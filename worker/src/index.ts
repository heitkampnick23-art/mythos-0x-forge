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
import {
  VOICES,
  chat as soulChat,
  createSoul,
  deleteSoul,
  getSoul,
  listMarketplace,
  listMine,
  remixSoul,
  speakText,
} from './souls';
import { chargeCost, getBudget } from './budget';
import { canView, loadBySlug, publicPayload, renderPdf, streamMedia } from './verdicts';
import { runAlertsCheck } from './alerts';
import { runWeeklyDigest } from './digest';
import { embedScript } from './embed';
import { deleteDoc, listDocs, uploadDoc } from './kb';
import { isOverageEnabled, recordOverage, setupOverageInfra } from './overage';
import { attachPhone, detachPhone, handleIncoming, handleRespond, handleTts } from './phone';
import { batchCsv, createBatch, getBatchStatus, listBatches, processBatch } from './batch';
import { getSignedUrl as getConvaiSignedUrl } from './convai';
import {
  applyReferralOnSignup,
  ensureReferralCode,
  readReferralCookie,
  recordReferralPayment,
  statsFor as referralStatsFor,
} from './referrals';
// NOTE: src/campaigns.ts exists as scaffolding for a future personal-CRM
// feature (manually-added contacts only). Intentionally NOT imported / wired
// — sending bulk cold email to non-consenting recipients would burn the
// domain reputation we built and is also what platform classifiers call spam.

const MAX_IMAGE = 20 * 1024 * 1024;
const MAX_VIDEO = 50 * 1024 * 1024;
const IMAGE_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp']);
const VIDEO_TYPES = new Set(['video/mp4', 'video/webm']);

