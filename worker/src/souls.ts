// Heartbeat — voice agents ("Souls") on top of Mythos 0X Forge.
//
// Each Soul is a (system_prompt, first_message, voice_id) bundle. Conversation
// loop: client sends user text → we call Anthropic with system_prompt + recent
// history → return assistant text → client requests TTS for that reply.
//
// Browser-side STT (Web Speech API) keeps STT free + private. ElevenLabs Convai
// (real-time WebSocket conversation) is a future upgrade gated behind paid EL
// plans; the DIY pipeline below works on the free tier.

import type { Env, Tier, User } from './types';
import { randomToken } from './auth';
import { chargeCost, estimateTokens, getBudget } from './budget';
import { retrieveContext } from './kb';

export const VOICES = [
  { id: 'pNInz6obpgDQGcFmaJgB', label: 'Adam', desc: 'deep, authoritative' },
  { id: '21m00Tcm4TlvDq8ikWAM', label: 'Rachel', desc: 'calm, neutral female' },
  { id: 'EXAVITQu4vr4xnSDxMaL', label: 'Bella', desc: 'soft, warm female' },
  { id: 'ErXwobaYiN019PkySvjV', label: 'Antoni', desc: 'well-rounded male' },
  { id: 'VR6AewLTigWG4xSOukaG', label: 'Arnold', desc: 'crisp, sharp male' },
  { id: 'AZnzlk1XvdvUeBnXmlld', label: 'Domi', desc: 'strong, confident female' },
  { id: 'MF3mGyEYCl7XYWbV9V6O', label: 'Elli', desc: 'emotional, expressive female' },
  { id: 'TxGEqnHWrfWFTfGW9XjX', label: 'Josh', desc: 'deep, narrator-style male' },
] as const;

export const SOUL_LIMITS: Record<Tier, { create: number; messagesPerDay: number }> = {
  free: { create: 0, messagesPerDay: 50 },
  pro: { create: 3, messagesPerDay: 200 },
  max: { create: 25, messagesPerDay: 1000 },
};

const HISTORY_TURNS = 12; // last 12 turns sent to the model for context

interface SoulRow {
  id: string;
  user_id: string;
  name: string;
  tagline: string;
  system_prompt: string;
  first_message: string;
  voice_id: string;
  voice_label: string;
  public: number;
  remixed_from: string | null;
  slug: string | null;
  chat_count: number;
  remix_count: number;
  created_at: number;
  updated_at: number;
  phone_number: string | null;
  phone_provider: string | null;
}

export function publicShape(s: SoulRow) {
  return {
    id: s.id,
    name: s.name,
    tagline: s.tagline,
    voice_id: s.voice_id,
    voice_label: s.voice_label,
    public: s.public === 1,
    chat_count: s.chat_count,
    remix_count: s.remix_count,
    slug: s.slug,
    created_at: s.created_at,
    is_owner: false,
    first_message: s.first_message,
  };
}

export function ownerShape(s: SoulRow) {
  return {
    ...publicShape(s),
    system_prompt: s.system_prompt,
    is_owner: true,
    remixed_from: s.remixed_from,
    phone_number: s.phone_number,
    phone_provider: s.phone_provider,
  };
}

// -- routes -------------------------------------------------------------------

export async function listMarketplace(env: Env): Promise<unknown> {
  const rows = await env.DB.prepare(
    `SELECT * FROM souls WHERE public = 1
     ORDER BY chat_count DESC, created_at DESC LIMIT 60`,
  ).all<SoulRow>();
  return { souls: (rows.results ?? []).map(publicShape) };
}

export async function listMine(env: Env, user: User): Promise<unknown> {
  const rows = await env.DB.prepare(
    `SELECT * FROM souls WHERE user_id = ?
     ORDER BY created_at DESC LIMIT 100`,
  )
    .bind(user.id)
    .all<SoulRow>();
  return { souls: (rows.results ?? []).map(ownerShape) };
}

export async function getSoul(
  env: Env,
  id: string,
  user: User | null,
): Promise<{ soul: ReturnType<typeof ownerShape> | ReturnType<typeof publicShape> } | null> {
  const s = await env.DB.prepare('SELECT * FROM souls WHERE id = ? OR slug = ?')
    .bind(id, id)
    .first<SoulRow>();
  if (!s) return null;
  if (s.public === 0 && s.user_id !== user?.id) return null;
  return { soul: s.user_id === user?.id ? ownerShape(s) : publicShape(s) };
}

