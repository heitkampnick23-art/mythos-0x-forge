// =============================================================================
// SIMULATED detection. v1 ships with believable mock results so the entire UX
// can be ground-truthed end-to-end. To plug in a real provider (Reality
// Defender, Hive, Sensity, or your own Cloudflare Worker proxy), replace the
// body of `analyzeMedia` with a fetch() call that returns the same shape.
// =============================================================================

export type MediaKind = 'image' | 'video';

export interface BoundingBox {
  /** All values are 0..1 fractions of the rendered media, not pixels. */
  x: number;
  y: number;
  width: number;
  height: number;
  label: string;
  /** 0..1 — drives outline intensity */
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
  /** 0..1 contribution to the overall score */
  weight: number;
}

export interface AnalysisResult {
  kind: MediaKind;
  /** 0..1 — probability the media is AI-generated/manipulated */
  confidence: number;
  verdict: 'authentic' | 'suspect' | 'synthetic';
  modelTag: string;
  durationMs: number;
  boxes: BoundingBox[];
  findings: Finding[];
}

const FINDING_POOL: Finding[] = [
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
  {
    category: 'reflection',
    title: 'Missing environmental reflections',
    detail:
      'Reflective surfaces in scene do not contain the subject — physically inconsistent with the camera position.',
    weight: 0.13,
  },
];

const seededRandom = (seed: number) => {
  let s = seed >>> 0 || 1;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 0xffffffff;
  };
};

const hashFile = (file: File): number => {
  const s = `${file.name}|${file.size}|${file.lastModified}`;
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
};

const verdictFor = (c: number): AnalysisResult['verdict'] =>
  c < 0.4 ? 'authentic' : c < 0.7 ? 'suspect' : 'synthetic';

export interface AnalyzeOptions {
  signal?: AbortSignal;
  onProgress?: (t: number) => void;
}

export async function analyzeMedia(
  file: File,
  opts: AnalyzeOptions = {},
): Promise<AnalysisResult> {
  const kind: MediaKind = file.type.startsWith('video') ? 'video' : 'image';
  const rand = seededRandom(hashFile(file));

  // Deterministic-per-file confidence in 0.60..0.98
  const confidence = 0.6 + rand() * 0.38;

  // Pick 3..5 unique findings, weighted toward the kind
  const pool = FINDING_POOL.filter((f) =>
    kind === 'video' ? true : f.category !== 'motion',
  );
  const shuffled = [...pool].sort(() => rand() - 0.5);
  const findings = shuffled.slice(0, 3 + Math.floor(rand() * 3));

  // 2..4 plausible bounding boxes, biased toward upper-center (face region)
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

  // Simulate work with progress events; abortable.
  const totalMs = 1800 + rand() * 1400;
  const start = performance.now();
  await new Promise<void>((resolve, reject) => {
    if (opts.signal?.aborted) return reject(new DOMException('Aborted', 'AbortError'));
    const tick = () => {
      const t = Math.min(1, (performance.now() - start) / totalMs);
      opts.onProgress?.(t);
      if (opts.signal?.aborted) return reject(new DOMException('Aborted', 'AbortError'));
      if (t >= 1) resolve();
      else requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });

  return {
    kind,
    confidence,
    verdict: verdictFor(confidence),
    modelTag: 'forge-eye-sim/0.1',
    durationMs: Math.round(performance.now() - start),
    boxes,
    findings,
  };
}
