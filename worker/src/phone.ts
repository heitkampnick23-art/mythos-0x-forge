// Twilio voice → Soul. Degraded mode (no ElevenLabs Convai required).
//
// Flow per call leg:
//   1. Caller dials Twilio number
//   2. Twilio POSTs to /v1/phone/incoming with form params (CallSid, From, To, ...)
//   3. We look up the Soul by `To` (the called number)
//   4. Return TwiML with <Gather input="speech"> + <Say> first_message
//   5. Twilio collects user speech, POSTs to /v1/phone/respond with SpeechResult
//   6. We call Anthropic with soul system_prompt + history → reply text
//   7. Return TwiML with <Play>https://api.mythos0x.com/v1/phone/tts?text=...</Play>
//      followed by another <Gather> to continue the conversation
//
// /v1/phone/tts is an unauthenticated endpoint that streams ElevenLabs audio
// for a given soul + text. Twilio is the only realistic caller; we sign the
// URL with an HMAC of (soul_id|message_id|expiry) so randoms can't pre-warm
// our TTS budget.

import type { Env } from './types';

const SIG_SECRET_KEY = 'phone_url_secret';

interface SoulRow {
  id: string;
  name: string;
  voice_id: string;
  system_prompt: string;
  first_message: string;
  user_id: string;
  phone_number: string | null;
}

// ---- helpers --------------------------------------------------------------

async function ensureSecret(env: Env): Promise<string> {
  const r = await env.DB.prepare('SELECT value FROM app_settings WHERE key = ?')
    .bind(SIG_SECRET_KEY)
    .first<{ value: string }>();
  if (r?.value) return r.value;
  // First-time generation
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  const secret = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
  await env.DB.prepare(
    'INSERT INTO app_settings (key, value, updated_at) VALUES (?, ?, ?) ON CONFLICT(key) DO NOTHING',
  )
    .bind(SIG_SECRET_KEY, secret, Math.floor(Date.now() / 1000))
    .run();
  return secret;
}

async function hmac(secret: string, message: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const buf = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(message));
  return Array.from(new Uint8Array(buf), (b) => b.toString(16).padStart(2, '0')).join('');
}

async function signUrl(env: Env, soulId: string, text: string): Promise<string> {
  const secret = await ensureSecret(env);
  const expiry = Math.floor(Date.now() / 1000) + 300; // 5 minutes
  const payload = `${soulId}|${expiry}|${text.slice(0, 4000)}`;
  const sig = (await hmac(secret, payload)).slice(0, 32);
  const params = new URLSearchParams({
    s: soulId,
    e: String(expiry),
    sig,
    t: text.slice(0, 4000),
  });
  return `https://api.mythos0x.com/v1/phone/tts?${params.toString()}`;
}

async function verifySignedTtsUrl(
  env: Env,
  soulId: string,
  expiry: number,
  text: string,
  sig: string,
): Promise<boolean> {
  if (Math.floor(Date.now() / 1000) > expiry) return false;
  const secret = await ensureSecret(env);
  const expected = (await hmac(secret, `${soulId}|${expiry}|${text}`)).slice(0, 32);
  return expected === sig;
}

function escapeXml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function twiml(body: string): Response {
  return new Response(`<?xml version="1.0" encoding="UTF-8"?>${body}`, {
    status: 200,
    headers: { 'content-type': 'text/xml; charset=utf-8' },
  });
}

async function loadSoulByPhone(env: Env, phone: string): Promise<SoulRow | null> {
  return env.DB.prepare(
    'SELECT id, name, voice_id, system_prompt, first_message, user_id, phone_number FROM souls WHERE phone_number = ?',
  )
    .bind(phone)
    .first<SoulRow>();
}

// ---- route handlers -------------------------------------------------------

export async function handleIncoming(req: Request, env: Env): Promise<Response> {
  const data = await req.formData();
  const to = String(data.get('To') ?? '');
  const callSid = String(data.get('CallSid') ?? '');
  const soul = await loadSoulByPhone(env, to);
  if (!soul) {
    return twiml(
      `<Response><Say voice="alice">This Mythos line is not assigned. Goodbye.</Say><Hangup/></Response>`,
    );
  }
  const ttsUrl = await signUrl(env, soul.id, soul.first_message);
  const respondUrl = `https://api.mythos0x.com/v1/phone/respond?soul=${encodeURIComponent(soul.id)}&call=${encodeURIComponent(callSid)}`;
  return twiml(`
<Response>
  <Play>${ttsUrl}</Play>
  <Gather input="speech" action="${respondUrl}" method="POST" speechTimeout="auto" speechModel="phone_call">
    <Say voice="alice">I'm listening.</Say>
  </Gather>
  <Say voice="alice">No reply heard. Goodbye.</Say>
</Response>`);
}

