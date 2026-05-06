// =============================================================================
// Mythos 0X Forge — API Worker
//
// Routes:
//   GET  /v1/health
//   GET  /v1/me                       whoami (tier from D1 if signed in)
//   POST /v1/analyze                  multipart, gated by daily tier limits
//   POST /v1/checkout                 {price_id} → Stripe Checkout URL
//   POST /v1/portal                   {return_url?} → Stripe Customer Portal
//   POST /v1/auth/magic-link          {email} → emails a magic link via Resend
//   GET  /v1/auth/verify?token=…      consumes magic token, redirects to /
//   POST /v1/auth/logout              clears session
//   POST /webhooks/stripe             Stripe → upserts users + subscriptions
// =============================================================================

import type { Env, Tier, AnalysisResult, MediaKind } from './types';
import { DAILY_LIMITS } from './types';
import {
  anonIdentity,
  clearSessionCookieHeader,
  createSession,
  deleteSession,
  lookupSession,
  randomToken,
  readSessionCookie,
  setSessionCookieHeader,
  tierForUser,
  upsertUserByEmail,
  userIdentity,
  utcDay,
} from './auth';
import {
  buildPriceMap,
  createBillingPortalSession,
  createCheckoutSession,
  priceMeta,
  verifyStripeSignature,
} from './stripe';
import { runDetection } from './detect';

const MAX_IMAGE = 20 * 1024 * 1024;
const MAX_VIDEO = 50 * 1024 * 1024;
const IMAGE_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp']);
const VIDEO_TYPES = new Set(['video/mp4', 'video/webm']);

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    buildPriceMap(env);
    const url = new URL(req.url);
    const cors = corsHeaders(env, req.headers.get('origin'));

    if (req.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: cors });
    }

    try {
      // Auth & app routes
      if (url.pathname === '/v1/health') return json({ ok: true, ts: Date.now() }, cors);
      if (url.pathname === '/v1/me') return await whoami(req, env, cors);
      if (url.pathname === '/v1/analyses' && req.method === 'GET')
        return await listAnalyses(req, env, cors);
      if (url.pathname === '/v1/analyze' && req.method === 'POST')
        return await analyze(req, env, cors);

      // Billing
      if (url.pathname === '/v1/checkout' && req.method === 'POST')
        return await checkout(req, env, cors);
      if (url.pathname === '/v1/portal' && req.method === 'POST')
        return await portal(req, env, cors);

      // Auth
      if (url.pathname === '/v1/auth/magic-link' && req.method === 'POST')
        return await sendMagicLink(req, env, cors);
      if (url.pathname === '/v1/auth/verify' && req.method === 'GET')
        return await verifyMagicLink(req, env, url);
      if (url.pathname === '/v1/auth/logout' && req.method === 'POST')
        return await logout(req, env, cors);

      // Webhook (no CORS — Stripe POSTs server-to-server)
      if (url.pathname === '/webhooks/stripe' && req.method === 'POST')
        return await stripeWebhook(req, env);

      return json({ error: 'not_found' }, cors, 404);
    } catch (err) {
      console.error('handler_error', (err as Error).stack);
      return json({ error: 'internal_error', detail: (err as Error).message }, cors, 500);
    }
  },
};

// -- whoami -------------------------------------------------------------------

async function whoami(req: Request, env: Env, cors: HeadersInit): Promise<Response> {
  const token = readSessionCookie(req);
  const user = token ? await lookupSession(env, token) : null;
  if (!user) {
    return json({ authenticated: false, tier: 'free' as Tier, limits: DAILY_LIMITS }, cors);
  }
  const tier = await tierForUser(env, user.id);
  return json(
    {
      authenticated: true,
      user: { id: user.id, email: user.email, tier, hasStripe: !!user.stripe_customer_id },
      limits: DAILY_LIMITS,
    },
    cors,
  );
}

// -- analyze (gated) ----------------------------------------------------------

