// Heartbeat Knowledge Base — RAG for Souls.
//
// Flow:
//   POST /v1/souls/:id/kb           upload (.txt, .md) → chunk → embed → Vectorize
//   GET  /v1/souls/:id/kb           list docs
//   DELETE /v1/souls/:id/kb/:docId  remove doc + its vectors
//
// On chat: embed user message, query Vectorize filtered by soul_id, take
// top-K chunks, prepend to system prompt as "Knowledge:\n{chunks}".
//
// Embedding model: Cloudflare Workers AI @cf/baai/bge-base-en-v1.5 (768 dims).
// Free tier: 10k neurons/day. Each embedding ≈ 1 neuron.

import type { Env, Tier, User } from './types';
import { randomToken } from './auth';

const EMBEDDING_MODEL = '@cf/baai/bge-base-en-v1.5';
const EMBEDDING_DIMS = 768;
const CHUNK_SIZE = 1500;        // chars (~ 350 tokens)
const CHUNK_OVERLAP = 200;      // chars
const TOP_K = 5;                // chunks retrieved per chat turn

// Per-tier limits (per Soul)
const KB_LIMITS: Record<Tier, { docs: number; bytes: number }> = {
  free: { docs: 0, bytes: 0 },
  pro:  { docs: 5,  bytes: 1 * 1024 * 1024 },   // 1 MB / doc
  max:  { docs: 50, bytes: 10 * 1024 * 1024 },  // 10 MB / doc
};

const ACCEPTED_TYPES = new Set(['text/plain', 'text/markdown', 'text/x-markdown']);
const ACCEPTED_EXTS = /\.(txt|md|markdown)$/i;

interface KbDocRow {
  id: string;
  soul_id: string;
  user_id: string;
  filename: string;
  content_type: string;
  size_bytes: number;
  r2_key: string;
  status: 'processing' | 'indexed' | 'failed';
  chunk_count: number;
  created_at: number;
}

// -- public API ---------------------------------------------------------------

export async function uploadDoc(
  env: Env,
  user: User,
  tier: Tier,
  soulId: string,
  file: File,
): Promise<
  | { ok: true; doc: KbDocRow }
  | { ok: false; error: string; status: number }
