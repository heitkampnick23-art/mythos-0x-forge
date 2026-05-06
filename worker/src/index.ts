// =============================================================================
// Mythos 0X Forge — API Worker
// Routes:
//   POST /v1/analyze   multipart upload, returns AnalysisResult
//   GET  /v1/health    liveness probe
//
// Env (set via `wrangler secret put`):
//   REALITY_DEFENDER_API_KEY  — when present, hits real detection. Else mock.
//   ANTHROPIC_API_KEY         — when present, narrates findings via Claude. Else static.
//
// Design: every external dep has a clean fallback so the Worker can ship before
// keys are provisioned. Behavior degrades to the same simulated UX the v1 site
// shipped with — no regression while keys are pending.
// =============================================================================

interface Env {
  MEDIA: R2Bucket;
  ALLOWED_ORIGIN: string;
  ENABLE_MOCK_FALLBACK: string;
  // Detection: Sightengine (self-serve). When both creds are set we hit the
  // real `genai` model; otherwise we degrade to the deterministic mock.
  SIGHTENGINE_USER?: string;
  SIGHTENGINE_SECRET?: string;
  // Narration: Anthropic Claude Haiku
  ANTHROPIC_API_KEY?: string;
}

type MediaKind = 'image' | 'video';

interface BoundingBox {
  x: number;
  y: number;
  width: number;
  height: number;
  label: string;
  severity: number;
}

interface Finding {
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

interface AnalysisResult {
  kind: MediaKind;
  confidence: number;
  verdict: 'authentic' | 'suspect' | 'synthetic';
  modelTag: string;
  durationMs: number;
  boxes: BoundingBox[];
  findings: Finding[];
}

const MAX_IMAGE = 20 * 1024 * 1024;
const MAX_VIDEO = 50 * 1024 * 1024;
const IMAGE_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp']);
const VIDEO_TYPES = new Set(['video/mp4', 'video/webm']);

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const url = new URL(req.url);
    const cors = corsHeaders(env, req.headers.get('origin'));

    if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });

    try {
      if (url.pathname === '/v1/health') return json({ ok: true, ts: Date.now() }, cors);
      if (url.pathname === '/v1/analyze' && req.method === 'POST') return await analyze(req, env, cors);
      return json({ error: 'not_found' }, cors, 404);
    } catch (err) {
      return json({ error: 'internal_error', detail: (err as Error).message }, cors, 500);
    }
  },
};

// -- routes -------------------------------------------------------------------

async function analyze(req: Request, env: Env, cors: HeadersInit): Promise<Response> {
  const start = Date.now();
  const form = await req.formData();
  const entry = form.get('file');
  if (!entry || typeof entry === 'string') {
    return json({ error: 'missing_file' }, cors, 400);
  }
  const file = entry as File;

  const validation = validateFile(file);
  if (!validation.ok) return json({ error: 'invalid_file', detail: validation.reason }, cors, 400);
  const kind = validation.kind;

  // Stash in R2 with a 1-hour TTL key so the detector (or downstream tools) can
  // fetch a signed URL. Even when not used by the mock path we still cache for
  // observability + future reuse.
  const objectKey = `analyses/${crypto.randomUUID()}-${safeName(file.name)}`;
  await env.MEDIA.put(objectKey, file.stream(), {
    httpMetadata: { contentType: file.type },
    customMetadata: { kind, originalName: file.name },
  });

  // Real detection if keyed; otherwise deterministic mock identical to v1 client.
  // Provider failures fall back to the mock so we never serve 5xx during an
  // upstream outage — confidence in `modelTag` lets the UI show provenance.
  let result: AnalysisResult;
  if (env.SIGHTENGINE_USER && env.SIGHTENGINE_SECRET) {
    try {
      result = await detectWithSightengine(file, kind, env);
    } catch (e) {
      console.error('sightengine_failed', (e as Error).message);
      if (env.ENABLE_MOCK_FALLBACK === 'true') result = await mockAnalyze(file, kind);
      else throw e;
    }
  } else if (env.ENABLE_MOCK_FALLBACK === 'true') {
    result = await mockAnalyze(file, kind);
  } else {
    return json({ error: 'detection_unavailable' }, cors, 503);
  }

  // Narration pass — turns raw scores into compelling forensic prose.
  if (env.ANTHROPIC_API_KEY) {
    try {
      result.findings = await narrate(result, env);
    } catch {
      // Narration is best-effort; never block on its failure.
    }
  }

  result.durationMs = Date.now() - start;
  return json(result, cors);
}