export async function handleRespond(req: Request, env: Env): Promise<Response> {
  const url = new URL(req.url);
  const soulId = url.searchParams.get('soul') ?? '';
  const callSid = url.searchParams.get('call') ?? '';
  const data = await req.formData();
  const speech = String(data.get('SpeechResult') ?? '').trim();

  const soul = await env.DB.prepare(
    'SELECT id, system_prompt, voice_id FROM souls WHERE id = ?',
  )
    .bind(soulId)
    .first<{ id: string; system_prompt: string; voice_id: string }>();
  if (!soul) {
    return twiml(`<Response><Say voice="alice">Soul not found.</Say><Hangup/></Response>`);
  }
  if (!speech) {
    return twiml(`<Response><Say voice="alice">No speech detected. Try again.</Say><Hangup/></Response>`);
  }

  // Pull recent turns for this call session (callSid as session_id)
  const history = await env.DB.prepare(
    `SELECT role, content FROM soul_messages WHERE session_id = ? ORDER BY created_at ASC LIMIT 20`,
  )
    .bind(callSid)
    .all<{ role: 'user' | 'assistant'; content: string }>();

  const messages = [
    ...(history.results ?? []),
    { role: 'user' as const, content: speech.slice(0, 1000) },
  ];

  let reply = 'Sorry, I lost the thread. Please call back.';
  if (env.ANTHROPIC_API_KEY) {
    try {
      const r = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'x-api-key': env.ANTHROPIC_API_KEY,
          'anthropic-version': '2023-06-01',
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          model: 'claude-haiku-4-5-20251001',
          max_tokens: 250, // shorter responses for phone — keep latency manageable
          system:
            soul.system_prompt +
            '\n\nReply briefly (1-2 sentences) — this conversation is over a phone call. Avoid lists, markdown, or long preambles.',
          messages,
        }),
      });
      if (r.ok) {
        const data2 = (await r.json()) as { content: Array<{ text?: string }> };
        reply = (data2.content?.[0]?.text ?? reply).trim();
      }
    } catch (e) {
      console.error('phone_anthropic_failed', (e as Error).message);
    }
  }

  // Persist turns
  const now = Math.floor(Date.now() / 1000);
  await env.DB.batch([
    env.DB.prepare(
      `INSERT INTO soul_messages (id, soul_id, session_id, user_id, role, content, created_at)
       VALUES (?, ?, ?, NULL, 'user', ?, ?)`,
    ).bind(crypto.randomUUID(), soul.id, callSid, speech, now),
    env.DB.prepare(
      `INSERT INTO soul_messages (id, soul_id, session_id, user_id, role, content, created_at)
       VALUES (?, ?, ?, NULL, 'assistant', ?, ?)`,
    ).bind(crypto.randomUUID(), soul.id, callSid, reply, now + 1),
  ]);

  const ttsUrl = await signUrl(env, soul.id, reply);
  const respondUrl = `https://api.mythos0x.com/v1/phone/respond?soul=${encodeURIComponent(soul.id)}&call=${encodeURIComponent(callSid)}`;
  return twiml(`
<Response>
  <Play>${ttsUrl}</Play>
  <Gather input="speech" action="${respondUrl}" method="POST" speechTimeout="auto" speechModel="phone_call">
    <Say voice="alice">${escapeXml('Anything else?')}</Say>
  </Gather>
  <Say voice="alice">${escapeXml('Thanks for calling. Goodbye.')}</Say>
</Response>`);
}

export async function handleTts(req: Request, env: Env): Promise<Response> {
  const url = new URL(req.url);
  const soulId = url.searchParams.get('s') ?? '';
  const expiry = Number(url.searchParams.get('e') ?? '0');
  const sig = url.searchParams.get('sig') ?? '';
  const text = url.searchParams.get('t') ?? '';

  if (!(await verifySignedTtsUrl(env, soulId, expiry, text, sig))) {
    return new Response('forbidden', { status: 403 });
  }
  if (!env.ELEVENLABS_API_KEY) {
    return new Response('tts not configured', { status: 503 });
  }
  const soul = await env.DB.prepare('SELECT voice_id FROM souls WHERE id = ?')
    .bind(soulId)
    .first<{ voice_id: string }>();
  if (!soul) return new Response('not found', { status: 404 });

  const ttsRes = await fetch(
    `https://api.elevenlabs.io/v1/text-to-speech/${soul.voice_id}/stream?output_format=mp3_44100_128`,
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
  if (!ttsRes.ok) return new Response('tts failed', { status: 502 });
  return new Response(ttsRes.body, {
    status: 200,
    headers: { 'content-type': 'audio/mpeg', 'cache-control': 'private, max-age=300' },
  });
}

// ---- attach a phone number to a Soul (called from owner's UI) -------------

export async function attachPhone(
  env: Env,
  userId: string,
  soulIdOrSlug: string,
  e164: string,
): Promise<{ ok: true } | { ok: false; error: string; status: number }> {
  if (!/^\+[1-9]\d{6,15}$/.test(e164)) {
    return { ok: false, error: 'invalid_e164', status: 400 };
  }
  const soul = await env.DB.prepare('SELECT id, user_id FROM souls WHERE id = ? OR slug = ?')
    .bind(soulIdOrSlug, soulIdOrSlug)
    .first<{ id: string; user_id: string }>();
  if (!soul) return { ok: false, error: 'soul_not_found', status: 404 };
  if (soul.user_id !== userId) return { ok: false, error: 'not_owner', status: 403 };
  // Make sure no other Soul owns this number
  const taken = await env.DB.prepare(
    'SELECT id FROM souls WHERE phone_number = ? AND id != ?',
  )
    .bind(e164, soul.id)
    .first();
  if (taken) return { ok: false, error: 'phone_in_use', status: 409 };
  await env.DB.prepare('UPDATE souls SET phone_number = ?, phone_provider = ? WHERE id = ?')
    .bind(e164, 'twilio', soul.id)
    .run();
  return { ok: true };
}

export async function detachPhone(
  env: Env,
  userId: string,
  soulIdOrSlug: string,
): Promise<{ ok: true } | { ok: false; error: string; status: number }> {
  const soul = await env.DB.prepare('SELECT id, user_id FROM souls WHERE id = ? OR slug = ?')
    .bind(soulIdOrSlug, soulIdOrSlug)
    .first<{ id: string; user_id: string }>();
  if (!soul) return { ok: false, error: 'soul_not_found', status: 404 };
  if (soul.user_id !== userId) return { ok: false, error: 'not_owner', status: 403 };
  await env.DB.prepare('UPDATE souls SET phone_number = NULL, phone_provider = NULL WHERE id = ?')
    .bind(soul.id)
    .run();
  return { ok: true };
}