async function analyze(req: Request, env: Env, cors: HeadersInit): Promise<Response> {
  const start = Date.now();
  const form = await req.formData();
  const entry = form.get('file');
  if (!entry || typeof entry === 'string') {
    return json({ error: 'missing_file' }, cors, 400);
  }
  const file = entry as File;
  const v = validateFile(file);
  if (!v.ok) return json({ error: 'invalid_file', detail: v.reason }, cors, 400);

  // Identify caller
  const token = readSessionCookie(req);
  const user = token ? await lookupSession(env, token) : null;
  const tier: Tier = user ? await tierForUser(env, user.id) : 'free';
  const identity = user ? userIdentity(user.id) : await anonIdentity(req);
  const day = utcDay();

  // Daily limit check
  const limit = DAILY_LIMITS[tier];
  const used = await currentUsage(env, identity, day);
  if (used >= limit) {
    return json(
      {
        error: 'rate_limited',
        tier,
        used,
        limit,
        upgrade_url: `${env.SITE_URL}/pricing`,
      },
      cors,
      402,
    );
  }

  // R2 cache (used for verdict pages later; non-blocking metadata)
  const objectKey = `analyses/${crypto.randomUUID()}-${safeName(file.name)}`;
  await env.MEDIA.put(objectKey, file.stream(), {
    httpMetadata: { contentType: file.type },
    customMetadata: { kind: v.kind, originalName: file.name },
  });

  // Detect + narrate
  const result: AnalysisResult = await runDetection(file, v.kind, env);
  result.durationMs = Date.now() - start;

  // Persist + increment counter
  const analysisId = randomToken(12);
  const now = Math.floor(Date.now() / 1000);
  await env.DB.batch([
    env.DB.prepare(
      `INSERT INTO analyses (id, user_id, identity, kind, confidence, verdict, model_tag, duration_ms, r2_key, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).bind(
      analysisId,
      user?.id ?? null,
      identity,
      result.kind,
      result.confidence,
      result.verdict,
      result.modelTag,
      result.durationMs,
      objectKey,
      now,
    ),
    env.DB.prepare(
      `INSERT INTO usage_daily (identity, day, count) VALUES (?, ?, 1)
       ON CONFLICT(identity, day) DO UPDATE SET count = count + 1`,
    ).bind(identity, day),
  ]);

  return json(
    {
      ...result,
      analysisId,
      tier,
      used: used + 1,
      limit,
    },
    cors,
  );
}

async function listAnalyses(req: Request, env: Env, cors: HeadersInit): Promise<Response> {
  const token = readSessionCookie(req);
  const user = token ? await lookupSession(env, token) : null;
  if (!user) return json({ error: 'auth_required' }, cors, 401);
  const rows = await env.DB.prepare(
    `SELECT id, kind, confidence, verdict, model_tag, duration_ms, created_at
     FROM analyses WHERE user_id = ? ORDER BY created_at DESC LIMIT 50`,
  )
    .bind(user.id)
    .all<{
      id: string;
      kind: string;
      confidence: number;
      verdict: string;
      model_tag: string;
      duration_ms: number;
      created_at: number;
    }>();
  return json({ analyses: rows.results ?? [] }, cors);
}

async function currentUsage(env: Env, identity: string, day: string): Promise<number> {
  const row = await env.DB.prepare(
    'SELECT count FROM usage_daily WHERE identity = ? AND day = ?',
  )
    .bind(identity, day)
    .first<{ count: number }>();
  return row?.count ?? 0;
}

// -- billing ------------------------------------------------------------------

async function checkout(req: Request, env: Env, cors: HeadersInit): Promise<Response> {
  if (!env.STRIPE_SECRET_KEY) return json({ error: 'stripe_not_configured' }, cors, 503);
  const body = (await req.json().catch(() => ({}))) as {
    price_id?: string;
    email?: string;
  };
  if (!body.price_id) return json({ error: 'missing_price_id' }, cors, 400);
  if (!priceMeta(body.price_id)) return json({ error: 'unknown_price' }, cors, 400);

  const token = readSessionCookie(req);
  const user = token ? await lookupSession(env, token) : null;

  const session = await createCheckoutSession(env, {
    priceId: body.price_id,
    email: user?.email ?? body.email,
    userId: user?.id,
    successUrl: `${env.SITE_URL}/?checkout=success&session_id={CHECKOUT_SESSION_ID}`,
    cancelUrl: `${env.SITE_URL}/pricing?checkout=cancel`,
  });

  return json({ url: session.url, id: session.id }, cors);
}

async function portal(req: Request, env: Env, cors: HeadersInit): Promise<Response> {
  if (!env.STRIPE_SECRET_KEY) return json({ error: 'stripe_not_configured' }, cors, 503);
  const token = readSessionCookie(req);
  const user = token ? await lookupSession(env, token) : null;
  if (!user || !user.stripe_customer_id) {
    return json({ error: 'no_subscription' }, cors, 400);
  }
  const body = (await req.json().catch(() => ({}))) as { return_url?: string };
  const session = await createBillingPortalSession(env, {
    customerId: user.stripe_customer_id,
    returnUrl: body.return_url ?? `${env.SITE_URL}/account`,
  });
  return json({ url: session.url }, cors);
}

// -- magic-link auth ----------------------------------------------------------

async function sendMagicLink(req: Request, env: Env, cors: HeadersInit): Promise<Response> {
  const body = (await req.json().catch(() => ({}))) as { email?: string };
  const email = body.email?.trim().toLowerCase();
  if (!email || !email.includes('@')) return json({ error: 'invalid_email' }, cors, 400);

  const token = randomToken();
  const now = Math.floor(Date.now() / 1000);
  const expires = now + 60 * 15; // 15 minutes
  await env.DB.prepare(
    'INSERT INTO magic_tokens (token, email, expires_at, created_at) VALUES (?, ?, ?, ?)',
  )
    .bind(token, email, expires, now)
    .run();

  const verifyUrl = `https://api.mythos0x.com/v1/auth/verify?token=${token}`;

  if (env.RESEND_API_KEY) {
    const from = env.RESEND_FROM ?? 'Mythos 0X Forge <onboarding@resend.dev>';
    const r = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${env.RESEND_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from,
        to: [email],
        subject: 'Sign in to Mythos 0X Forge',
        html: `<div style="font-family:system-ui,sans-serif;max-width:480px;margin:0 auto;padding:32px;background:#0a0608;color:#fff;border-radius:12px"><h1 style="background:linear-gradient(180deg,#ffe6c4,#ffb347 50%,#c81d25);-webkit-background-clip:text;background-clip:text;color:transparent;font-size:32px;margin:0 0 12px">Mythos 0X Forge</h1><p style="color:#aaa;margin:0 0 24px">Forensic AI Authentication</p><p style="margin:0 0 16px">Click to enter the Forge:</p><p style="margin:24px 0"><a href="${verifyUrl}" style="display:inline-block;padding:14px 28px;background:linear-gradient(90deg,#ff5722,#c81d25);color:#fff;text-decoration:none;border-radius:999px;font-weight:600;letter-spacing:0.05em">Sign In</a></p><p style="color:#666;font-size:12px;margin:32px 0 0">Link expires in 15 minutes. If you didn't request this, ignore this email.</p></div>`,
        text: `Sign in to Mythos 0X Forge: ${verifyUrl}\n(expires in 15 minutes)`,
      }),
    });
    if (!r.ok) {
      const detail = await r.text().catch(() => '');
      console.error('resend_failed', r.status, detail.slice(0, 300));
    }
  } else {
    console.log('magic-link (no Resend configured):', verifyUrl);
  }

  return json({ ok: true }, cors);
}