// -- detection (real) ---------------------------------------------------------

/**
 * Sightengine — self-serve AI detection. Uses the `genai` model for images
 * (and `deepfake` if the user later upgrades). Image flow is sync. Video flow
 * uses the sync video endpoint with frame-sampling.
 *
 * Docs: https://sightengine.com/docs/ai-generated-image-detection
 *       https://sightengine.com/docs/synchronous-video-content-moderation
 */
async function detectWithSightengine(
  file: File,
  kind: MediaKind,
  env: Env,
): Promise<AnalysisResult> {
  const endpoint =
    kind === 'image'
      ? 'https://api.sightengine.com/1.0/check.json'
      : 'https://api.sightengine.com/1.0/video/check-sync.json';

  const form = new FormData();
  form.append('media', file, file.name);
  form.append('models', 'genai');
  form.append('api_user', env.SIGHTENGINE_USER!);
  form.append('api_secret', env.SIGHTENGINE_SECRET!);

  const r = await fetch(endpoint, { method: 'POST', body: form });
  if (!r.ok) {
    const text = await r.text().catch(() => '');
    throw new Error(`sightengine ${r.status}: ${text.slice(0, 200)}`);
  }
  const data = (await r.json()) as SightengineResult;
  if (data.status !== 'success') {
    throw new Error(`sightengine_status: ${data.error?.message ?? data.status}`);
  }

  return mapSightengineResult(data, kind);
}

interface SightengineResult {
  status: string;
  error?: { message?: string; code?: number };
  type?: { ai_generated?: number };
  data?: { frames?: Array<{ position?: number; type?: { ai_generated?: number } }> };
}

function mapSightengineResult(data: SightengineResult, kind: MediaKind): AnalysisResult {
  // Image: top-level type.ai_generated is 0..1
  // Video: average across frames, also keep peak for finding detail
  let confidence = 0;
  let peak = 0;
  let frameCount = 0;
  if (kind === 'image') {
    confidence = data.type?.ai_generated ?? 0;
    peak = confidence;
    frameCount = 1;
  } else {
    const frames = data.data?.frames ?? [];
    frameCount = frames.length;
    if (frames.length > 0) {
      const scores = frames.map((f) => f.type?.ai_generated ?? 0);
      confidence = scores.reduce((s, v) => s + v, 0) / scores.length;
      peak = Math.max(...scores);
    }
  }

  const verdict: AnalysisResult['verdict'] =
    confidence < 0.4 ? 'authentic' : confidence < 0.7 ? 'suspect' : 'synthetic';

  // Sightengine genai returns a single score. Synthesize 1-2 findings from it
  // so the UI's breakdown panel has substance; the narration pass (Anthropic)
  // can rewrite these into more compelling forensic prose downstream.
  const findings: Finding[] = [
    {
      category: 'frequency',
      title: 'Generative diffusion signature',
      detail: `Sightengine genai model returned ${(confidence * 100).toFixed(1)}% AI-generation probability${
        kind === 'video' ? ` (averaged across ${frameCount} sampled frames; peak ${(peak * 100).toFixed(1)}%)` : ''
      }.`,
      weight: confidence,
    },
  ];
  if (kind === 'video' && peak > confidence + 0.15) {
    findings.push({
      category: 'motion',
      title: 'Inconsistent frame-level scoring',
      detail: `Per-frame variance is high (peak ${(peak * 100).toFixed(1)}% vs mean ${(confidence * 100).toFixed(1)}%) — segments of the video score significantly more synthetic than others.`,
      weight: Math.min(1, peak - confidence + 0.5),
    });
  }

  return {
    kind,
    confidence,
    verdict,
    modelTag: 'sightengine/genai',
    durationMs: 0,
    boxes: [], // Sightengine genai doesn't return spatial boxes; UI overlay no-ops.
    findings,
  };
}

// -- detection (mock fallback) ------------------------------------------------

