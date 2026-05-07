// Public verdict pages + court-ready PDF reports.
//
// /v1/verdicts/:slug          → JSON for the public page (or owner)
// /v1/verdicts/:slug/image    → R2 media proxy (only if public or owner)
// /v1/verdicts/:slug/pdf      → PDF report (Pro+ owner; or any signed-in user)
// /v1/analyses/:id/share      → toggle public flag (owner)
//
// PDFs are composed with pdf-lib at request time. No persistent rendering;
// always reflects the current data + branding. Cost is compute-only (no
// external provider calls), so PDFs are not budget-charged.

import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import type { Env, User } from './types';

interface AnalysisRow {
  id: string;
  user_id: string | null;
  kind: 'image' | 'video';
  confidence: number;
  verdict: 'authentic' | 'suspect' | 'synthetic';
  model_tag: string;
  duration_ms: number;
  r2_key: string | null;
  share_slug: string | null;
  public: number;
  sha256: string | null;
  findings_json: string | null;
  boxes_json: string | null;
  original_name: string | null;
  created_at: number;
}

export async function loadBySlug(env: Env, slug: string): Promise<AnalysisRow | null> {
  return env.DB.prepare(
    `SELECT id, user_id, kind, confidence, verdict, model_tag, duration_ms,
            r2_key, share_slug, public, sha256, findings_json, boxes_json,
            original_name, created_at
     FROM analyses WHERE share_slug = ?`,
  )
    .bind(slug)
    .first<AnalysisRow>();
}

export function canView(row: AnalysisRow, user: User | null): boolean {
  return row.public === 1 || row.user_id === (user?.id ?? null);
}

export function publicPayload(row: AnalysisRow, owner: boolean) {
  return {
    slug: row.share_slug,
    kind: row.kind,
    confidence: row.confidence,
    verdict: row.verdict,
    modelTag: row.model_tag,
    durationMs: row.duration_ms,
    sha256: row.sha256,
    originalName: row.original_name,
    findings: row.findings_json ? JSON.parse(row.findings_json) : [],
    boxes: row.boxes_json ? JSON.parse(row.boxes_json) : [],
    public: row.public === 1,
    createdAt: row.created_at,
    isOwner: owner,
    hasMedia: !!row.r2_key,
  };
}

export async function streamMedia(
  env: Env,
  row: AnalysisRow,
  cors: HeadersInit,
): Promise<Response> {
  if (!row.r2_key) {
    return new Response(JSON.stringify({ error: 'media_purged' }), {
      status: 404,
      headers: { 'content-type': 'application/json', ...cors },
    });
  }
  const obj = await env.MEDIA.get(row.r2_key);
  if (!obj) {
    return new Response(JSON.stringify({ error: 'media_purged' }), {
      status: 404,
      headers: { 'content-type': 'application/json', ...cors },
    });
  }
  const headers = new Headers();
  obj.writeHttpMetadata(headers);
  // Public-shareable: 1 hour cache
  headers.set('cache-control', 'public, max-age=3600');
  // CORS for img/video tags is fine without credentials
  headers.set('access-control-allow-origin', (cors as Record<string, string>)['access-control-allow-origin'] ?? '*');
  return new Response(obj.body, { status: 200, headers });
}

// -- PDF report --------------------------------------------------------------

interface Finding {
  category: string;
  title: string;
  detail: string;
  weight: number;
}

const VERDICT_COLOR = {
  authentic: rgb(0.4, 0.85, 0.55),
  suspect: rgb(1.0, 0.7, 0.27),
  synthetic: rgb(0.78, 0.11, 0.15),
};

