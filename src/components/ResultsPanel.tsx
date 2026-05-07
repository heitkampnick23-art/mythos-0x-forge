import { useState } from 'react';
import type { AnalysisResult, Finding } from '../lib/analyzeMedia';
import type { Tier } from '../lib/api';
import { downloadVerdictPdf, shareAnalysis } from '../lib/api';
import { GlassPanel } from './glass';
import { ConfidenceMeter } from './ConfidenceMeter';
import { VoiceReadout } from './VoiceReadout';

interface Props {
  result: AnalysisResult;
  onReset: () => void;
  tier: Tier;
  authenticated: boolean;
  onUpgrade: () => void;
  onSignIn: () => void;
}

export function ResultsPanel({
  result,
  onReset,
  tier,
  authenticated,
  onUpgrade,
  onSignIn,
}: Props) {
  const [shareUrl, setShareUrl] = useState<string | null>(null);
  const [sharing, setSharing] = useState(false);
  const [pdfState, setPdfState] = useState<'idle' | 'loading' | 'ok' | 'err'>('idle');
  const [copied, setCopied] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const slug = result.shareSlug;

  const onShare = async () => {
    if (!authenticated) return onSignIn();
    if (!result.analysisId) return;
    setSharing(true);
    setErr(null);
    try {
      const url = await shareAnalysis(result.analysisId, true);
      setShareUrl(url);
      if (url) {
        await navigator.clipboard.writeText(url).catch(() => undefined);
        setCopied(true);
        setTimeout(() => setCopied(false), 2500);
      }
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setSharing(false);
    }
  };

  const onPdf = async () => {
    if (!authenticated) return onSignIn();
    if (tier === 'free') return onUpgrade();
    if (!slug) return;
    setPdfState('loading');
    setErr(null);
    try {
      await downloadVerdictPdf(slug);
      setPdfState('ok');
      setTimeout(() => setPdfState('idle'), 2500);
    } catch (e) {
      const error = e as { status?: number; message?: string };
      if (error.status === 402) {
        onUpgrade();
        setPdfState('idle');
      } else {
        setErr(error.message ?? 'PDF failed');
        setPdfState('err');
      }
    }
  };

  return (
    <div className="flex w-full flex-col gap-4">
      <GlassPanel
        hot
        edge
        className="animate-slide-up overflow-hidden p-6 sm:p-8"
        style={{ animationDelay: '40ms' }}
      >
        <div className="flex flex-col items-start justify-between gap-6 sm:flex-row sm:items-center">
          <ConfidenceMeter result={result} />
          <div className="flex flex-col items-end gap-2">
            <VoiceReadout
              result={result}
              tier={tier}
              authenticated={authenticated}
              onUpgrade={onUpgrade}
              onSignIn={onSignIn}
            />
            <div className="flex flex-wrap items-center justify-end gap-2">
              {slug && (
                <button
                  type="button"
                  onClick={onShare}
                  disabled={sharing}
                  className="flex items-center gap-1.5 rounded-full border border-white/10 bg-white/[0.04] px-3 py-1.5 text-[10px] uppercase tracking-[0.24em] text-white/65 transition hover:border-ember-gold/40 hover:text-white disabled:opacity-50"
                >
                  <ShareIcon />
                  {sharing ? 'Sharing…' : copied ? 'Link copied' : shareUrl ? 'Re-copy link' : 'Share'}
                </button>
              )}
              {slug && (
                <button
                  type="button"
                  onClick={onPdf}
                  disabled={pdfState === 'loading'}
                  className={`flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-[10px] uppercase tracking-[0.24em] transition ${
                    tier !== 'free' && authenticated
                      ? 'border-ember-fire/40 bg-ember-fire/[0.08] text-ember-gold hover:bg-ember-fire/15 hover:shadow-ember-glow'
                      : 'border-white/10 bg-white/[0.03] text-white/55 hover:border-ember-fire/40 hover:text-white'
                  } disabled:opacity-50`}
                >
                  <DocIcon />
                  {pdfState === 'loading'
                    ? 'Generating…'
                    : pdfState === 'ok'
                    ? 'Downloaded'
                    : tier === 'free' || !authenticated
                    ? 'PDF (Pro+)'
                    : 'Download PDF'}
                </button>
              )}
              <button
                type="button"
                onClick={onReset}
                className="rounded-full border border-white/10 bg-white/[0.03] px-3 py-1.5 text-[10px] uppercase tracking-[0.24em] text-white/55 transition hover:border-ember-fire/40 hover:bg-ember-fire/[0.08] hover:text-white"
              >
                New
              </button>
            </div>
            {err && (
              <span className="text-[10px] text-ember-blood">{err}</span>
            )}
            {shareUrl && !copied && (
              <span className="font-mono text-[10px] tracking-wide text-white/40 break-all">
                {shareUrl}
              </span>
            )}
            {result.sha256 && (
              <span
                className="font-mono text-[9px] uppercase tracking-[0.18em] text-white/25"
                title="SHA-256 of original bytes — embedded in PDF"
              >
                sha256: {result.sha256.slice(0, 16)}…
              </span>
            )}
          </div>
        </div>
      </GlassPanel>

      <GlassPanel
        edge
        className="animate-slide-up p-6 sm:p-8"
        style={{ animationDelay: '160ms' }}
      >
        <div className="mb-5 flex items-center justify-between">
          <h2 className="font-display text-sm font-semibold uppercase tracking-[0.32em] text-white/60">
            Forensic Breakdown
          </h2>
          <span className="font-mono text-[10px] uppercase tracking-[0.2em] text-white/35">
            {result.findings.length} signal{result.findings.length === 1 ? '' : 's'}
          </span>
        </div>
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          {result.findings.map((f, i) => (
            <FindingCard key={i} finding={f} delay={220 + i * 80} />
          ))}
        </div>
      </GlassPanel>
    </div>
  );
}