async function mockAnalyze(file: File, kind: MediaKind): Promise<AnalysisResult> {
  // Hash the file metadata for deterministic per-file confidence.
  const enc = new TextEncoder();
  const buf = await crypto.subtle.digest(
    'SHA-256',
    enc.encode(`${file.name}|${file.size}|${file.lastModified}`),
  );
  const view = new DataView(buf);
  let seed = view.getUint32(0) || 1;
  const rand = () => {
    seed = ((seed * 1664525) + 1013904223) >>> 0;
    return seed / 0xffffffff;
  };

  const confidence = 0.6 + rand() * 0.38;
  const pool = MOCK_FINDINGS.filter((f) => (kind === 'video' ? true : f.category !== 'motion'));
  const shuffled = [...pool].sort(() => rand() - 0.5);
  const findings = shuffled.slice(0, 3 + Math.floor(rand() * 3));

  const boxCount = 2 + Math.floor(rand() * 3);
  const boxes: BoundingBox[] = Array.from({ length: boxCount }, (_, i) => {
    const w = 0.18 + rand() * 0.18;
    const h = 0.18 + rand() * 0.22;
    const cx = 0.5 + (rand() - 0.5) * 0.45;
    const cy = 0.42 + (rand() - 0.5) * 0.45;
    return {
      x: Math.max(0.02, Math.min(0.98 - w, cx - w / 2)),
      y: Math.max(0.02, Math.min(0.98 - h, cy - h / 2)),
      width: w,
      height: h,
      label: findings[i % findings.length]?.title ?? 'Anomaly',
      severity: 0.5 + rand() * 0.5,
    };
  });

  // Light artificial latency so the scan animation has time to play.
  await sleep(900);

  return {
    kind,
    confidence,
    verdict: confidence < 0.4 ? 'authentic' : confidence < 0.7 ? 'suspect' : 'synthetic',
    modelTag: 'forge-eye-sim/0.1',
    durationMs: 0,
    boxes,
    findings,
  };
}

const MOCK_FINDINGS: Finding[] = [
  {
    category: 'lighting',
    title: 'Inconsistent light direction',
    detail:
      'Specular highlights on subject and environment disagree by 18° — typical of composited or generated frames.',
    weight: 0.18,
  },
  {
    category: 'reflection',
    title: 'Asymmetric eye reflections',
    detail:
      'Catchlights in left and right eyes have divergent shapes; authentic capture rarely produces this asymmetry.',
    weight: 0.16,
  },
  {
    category: 'texture',
    title: 'Skin texture over-smoothing',
    detail:
      'Pore-frequency band attenuated 2.4× below natural baseline — common GAN/diffusion artifact in face regions.',
    weight: 0.15,
  },
  {
    category: 'frequency',
    title: 'High-frequency residue',
    detail:
      'FFT magnitude shows periodic ringing at the 0.31 cycles/px band, consistent with diffusion upscaling.',
    weight: 0.14,
  },
  {
    category: 'geometry',
    title: 'Subtle facial geometry drift',
    detail:
      'Inter-pupillary distance fluctuates across the frame plane in a way physical optics would not produce.',
    weight: 0.12,
  },
  {
    category: 'compression',
    title: 'Atypical compression seam',
    detail:
      'JPEG quantization tables differ between subject and background — suggests a re-encoded composite.',
    weight: 0.1,
  },
  {
    category: 'motion',
    title: 'Temporal flicker on edges',
    detail:
      'Sub-pixel jitter on hairline and collar edges across frames — hallmark of frame-by-frame generative video.',
    weight: 0.17,
  },
];

// -- narration via Claude -----------------------------------------------------

async function narrate(result: AnalysisResult, env: Env): Promise<Finding[]> {
  const prompt = `You are a forensic AI analyst. Given these raw detection signals for a ${result.kind}, rewrite each finding's "detail" field to sound authoritative, specific, and forensic — like a court report. Keep the original "category" and "title" and "weight". Return a JSON array with exactly the same length and order, each item: {"category","title","detail","weight"}. No prose outside the JSON.

Signals:
${JSON.stringify(result.findings)}`;

  const r = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': env.ANTHROPIC_API_KEY!,
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 1024,
      messages: [{ role: 'user', content: prompt }],
    }),
  });
  if (!r.ok) throw new Error(`Anthropic ${r.status}`);
  const data = (await r.json()) as { content: Array<{ text?: string }> };
  const text = data.content?.[0]?.text ?? '[]';
  // Tolerate fenced or prose-wrapped output
  const start = text.indexOf('[');
  const end = text.lastIndexOf(']');
  if (start === -1 || end === -1) throw new Error('no_json');
  const parsed = JSON.parse(text.slice(start, end + 1));
  return parsed as Finding[];
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

function corsHeaders(env: Env, origin: string | null): HeadersInit {
  const allowed = origin === env.ALLOWED_ORIGIN || origin === 'http://localhost:5173';
  return {
    'access-control-allow-origin': allowed ? origin! : env.ALLOWED_ORIGIN,
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

function sleep(ms: number): Promise<void> {
  return new Promise((res) => setTimeout(res, ms));
}