> {
  const limit = KB_LIMITS[tier];
  if (limit.docs === 0) return { ok: false, error: 'tier_locked', status: 402 };

  // Verify soul ownership
  const soul = await env.DB.prepare('SELECT id, user_id FROM souls WHERE id = ? OR slug = ?')
    .bind(soulId, soulId)
    .first<{ id: string; user_id: string }>();
  if (!soul) return { ok: false, error: 'soul_not_found', status: 404 };
  if (soul.user_id !== user.id) return { ok: false, error: 'not_owner', status: 403 };

  // Validate file
  if (!ACCEPTED_TYPES.has(file.type) && !ACCEPTED_EXTS.test(file.name)) {
    return { ok: false, error: 'unsupported_type — txt/md only in v0', status: 400 };
  }
  if (file.size > limit.bytes) {
    return { ok: false, error: `file_too_large (max ${Math.round(limit.bytes / 1024 / 1024)}MB)`, status: 400 };
  }

  // Per-soul doc count cap
  const owned = await env.DB.prepare('SELECT COUNT(*) as c FROM soul_kb_docs WHERE soul_id = ?')
    .bind(soul.id)
    .first<{ c: number }>();
  if ((owned?.c ?? 0) >= limit.docs) {
    return { ok: false, error: 'doc_limit_reached', status: 402 };
  }

  // Read text
  const text = await file.text();
  if (!text.trim()) return { ok: false, error: 'empty_file', status: 400 };

  // R2 archive
  const docId = randomToken(10);
  const r2Key = `soul-kb/${soul.id}/${docId}-${safeName(file.name)}`;
  await env.MEDIA.put(r2Key, text, {
    httpMetadata: { contentType: file.type || 'text/plain' },
    customMetadata: { soul_id: soul.id, doc_id: docId, original_name: file.name },
  });

  // Insert D1 record (status=processing)
  const now = Math.floor(Date.now() / 1000);
  await env.DB.prepare(
    `INSERT INTO soul_kb_docs (id, soul_id, user_id, filename, content_type, size_bytes, r2_key, status, chunk_count, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, 'processing', 0, ?)`,
  )
    .bind(docId, soul.id, user.id, file.name, file.type || 'text/plain', file.size, r2Key, now)
    .run();

  // Chunk + embed + upsert to Vectorize
  try {
    const chunks = chunkText(text);
    const vectors = await embedChunks(env, chunks);
    const toUpsert = vectors.map((values, idx) => ({
      id: `${docId}-${idx}`,
      values,
      metadata: {
        soul_id: soul.id,
        doc_id: docId,
        chunk_idx: idx,
        // Store the chunk text in metadata so we don't need a second lookup at query time
        text: chunks[idx].slice(0, 2000),
        filename: file.name,
      },
    }));
    // Vectorize upsert in batches of 100
    for (let i = 0; i < toUpsert.length; i += 100) {
      await env.VECTORIZE.upsert(toUpsert.slice(i, i + 100));
    }
    await env.DB.prepare(
      'UPDATE soul_kb_docs SET status = ?, chunk_count = ? WHERE id = ?',
    )
      .bind('indexed', chunks.length, docId)
      .run();
  } catch (e) {
    console.error('kb_index_failed', (e as Error).message);
    await env.DB.prepare('UPDATE soul_kb_docs SET status = ? WHERE id = ?')
      .bind('failed', docId)
      .run();
    return { ok: false, error: 'index_failed', status: 502 };
  }

  const final = await env.DB.prepare('SELECT * FROM soul_kb_docs WHERE id = ?')
    .bind(docId)
    .first<KbDocRow>();
  return { ok: true, doc: final! };
}

export async function listDocs(env: Env, user: User, soulIdOrSlug: string): Promise<KbDocRow[]> {
  const soul = await env.DB.prepare('SELECT id, user_id FROM souls WHERE id = ? OR slug = ?')
    .bind(soulIdOrSlug, soulIdOrSlug)
    .first<{ id: string; user_id: string }>();
  if (!soul || soul.user_id !== user.id) return [];
  const rows = await env.DB.prepare(
    'SELECT * FROM soul_kb_docs WHERE soul_id = ? ORDER BY created_at DESC',
  )
    .bind(soul.id)
    .all<KbDocRow>();
  return rows.results ?? [];
}

export async function deleteDoc(
  env: Env,
  user: User,
  soulIdOrSlug: string,
  docId: string,
): Promise<boolean> {
  const soul = await env.DB.prepare('SELECT id, user_id FROM souls WHERE id = ? OR slug = ?')
    .bind(soulIdOrSlug, soulIdOrSlug)
    .first<{ id: string; user_id: string }>();
  if (!soul || soul.user_id !== user.id) return false;
  const doc = await env.DB.prepare(
    'SELECT id, chunk_count, r2_key FROM soul_kb_docs WHERE id = ? AND soul_id = ?',
  )
    .bind(docId, soul.id)
    .first<{ id: string; chunk_count: number; r2_key: string }>();
  if (!doc) return false;
  // Delete vectors
  if (doc.chunk_count > 0) {
    const ids = Array.from({ length: doc.chunk_count }, (_, i) => `${doc.id}-${i}`);
    try {
      await env.VECTORIZE.deleteByIds(ids);
    } catch (e) {
      console.error('vectorize_delete_failed', (e as Error).message);
    }
  }
  // Delete R2 + D1
  await env.MEDIA.delete(doc.r2_key).catch(() => undefined);
  await env.DB.prepare('DELETE FROM soul_kb_docs WHERE id = ?').bind(doc.id).run();
  return true;
}