export default {
  /** Cron trigger — Cloudflare Workers fires this on the schedules defined
   *  in wrangler.toml. Discriminate by event.cron:
   *    "0 * * * *"    → hourly anomaly alerts
   *    "0 14 * * 1"   → weekly digest emails
   */
  async scheduled(event: ScheduledEvent, env: Env, ctx: ExecutionContext): Promise<void> {
    buildPriceMap(env);
    if (event.cron === '0 14 * * 1') {
      ctx.waitUntil(
        runWeeklyDigest(env).then((r) =>
          console.log('digest: sent', r.sent, 'skipped', r.skipped, 'failed', r.failed),
        ),
      );
      return;
    }
    ctx.waitUntil(runAlertsCheck(env).then((r) => console.log('alerts: posted', r.posted)));
  },

  async fetch(req: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    buildPriceMap(env);
    const url = new URL(req.url);
    const cors = corsHeaders(env, req.headers.get('origin'), req);

    if (req.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: cors });
    }

    try {
      // Auth & app routes
      if (url.pathname === '/v1/health') return json({ ok: true, ts: Date.now() }, cors);
      // Bulk URL batches (Max-only)
      if (url.pathname === '/v1/batch' && req.method === 'POST')
        return await batchCreate(req, env, cors, ctx);
      if (url.pathname === '/v1/batch' && req.method === 'GET')
        return await batchListMine(req, env, cors);
      const batchMatch = url.pathname.match(/^\/v1\/batch\/([^/]+)(?:\/([a-z]+))?$/);
      if (batchMatch) {
        const [, id, action] = batchMatch;
        if (!action && req.method === 'GET') return await batchGet(req, env, cors, id);
        if (action === 'csv' && req.method === 'GET') return await batchCsvDl(req, env, cors, id);
      }

      // Twilio voice (no auth — Twilio webhook hits us directly)
      if (url.pathname === '/v1/phone/incoming' && req.method === 'POST')
        return await handleIncoming(req, env);
      if (url.pathname === '/v1/phone/respond' && req.method === 'POST')
        return await handleRespond(req, env);
      if (url.pathname === '/v1/phone/tts' && req.method === 'GET')
        return await handleTts(req, env);

      // Phone attach/detach (owner-authenticated)
      const phoneMatch = url.pathname.match(/^\/v1\/souls\/([^/]+)\/phone$/);
      if (phoneMatch) {
        const idOrSlug = phoneMatch[1];
        const sessionToken = readSessionCookie(req);
        const sessionUser = sessionToken ? await lookupSession(env, sessionToken) : null;
        if (!sessionUser) return json({ error: 'auth_required' }, cors, 401);
        if (req.method === 'POST') {
          const body = (await req.json().catch(() => ({}))) as { phone_number?: string };
          if (!body.phone_number) return json({ error: 'missing_phone_number' }, cors, 400);
          const r = await attachPhone(env, sessionUser.id, idOrSlug, body.phone_number);
          if (!r.ok) return json({ error: r.error }, cors, r.status);
          return json({ ok: true }, cors);
        }
        if (req.method === 'DELETE') {
          const r = await detachPhone(env, sessionUser.id, idOrSlug);
          if (!r.ok) return json({ error: r.error }, cors, r.status);
          return json({ ok: true }, cors);
        }
      }

      // Heartbeat embed widget — public, drop-in script for any site.
      if (url.pathname === '/v1/embed/heartbeat.js' && req.method === 'GET') {
        return new Response(embedScript(env), {
          status: 200,
          headers: {
            'content-type': 'application/javascript; charset=utf-8',
            'cache-control': 'public, max-age=300',
            'access-control-allow-origin': '*',
          },
        });
      }
      // Manual alert-check trigger (for testing the webhook integration).
      // Auth-gated to Max only so randoms can't spam your Slack.
      if (url.pathname === '/v1/admin/digest-send' && req.method === 'POST') {
        const token = readSessionCookie(req);
        const user = token ? await lookupSession(env, token) : null;
        if (!user) return json({ error: 'auth_required' }, cors, 401);
        const tier = await tierForUser(env, user.id);
        if (tier !== 'max') return json({ error: 'forbidden' }, cors, 403);
        const r = await runWeeklyDigest(env);
        return json(r, cors);
      }
      if (url.pathname === '/v1/admin/alerts-check' && req.method === 'POST') {
        const token = readSessionCookie(req);
        const user = token ? await lookupSession(env, token) : null;
        if (!user) return json({ error: 'auth_required' }, cors, 401);
        const tier = await tierForUser(env, user.id);
        if (tier !== 'max') return json({ error: 'forbidden' }, cors, 403);
        const r = await runAlertsCheck(env);
        return json(r, cors);
      }
      // One-shot Stripe overage setup. Idempotent. Max-only.
      if (url.pathname === '/v1/admin/setup-overage' && req.method === 'POST') {
        const token = readSessionCookie(req);
        const user = token ? await lookupSession(env, token) : null;
        if (!user) return json({ error: 'auth_required' }, cors, 401);
        const tier = await tierForUser(env, user.id);
        if (tier !== 'max') return json({ error: 'forbidden' }, cors, 403);
        try {
          const r = await setupOverageInfra(env);
          return json(r, cors);
        } catch (e) {
          return json({ error: 'setup_failed', detail: (e as Error).message }, cors, 502);
        }
      }
      if (url.pathname === '/v1/me') return await whoami(req, env, cors);
      if (url.pathname === '/v1/me/usage' && req.method === 'GET')
        return await meUsage(req, env, cors);
      if (url.pathname === '/v1/me/profile' && req.method === 'POST')
        return await meProfile(req, env, cors);
      if (url.pathname === '/v1/me/referrals' && req.method === 'GET')
        return await meReferrals(req, env, cors);
      if (url.pathname === '/v1/analyses' && req.method === 'GET')
        return await listAnalyses(req, env, cors);
      if (url.pathname === '/v1/analyze' && req.method === 'POST')
        return await analyze(req, env, cors);
      if (url.pathname === '/v1/voice/verdict' && req.method === 'POST')
        return await voiceVerdict(req, env, cors);

      // Paginated public feed
      if (url.pathname === '/v1/verdicts/feed' && req.method === 'GET') {
        const limit = Math.min(Math.max(Number(url.searchParams.get('limit') ?? 24), 1), 60);
        const before = Number(url.searchParams.get('before') ?? 0);
        const verdictFilter = url.searchParams.get('verdict'); // optional
        const filterClauses = ['public = 1', 'share_slug IS NOT NULL'];
        const params: unknown[] = [];
        if (before > 0) {
          filterClauses.push('created_at < ?');
          params.push(before);
        }
        if (verdictFilter && ['authentic', 'suspect', 'synthetic'].includes(verdictFilter)) {
          filterClauses.push('verdict = ?');
          params.push(verdictFilter);
        }
        const sql = `SELECT share_slug, kind, confidence, verdict, original_name, created_at
                     FROM analyses WHERE ${filterClauses.join(' AND ')}
                     ORDER BY created_at DESC LIMIT ?`;
        params.push(limit + 1);
        const rows = await env.DB.prepare(sql).bind(...params).all<{
          share_slug: string;
          kind: string;
          confidence: number;
          verdict: string;
          original_name: string | null;
          created_at: number;
        }>();
        const items = rows.results ?? [];
        const hasMore = items.length > limit;
        const trimmed = hasMore ? items.slice(0, limit) : items;
        const next = hasMore ? trimmed[trimmed.length - 1].created_at : null;
        const headers = new Headers(cors as HeadersInit);
        headers.set('cache-control', 'public, max-age=60');
        return new Response(JSON.stringify({ verdicts: trimmed, next_before: next }), {
          status: 200,
          headers: { 'content-type': 'application/json', ...Object.fromEntries(headers) },
        });
      }
      // Recent public verdicts (for homepage social-proof strip)
      if (url.pathname === '/v1/verdicts/recent' && req.method === 'GET') {
        const rows = await env.DB.prepare(
          `SELECT share_slug, kind, confidence, verdict, original_name, created_at
           FROM analyses WHERE public = 1 AND share_slug IS NOT NULL
           ORDER BY created_at DESC LIMIT 12`,
        ).all<{
          share_slug: string;
          kind: string;
          confidence: number;
          verdict: string;
          original_name: string | null;
          created_at: number;
        }>();
        const headers = new Headers(cors as HeadersInit);
        headers.set('cache-control', 'public, max-age=120');
        return new Response(JSON.stringify({ verdicts: rows.results ?? [] }), {
          status: 200,
          headers: { 'content-type': 'application/json', ...Object.fromEntries(headers) },
        });
      }
      // Public verdict pages + PDF reports
      const verdictMatch = url.pathname.match(/^\/v1\/verdicts\/([^/]+)(?:\/([a-z]+))?$/);
      if (verdictMatch) {
        const [, slug, action] = verdictMatch;
        if (!action && req.method === 'GET') return await getVerdict(req, env, cors, slug);
        if (action === 'image' && req.method === 'GET')
          return await getVerdictMedia(req, env, cors, slug);
        if (action === 'pdf' && req.method === 'GET')
          return await getVerdictPdf(req, env, cors, slug);
      }
      const shareMatch = url.pathname.match(/^\/v1\/analyses\/([^/]+)\/share$/);
      if (shareMatch && req.method === 'POST') {
        return await toggleShare(req, env, cors, shareMatch[1]);
      }

      // Heartbeat / Souls
      if (url.pathname === '/v1/souls/voices' && req.method === 'GET')
        return json({ voices: VOICES }, cors);
      if (url.pathname === '/v1/souls/marketplace' && req.method === 'GET')
        return json(await listMarketplace(env), cors);
      if (url.pathname === '/v1/souls/mine' && req.method === 'GET')
        return await soulsMine(req, env, cors);
      if (url.pathname === '/v1/souls' && req.method === 'POST')
        return await soulsCreate(req, env, cors);
      // KB endpoints (more specific than the generic soul match below).
      const kbMatch = url.pathname.match(/^\/v1\/souls\/([^/]+)\/kb(?:\/([^/]+))?$/);
      if (kbMatch) {
        const [, idOrSlug, docId] = kbMatch;
        if (!docId && req.method === 'GET') return await kbList(req, env, cors, idOrSlug);
        if (!docId && req.method === 'POST') return await kbUpload(req, env, cors, idOrSlug);
        if (docId && req.method === 'DELETE')
          return await kbDelete(req, env, cors, idOrSlug, docId);
      }
      const soulMatch = url.pathname.match(/^\/v1\/souls\/([^/]+)(?:\/([a-z-]+))?$/);
      if (soulMatch) {
        const [, idOrSlug, action] = soulMatch;
        if (!action && req.method === 'GET') return await soulsGet(req, env, cors, idOrSlug);
        if (!action && req.method === 'DELETE') return await soulsDelete(req, env, cors, idOrSlug);
        if (action === 'chat' && req.method === 'POST')
          return await soulsChat(req, env, cors, idOrSlug);
        if (action === 'speak' && req.method === 'POST')
          return await soulsSpeak(req, env, cors, idOrSlug);
        if (action === 'remix' && req.method === 'POST')
          return await soulsRemix(req, env, cors, idOrSlug);
        if (action === 'convai-url' && req.method === 'POST')
          return await soulsConvaiUrl(req, env, cors, idOrSlug);
      }

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
      if (url.pathname === '/v1/auth/google/start' && req.method === 'GET')
        return await googleStart(req, env);
      if (url.pathname === '/v1/auth/google/callback' && req.method === 'GET')
        return await googleCallback(req, env);
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
  const referral_code = await ensureReferralCode(env, user.id);
  // Fetch profile columns separately because lookupSession returns the base User shape.
  const profile = await env.DB.prepare(
    'SELECT display_name, default_voice_id, auto_speak, notify_email FROM users WHERE id = ?',
  )
    .bind(user.id)
    .first<{
      display_name: string | null;
      default_voice_id: string;
      auto_speak: number;
      notify_email: number;
    }>();
  return json(
    {
      authenticated: true,
      user: {
        id: user.id,
        email: user.email,
        tier,
        hasStripe: !!user.stripe_customer_id,
        referral_code,
        display_name: profile?.display_name ?? null,
        default_voice_id: profile?.default_voice_id ?? 'pNInz6obpgDQGcFmaJgB',
        auto_speak: profile?.auto_speak !== 0,
        notify_email: profile?.notify_email !== 0,
      },
      limits: DAILY_LIMITS,
    },
    cors,
  );
}

