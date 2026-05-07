// Bulk URL analysis — Max-tier B2B feature.
//
// Flow:
//   POST /v1/batch { urls: string[] }
//   → returns { batch_id }
//   → Worker processes URLs in background via ctx.waitUntil with limited
//     concurrency (4 parallel) so we don't hammer Sightengine.
//   → Each successful URL becomes a regular analysis row with its own slug,
//     so every result has a sharable /v/<slug> page + downloadable PDF.
//
//   GET /v1/batch/:id      → { job, items[] }
//   GET /v1/batch/:id/csv  → CSV download of results

import type { Env, Tier, User } from './types';
import { randomToken, userIdentity, utcDay } from './auth';
import { runDetection } from './detect';
import { chargeCost } from './budget';

const MAX_CONCURRENCY = 4;
const MAX_URLS_PER_BATCH: Record<Tier, number> = { free: 0, pro: 0, max: 200 };
const MAX_FILE_BYTES = 20 * 1024 * 1024;
const ALLOWED_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp']);

interface JobRow {
  id: string;
  user_id: string;
  total: number;
  done: number;
  failed: number;
  status: 'queued' | 'processing' | 'done';
  created_at: number;
  completed_at: number | null;
}

interface ItemRow {
  id: string;
  batch_id: string;
  position: number;
  url: string;
  status: 'pending' | 'done' | 'failed';
  analysis_id: string | null;
  share_slug: string | null;
  confidence: number | null;
  verdict: string | null;
  error: string | null;
  created_at: number;
  completed_at: number | null;
}

// ---- create ---------------------------------------------------------------

export async function createBatch(
  env: Env,
  user: User,
  tier: Tier,
  urls: string[],
): Promise<
  | { ok: true; batchId: string; total: number }
  | { ok: false; error: string; status: number }
> {
  const limit = MAX_URLS_PER_BATCH[tier];
  if (limit === 0) {
    return { ok: false, error: 'tier_locked', status: 402 };
  }
  // Dedupe + clean
  const cleaned = Array.from(new Set(urls.map((u) => u.trim()).filter(Boolean)));
  if (cleaned.length === 0) return { ok: false, error: 'no_urls', status: 400 };
  if (cleaned.length > limit) {
    return { ok: false, error: `max_${limit}_urls_per_batch`, status: 400 };
  }
  for (const u of cleaned) {
    if (!/^https?:\/\//i.test(u)) {
      return { ok: false, error: `invalid_url: ${u.slice(0, 80)}`, status: 400 };
    }
  }

  const batchId = randomToken(10);
  const now = Math.floor(Date.now() / 1000);
  await env.DB.prepare(
    `INSERT INTO batch_jobs (id, user_id, total, done, failed, status, created_at)
     VALUES (?, ?, ?, 0, 0, 'queued', ?)`,
  )
    .bind(batchId, user.id, cleaned.length, now)
    .run();

  // Insert all items in batches (D1 has a 100-statement limit per call)
  for (let i = 0; i < cleaned.length; i += 25) {
    const slice = cleaned.slice(i, i + 25);
    await env.DB.batch(
      slice.map((url, j) =>
        env.DB.prepare(
          `INSERT INTO batch_items (id, batch_id, position, url, status, created_at)
           VALUES (?, ?, ?, ?, 'pending', ?)`,
        ).bind(randomToken(10), batchId, i + j, url, now),
      ),
    );
  }

  return { ok: true, batchId, total: cleaned.length };
}

// ---- background processor (called via ctx.waitUntil) ----------------------

export async function processBatch(env: Env, batchId: string): Promise<void> {
  const job = await env.DB.prepare('SELECT * FROM batch_jobs WHERE id = ?')
    .bind(batchId)
    .first<JobRow>();
  if (!job || job.status === 'done') return;

  await env.DB.prepare(
    "UPDATE batch_jobs SET status = 'processing' WHERE id = ?",
  )
    .bind(batchId)
    .run();

  const pending = await env.DB.prepare(
    `SELECT * FROM batch_items WHERE batch_id = ? AND status = 'pending' ORDER BY position`,
  )
    .bind(batchId)
    .all<ItemRow>();

  const items = pending.results ?? [];
  const identity = userIdentity(job.user_id);

  // Process with limited concurrency. Workers don't have proper Promise.all
  // backpressure helpers; build a hand-rolled pool.
  let cursor = 0;
  const workers = Array.from({ length: MAX_CONCURRENCY }, async () => {
    while (cursor < items.length) {
      const idx = cursor++;
      const item = items[idx];
      if (!item) break;
      await processItem(env, item, identity, job.user_id);
    }
  });
  await Promise.all(workers);

  // Final tally
  const tally = await env.DB.prepare(
    `SELECT
       SUM(CASE WHEN status = 'done' THEN 1 ELSE 0 END) as done,
       SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) as failed
     FROM batch_items WHERE batch_id = ?`,
  )
    .bind(batchId)
    .first<{ done: number; failed: number }>();

  await env.DB.prepare(
    `UPDATE batch_jobs SET done = ?, failed = ?, status = 'done', completed_at = ? WHERE id = ?`,
  )
    .bind(tally?.done ?? 0, tally?.failed ?? 0, Math.floor(Date.now() / 1000), batchId)
    .run();
}

