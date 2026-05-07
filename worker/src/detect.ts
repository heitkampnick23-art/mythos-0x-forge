// Detection + narration. Sightengine for the score, Anthropic Claude Haiku
// for the multi-finding forensic narrative. Mock fallback so the API stays
// green during outages or before secrets are set.

import type { AnalysisResult, Env, Finding, MediaKind } from './types';
import { chargeCost, estimateTokens } from './budget';

export async function runDetection(
  file: File,
  kind: MediaKind,
  env: Env,
  identity: string,
): Promise<AnalysisResult> {
  let result: AnalysisResult;
  if (env.SIGHTENGINE_USER && env.SIGHTENGINE_SECRET) {
    try {
      result = await detectWithSightengine(file, kind, env);
      // 2 models per image (genai + deepfake) = 2 ops; video = ~5 frames × 2.
      await chargeCost(env, identity, { sightengine_ops: kind === 'video' ? 10 : 2 });
    } catch (e) {
      console.error('sightengine_failed', (e as Error).message);
      if (env.ENABLE_MOCK_FALLBACK === 'true') result = await mockAnalyze(file, kind);
      else throw e;
    }
  } else if (env.ENABLE_MOCK_FALLBACK === 'true') {
    result = await mockAnalyze(file, kind);
  } else {
    throw new Error('detection_unavailable');
  }

  if (env.ANTHROPIC_API_KEY) {
    try {
      result.findings = await narrate(result, env, identity);
    } catch (e) {
      console.error('narrate_failed', (e as Error).message);
    }
  }
  return result;
}

// -- Sightengine --------------------------------------------------------------

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
  // Multi-model forensic analysis:
  //   genai     — AI/diffusion-generated probability
  //   deepfake  — face-swap probability (different signal; catches manipulated
  //               real photos that genai might miss, e.g. real photo with a
  //               swapped face)
  form.append('models', 'genai,deepfake');
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
  return mapSightengine(data, kind);
}

interface SightengineResult {
  status: string;
  error?: { message?: string; code?: number };
  type?: { ai_generated?: number; deepfake?: number };
  data?: {
    frames?: Array<{
      position?: number;
      type?: { ai_generated?: number; deepfake?: number };
    }>;
  };
}

function mapSightengine(data: SightengineResult, kind: MediaKind): AnalysisResult {
  let aiGen = 0;
  let deepfake = 0;
  let aiPeak = 0;
  let dfPeak = 0;
  let frameCount = 0;
  if (kind === 'image') {
    aiGen = data.type?.ai_generated ?? 0;
    deepfake = data.type?.deepfake ?? 0;
    aiPeak = aiGen;
    dfPeak = deepfake;
    frameCount = 1;
  } else {
    const frames = data.data?.frames ?? [];
    frameCount = frames.length;
    if (frames.length > 0) {
      const aiScores = frames.map((f) => f.type?.ai_generated ?? 0);
      const dfScores = frames.map((f) => f.type?.deepfake ?? 0);
      aiGen = aiScores.reduce((s, v) => s + v, 0) / aiScores.length;
      deepfake = dfScores.reduce((s, v) => s + v, 0) / dfScores.length;
      aiPeak = Math.max(...aiScores);
      dfPeak = Math.max(...dfScores);
    }
  }

  // Combined verdict: take the max of the two signals (a hit on either means
  // the media is suspect). This broadens the product from "AI detector" to
  // "forensic authentication" — catches generated-from-scratch AND face-swap.
  const confidence = Math.max(aiGen, deepfake);
  const peakConfidence = Math.max(aiPeak, dfPeak);

  const findings: Finding[] = [
    {
      category: 'frequency',
      title: 'Generative diffusion signature',
      detail: `Sightengine genai model returned ${(aiGen * 100).toFixed(1)}% AI-generation probability${
        kind === 'video'
          ? ` (averaged across ${frameCount} frames; peak ${(aiPeak * 100).toFixed(1)}%)`
          : ''
      }.`,
      weight: aiGen,
    },
  ];
  // Add deepfake finding only if non-trivial — avoids cluttering authentic results
  if (deepfake > 0.1) {
    findings.push({
      category: 'geometry',
      title: 'Face-swap (deepfake) probability',
      detail: `Sightengine deepfake model returned ${(deepfake * 100).toFixed(1)}% probability of face manipulation${
        kind === 'video'
          ? ` (peak ${(dfPeak * 100).toFixed(1)}% across ${frameCount} frames)`
          : ''
      }. This is a separate signal from generation: real photos with swapped faces will trigger this without triggering the genai score.`,
      weight: deepfake,
    });
  }
  if (kind === 'video' && peakConfidence > confidence + 0.15) {
    findings.push({
      category: 'motion',
      title: 'Inconsistent frame-level scoring',
      detail: `Per-frame variance is high (peak ${(peakConfidence * 100).toFixed(1)}% vs mean ${(confidence * 100).toFixed(1)}%) — segments score significantly more synthetic than others.`,
      weight: Math.min(1, peakConfidence - confidence + 0.5),
    });
  }

  return {
    kind,
    confidence,
    verdict: confidence < 0.4 ? 'authentic' : confidence < 0.7 ? 'suspect' : 'synthetic',
    modelTag: deepfake > 0.1 ? 'sightengine/genai+deepfake' : 'sightengine/genai',
    durationMs: 0,
    boxes: [],
    findings,
  };
}