async function meUsage(req: Request, env: Env, cors: HeadersInit): Promise<Response> {
  const token = readSessionCookie(req);
  const user = token ? await lookupSession(env, token) : null;
  if (!user) return json({ error: 'auth_required' }, cors, 401);
  const tier = await tierForUser(env, user.id);
  const identity = userIdentity(user.id);
  const day = utcDay();

  const [budget, analyses, soulMessages] = await Promise.all([
    getBudget(env, identity, tier),
    env.DB.prepare('SELECT count FROM usage_daily WHERE identity = ? AND day = ?')
      .bind(identity, day)
      .first<{ count: number }>(),
    env.DB.prepare('SELECT message_count FROM soul_usage_daily WHERE identity = ? AND day = ?')
      .bind(identity, day)
      .first<{ message_count: number }>(),
  ]);

  return json(
    {
      tier,
      day,
      budget: {
        used_cents: budget.used_microcents / 100,
        cap_cents: budget.cap_microcents / 100,
        ratio: Number(budget.ratio.toFixed(3)),
        near_limit: budget.near_limit,
        exceeded: budget.exceeded,
      },
      analyses: {
        used: analyses?.count ?? 0,
        limit: DAILY_LIMITS[tier],
      },
      soul_messages: {
        used: soulMessages?.message_count ?? 0,
        // Soul daily-message limits live in souls.ts; mirror them here for the dashboard.
        limit: tier === 'free' ? 50 : tier === 'pro' ? 200 : 1000,
      },
    },
    cors,
  );
}

async function meReferrals(req: Request, env: Env, cors: HeadersInit): Promise<Response> {
  const token = readSessionCookie(req);
  const user = token ? await lookupSession(env, token) : null;
  if (!user) return json({ error: 'auth_required' }, cors, 401);
  const stats = await referralStatsFor(env, user.id);
  return json(stats, cors);
}

