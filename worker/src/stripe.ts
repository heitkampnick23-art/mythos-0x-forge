// Thin Stripe wrapper for Workers. Uses the form-encoded REST API directly
// (no SDK) to keep the bundle small and avoid Node.js polyfills.

import type { Env, Tier } from './types';

const API = 'https://api.stripe.com/v1';

export type Interval = 'month' | 'year';

const PRICE_TO_TIER: Record<string, { tier: Tier; interval: Interval }> = {};

export function buildPriceMap(env: Env) {
  PRICE_TO_TIER[env.PRICE_PRO_MONTHLY] = { tier: 'pro', interval: 'month' };
  PRICE_TO_TIER[env.PRICE_PRO_YEARLY] = { tier: 'pro', interval: 'year' };
  PRICE_TO_TIER[env.PRICE_MAX_MONTHLY] = { tier: 'max', interval: 'month' };
  PRICE_TO_TIER[env.PRICE_MAX_YEARLY] = { tier: 'max', interval: 'year' };
}

export function priceMeta(priceId: string): { tier: Tier; interval: Interval } | null {
  return PRICE_TO_TIER[priceId] ?? null;
}

function form(params: Record<string, string | number | boolean | undefined>): string {
  const u = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined) continue;
    u.append(k, String(v));
  }
  return u.toString();
}

async function call<T>(env: Env, path: string, body: string): Promise<T> {
  if (!env.STRIPE_SECRET_KEY) throw new Error('stripe_not_configured');
  const r = await fetch(`${API}${path}`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${env.STRIPE_SECRET_KEY}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body,
  });
  if (!r.ok) {
    const err = await r.text().catch(() => '');
    throw new Error(`stripe_${r.status}: ${err.slice(0, 200)}`);
  }
  return (await r.json()) as T;
}

export async function createCheckoutSession(
  env: Env,
  args: { priceId: string; email?: string; userId?: string; successUrl: string; cancelUrl: string },
): Promise<{ id: string; url: string }> {
  const meta = priceMeta(args.priceId);
  if (!meta) throw new Error('unknown_price');
  return call(
    env,
    '/checkout/sessions',
    form({
      mode: 'subscription',
      'line_items[0][price]': args.priceId,
      'line_items[0][quantity]': 1,
      success_url: args.successUrl,
      cancel_url: args.cancelUrl,
      customer_email: args.email,
      'metadata[tier]': meta.tier,
      'metadata[interval]': meta.interval,
      'metadata[user_id]': args.userId ?? '',
      allow_promotion_codes: 'true',
      billing_address_collection: 'auto',
    }),
  );
}

export async function createBillingPortalSession(
  env: Env,
  args: { customerId: string; returnUrl: string },
): Promise<{ id: string; url: string }> {
  return call(
    env,
    '/billing_portal/sessions',
    form({ customer: args.customerId, return_url: args.returnUrl }),
  );
}

// -- Webhook signature verification (Stripe spec) -----------------------------

export async function verifyStripeSignature(
  rawBody: string,
  signatureHeader: string,
  secret: string,
  toleranceSec = 300,
): Promise<boolean> {
  // header format: t=<unix>,v1=<sig>,v0=<sig>
  const parts = signatureHeader.split(',').reduce<Record<string, string>>((acc, kv) => {
    const [k, v] = kv.split('=');
    if (k && v) acc[k.trim()] = v.trim();
    return acc;
  }, {});
  const t = parts['t'];
  const v1 = parts['v1'];
  if (!t || !v1) return false;
  const now = Math.floor(Date.now() / 1000);
  if (Math.abs(now - Number(t)) > toleranceSec) return false;

  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw',
    enc.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const mac = await crypto.subtle.sign('HMAC', key, enc.encode(`${t}.${rawBody}`));
  const expected = Array.from(new Uint8Array(mac), (b) => b.toString(16).padStart(2, '0')).join('');
  return timingSafeEqual(expected, v1);
}

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let acc = 0;
  for (let i = 0; i < a.length; i++) acc |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return acc === 0;
}