function FindingCard({ finding, delay }: { finding: Finding; delay: number }) {
  const severity = Math.round(finding.weight * 100);
  return (
    <div
      className="animate-slide-up rounded-xl border border-white/[0.06] bg-gradient-to-br from-white/[0.03] to-transparent p-4"
      style={{ animationDelay: `${delay}ms` }}
    >
      <div className="mb-2 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="h-1.5 w-1.5 rounded-full bg-ember-fire shadow-ember-glow" />
          <span className="font-mono text-[10px] uppercase tracking-[0.22em] text-ember-gold/80">
            {finding.category}
          </span>
        </div>
        <span className="font-mono text-[10px] tracking-wider text-white/40">
          {severity}% weight
        </span>
      </div>
      <h3 className="font-display text-base font-medium leading-snug text-white">
        {finding.title}
      </h3>
      <p className="mt-1.5 text-[13px] leading-relaxed text-white/55">{finding.detail}</p>
      <div className="mt-3 h-[2px] w-full overflow-hidden rounded-full bg-white/[0.04]">
        <div
          className="h-full rounded-full bg-gradient-to-r from-ember-gold via-ember-fire to-ember-blood"
          style={{ width: `${severity}%` }}
        />
      </div>
    </div>
  );
}

function ShareIcon() {
  return (
    <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="18" cy="5" r="3" />
      <circle cx="6" cy="12" r="3" />
      <circle cx="18" cy="19" r="3" />
      <line x1="8.59" y1="13.51" x2="15.42" y2="17.49" />
      <line x1="15.41" y1="6.51" x2="8.59" y2="10.49" />
    </svg>
  );
}

function DocIcon() {
  return (
    <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
      <polyline points="14 2 14 8 20 8" />
      <line x1="12" y1="18" x2="12" y2="12" />
      <polyline points="9 15 12 12 15 15" />
    </svg>
  );
}