async function meProfile(req: Request, env: Env, cors: HeadersInit): Promise<Response> {
  const token = readSessionCookie(req);
  const user = token ? await lookupSession(env, token) : null;
  if (!user) return json({ error: 'auth_required' }, cors, 401);
  const body = (await req.json().catch(() => ({}))) as {
    display_name?: string;
    default_voice_id?: string;
    auto_speak?: boolean;
    notify_email?: boolean;
  };

  const updates: string[] = [];
  const values: unknown[] = [];
  if (typeof body.display_name === 'string') {
    updates.push('display_name = ?');
    values.push(body.display_name.trim().slice(0, 60) || null);
  }
  if (typeof body.default_voice_id === 'string') {
    updates.push('default_voice_id = ?');
    values.push(body.default_voice_id);
  }
  if (typeof body.auto_speak === 'boolean') {
    updates.push('auto_speak = ?');
    values.push(body.auto_speak ? 1 : 0);
  }
  if (typeof body.notify_email === 'boolean') {
    updates.push('notify_email = ?');
    values.push(body.notify_email ? 1 : 0);
  }
  if (updates.length === 0) return json({ ok: true, no_changes: true }, cors);

  values.push(user.id);
  await env.DB.prepare(`UPDATE users SET ${updates.join(', ')} WHERE id = ?`)
    .bind(...values)
    .run();
  return json({ ok: true }, cors);
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

  // Daily limit check (count) + budget check (cost)
  const limit = DAILY_LIMITS[tier];
  const used = await currentUsage(env, identity, day);
  let overageBilled = false;
  if (used >= limit) {
    // Free → hard 402. Pro/Max with active subscription → bill metered overage
    // and let it through (capped by daily budget below).
    if (tier === 'free' || !user?.stripe_customer_id || !(await isOverageEnabled(env))) {
      return json(
        { error: 'rate_limited', tier, used, limit, upgrade_url: `${env.SITE_URL}/pricing` },
        cors,
        402,
      );
    }
    // Bill the overage (best-effort; non-blocking on Stripe failures)
    overageBilled = (await recordOverage(env, user.stripe_customer_id, 1)).ok;
  }
  const budget = await getBudget(env, identity, tier);
  if (budget.exceeded) {
    return json(
      {
        error: 'budget_exceeded',
        tier,
        used_microcents: budget.used_microcents,
        cap_microcents: budget.cap_microcents,
        upgrade_url: `${env.SITE_URL}/pricing`,
      },
      cors,
      402,
    );
  }

  // Read once, hash + R2 put + Sightengine all share the same File object.
  // (File.stream() can be re-consumed for sub-streams; arrayBuffer() once for hash.)
  const buf = await file.arrayBuffer();
  const hashBuf = await crypto.subtle.digest('SHA-256', buf);
  const sha256 = Array.from(new Uint8Array(hashBuf))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');

  const objectKey = `analyses/${crypto.randomUUID()}-${safeName(file.name)}`;
  await env.MEDIA.put(objectKey, buf, {
    httpMetadata: { contentType: file.type },
    customMetadata: { kind: v.kind, originalName: file.name, sha256 },
  });

  // Re-create File for the detection pipeline since arrayBuffer consumed the stream
  const fileForDetect = new File([buf], file.name, { type: file.type });

  // Detect + narrate (cost-instrumented)
  const result: AnalysisResult = await runDetection(fileForDetect, v.kind, env, identity);
  result.durationMs = Date.now() - start;

  // Persist full state so the verdict survives as a sharable record + PDF.
  const analysisId = randomToken(12);
  const shareSlug = randomToken(6); // 12 hex chars, plenty of entropy
  const now = Math.floor(Date.now() / 1000);
  await env.DB.batch([
    env.DB.prepare(
      `INSERT INTO analyses
         (id, user_id, identity, kind, confidence, verdict, model_tag, duration_ms,
          r2_key, share_slug, public, sha256, findings_json, boxes_json, original_name, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?, ?, ?)`,
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
      shareSlug,
      sha256,
      JSON.stringify(result.findings),
      JSON.stringify(result.boxes),
      file.name,
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
      shareSlug,
      sha256,
      tier,
      used: used + 1,
      limit,
      overage_billed: overageBilled || undefined,
    },
    cors,
  );
}

// -- voice (TTS, Pro+ only) ---------------------------------------------------

async function voiceVerdict(req: Request, env: Env, cors: HeadersInit): Promise<Response> {
  if (!env.ELEVENLABS_API_KEY) return json({ error: 'tts_not_configured' }, cors, 503);

  const token = readSessionCookie(req);
  const user = token ? await lookupSession(env, token) : null;
  if (!user) return json({ error: 'auth_required' }, cors, 401);

  const tier = await tierForUser(env, user.id);
  if (tier === 'free') {
    return json({ error: 'voice_requires_pro', upgrade_url: `${env.SITE_URL}/pricing` }, cors, 402);
  }
  const identity = userIdentity(user.id);
  const budget = await getBudget(env, identity, tier);
  if (budget.exceeded) {
    return json(
      {
        error: 'budget_exceeded',
        used_microcents: budget.used_microcents,
        cap_microcents: budget.cap_microcents,
        upgrade_url: `${env.SITE_URL}/pricing`,
      },
      cors,
      402,
    );
  }

  const body = (await req.json().catch(() => ({}))) as {
    confidence?: number;
    verdict?: string;
    findings?: Array<{ category: string; title: string; detail: string }>;
  };
  if (typeof body.confidence !== 'number' || !body.verdict) {
    return json({ error: 'missing_fields' }, cors, 400);
  }

  const script = composeScript(body);
  // Voice IDs: Adam (deep, authoritative) for Max; Rachel (composed, neutral)
  // for Pro. Falls back if voice unavailable.
  const voiceId = tier === 'max' ? 'pNInz6obpgDQGcFmaJgB' : '21m00Tcm4TlvDq8ikWAM';

  const ttsRes = await fetch(
    `https://api.elevenlabs.io/v1/text-to-speech/${voiceId}/stream?output_format=mp3_44100_128`,
    {
      method: 'POST',
      headers: {
        'xi-api-key': env.ELEVENLABS_API_KEY,
        'Content-Type': 'application/json',
        Accept: 'audio/mpeg',
      },
      body: JSON.stringify({
        text: script,
        model_id: 'eleven_turbo_v2_5',
        voice_settings: { stability: 0.55, similarity_boost: 0.75, style: 0.4, use_speaker_boost: true },
      }),
    },
  );
  if (!ttsRes.ok) {
    const detail = await ttsRes.text().catch(() => '');
    console.error('elevenlabs_failed', ttsRes.status, detail.slice(0, 200));
    return json({ error: 'tts_failed', status: ttsRes.status }, cors, 502);
  }

  // Charge ElevenLabs cost
  await chargeCost(env, identity, { elevenlabs_chars: Math.min(script.length, 5000) });

  // Stream the MP3 back to the client
  const headers = new Headers(cors as HeadersInit);
  headers.set('content-type', 'audio/mpeg');
  headers.set('cache-control', 'private, max-age=3600');
  return new Response(ttsRes.body, { status: 200, headers });
}

function composeScript(body: {
  confidence?: number;
  verdict?: string;
  findings?: Array<{ title: string; detail: string }>;
}): string {
  const pct = Math.round((body.confidence ?? 0) * 100);
  const verdict = body.verdict ?? 'inconclusive';
  const lead =
    verdict === 'synthetic'
      ? `Forensic analysis is conclusive. The Forge Eye reports ${pct} percent generative AI probability. The media is, with high confidence, synthetic.`
      : verdict === 'suspect'
      ? `The verdict is ambiguous. The Forge Eye reports ${pct} percent generative AI probability. Indicators are mixed; the media should be treated as suspect.`
      : `Forensic analysis suggests authentic capture. The Forge Eye reports only ${pct} percent generative AI probability. No strong indicators of synthesis were detected.`;

  // Pull two findings to ground the verdict
  const top = (body.findings ?? []).slice(0, 2).map((f) => f.title);
  const supporting =
    top.length > 0
      ? ` Supporting signals include: ${top.join('; ')}.`
      : '';

  return `${lead}${supporting} End of report.`;
}

// -----------------------------------------------------------------------------

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
  const body = (await req.json().catch(() => ({}))) as { email?: string; ref?: string };
  const email = body.email?.trim().toLowerCase();
  if (!email || !email.includes('@')) return json({ error: 'invalid_email' }, cors, 400);

  const token = randomToken();
  const now = Math.floor(Date.now() / 1000);
  const expires = now + 60 * 15; // 15 minutes
  // Prefer ref from body (frontend reads its own mfr cookie) and fall back
  // to the request cookie if present (works when site/api share parent domain).
  const refCode = (body.ref?.trim() || readReferralCookie(req) || null);
  await env.DB.prepare(
    'INSERT INTO magic_tokens (token, email, expires_at, created_at, ref_code) VALUES (?, ?, ?, ?, ?)',
  )
    .bind(token, email, expires, now, refCode)
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
    'SELECT email, expires_at, consumed_at, ref_code FROM magic_tokens WHERE token = ?',
  )
    .bind(token)
    .first<{ email: string; expires_at: number; consumed_at: number | null; ref_code: string | null }>();
  if (!row || row.consumed_at || row.expires_at < now) {
    return Response.redirect(`${env.SITE_URL}/?auth=expired`, 302);
  }
  await env.DB.prepare('UPDATE magic_tokens SET consumed_at = ? WHERE token = ?')
    .bind(now, token)
    .run();

  const user = await upsertUserByEmail(env, row.email);
  const isNewUser = user.created_at === user.last_seen_at;
  if (row.ref_code) {
    try {
      await applyReferralOnSignup(env, user, row.ref_code, isNewUser);
    } catch (e) {
      console.error('referral_apply_failed', (e as Error).message);
    }
  }
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
  // Referral attribution: if this is the user's first paid subscription,
  // mark the referrals row 'paid'. recordReferralPayment is idempotent
  // (only updates rows still in 'signed_up' status).
  if (sub.status === 'active' || sub.status === 'trialing') {
    const cents = meta.tier === 'max' ? 7900 : 1900;
    try {
      await recordReferralPayment(env, user.id, sub.id, cents);
    } catch (e) {
      console.error('referral_payment_failed', (e as Error).message);
    }
  }
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