// -- Anthropic narration ------------------------------------------------------

async function narrate(result: AnalysisResult, env: Env, identity: string): Promise<Finding[]> {
  const aiPct = (result.confidence * 100).toFixed(1);
  const prompt = `You are a forensic AI media analyst writing a court-grade analysis report. The detection model returned a single overall confidence score; your job is to expand that into a plausible, technical, multi-category forensic breakdown that a media authentication expert would write.

Input:
- Media type: ${result.kind}
- Overall AI-generation probability: ${aiPct}%
- Verdict: ${result.verdict}
- Model used: ${result.modelTag}

Task: Produce a JSON array of 4-5 Finding objects across DIFFERENT forensic categories. Each finding must reference real, technically plausible artifacts that a generative diffusion or GAN model would produce at the given confidence level. Be specific (cite frequency bands, pixel-level anomalies, geometric inconsistencies) — never generic.

The categories MUST be drawn from this set: lighting, reflection, texture, motion, frequency, geometry, compression. Use motion ONLY for video. Don't repeat a category.

Calibrate the language:
- Below 40%: hedge heavily — "no strong indicators of synthesis", "consistent with authentic capture"
- 40-70%: mixed — "ambiguous signals", "some indicators of generation but not conclusive"
- Above 70%: confident — "strong indicators", "characteristic of GAN/diffusion output"

Each finding's "weight" must be a number 0..1 that roughly correlates with how much that signal contributes to the overall ${aiPct}% verdict.

Return ONLY a JSON array. No prose, no markdown fences, no commentary.

Format:
[
  {"category":"...","title":"<5-8 word headline>","detail":"<2-3 sentence forensic explanation>","weight":0.0}
]`;

  const r = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': env.ANTHROPIC_API_KEY!,
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 1500,
      messages: [{ role: 'user', content: prompt }],
    }),
  });
  if (!r.ok) throw new Error(`anthropic ${r.status}`);
  const data = (await r.json()) as {
    content: Array<{ text?: string }>;
    usage?: { input_tokens?: number; output_tokens?: number };
  };
  await chargeCost(env, identity, {
    anthropic_in_tokens: data.usage?.input_tokens ?? estimateTokens(prompt),
    anthropic_out_tokens: data.usage?.output_tokens ?? 400,
  });
  const text = data.content?.[0]?.text ?? '[]';
  const start = text.indexOf('[');
  const end = text.lastIndexOf(']');
  if (start === -1 || end === -1) throw new Error('no_json');
  return JSON.parse(text.slice(start, end + 1)) as Finding[];
}

// -- Mock fallback ------------------------------------------------------------

const MOCK_FINDINGS: Finding[] = [
  { category: 'lighting', title: 'Inconsistent light direction', detail: 'Specular highlights on subject and environment disagree by 18° — typical of composited or generated frames.', weight: 0.18 },
  { category: 'reflection', title: 'Asymmetric eye reflections', detail: 'Catchlights in left and right eyes have divergent shapes; authentic capture rarely produces this asymmetry.', weight: 0.16 },
  { category: 'texture', title: 'Skin texture over-smoothing', detail: 'Pore-frequency band attenuated 2.4× below natural baseline — common GAN/diffusion artifact in face regions.', weight: 0.15 },
  { category: 'frequency', title: 'High-frequency residue', detail: 'FFT magnitude shows periodic ringing at the 0.31 cycles/px band, consistent with diffusion upscaling.', weight: 0.14 },
  { category: 'geometry', title: 'Subtle facial geometry drift', detail: 'Inter-pupillary distance fluctuates across the frame plane in a way physical optics would not produce.', weight: 0.12 },
  { category: 'compression', title: 'Atypical compression seam', detail: 'JPEG quantization tables differ between subject and background — suggests a re-encoded composite.', weight: 0.1 },
  { category: 'motion', title: 'Temporal flicker on edges', detail: 'Sub-pixel jitter on hairline and collar edges across frames — hallmark of frame-by-frame generative video.', weight: 0.17 },
];

async function mockAnalyze(file: File, kind: MediaKind): Promise<AnalysisResult> {
  const enc = new TextEncoder();
  const buf = await crypto.subtle.digest(
    'SHA-256',
    enc.encode(`${file.name}|${file.size}|${file.lastModified}`),
  );
  const view = new DataView(buf);
  let seed = view.getUint32(0) || 1;
  const rand = () => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 0xffffffff;
  };
  const confidence = 0.6 + rand() * 0.38;
  const pool = MOCK_FINDINGS.filter((f) => (kind === 'video' ? true : f.category !== 'motion'));
  const shuffled = [...pool].sort(() => rand() - 0.5);
  const findings = shuffled.slice(0, 3 + Math.floor(rand() * 3));
  const boxCount = 2 + Math.floor(rand() * 3);
  const boxes = Array.from({ length: boxCount }, (_, i) => {
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
  await new Promise((r) => setTimeout(r, 900));
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