async function verifyMagicLink(_req: Request, env: Env, url: URL): Promise<Response> {
  const token = url.searchParams.get('token');
  if (!token) return Response.redirect(`${env.SITE_URL}/?auth=missing_token`, 302);

  const now = Math.floor(Date.now() / 1000);
  const row = await env.DB.prepare(
    'SELECT email, expires_at, consumed_at FROM magic_tokens WHERE token = ?',
  )
    .bind(token)
    .first<{ email: string; expires_at: number; consumed_at: number | null }>();
  if (!row || row.consumed_at || row.expires_at < now) {
    return Response.redirect(`${env.SITE_URL}/?auth=expired`, 302);
  }
  await env.DB.prepare('UPDATE magic_tokens SET consumed_at = ? WHERE token = ?')
    .bind(now, token)
    .run();

  const user = await upsertUserByEmail(env, row.email);
  const session = await createSession(env, user.id);

  return new Response(null, {
    status: 302,
    headers: {
      Location: `${env.SITE_URL}/?auth=ok`,
      'set-cookie': setSessionCookieHeader(session),
    },
  });
}

async function logout(req: Request, env: Env, cors: HeadersInit): Promise<Response> {
  const token = readSessionCookie(req);
  if (token) await deleteSession(env, token);
  return new Response(JSON.stringify({ ok: true }), {
    status: 200,
    headers: {
      'content-type': 'application/json',
      'set-cookie': clearSessionCookieHeader(),
      ...cors,
    },
  });
}

// -- Stripe webhook -----------------------------------------------------------

async function stripeWebhook(req: Request, env: Env): Promise<Response> {
  if (!env.STRIPE_WEBHOOK_SECRET) {
    return new Response(JSON.stringify({ error: 'webhook_not_configured' }), {
      status: 503,
      headers: { 'content-type': 'application/json' },
    });
  }
  const sig = req.headers.get('stripe-signature');
  const raw = await req.text();
  if (!sig || !(await verifyStripeSignature(raw, sig, env.STRIPE_WEBHOOK_SECRET))) {
    return new Response(JSON.stringify({ error: 'invalid_signature' }), { status: 400 });
  }
  const event = JSON.parse(raw) as { type: string; data: { object: any } }; // eslint-disable-line @typescript-eslint/no-explicit-any

  try {
    switch (event.type) {
      case 'checkout.session.completed':
        await handleCheckoutCompleted(env, event.data.object);
        break;
      case 'customer.subscription.created':
      case 'customer.subscription.updated':
        await upsertSubscription(env, event.data.object);
        break;
      case 'customer.subscription.deleted':
        await markSubscriptionCanceled(env, event.data.object);
        break;
    }
  } catch (e) {
    console.error('webhook_handler_failed', event.type, (e as Error).message);
    // Return 200 anyway so Stripe doesn't retry storms; we log for follow-up.
  }

  return new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } });
}