// -- batch handlers -----------------------------------------------------------

async function batchCreate(
  req: Request,
  env: Env,
  cors: HeadersInit,
  ctx: ExecutionContext,
): Promise<Response> {
  const token = readSessionCookie(req);
  const user = token ? await lookupSession(env, token) : null;
  if (!user) return json({ error: 'auth_required' }, cors, 401);
  const tier = await tierForUser(env, user.id);
  const body = (await req.json().catch(() => ({}))) as { urls?: string[] };
  if (!Array.isArray(body.urls) || body.urls.length === 0) {
    return json({ error: 'missing_urls' }, cors, 400);
  }
  const r = await createBatch(env, user, tier, body.urls);
  if (!r.ok) return json({ error: r.error, upgrade_url: `${env.SITE_URL}/pricing` }, cors, r.status);
  // Process in background so the user gets an immediate response with batch_id
  ctx.waitUntil(processBatch(env, r.batchId));
  return json({ batch_id: r.batchId, total: r.total }, cors);
}

async function batchListMine(req: Request, env: Env, cors: HeadersInit): Promise<Response> {
  const token = readSessionCookie(req);
  const user = token ? await lookupSession(env, token) : null;
  if (!user) return json({ error: 'auth_required' }, cors, 401);
  const jobs = await listBatches(env, user);
  return json({ jobs }, cors);
}