export async function createSoul(
  env: Env,
  user: User,
  tier: Tier,
  body: {
    name?: string;
    tagline?: string;
    system_prompt?: string;
    first_message?: string;
    voice_id?: string;
    public?: boolean;
  },
): Promise<{ ok: true; soul: ReturnType<typeof ownerShape> } | { ok: false; error: string; status: number }> {
  if (!body.name || !body.system_prompt || !body.voice_id) {
    return { ok: false, error: 'missing_fields', status: 400 };
  }
  if (!VOICES.find((v) => v.id === body.voice_id)) {
    return { ok: false, error: 'unknown_voice', status: 400 };
  }
  const limit = SOUL_LIMITS[tier].create;
  if (limit === 0) {
    return { ok: false, error: 'tier_locked', status: 402 };
  }
  const owned = await env.DB.prepare('SELECT COUNT(*) as c FROM souls WHERE user_id = ?')
    .bind(user.id)
    .first<{ c: number }>();
  if ((owned?.c ?? 0) >= limit) {
    return { ok: false, error: 'soul_limit_reached', status: 402 };
  }

  const id = randomToken(12);
  const slug = await uniqueSlug(env, body.name);
  const voice = VOICES.find((v) => v.id === body.voice_id)!;
  const now = Math.floor(Date.now() / 1000);

  await env.DB.prepare(
    `INSERT INTO souls (id, user_id, name, tagline, system_prompt, first_message, voice_id, voice_label, public, slug, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  )
    .bind(
      id,
      user.id,
      body.name.slice(0, 60),
      (body.tagline ?? '').slice(0, 140),
      body.system_prompt.slice(0, 4000),
      (body.first_message ?? 'Hello.').slice(0, 500),
      voice.id,
      voice.label,
      body.public ? 1 : 0,
      slug,
      now,
      now,
    )
    .run();

  const created = await env.DB.prepare('SELECT * FROM souls WHERE id = ?')
    .bind(id)
    .first<SoulRow>();
  return { ok: true, soul: ownerShape(created!) };
}

export async function deleteSoul(env: Env, user: User, id: string): Promise<boolean> {
  const r = await env.DB.prepare('DELETE FROM souls WHERE id = ? AND user_id = ?')
    .bind(id, user.id)
    .run();
  return (r.meta.changes ?? 0) > 0;
}

export async function remixSoul(
  env: Env,
  user: User,
  tier: Tier,
  id: string,
): Promise<{ ok: true; soul: ReturnType<typeof ownerShape> } | { ok: false; error: string; status: number }> {
  const limit = SOUL_LIMITS[tier].create;
  if (limit === 0) return { ok: false, error: 'tier_locked', status: 402 };
  const source = await env.DB.prepare('SELECT * FROM souls WHERE (id = ? OR slug = ?) AND public = 1')
    .bind(id, id)
    .first<SoulRow>();
  if (!source) return { ok: false, error: 'not_found', status: 404 };

  const owned = await env.DB.prepare('SELECT COUNT(*) as c FROM souls WHERE user_id = ?')
    .bind(user.id)
    .first<{ c: number }>();
  if ((owned?.c ?? 0) >= limit) return { ok: false, error: 'soul_limit_reached', status: 402 };

  const newId = randomToken(12);
  const newSlug = await uniqueSlug(env, `${source.name} remix`);
  const now = Math.floor(Date.now() / 1000);

  await env.DB.prepare(
    `INSERT INTO souls (id, user_id, name, tagline, system_prompt, first_message, voice_id, voice_label, public, remixed_from, slug, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?, ?)`,
  )
    .bind(
      newId,
      user.id,
      `${source.name} (remix)`,
      source.tagline,
      source.system_prompt,
      source.first_message,
      source.voice_id,
      source.voice_label,
      source.id,
      newSlug,
      now,
      now,
    )
    .run();
  await env.DB.prepare('UPDATE souls SET remix_count = remix_count + 1 WHERE id = ?')
    .bind(source.id)
    .run();

  const created = await env.DB.prepare('SELECT * FROM souls WHERE id = ?').bind(newId).first<SoulRow>();
  return { ok: true, soul: ownerShape(created!) };
}

// -- chat ---------------------------------------------------------------------

export async function chat(
  env: Env,
  user: User | null,
  identity: string,
  tier: Tier,
  soulIdOrSlug: string,
  userMessage: string,
  sessionId: string,
): Promise<{ ok: true; reply: string; messageId: string; sources?: string[] } | { ok: false; error: string; status: number; meta?: unknown }> {
  if (!env.ANTHROPIC_API_KEY) return { ok: false, error: 'llm_not_configured', status: 503 };
  if (!userMessage.trim()) return { ok: false, error: 'empty_message', status: 400 };

  // Daily limit (count) + budget check (cost)
  const day = new Date().toISOString().slice(0, 10);
  const used = await env.DB.prepare(
    'SELECT message_count FROM soul_usage_daily WHERE identity = ? AND day = ?',
  )
    .bind(identity, day)
    .first<{ message_count: number }>();
  const limit = SOUL_LIMITS[tier].messagesPerDay;
  if ((used?.message_count ?? 0) >= limit) {
    return {
      ok: false,
      error: 'rate_limited',
      status: 402,
      meta: { used: used?.message_count, limit, tier, upgrade_url: `${env.SITE_URL}/pricing` },
    };
  }
  const budget = await getBudget(env, identity, tier);
  if (budget.exceeded) {
    return {
      ok: false,
      error: 'budget_exceeded',
      status: 402,
      meta: {
        used_microcents: budget.used_microcents,
        cap_microcents: budget.cap_microcents,
        upgrade_url: `${env.SITE_URL}/pricing`,
      },
    };
  }

  const soul = await env.DB.prepare('SELECT * FROM souls WHERE id = ? OR slug = ?')
    .bind(soulIdOrSlug, soulIdOrSlug)
    .first<SoulRow>();
  if (!soul) return { ok: false, error: 'not_found', status: 404 };
  if (soul.public === 0 && soul.user_id !== user?.id) {
    return { ok: false, error: 'private_soul', status: 403 };
  }

  // Pull recent history for this session
  const history = await env.DB.prepare(
    `SELECT role, content FROM soul_messages
     WHERE session_id = ? ORDER BY created_at ASC LIMIT ?`,
  )
    .bind(sessionId, HISTORY_TURNS * 2)
    .all<{ role: 'user' | 'assistant'; content: string }>();

  const messages = [...(history.results ?? []), { role: 'user' as const, content: userMessage.slice(0, 4000) }];

  // RAG: retrieve relevant KB chunks for this Soul, prepend to system prompt
  let systemPrompt = soul.system_prompt;
  let ragSources: string[] = [];
  try {
    const ctx = await retrieveContext(env, soul.id, userMessage);
    if (ctx) {
      systemPrompt =
        soul.system_prompt +
        '\n\n--- KNOWLEDGE BASE (cite when relevant) ---\n' +
        ctx.context +
        '\n--- END KNOWLEDGE BASE ---\n\n' +
        'Use the knowledge above when it directly answers the user. If it does not, ignore it and reply from your own persona.';
      ragSources = ctx.sources;
    }
  } catch (e) {
    console.error('rag_failed', (e as Error).message);
  }

  // Call Anthropic
  const anthRes = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': env.ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 600,
      system: systemPrompt,
      messages,
    }),
  });
  if (!anthRes.ok) {
    const detail = await anthRes.text().catch(() => '');
    console.error('anthropic_chat_failed', anthRes.status, detail.slice(0, 200));
    return { ok: false, error: 'llm_failed', status: 502 };
  }
  const data = (await anthRes.json()) as {
    content: Array<{ text?: string }>;
    usage?: { input_tokens?: number; output_tokens?: number };
  };
  const reply = (data.content?.[0]?.text ?? '').trim();
  if (!reply) return { ok: false, error: 'empty_reply', status: 502 };
  await chargeCost(env, identity, {
    anthropic_in_tokens: data.usage?.input_tokens ?? estimateTokens(soul.system_prompt + userMessage),
    anthropic_out_tokens: data.usage?.output_tokens ?? estimateTokens(reply),
  });

  // Persist + increment counters
  const userMsgId = randomToken(10);
  const assistantMsgId = randomToken(10);
  const now = Math.floor(Date.now() / 1000);
  await env.DB.batch([
    env.DB.prepare(
      `INSERT INTO soul_messages (id, soul_id, session_id, user_id, role, content, created_at)
       VALUES (?, ?, ?, ?, 'user', ?, ?)`,
    ).bind(userMsgId, soul.id, sessionId, user?.id ?? null, userMessage, now),
    env.DB.prepare(
      `INSERT INTO soul_messages (id, soul_id, session_id, user_id, role, content, created_at)
       VALUES (?, ?, ?, ?, 'assistant', ?, ?)`,
    ).bind(assistantMsgId, soul.id, sessionId, user?.id ?? null, reply, now + 1),
    env.DB.prepare(
      `INSERT INTO soul_usage_daily (identity, day, message_count) VALUES (?, ?, 1)
       ON CONFLICT(identity, day) DO UPDATE SET message_count = message_count + 1`,
    ).bind(identity, day),
    env.DB.prepare('UPDATE souls SET chat_count = chat_count + 1 WHERE id = ?').bind(soul.id),
  ]);

  return { ok: true, reply, messageId: assistantMsgId, sources: ragSources };
}

// -- TTS streaming ------------------------------------------------------------

export async function speakText(
  env: Env,
  voiceId: string,
  text: string,
  cors: HeadersInit,
  identity: string,
  tier: Tier,
): Promise<Response> {
  if (!env.ELEVENLABS_API_KEY) {
    return new Response(JSON.stringify({ error: 'tts_not_configured' }), {
      status: 503,
      headers: { 'content-type': 'application/json', ...cors },
    });
  }
  if (!VOICES.find((v) => v.id === voiceId)) {
    return new Response(JSON.stringify({ error: 'unknown_voice' }), {
      status: 400,
      headers: { 'content-type': 'application/json', ...cors },
    });
  }
  const budget = await getBudget(env, identity, tier);
  if (budget.exceeded) {
    return new Response(
      JSON.stringify({
        error: 'budget_exceeded',
        used_microcents: budget.used_microcents,
        cap_microcents: budget.cap_microcents,
        upgrade_url: `${env.SITE_URL}/pricing`,
      }),
      { status: 402, headers: { 'content-type': 'application/json', ...cors } },
    );
  }
  const ttsRes = await fetch(
    `https://api.elevenlabs.io/v1/text-to-speech/${voiceId}/stream?output_format=mp3_44100_128`,
    {
      method: 'POST',
      headers: {
        'xi-api-key': env.ELEVENLABS_API_KEY,
        'content-type': 'application/json',
        Accept: 'audio/mpeg',
      },
      body: JSON.stringify({
        text: text.slice(0, 5000),
        model_id: 'eleven_turbo_v2_5',
        voice_settings: { stability: 0.5, similarity_boost: 0.75, style: 0.3, use_speaker_boost: true },
      }),
    },
  );
  if (!ttsRes.ok) {
    const detail = await ttsRes.text().catch(() => '');
    console.error('elevenlabs_failed', ttsRes.status, detail.slice(0, 200));
    return new Response(JSON.stringify({ error: 'tts_failed', status: ttsRes.status }), {
      status: 502,
      headers: { 'content-type': 'application/json', ...cors },
    });
  }
  // Charge for the characters we sent (cap-aware: text was already truncated).
  await chargeCost(env, identity, { elevenlabs_chars: Math.min(text.length, 5000) });
  const headers = new Headers(cors as HeadersInit);
  headers.set('content-type', 'audio/mpeg');
  headers.set('cache-control', 'private, max-age=3600');
  return new Response(ttsRes.body, { status: 200, headers });
}

// -- helpers ------------------------------------------------------------------

async function uniqueSlug(env: Env, name: string): Promise<string> {
  const base =
    name
      .toLowerCase()
      .trim()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 40) || 'soul';
  let candidate = base;
  let i = 0;
  for (;;) {
    const exists = await env.DB.prepare('SELECT 1 FROM souls WHERE slug = ?')
      .bind(candidate)
      .first();
    if (!exists) return candidate;
    i++;
    candidate = `${base}-${i}`;
    if (i > 50) return `${base}-${randomToken(4)}`;
  }
}
