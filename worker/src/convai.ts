// ElevenLabs Convai integration. When a Soul has real-time voice enabled,
// we mirror it as a Convai agent so it can be reached at ~300ms latency via:
//   - The <elevenlabs-convai> widget on the web (browser-side WebSocket)
//   - A connected Twilio phone number (EL handles the audio bridging)
//
// This module owns the lifecycle: create on first enable, sync on edits,
// delete when the Soul is deleted or real-time is turned off.

import type { Env } from './types';

const API = 'https://api.elevenlabs.io/v1';

interface CreateAgentResp {
  agent_id: string;
}

async function el<T>(env: Env, path: string, init: RequestInit = {}): Promise<T> {
  if (!env.ELEVENLABS_API_KEY) throw new Error('elevenlabs_not_configured');
  const r = await fetch(`${API}${path}`, {
    ...init,
    headers: {
      'xi-api-key': env.ELEVENLABS_API_KEY,
      'content-type': 'application/json',
      ...(init.headers ?? {}),
    },
  });
  if (!r.ok) {
    const detail = await r.text().catch(() => '');
    throw new Error(`convai_${r.status}: ${detail.slice(0, 250)}`);
  }
  return (await r.json()) as T;
}

interface AgentConfig {
  name: string;
  systemPrompt: string;
  firstMessage: string;
  voiceId: string;
}

function buildPayload(cfg: AgentConfig) {
  return {
    name: cfg.name.slice(0, 80),
    conversation_config: {
      agent: {
        prompt: {
          prompt: cfg.systemPrompt.slice(0, 6000),
          // We let ElevenLabs default the LLM (their gateway picks the best model).
          // Override if you want a specific Claude/GPT/Gemini model.
        },
        first_message: cfg.firstMessage.slice(0, 500),
        language: 'en',
      },
      tts: {
        voice_id: cfg.voiceId,
        model_id: 'eleven_turbo_v2_5',
      },
    },
  };
}

/** Create a new Convai agent. Returns agent_id. */
export async function createAgent(env: Env, cfg: AgentConfig): Promise<string> {
  const payload = buildPayload(cfg);
  const r = await el<CreateAgentResp>(env, '/convai/agents/create', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
  return r.agent_id;
}

/** Update an existing Convai agent (system prompt, voice, etc.). */
export async function updateAgent(env: Env, agentId: string, cfg: AgentConfig): Promise<void> {
  const payload = buildPayload(cfg);
  await el(env, `/convai/agents/${encodeURIComponent(agentId)}`, {
    method: 'PATCH',
    body: JSON.stringify(payload),
  });
}

/** Delete a Convai agent. Idempotent — 404 is treated as success. */
export async function deleteAgent(env: Env, agentId: string): Promise<void> {
  if (!env.ELEVENLABS_API_KEY) return;
  const r = await fetch(`${API}/convai/agents/${encodeURIComponent(agentId)}`, {
    method: 'DELETE',
    headers: { 'xi-api-key': env.ELEVENLABS_API_KEY },
  });
  if (!r.ok && r.status !== 404) {
    const detail = await r.text().catch(() => '');
    console.error('convai_delete_failed', agentId, r.status, detail.slice(0, 200));
  }
}

/**
 * Get a signed URL for browser-side WebSocket connection. The widget can use
 * this to start a real-time conversation without the user's browser ever
 * seeing our ElevenLabs API key.
 */
export async function getSignedUrl(env: Env, agentId: string): Promise<string> {
  const r = await el<{ signed_url: string }>(
    env,
    `/convai/conversation/get-signed-url?agent_id=${encodeURIComponent(agentId)}`,
  );
  return r.signed_url;
}