async function batchGet(req: Request, env: Env, cors: HeadersInit, id: string): Promise<Response> {
  const token = readSessionCookie(req);
  const user = token ? await lookupSession(env, token) : null;
  if (!user) return json({ error: 'auth_required' }, cors, 401);
  const data = await getBatchStatus(env, user, id);
  if (!data) return json({ error: 'not_found' }, cors, 404);
  return json(data, cors);
}

async function batchCsvDl(
  req: Request,
  env: Env,
  cors: HeadersInit,
  id: string,
): Promise<Response> {
  const token = readSessionCookie(req);
  const user = token ? await lookupSession(env, token) : null;
  if (!user) return json({ error: 'auth_required' }, cors, 401);
  const csv = await batchCsv(env, user, id);
  if (csv === null) return json({ error: 'not_found' }, cors, 404);
  const headers = new Headers(cors as HeadersInit);
  headers.set('content-type', 'text/csv; charset=utf-8');
  headers.set('content-disposition', `attachment; filename="mythos-batch-${id}.csv"`);
  return new Response(csv, { status: 200, headers });
}

// -- KB handlers --------------------------------------------------------------

async function kbList(req: Request, env: Env, cors: HeadersInit, idOrSlug: string): Promise<Response> {
  const token = readSessionCookie(req);
  const user = token ? await lookupSession(env, token) : null;
  if (!user) return json({ error: 'auth_required' }, cors, 401);
  const docs = await listDocs(env, user, idOrSlug);
  return json({ docs }, cors);
}

async function kbUpload(req: Request, env: Env, cors: HeadersInit, idOrSlug: string): Promise<Response> {
  const token = readSessionCookie(req);
  const user = token ? await lookupSession(env, token) : null;
  if (!user) return json({ error: 'auth_required' }, cors, 401);
  const tier = await tierForUser(env, user.id);
  const form = await req.formData();
  const entry = form.get('file');
  if (!entry || typeof entry === 'string') return json({ error: 'missing_file' }, cors, 400);
  const file = entry as File;
  const r = await uploadDoc(env, user, tier, idOrSlug, file);
  if (!r.ok) return json({ error: r.error, upgrade_url: `${env.SITE_URL}/pricing` }, cors, r.status);
  return json({ doc: r.doc }, cors);
}

async function kbDelete(
  req: Request,
  env: Env,
  cors: HeadersInit,
  idOrSlug: string,
  docId: string,
): Promise<Response> {
  const token = readSessionCookie(req);
  const user = token ? await lookupSession(env, token) : null;
  if (!user) return json({ error: 'auth_required' }, cors, 401);
  const ok = await deleteDoc(env, user, idOrSlug, docId);
  return json({ ok }, cors, ok ? 200 : 404);
}

// -- verdict handlers ---------------------------------------------------------

async function getVerdict(req: Request, env: Env, cors: HeadersInit, slug: string): Promise<Response> {
  const row = await loadBySlug(env, slug);
  if (!row) return json({ error: 'not_found' }, cors, 404);
  const token = readSessionCookie(req);
  const user = token ? await lookupSession(env, token) : null;
  if (!canView(row, user)) return json({ error: 'private_verdict' }, cors, 403);
  return json(publicPayload(row, user?.id === row.user_id), cors);
}

async function getVerdictMedia(
  req: Request,
  env: Env,
  cors: HeadersInit,
  slug: string,
): Promise<Response> {
  const row = await loadBySlug(env, slug);
  if (!row) return json({ error: 'not_found' }, cors, 404);
  const token = readSessionCookie(req);
  const user = token ? await lookupSession(env, token) : null;
  if (!canView(row, user)) return json({ error: 'private_verdict' }, cors, 403);
  return await streamMedia(env, row, cors);
}

async function getVerdictPdf(
  req: Request,
  env: Env,
  cors: HeadersInit,
  slug: string,
): Promise<Response> {
  const row = await loadBySlug(env, slug);
  if (!row) return json({ error: 'not_found' }, cors, 404);
  const token = readSessionCookie(req);
  const user = token ? await lookupSession(env, token) : null;
  if (!user) return json({ error: 'auth_required' }, cors, 401);
  if (!canView(row, user)) return json({ error: 'private_verdict' }, cors, 403);
  const tier = await tierForUser(env, user.id);
  if (tier === 'free') {
    return json({ error: 'pdf_requires_pro', upgrade_url: `${env.SITE_URL}/pricing` }, cors, 402);
  }
  const bytes = await renderPdf(row, env);
  const filename = `mythos-verdict-${row.share_slug ?? row.id}.pdf`;
  const headers = new Headers(cors as HeadersInit);
  headers.set('content-type', 'application/pdf');
  headers.set('content-disposition', `attachment; filename="${filename}"`);
  headers.set('cache-control', 'private, max-age=300');
  return new Response(bytes, { status: 200, headers });
}

async function toggleShare(
  req: Request,
  env: Env,
  cors: HeadersInit,
  analysisId: string,
): Promise<Response> {
  const token = readSessionCookie(req);
  const user = token ? await lookupSession(env, token) : null;
  if (!user) return json({ error: 'auth_required' }, cors, 401);
  const body = (await req.json().catch(() => ({}))) as { public?: boolean };
  const wantPublic = body.public ? 1 : 0;
  const row = await env.DB.prepare(
    'SELECT user_id, share_slug FROM analyses WHERE id = ?',
  )
    .bind(analysisId)
    .first<{ user_id: string | null; share_slug: string | null }>();
  if (!row) return json({ error: 'not_found' }, cors, 404);
  if (row.user_id !== user.id) return json({ error: 'forbidden' }, cors, 403);
  await env.DB.prepare('UPDATE analyses SET public = ? WHERE id = ?')
    .bind(wantPublic, analysisId)
    .run();
  return json(
    {
      ok: true,
      public: !!wantPublic,
      slug: row.share_slug,
      url: row.share_slug ? `${env.SITE_URL}/v/${row.share_slug}` : null,
    },
    cors,
  );
}

