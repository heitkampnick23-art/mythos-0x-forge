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

// -- verdict pages + PDF reports ---------------------------------------------

export interface PublicVerdict {
  slug: string;
  kind: 'image' | 'video';
  confidence: number;
  verdict: 'authentic' | 'suspect' | 'synthetic';
  modelTag: string;
  durationMs: number;
  sha256: string | null;
  originalName: string | null;
  findings: Array<{ category: string; title: string; detail: string; weight: number }>;
  boxes: Array<{ x: number; y: number; width: number; height: number; label: string; severity: number }>;
  public: boolean;
  createdAt: number;
  isOwner: boolean;
  hasMedia: boolean;
}

export const fetchVerdict = (slug: string) => api<PublicVerdict>(`/v1/verdicts/${slug}`);

export const verdictMediaUrl = (slug: string) => `${API_BASE}/v1/verdicts/${slug}/image`;

/** Toggle public-share flag for an owner-only analysis. Returns the share URL. */
export async function shareAnalysis(analysisId: string, isPublic: boolean): Promise<string | null> {
  const r = await api<{ ok: true; public: boolean; slug: string | null; url: string | null }>(
    `/v1/analyses/${analysisId}/share`,
    { method: 'POST', body: JSON.stringify({ public: isPublic }) },
  );
  return r.url;
}

// -- bulk URL batches --------------------------------------------------------

export interface BatchJob {
  id: string;
  user_id: string;
  total: number;
  done: number;
  failed: number;
  status: 'queued' | 'processing' | 'done';
  created_at: number;
  completed_at: number | null;
}

export interface BatchItem {
  id: string;
  batch_id: string;
  position: number;
  url: string;
  status: 'pending' | 'done' | 'failed';
  analysis_id: string | null;
  share_slug: string | null;
  confidence: number | null;
  verdict: 'authentic' | 'suspect' | 'synthetic' | null;
  error: string | null;
  created_at: number;
  completed_at: number | null;
}

export async function createBatch(urls: string[]): Promise<{ batch_id: string; total: number }> {
  return api<{ batch_id: string; total: number }>('/v1/batch', {
    method: 'POST',
    body: JSON.stringify({ urls }),
  });
}

export const fetchBatch = (id: string) =>
  api<{ job: BatchJob; items: BatchItem[] }>(`/v1/batch/${id}`);

export const fetchMyBatches = () => api<{ jobs: BatchJob[] }>('/v1/batch').then((r) => r.jobs);

export function downloadBatchCsv(id: string): void {
  // Anchor with credentials is tricky; just fetch + blob
  fetch(`${API_BASE}/v1/batch/${id}/csv`, { credentials: 'include' })
    .then((res) => {
      if (!res.ok) throw new Error(`csv ${res.status}`);
      return res.blob();
    })
    .then((blob) => {
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `mythos-batch-${id}.csv`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setTimeout(() => URL.revokeObjectURL(url), 5000);
    });
}

/** Trigger PDF download. Pro+ tier required. */
export async function downloadVerdictPdf(slug: string): Promise<void> {
  const res = await fetch(`${API_BASE}/v1/verdicts/${slug}/pdf`, { credentials: 'include' });
  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    throw Object.assign(new Error(`pdf ${res.status}`), { status: res.status, detail });
  }
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `mythos-verdict-${slug}.pdf`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 5000);
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
