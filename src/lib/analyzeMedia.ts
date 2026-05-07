// =============================================================================
// Client-side analyzeMedia: posts to the Mythos Forge API Worker.
//
// Worker endpoint: VITE_FORGE_API_URL (defaults to https://api.mythos0x.com).
// The Worker handles routing to Reality Defender (or its mock fallback) and
// Anthropic narration server-side; the client never sees provider keys.
// =============================================================================

const API_BASE =
  (import.meta.env.VITE_FORGE_API_URL as string | undefined) ?? 'https://api.mythos0x.com';

export type MediaKind = 'image' | 'video';

export interface BoundingBox {
  x: number;
  y: number;
  width: number;
  height: number;
  label: string;
  severity: number;
}

export interface Finding {
  category:
    | 'lighting'
    | 'reflection'
    | 'texture'
    | 'motion'
    | 'frequency'
    | 'geometry'
    | 'compression';
  title: string;
  detail: string;
  weight: number;
}

export interface AnalysisResult {
  kind: MediaKind;
  confidence: number;
  verdict: 'authentic' | 'suspect' | 'synthetic';
  modelTag: string;
  durationMs: number;
  boxes: BoundingBox[];
  findings: Finding[];
  /** Database ID — used to toggle the public-share flag. */
  analysisId?: string;
  /** Stable slug for the public verdict page + PDF filename. */
  shareSlug?: string;
  /** SHA-256 of the uploaded bytes, shown in the PDF for tamper-evidence. */
  sha256?: string;
  tier?: 'free' | 'pro' | 'max';
  used?: number;
  limit?: number;
}

export interface AnalyzeOptions {
  signal?: AbortSignal;
  onProgress?: (t: number) => void;
}

export async function analyzeMedia(
  file: File,
  opts: AnalyzeOptions = {},
): Promise<AnalysisResult> {
  // Smooth fake-progress while we wait on the network — keeps the scan
  // animation populated. Real time-to-result is 1-15s depending on provider;
  // the easing curve front-loads progress so it feels responsive.
  let cancelled = false;
  const start = performance.now();
  const tick = () => {
    if (cancelled) return;
    const t = Math.min(0.95, 1 - Math.exp(-(performance.now() - start) / 2000));
    opts.onProgress?.(t);
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);

  try {
    const form = new FormData();
    form.append('file', file);

    const res = await fetch(`${API_BASE}/v1/analyze`, {
      method: 'POST',
      body: form,
      credentials: 'include',
      signal: opts.signal,
    });

    if (res.status === 402) {
      const data = (await res.json()) as {
        tier: string;
        used: number;
        limit: number;
        upgrade_url: string;
      };
      throw Object.assign(new Error('rate_limited'), {
        rateLimited: true,
        tier: data.tier,
        used: data.used,
        limit: data.limit,
        upgradeUrl: data.upgrade_url,
      });
    }

    if (!res.ok) {
      const detail = await res.text().catch(() => '');
      throw new Error(`forge-api ${res.status}: ${detail || res.statusText}`);
    }

    const result = (await res.json()) as AnalysisResult;
    cancelled = true;
    opts.onProgress?.(1);
    return result;
  } catch (err) {
    cancelled = true;
    throw err;
  }
}

export interface RateLimitedError extends Error {
  rateLimited: true;
  tier: string;
  used: number;
  limit: number;
  upgradeUrl: string;
}

export function isRateLimited(err: unknown): err is RateLimitedError {
  return Boolean((err as { rateLimited?: boolean })?.rateLimited);
}