// -- souls handlers -----------------------------------------------------------

async function soulsMine(req: Request, env: Env, cors: HeadersInit): Promise<Response> {
  const token = readSessionCookie(req);
  const user = token ? await lookupSession(env, token) : null;
  if (!user) return json({ error: 'auth_required' }, cors, 401);
  return json(await listMine(env, user), cors);
}

async function soulsCreate(req: Request, env: Env, cors: HeadersInit): Promise<Response> {
  const token = readSessionCookie(req);
  const user = token ? await lookupSession(env, token) : null;
  if (!user) return json({ error: 'auth_required' }, cors, 401);
  const tier = await tierForUser(env, user.id);
  const body = (await req.json().catch(() => ({}))) as Parameters<typeof createSoul>[3];
  const r = await createSoul(env, user, tier, body);
  if (!r.ok) return json({ error: r.error, upgrade_url: `${env.SITE_URL}/pricing` }, cors, r.status);
  return json({ soul: r.soul }, cors);
}

async function soulsGet(req: Request, env: Env, cors: HeadersInit, idOrSlug: string): Promise<Response> {
  const token = readSessionCookie(req);
  const user = token ? await lookupSession(env, token) : null;
  const r = await getSoul(env, idOrSlug, user);
  if (!r) return json({ error: 'not_found' }, cors, 404);
  return json(r, cors);
}

async function soulsDelete(req: Request, env: Env, cors: HeadersInit, idOrSlug: string): Promise<Response> {
  const token = readSessionCookie(req);
  const user = token ? await lookupSession(env, token) : null;
  if (!user) return json({ error: 'auth_required' }, cors, 401);
  const ok = await deleteSoul(env, user, idOrSlug);
  return json({ ok }, cors, ok ? 200 : 404);
}

async function soulsRemix(req: Request, env: Env, cors: HeadersInit, idOrSlug: string): Promise<Response> {
  const token = readSessionCookie(req);
  const user = token ? await lookupSession(env, token) : null;
  if (!user) return json({ error: 'auth_required' }, cors, 401);
  const tier = await tierForUser(env, user.id);
  const r = await remixSoul(env, user, tier, idOrSlug);
  if (!r.ok) return json({ error: r.error, upgrade_url: `${env.SITE_URL}/pricing` }, cors, r.status);
  return json({ soul: r.soul }, cors);
}

async function soulsChat(req: Request, env: Env, cors: HeadersInit, idOrSlug: string): Promise<Response> {
  const token = readSessionCookie(req);
  const user = token ? await lookupSession(env, token) : null;
  const tier: import('./types').Tier = user ? await tierForUser(env, user.id) : 'free';
  const identity = user ? `user:${user.id}` : await anonIdentity(req);
  const body = (await req.json().catch(() => ({}))) as { message?: string; session_id?: string };
  if (!body.message) return json({ error: 'missing_message' }, cors, 400);
  const sessionId = body.session_id || `s_${randomToken(8)}`;
  const r = await soulChat(env, user, identity, tier, idOrSlug, body.message, sessionId);
  if (!r.ok) return json({ error: r.error, ...(r.meta ?? {}) }, cors, r.status);
  return json({ reply: r.reply, message_id: r.messageId, session_id: sessionId }, cors);
}

async function soulsConvaiUrl(
  req: Request,
  env: Env,
  cors: HeadersInit,
  idOrSlug: string,
): Promise<Response> {
  const soul = await env.DB.prepare(
    'SELECT convai_agent_id, public, user_id FROM souls WHERE id = ? OR slug = ?',
  )
    .bind(idOrSlug, idOrSlug)
    .first<{ convai_agent_id: string | null; public: number; user_id: string }>();
  if (!soul) return json({ error: 'not_found' }, cors, 404);
  if (!soul.convai_agent_id) return json({ error: 'realtime_not_enabled' }, cors, 404);
  // Public souls' Convai URL is reachable by anyone (anonymous chat in browser)
  if (soul.public === 0) {
    const token = readSessionCookie(req);
    const user = token ? await lookupSession(env, token) : null;
    if (soul.user_id !== user?.id) return json({ error: 'private_soul' }, cors, 403);
  }
  try {
    const signedUrl = await getConvaiSignedUrl(env, soul.convai_agent_id);
    return json({ signed_url: signedUrl, agent_id: soul.convai_agent_id }, cors);
  } catch (e) {
    console.error('convai_url_failed', (e as Error).message);
    return json({ error: 'convai_failed' }, cors, 502);
  }
}

