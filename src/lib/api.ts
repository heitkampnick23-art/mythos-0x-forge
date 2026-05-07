// Typed Worker client. All requests are credentialed (cookie-based session).
const API_BASE =
  (import.meta.env.VITE_FORGE_API_URL as string | undefined) ?? 'https://api.mythos0x.com';

export type Tier = 'free' | 'pro' | 'max';

export interface Limits {
  free: number;
  pro: number;
  max: number;
}

export interface MeResponse {
  authenticated: boolean;
  user?: {
    id: string;
    email: string;
    tier: Tier;
    hasStripe: boolean;
    display_name: string | null;
    default_voice_id: string;
    auto_speak: boolean;
    notify_email: boolean;
  };
  tier?: Tier;
  limits: Limits;
}

export interface UsageResponse {
  tier: Tier;
  day: string;
  budget: {
    used_cents: number;
    cap_cents: number;
    ratio: number;
    near_limit: boolean;
    exceeded: boolean;
  };
  analyses: { used: number; limit: number };
  soul_messages: { used: number; limit: number };
}

export const fetchUsage = (): Promise<UsageResponse> => api<UsageResponse>('/v1/me/usage');

export async function updateProfile(body: {
  display_name?: string;
  default_voice_id?: string;
  auto_speak?: boolean;
  notify_email?: boolean;
}): Promise<void> {
  await api<{ ok: true }>('/v1/me/profile', {
    method: 'POST',
    body: JSON.stringify(body),
  });
}

async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    credentials: 'include',
    ...init,
    headers: { 'content-type': 'application/json', ...(init.headers ?? {}) },
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    throw Object.assign(new Error(`api ${res.status}: ${detail.slice(0, 200)}`), {
      status: res.status,
      detail,
    });
  }
  return res.json() as Promise<T>;
}

export const fetchMe = (): Promise<MeResponse> => api<MeResponse>('/v1/me');

export async function startCheckout(price_id: string, email?: string): Promise<string> {
  const r = await api<{ url: string }>('/v1/checkout', {
    method: 'POST',
    body: JSON.stringify({ price_id, email }),
  });
  return r.url;
}

export async function openBillingPortal(): Promise<string> {
  const r = await api<{ url: string }>('/v1/portal', {
    method: 'POST',
    body: JSON.stringify({ return_url: `${window.location.origin}/account` }),
  });
  return r.url;
}

export async function sendMagicLink(email: string): Promise<void> {
  await api<{ ok: true }>('/v1/auth/magic-link', {
    method: 'POST',
    body: JSON.stringify({ email }),
  });
}

export async function logout(): Promise<void> {
  await api<{ ok: true }>('/v1/auth/logout', { method: 'POST' });
}

export interface AnalysisRow {
  id: string;
  kind: 'image' | 'video';
  confidence: number;
  verdict: 'authentic' | 'suspect' | 'synthetic';
  model_tag: string;
  duration_ms: number;
  created_at: number;
}

export async function listAnalyses(): Promise<AnalysisRow[]> {
  const r = await api<{ analyses: AnalysisRow[] }>('/v1/analyses');
  return r.analyses;
}

/**
 * Stream the verdict as an audio blob via ElevenLabs. Pro+ tier only.
 * Returns an object URL the caller is responsible for revoking.
 */
export async function fetchVerdictAudio(payload: {
  confidence: number;
  verdict: string;
  findings: Array<{ category: string; title: string; detail: string; weight: number }>;
}): Promise<string> {
  const res = await fetch(`${API_BASE}/v1/voice/verdict`, {
    method: 'POST',
    credentials: 'include',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    throw Object.assign(new Error(`voice ${res.status}`), { status: res.status, detail });
  }
  const blob = await res.blob();
  return URL.createObjectURL(blob);
}

// Pricing — kept in sync with Worker's wrangler.toml vars
export const PRICES = {
  pro: {
    monthly: { id: 'price_1TUDMUQu1YpWmfU0YKer3uRx', amount: 19, interval: 'month' as const },
    yearly: { id: 'price_1TUDMmQu1YpWmfU0qAoMonqK', amount: 190, interval: 'year' as const },
  },
  max: {
    monthly: { id: 'price_1TUDMuQu1YpWmfU04iNloR3Y', amount: 79, interval: 'month' as const },
    yearly: { id: 'price_1TUDN3Qu1YpWmfU0Wbeibk7t', amount: 790, interval: 'year' as const },
  },
};