/** Retrieve top-K chunks for a Soul + query. Returns concatenated text or null. */
export async function retrieveContext(
  env: Env,
  soulId: string,
  query: string,
): Promise<{ context: string; sources: string[] } | null> {
  // Skip retrieval if no docs indexed
  const hasDocs = await env.DB.prepare(
    "SELECT 1 FROM soul_kb_docs WHERE soul_id = ? AND status = 'indexed' LIMIT 1",
  )
    .bind(soulId)
    .first();
  if (!hasDocs) return null;

  let queryVec: number[];
  try {
    const r = await env.AI.run(EMBEDDING_MODEL, { text: [query] });
    queryVec = (r as { data: number[][] }).data[0];
    if (!queryVec || queryVec.length !== EMBEDDING_DIMS) return null;
  } catch (e) {
    console.error('kb_query_embed_failed', (e as Error).message);
    return null;
  }

  let matches;
  try {
    const result = await env.VECTORIZE.query(queryVec, {
      topK: TOP_K,
      filter: { soul_id: soulId },
      returnMetadata: 'all',
    });
    matches = result.matches;
  } catch (e) {
    console.error('vectorize_query_failed', (e as Error).message);
    return null;
  }

  if (!matches || matches.length === 0) return null;

  // Filter low-similarity matches (cosine score < 0.5 is usually noise)
  const useful = matches.filter((m) => m.score >= 0.5);
  if (useful.length === 0) return null;

  const chunks: string[] = [];
  const sources = new Set<string>();
  for (const m of useful) {
    const meta = m.metadata as { text?: string; filename?: string } | undefined;
    if (meta?.text) chunks.push(meta.text);
    if (meta?.filename) sources.add(meta.filename);
  }

  return { context: chunks.join('\n\n---\n\n'), sources: Array.from(sources) };
}

// -- helpers ------------------------------------------------------------------

function chunkText(text: string): string[] {
  // Simple sliding-window chunker. Splits on paragraph boundaries when
  // possible; falls back to char-window with overlap.
  const paragraphs = text
    .replace(/\r\n/g, '\n')
    .split(/\n{2,}/)
    .map((p) => p.trim())
    .filter(Boolean);

  const chunks: string[] = [];
  let cur = '';
  for (const p of paragraphs) {
    if ((cur + '\n\n' + p).length > CHUNK_SIZE && cur) {
      chunks.push(cur);
      // Overlap: carry last N chars of cur into next chunk
      cur = cur.slice(-CHUNK_OVERLAP) + '\n\n' + p;
    } else {
      cur = cur ? cur + '\n\n' + p : p;
    }
  }
  if (cur) chunks.push(cur);

  // For paragraphs longer than CHUNK_SIZE, hard-split
  const final: string[] = [];
  for (const c of chunks) {
    if (c.length <= CHUNK_SIZE * 1.3) {
      final.push(c);
      continue;
    }
    for (let i = 0; i < c.length; i += CHUNK_SIZE - CHUNK_OVERLAP) {
      final.push(c.slice(i, i + CHUNK_SIZE));
    }
  }
  return final;
}

async function embedChunks(env: Env, chunks: string[]): Promise<number[][]> {
  // Workers AI accepts a batch of texts. Cap at 100 per call to be safe.
  const out: number[][] = [];
  for (let i = 0; i < chunks.length; i += 50) {
    const batch = chunks.slice(i, i + 50);
    const r = await env.AI.run(EMBEDDING_MODEL, { text: batch });
    const vectors = (r as { data: number[][] }).data;
    if (!vectors || vectors.length !== batch.length) {
      throw new Error(`embedding_returned_${vectors?.length ?? 0}_for_${batch.length}_inputs`);
    }
    out.push(...vectors);
  }
  return out;
}

function safeName(name: string): string {
  return name.replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 80);
}