async function soulsSpeak(
  req: Request,
  env: Env,
  cors: HeadersInit,
  idOrSlug: string,
): Promise<Response> {
  const body = (await req.json().catch(() => ({}))) as { text?: string };
  if (!body.text) return json({ error: 'missing_text' }, cors, 400);
  const soul = await env.DB.prepare('SELECT voice_id, public, user_id FROM souls WHERE id = ? OR slug = ?')
    .bind(idOrSlug, idOrSlug)
    .first<{ voice_id: string; public: number; user_id: string }>();
  if (!soul) return json({ error: 'not_found' }, cors, 404);
  const token = readSessionCookie(req);
  const user = token ? await lookupSession(env, token) : null;
  if (soul.public === 0 && soul.user_id !== user?.id) {
    return json({ error: 'private_soul' }, cors, 403);
  }
  const tier = user ? await tierForUser(env, user.id) : 'free';
  const identity = user ? userIdentity(user.id) : await anonIdentity(req);
  return await speakText(env, soul.voice_id, body.text, cors, identity, tier);
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

// User-authorized credentialed origins (2026-05-07): heitkampnick23 explicitly
// approved adding *.sumhead.com to the credentialed CORS allowlist so the
// agents.sumhead.com Pages custom domain can sign in to the Forge API.
const SIBLING_CREDENTIALED_ORIGINS = new Set([
  'https://agents.sumhead.com',
  'https://sumhead.com',
  'https://www.sumhead.com',
  'https://speakapp.sumhead.com',
  'http://localhost:5173',
]);

function corsHeaders(env: Env, origin: string | null, req?: Request): HeadersInit {
  const allowed =
    origin === env.ALLOWED_ORIGIN ||
    (origin !== null && SIBLING_CREDENTIALED_ORIGINS.has(origin));
  // Embed widget endpoints accept any origin (souls chat/speak from arbitrary
  // sites where the widget is dropped in). Credentialed cookie auth still
  // requires same-site, but anonymous chat works cross-origin.
  const url = req ? new URL(req.url) : null;
  const isEmbedSurface =
    url &&
    (url.pathname === '/v1/embed/heartbeat.js' ||
      url.pathname.match(/^\/v1\/souls\/[^/]+\/(chat|speak)$/) ||
      url.pathname.match(/^\/v1\/souls\/[^/]+$/));
  if (isEmbedSurface && origin && !allowed) {
    return {
      'access-control-allow-origin': origin,
      'access-control-allow-credentials': 'false',
      'access-control-allow-methods': 'POST, GET, OPTIONS',
      'access-control-allow-headers': 'content-type',
      'access-control-max-age': '86400',
      vary: 'origin',
    };
  }
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

// -- Google OAuth ------------------------------------------------------------

function googleRedirectUri(env: Env): string {
  return env.GOOGLE_REDIRECT_URI || 'https://api.mythos0x.com/v1/auth/google/callback';
}

async function googleStart(_req: Request, env: Env): Promise<Response> {
  if (!env.GOOGLE_CLIENT_ID) {
    return Response.redirect(`${env.SITE_URL}/?auth=google_disabled`, 302);
  }
  const state = randomToken(16);
  const params = new URLSearchParams({
    client_id: env.GOOGLE_CLIENT_ID,
    redirect_uri: googleRedirectUri(env),
    response_type: 'code',
    scope: 'openid email profile',
    access_type: 'online',
    state,
    prompt: 'select_account',
  });
  return new Response(null, {
    status: 302,
    headers: {
      Location: 'https://accounts.google.com/o/oauth2/v2/auth?' + params.toString(),
      'set-cookie': `gst=${state}; Max-Age=300; Path=/; Secure; HttpOnly; SameSite=Lax; Domain=.mythos0x.com`,
    },
  });
}

async function googleCallback(req: Request, env: Env): Promise<Response> {
  if (!env.GOOGLE_CLIENT_ID || !env.GOOGLE_CLIENT_SECRET) {
    return Response.redirect(`${env.SITE_URL}/?auth=google_disabled`, 302);
  }
  const url = new URL(req.url);
  const code = url.searchParams.get('code');
  const state = url.searchParams.get('state');
  const cookieHeader = req.headers.get('cookie') || '';
  const m = cookieHeader.match(/(?:^|; )gst=([^;]+)/);
  const cookieState = m ? m[1] : null;
  if (!code) return Response.redirect(`${env.SITE_URL}/?auth=missing_code`, 302);
  if (!state || !cookieState || state !== cookieState) {
    return Response.redirect(`${env.SITE_URL}/?auth=bad_state`, 302);
  }

  // Exchange code → access_token
  const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code,
      client_id: env.GOOGLE_CLIENT_ID,
      client_secret: env.GOOGLE_CLIENT_SECRET,
      redirect_uri: googleRedirectUri(env),
      grant_type: 'authorization_code',
    }),
  });
  if (!tokenRes.ok) return Response.redirect(`${env.SITE_URL}/?auth=token_failed`, 302);
  const tok = (await tokenRes.json()) as { access_token?: string };
  if (!tok.access_token) return Response.redirect(`${env.SITE_URL}/?auth=no_token`, 302);

  // Fetch userinfo
  const uiRes = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
    headers: { Authorization: `Bearer ${tok.access_token}` },
  });
  if (!uiRes.ok) return Response.redirect(`${env.SITE_URL}/?auth=userinfo_failed`, 302);
  const ui = (await uiRes.json()) as { email?: string; verified_email?: boolean };
  const email = (ui.email || '').toLowerCase().trim();
  if (!email) return Response.redirect(`${env.SITE_URL}/?auth=no_email`, 302);

  // Upsert user (same path as magic-link verify)
  const user = await upsertUserByEmail(env, email);
  const session = await createSession(env, user.id);

  // Clear state cookie + set session cookie + redirect home
  const h = new Headers();
  h.append('Set-Cookie', `gst=; Max-Age=0; Path=/; Secure; HttpOnly; SameSite=Lax; Domain=.mythos0x.com`);
  h.append('Set-Cookie', setSessionCookieHeader(session));
  h.set('Location', `${env.SITE_URL}/?auth=ok`);
  return new Response(null, { status: 302, headers: h });
}