interface StripeCheckoutSession {
  id: string;
  customer: string;
  customer_email: string | null;
  customer_details?: { email?: string };
  metadata?: { user_id?: string };
}

async function handleCheckoutCompleted(env: Env, s: StripeCheckoutSession): Promise<void> {
  const email =
    s.customer_email ?? s.customer_details?.email ?? null;
  if (!email) return;
  const user = await upsertUserByEmail(env, email);
  await env.DB.prepare(
    'UPDATE users SET stripe_customer_id = ? WHERE id = ?',
  )
    .bind(s.customer, user.id)
    .run();
}

interface StripeSubscription {
  id: string;
  customer: string;
  status: string;
  current_period_end: number;
  cancel_at_period_end: boolean;
  items: { data: Array<{ price: { id: string; recurring?: { interval: string } } }> };
  metadata?: { tier?: string };
}

async function upsertSubscription(env: Env, sub: StripeSubscription): Promise<void> {
  const item = sub.items.data[0];
  if (!item) return;
  const meta = priceMeta(item.price.id);
  if (!meta) return;
  // Find user by stripe_customer_id
  const user = await env.DB.prepare(
    'SELECT id FROM users WHERE stripe_customer_id = ?',
  )
    .bind(sub.customer)
    .first<{ id: string }>();
  if (!user) {
    console.warn('webhook_orphan_sub', sub.id, sub.customer);
    return;
  }
  const now = Math.floor(Date.now() / 1000);
  await env.DB.prepare(
    `INSERT INTO subscriptions
       (id, user_id, stripe_customer_id, status, price_id, tier, interval, current_period_end, cancel_at_period_end, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET
       status = excluded.status,
       price_id = excluded.price_id,
       tier = excluded.tier,
       interval = excluded.interval,
       current_period_end = excluded.current_period_end,
       cancel_at_period_end = excluded.cancel_at_period_end,
       updated_at = excluded.updated_at`,
  )
    .bind(
      sub.id,
      user.id,
      sub.customer,
      sub.status,
      item.price.id,
      meta.tier,
      meta.interval,
      sub.current_period_end,
      sub.cancel_at_period_end ? 1 : 0,
      now,
      now,
    )
    .run();
  // Mirror tier on user row for cheap reads
  await env.DB.prepare('UPDATE users SET tier = ? WHERE id = ?')
    .bind(sub.status === 'active' || sub.status === 'trialing' ? meta.tier : 'free', user.id)
    .run();
}

async function markSubscriptionCanceled(env: Env, sub: StripeSubscription): Promise<void> {
  const now = Math.floor(Date.now() / 1000);
  await env.DB.prepare(
    'UPDATE subscriptions SET status = ?, updated_at = ? WHERE id = ?',
  )
    .bind('canceled', now, sub.id)
    .run();
  // Demote user
  await env.DB.prepare(
    `UPDATE users SET tier = 'free' WHERE stripe_customer_id = ?`,
  )
    .bind(sub.customer)
    .run();
}

// -- helpers ------------------------------------------------------------------

function validateFile(
  file: File,
): { ok: true; kind: MediaKind } | { ok: false; reason: string } {
  if (IMAGE_TYPES.has(file.type)) {
    if (file.size > MAX_IMAGE) return { ok: false, reason: 'image_too_large' };
    return { ok: true, kind: 'image' };
  }
  if (VIDEO_TYPES.has(file.type)) {
    if (file.size > MAX_VIDEO) return { ok: false, reason: 'video_too_large' };
    return { ok: true, kind: 'video' };
  }
  return { ok: false, reason: 'unsupported_type' };
}

function safeName(name: string): string {
  return name.replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 80);
}

function corsHeaders(env: Env, origin: string | null): HeadersInit {
  const allowed = origin === env.ALLOWED_ORIGIN || origin === 'http://localhost:5173';
  return {
    'access-control-allow-origin': allowed ? origin! : env.ALLOWED_ORIGIN,
    'access-control-allow-credentials': 'true',
    'access-control-allow-methods': 'POST, GET, OPTIONS',
    'access-control-allow-headers': 'content-type',
    'access-control-max-age': '86400',
    vary: 'origin',
  };
}

function json(body: unknown, cors: HeadersInit, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', ...cors },
  });
}