export async function renderPdf(row: AnalysisRow, env: Env): Promise<Uint8Array> {
  const findings: Finding[] = row.findings_json ? JSON.parse(row.findings_json) : [];
  const pct = Math.round(row.confidence * 100);
  const verdictText =
    row.verdict === 'synthetic'
      ? 'AI-Generated (Synthetic)'
      : row.verdict === 'suspect'
      ? 'Suspect — Inconclusive'
      : 'Likely Authentic';

  const pdf = await PDFDocument.create();
  pdf.setTitle(`Mythos 0X Forge — Verdict ${row.share_slug ?? row.id}`);
  pdf.setAuthor('Mythos 0X Forge');
  pdf.setProducer('Mythos 0X Forge — mythos0x.com');
  pdf.setSubject('Forensic AI Media Authentication Report');
  pdf.setCreationDate(new Date(row.created_at * 1000));

  const page = pdf.addPage([612, 792]); // US Letter
  const w = page.getWidth();
  const h = page.getHeight();

  const helv = await pdf.embedFont(StandardFonts.Helvetica);
  const helvB = await pdf.embedFont(StandardFonts.HelveticaBold);
  const mono = await pdf.embedFont(StandardFonts.Courier);

  const ember = rgb(1.0, 0.7, 0.27);
  const fire = rgb(1.0, 0.34, 0.13);
  const dim = rgb(0.45, 0.45, 0.5);
  const ink = rgb(0.05, 0.05, 0.07);
  const subtle = rgb(0.85, 0.85, 0.9);

  // Top accent bar
  page.drawRectangle({ x: 0, y: h - 6, width: w, height: 6, color: fire });

  // Letterhead
  let y = h - 50;
  page.drawText('MYTHOS', { x: 50, y, font: helvB, size: 26, color: ink });
  page.drawText('0X', { x: 142, y, font: mono, size: 26, color: fire });
  page.drawText('FORGE', { x: 178, y, font: helvB, size: 26, color: ink });
  y -= 16;
  page.drawText('FORENSIC AI MEDIA AUTHENTICATION REPORT', {
    x: 50,
    y,
    font: helv,
    size: 8,
    color: dim,
  });

  // Header line
  y -= 18;
  page.drawLine({
    start: { x: 50, y },
    end: { x: w - 50, y },
    thickness: 0.5,
    color: subtle,
  });

  // Subject metadata
  y -= 30;
  const meta: Array<[string, string]> = [
    ['Subject', row.original_name ?? '(unnamed)'],
    ['Type', row.kind.toUpperCase()],
    ['SHA-256', row.sha256 ?? 'n/a'],
    ['Analyzed', new Date(row.created_at * 1000).toUTCString()],
    ['Model', row.model_tag],
    ['Verdict ID', row.share_slug ?? row.id],
  ];
  for (const [k, v] of meta) {
    page.drawText(k, { x: 50, y, font: helvB, size: 9, color: dim });
    const isMonoVal = k === 'SHA-256' || k === 'Verdict ID';
    page.drawText(v.length > 78 ? v.slice(0, 75) + '…' : v, {
      x: 130,
      y,
      font: isMonoVal ? mono : helv,
      size: 9,
      color: ink,
    });
    y -= 16;
  }

  // Verdict block
  y -= 16;
  page.drawRectangle({
    x: 50,
    y: y - 76,
    width: w - 100,
    height: 80,
    color: rgb(0.98, 0.97, 0.96),
    borderColor: VERDICT_COLOR[row.verdict],
    borderWidth: 2,
  });
  page.drawText(`${pct}%`, {
    x: 70,
    y: y - 50,
    font: helvB,
    size: 48,
    color: VERDICT_COLOR[row.verdict],
  });
  page.drawText('AI-GENERATION PROBABILITY', {
    x: 70,
    y: y - 64,
    font: helv,
    size: 7,
    color: dim,
  });
  page.drawText(verdictText, {
    x: 250,
    y: y - 30,
    font: helvB,
    size: 18,
    color: VERDICT_COLOR[row.verdict],
  });
  page.drawText('Verdict', {
    x: 250,
    y: y - 50,
    font: helv,
    size: 7,
    color: dim,
  });
  y -= 100;

  // Findings
  if (findings.length > 0) {
    page.drawText('FORENSIC BREAKDOWN', { x: 50, y, font: helvB, size: 11, color: ink });
    page.drawLine({
      start: { x: 50, y: y - 4 },
      end: { x: w - 50, y: y - 4 },
      thickness: 0.5,
      color: subtle,
    });
    y -= 22;

    for (const f of findings) {
      if (y < 130) break; // leave room for footer
      const wt = Math.round(f.weight * 100);
      page.drawText(f.category.toUpperCase(), {
        x: 50,
        y,
        font: mono,
        size: 7,
        color: ember,
      });
      page.drawText(`${wt}% weight`, {
        x: w - 100,
        y,
        font: mono,
        size: 7,
        color: dim,
      });
      y -= 12;
      page.drawText(f.title, { x: 50, y, font: helvB, size: 11, color: ink });
      y -= 14;
      // Wrap detail at ~95 chars/line
      const lines = wrapText(f.detail, 92);
      for (const line of lines) {
        if (y < 110) break;
        page.drawText(line, { x: 50, y, font: helv, size: 9, color: rgb(0.25, 0.25, 0.28) });
        y -= 12;
      }
      y -= 8;
    }
  }

  // Disclaimer + footer
  const footerY = 70;
  page.drawLine({
    start: { x: 50, y: footerY + 30 },
    end: { x: w - 50, y: footerY + 30 },
    thickness: 0.5,
    color: subtle,
  });
  const disclaimer =
    'This report contains probabilistic estimates from automated detection models. Confidence ' +
    'scores have known false-positive and false-negative rates. This document is not legal ' +
    'evidence and may not be relied upon as a substitute for expert testimony. © 2026 Mythos.';
  const dLines = wrapText(disclaimer, 105);
  let dy = footerY + 18;
  for (const line of dLines) {
    page.drawText(line, { x: 50, y: dy, font: helv, size: 7, color: dim });
    dy -= 9;
  }
  page.drawText(
    `View live: ${env.SITE_URL}/v/${row.share_slug ?? row.id}`,
    { x: 50, y: footerY - 8, font: mono, size: 7, color: ember },
  );

  return await pdf.save();
}

function wrapText(text: string, maxChars: number): string[] {
  const words = text.split(/\s+/);
  const lines: string[] = [];
  let cur = '';
  for (const w of words) {
    if ((cur + ' ' + w).trim().length > maxChars) {
      if (cur) lines.push(cur);
      cur = w;
    } else {
      cur = cur ? cur + ' ' + w : w;
    }
  }
  if (cur) lines.push(cur);
  return lines;
}
