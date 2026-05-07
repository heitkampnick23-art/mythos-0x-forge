// Stripe metered overage — automatic billing when paying users exceed their
// daily count limit. Free users still 402 (no card on file).
//
// Setup is one-shot via POST /v1/admin/setup-overage (Max-only). Creates:
//   1. A Meter named 'forge_analyses_overage' with sum aggregation, customer
//      mapping by stripe_customer_id from the event payload.
//   2. A Product 'Forge Analyses (over plan)'.
//   3. A metered Price ($0.10/analysis) attached to that meter + product.
//   4. Stores meter_id + price_id in app_settings so the rest of the worker
//      can read them.
//
// On overage (Pro/Max user past daily count cap):
//   - We send a MeterEvent to Stripe
//   - We allow the analysis to proceed (no 402)
//   - Stripe aggregates and adds an overage line to the next invoice
//
// To actually bill: the metered price must be a SubscriptionItem on the
// customer's subscription. We attach it lazily (on first overage) using
// `subscription_items.create`.

import type { Env } from './types';

const OVERAGE_EVENT_NAME = 'forge_analyses_overage';

async function getSetting(env: Env, key: string): Promise<string | null> {
  const r = await env.DB.prepare('SELECT value FROM app_settings WHERE key = ?')
    .bind(key)
    .first<{ value: string }>();
  return r?.value ?? null;
}

async function setSetting(env: Env, key: string, value: string): Promise<void> {
  const now = Math.floor(Date.now() / 1000);
  await env.DB.prepare(
    `INSERT INTO app_settings (key, value, updated_at) VALUES (?, ?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
  )
    .bind(key, value, now)
    .run();
}

async function stripe<T>(env: Env, path: string, body?: string): Promise<T> {
  if (!env.STRIPE_SECRET_KEY) throw new Error('stripe_not_configured');
  const r = await fetch(`https://api.stripe.com/v1${path}`, {
    method: body ? 'POST' : 'GET',
    headers: {
      Authorization: `Bearer ${env.STRIPE_SECRET_KEY}`,
      'content-type': 'application/x-www-form-urlencoded',
    },
    body,
  });
  if (!r.ok) {
    const err = await r.text().catch(() => '');
    throw new Error(`stripe_${r.status}: ${err.slice(0, 250)}`);
  }
  return (await r.json()) as T;
}

function form(params: Record<string, string | number | undefined>): string {
  const u = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined) continue;
    u.append(k, String(v));
  }
  return u.toString();
}

// ---- one-shot admin setup ---------------------------------------------------

export async function setupOverageInfra(env: Env): Promise<{
  meter_id: string;
  product_id: string;
  price_id: string;
  already_existed: boolean;
}> {
  const existingMeter = await getSetting(env, 'overage_meter_id');
  const existingPrice = await getSetting(env, 'overage_price_id');
  const existingProduct = await getSetting(env, 'overage_product_id');
  if (existingMeter && existingPrice && existingProduct) {
    return {
      meter_id: existingMeter,
      product_id: existingProduct,
      price_id: existingPrice,
      already_existed: true,
    };
  }

  // 1. Create Meter
  const meter = await stripe<{ id: string }>(
    env,
    '/billing/meters',
    form({
      display_name: 'Forge Analyses Overage',
      event_name: OVERAGE_EVENT_NAME,
      'default_aggregation[formula]': 'sum',
      'customer_mapping[event_payload_key]': 'stripe_customer_id',
      'customer_mapping[type]': 'by_id',
      'value_settings[event_payload_key]': 'value',
    }),
  );

  // 2. Create Product
  const product = await stripe<{ id: string }>(
    env,
    '/products',
    form({
      name: 'Forge Analyses (over plan)',
      description:
        'Per-analysis overage charged when a Pro or Max subscriber exceeds their daily plan limit. Billed at the end of each cycle on the existing card.',
    }),
  );

  // 3. Create metered Price ($0.10/analysis)
  const price = await stripe<{ id: string }>(
    env,
    '/prices',
    form({
      product: product.id,
      currency: 'usd',
      unit_amount: 10, // cents
      'recurring[interval]': 'month',
      'recurring[usage_type]': 'metered',
      'recurring[meter]': meter.id,
      billing_scheme: 'per_unit',
    }),
  );

  await setSetting(env, 'overage_meter_id', meter.id);
  await setSetting(env, 'overage_product_id', product.id);
  await setSetting(env, 'overage_price_id', price.id);

  return {
    meter_id: meter.id,
    product_id: product.id,
    price_id: price.id,
    already_existed: false,
  };
}

// ---- runtime: emit a meter event + attach SubscriptionItem on first overage --

export async function recordOverage(
  env: Env,
  stripeCustomerId: string,
  count = 1,
): Promise<{ ok: true } | { ok: false; reason: string }> {
  if (!env.STRIPE_SECRET_KEY) return { ok: false, reason: 'stripe_not_configured' };
  const meterId = await getSetting(env, 'overage_meter_id');
  const priceId = await getSetting(env, 'overage_price_id');
  if (!meterId || !priceId) return { ok: false, reason: 'overage_not_setup' };

  // 1. Make sure this customer has the metered price attached as a SubscriptionItem.
  //    Idempotent — `attached_to:cus_xxx` flag is stored per-customer.
  const attachKey = `overage_attached_${stripeCustomerId}`;
  const attached = await getSetting(env, attachKey);
  if (!attached) {
    try {
      // Find their active subscription
      const subs = await stripe<{ data: Array<{ id: string }> }>(
        env,
        `/subscriptions?customer=${encodeURIComponent(stripeCustomerId)}&status=active&limit=1`,
      );
      const sub = subs.data?.[0];
      if (sub) {
        await stripe(
          env,
          '/subscription_items',
          form({ subscription: sub.id, price: priceId }),
        );
      }
      await setSetting(env, attachKey, '1');
    } catch (e) {
      // Non-fatal — log but don't fail the analyze. We'll retry on next overage.
      console.error('overage_attach_failed', stripeCustomerId, (e as Error).message);
    }
  }

  // 2. Emit the meter event
  try {
    await stripe(
      env,
      '/billing/meter_events',
      form({
        event_name: OVERAGE_EVENT_NAME,
        'payload[stripe_customer_id]': stripeCustomerId,
        'payload[value]': count,
      }),
    );
    return { ok: true };
  } catch (e) {
    console.error('meter_event_failed', stripeCustomerId, (e as Error).message);
    return { ok: false, reason: (e as Error).message };
  }
}

export async function isOverageEnabled(env: Env): Promise<boolean> {
  return Boolean(await getSetting(env, 'overage_price_id'));
}