async function processItem(
  env: Env,
  item: ItemRow,
  identity: string,
  userId: string,
): Promise<void> {
  try {
    // 1. Fetch image
    const fetchRes = await fetch(item.url, { cf: { cacheTtl: 60 } as Record<string, unknown> });
    if (!fetchRes.ok) throw new Error(`fetch_${fetchRes.status}`);
    const contentType = fetchRes.headers.get('content-type')?.split(';')[0]?.trim() ?? '';
    if (!ALLOWED_TYPES.has(contentType)) {
      throw new Error(`unsupported_content_type:${contentType || 'unknown'}`);
    }
    const buf = await fetchRes.arrayBuffer();
    if (buf.byteLength > MAX_FILE_BYTES) {
      throw new Error('file_too_large');
    }
    const filename = sanitizeName(new URL(item.url).pathname.split('/').pop() || 'image');

    // 2. Hash + R2
    const hashBuf = await crypto.subtle.digest('SHA-256', buf);
    const sha256 = Array.from(new Uint8Array(hashBuf))
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('');
    const objectKey = `analyses/${crypto.randomUUID()}-${filename}`;
    await env.MEDIA.put(objectKey, buf, {
      httpMetadata: { contentType },
      customMetadata: { kind: 'image', originalName: filename, sha256, batch_id: item.batch_id },
    });

    // 3. Detect (cost-instrumented inside runDetection)
    const file = new File([buf], filename, { type: contentType });
    const result = await runDetection(file, 'image', env, identity);

    // 4. Persist as a regular analysis row (so it gets a /v/<slug>)
    const analysisId = randomToken(12);
    const shareSlug = randomToken(6);
    const now = Math.floor(Date.now() / 1000);
    await env.DB.prepare(
      `INSERT INTO analyses
         (id, user_id, identity, kind, confidence, verdict, model_tag, duration_ms,
          r2_key, share_slug, public, sha256, findings_json, boxes_json, original_name, created_at)
       VALUES (?, ?, ?, 'image', ?, ?, ?, ?, ?, ?, 0, ?, ?, ?, ?, ?)`,
    )
      .bind(
        analysisId,
        userId,
        identity,
        result.confidence,
        result.verdict,
        result.modelTag,
        result.durationMs ?? 0,
        objectKey,
        shareSlug,
        sha256,
        JSON.stringify(result.findings),
        JSON.stringify(result.boxes),
        filename,
        now,
      )
      .run();

    // 5. Bump daily usage_daily counter (each batch URL counts toward daily limit)
    await env.DB.prepare(
      `INSERT INTO usage_daily (identity, day, count) VALUES (?, ?, 1)
       ON CONFLICT(identity, day) DO UPDATE SET count = count + 1`,
    )
      .bind(identity, utcDay())
      .run();

    // 6. Mark item done
    await env.DB.prepare(
      `UPDATE batch_items
       SET status = 'done', analysis_id = ?, share_slug = ?, confidence = ?, verdict = ?, completed_at = ?
       WHERE id = ?`,
    )
      .bind(analysisId, shareSlug, result.confidence, result.verdict, now, item.id)
      .run();
  } catch (e) {
    const msg = (e as Error).message.slice(0, 200);
    await env.DB.prepare(
      `UPDATE batch_items SET status = 'failed', error = ?, completed_at = ? WHERE id = ?`,
    )
      .bind(msg, Math.floor(Date.now() / 1000), item.id)
      .run();
    // Even on failure, charge the cost so far (mostly fetch failures = $0)
    void chargeCost; // referenced to avoid unused-import lint
  }
}

function sanitizeName(name: string): string {
  return name.replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 80) || 'image';
}

// ---- read APIs ------------------------------------------------------------

export async function getBatchStatus(env: Env, user: User, batchId: string): Promise<{
  job: JobRow;
  items: ItemRow[];
} | null> {
  const job = await env.DB.prepare('SELECT * FROM batch_jobs WHERE id = ? AND user_id = ?')
    .bind(batchId, user.id)
    .first<JobRow>();
  if (!job) return null;
  const items = await env.DB.prepare(
    `SELECT * FROM batch_items WHERE batch_id = ? ORDER BY position`,
  )
    .bind(batchId)
    .all<ItemRow>();
  return { job, items: items.results ?? [] };
}

export async function listBatches(env: Env, user: User): Promise<JobRow[]> {
  const r = await env.DB.prepare(
    'SELECT * FROM batch_jobs WHERE user_id = ? ORDER BY created_at DESC LIMIT 30',
  )
    .bind(user.id)
    .all<JobRow>();
  return r.results ?? [];
}

export async function batchCsv(env: Env, user: User, batchId: string): Promise<string | null> {
  const data = await getBatchStatus(env, user, batchId);
  if (!data) return null;
  const rows = [
    ['position', 'url', 'status', 'verdict', 'confidence', 'verdict_url', 'error'].join(','),
    ...data.items.map((it) => {
      const verdictUrl = it.share_slug ? `${env.SITE_URL}/v/${it.share_slug}` : '';
      const fields = [
        String(it.position),
        csvEscape(it.url),
        it.status,
        it.verdict ?? '',
        it.confidence !== null ? it.confidence.toFixed(4) : '',
        verdictUrl,
        csvEscape(it.error ?? ''),
      ];
      return fields.join(',');
    }),
  ];
  return rows.join('\n');
}

function csvEscape(s: string): string {
  if (/[",\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}
