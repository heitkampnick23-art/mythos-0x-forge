// Heartbeat client API — souls CRUD + chat + voices.
const API_BASE =
  (import.meta.env.VITE_FORGE_API_URL as string | undefined) ?? 'https://api.mythos0x.com';

export interface Voice {
  id: string;
  label: string;
  desc: string;
}

export interface SoulPublic {
  id: string;
  name: string;
  tagline: string;
  voice_id: string;
  voice_label: string;
  public: boolean;
  chat_count: number;
  remix_count: number;
  slug: string | null;
  created_at: number;
  is_owner: boolean;
  first_message: string;
}

export interface SoulOwner extends SoulPublic {
  system_prompt: string;
  is_owner: true;
  remixed_from: string | null;
  phone_number?: string | null;
  convai_agent_id?: string | null;
  realtime_voice?: boolean;
}

async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    credentials: 'include',
    ...init,
    headers: { 'content-type': 'application/json', ...(init.headers ?? {}) },
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    throw Object.assign(new Error(`api ${res.status}`), { status: res.status, detail });
  }
  return res.json() as Promise<T>;
}

export const fetchVoices = () => api<{ voices: Voice[] }>('/v1/souls/voices').then((r) => r.voices);

export const fetchMarketplace = () =>
  api<{ souls: SoulPublic[] }>('/v1/souls/marketplace').then((r) => r.souls);

export const fetchMine = () => api<{ souls: SoulOwner[] }>('/v1/souls/mine').then((r) => r.souls);

export const fetchSoul = (idOrSlug: string) =>
  api<{ soul: SoulPublic | SoulOwner }>(`/v1/souls/${idOrSlug}`).then((r) => r.soul);

export const createSoul = (body: {
  name: string;
  tagline?: string;
  system_prompt: string;
  first_message?: string;
  voice_id: string;
  public: boolean;
  realtime_voice?: boolean;
}) =>
  api<{ soul: SoulOwner }>('/v1/souls', { method: 'POST', body: JSON.stringify(body) }).then(
    (r) => r.soul,
  );

/** Get a signed WebSocket URL for the realtime Convai widget. */
export const getConvaiSignedUrl = (idOrSlug: string) =>
  api<{ signed_url: string; agent_id: string }>(`/v1/souls/${idOrSlug}/convai-url`, {
    method: 'POST',
  });

export const deleteSoul = (id: string) =>
  api<{ ok: boolean }>(`/v1/souls/${id}`, { method: 'DELETE' });

export const remixSoul = (idOrSlug: string) =>
  api<{ soul: SoulOwner }>(`/v1/souls/${idOrSlug}/remix`, { method: 'POST' }).then((r) => r.soul);

export const sendSoulMessage = (
  idOrSlug: string,
  message: string,
  sessionId?: string,
) =>
  api<{ reply: string; message_id: string; session_id: string }>(`/v1/souls/${idOrSlug}/chat`, {
    method: 'POST',
    body: JSON.stringify({ message, session_id: sessionId }),
  });

// -- knowledge base ----------------------------------------------------------

export interface KbDoc {
  id: string;
  soul_id: string;
  filename: string;
  content_type: string;
  size_bytes: number;
  status: 'processing' | 'indexed' | 'failed';
  chunk_count: number;
  created_at: number;
}

export const fetchKbDocs = (idOrSlug: string) =>
  api<{ docs: KbDoc[] }>(`/v1/souls/${idOrSlug}/kb`).then((r) => r.docs);

export async function uploadKbDoc(idOrSlug: string, file: File): Promise<KbDoc> {
  const form = new FormData();
  form.append('file', file);
  const res = await fetch(`${API_BASE}/v1/souls/${idOrSlug}/kb`, {
    method: 'POST',
    credentials: 'include',
    body: form,
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    throw Object.assign(new Error(`kb_upload ${res.status}`), { status: res.status, detail });
  }
  const data = (await res.json()) as { doc: KbDoc };
  return data.doc;
}

export const deleteKbDoc = (idOrSlug: string, docId: string) =>
  api<{ ok: boolean }>(`/v1/souls/${idOrSlug}/kb/${docId}`, { method: 'DELETE' });

// -- phone numbers (Twilio) --------------------------------------------------

export const attachPhoneToSoul = (idOrSlug: string, e164: string) =>
  api<{ ok: boolean }>(`/v1/souls/${idOrSlug}/phone`, {
    method: 'POST',
    body: JSON.stringify({ phone_number: e164 }),
  });

export const detachPhoneFromSoul = (idOrSlug: string) =>
  api<{ ok: boolean }>(`/v1/souls/${idOrSlug}/phone`, { method: 'DELETE' });

/** Returns an object URL for the streamed MP3. Caller must revoke. */
export async function speakSoulText(idOrSlug: string, text: string): Promise<string> {
  const res = await fetch(`${API_BASE}/v1/souls/${idOrSlug}/speak`, {
    method: 'POST',
    credentials: 'include',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ text }),
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    throw Object.assign(new Error(`speak ${res.status}`), { status: res.status, detail });
  }
  return URL.createObjectURL(await res.blob());
}
