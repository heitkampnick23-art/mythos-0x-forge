import { useEffect, useState } from 'react';
import {
  downloadVerdictPdf,
  fetchVerdict,
  verdictMediaUrl,
  type MeResponse,
  type PublicVerdict,
} from '../lib/api';
import { GlassPanel } from './glass';
import { BoundingBoxOverlay } from './BoundingBoxOverlay';

interface Props {
  slug: string;
  me: MeResponse | null;
  onBack: () => void;
  onUpgrade: () => void;
}

const VERDICT_COPY: Record<
  PublicVerdict['verdict'],
  { label: string; color: string }
> = {
  authentic: { label: 'Likely Authentic', color: '#7be3a4' },
  suspect: { label: 'Suspect', color: '#ffb347' },
  synthetic: { label: 'AI-Generated', color: '#c81d25' },
};

export function VerdictPage({ slug, me, onBack, onUpgrade }: Props) {
  const [verdict, setVerdict] = useState<PublicVerdict | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [pdfState, setPdfState] = useState<'idle' | 'loading' | 'err'>('idle');
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    fetchVerdict(slug)
      .then(setVerdict)
      .catch((e) => {
        const error = e as { status?: number; message?: string };
        setErr(
          error.status === 404
            ? 'Verdict not found.'
            : error.status === 403
            ? 'This verdict is private.'
            : error.message ?? 'Failed to load verdict.',
        );
      });
  }, [slug]);

  const copyLink = async () => {
    await navigator.clipboard.writeText(window.location.href).catch(() => undefined);
    setCopied(true);
    setTimeout(() => setCopied(false), 2500);
  };

  const downloadPdf = async () => {
    if (!me?.authenticated) return onBack();
    if ((me.user?.tier ?? 'free') === 'free') return onUpgrade();
    setPdfState('loading');
    try {
      await downloadVerdictPdf(slug);
      setPdfState('idle');
    } catch (e) {
      const error = e as { status?: number };
      if (error.status === 402) onUpgrade();
      setPdfState('err');
    }
  };

  if (err) {
    return (
      <main className="relative z-10 mx-auto flex w-full max-w-3xl flex-col items-center px-4 pb-24 pt-32 text-center">
        <h1 className="font-display text-3xl font-semibold text-white">{err}</h1>
        <button
          type="button"
          onClick={onBack}
          className="mt-8 rounded-full border border-white/10 bg-white/[0.03] px-5 py-2 text-[10px] uppercase tracking-[0.28em] text-white/60 hover:text-white"
        >
          Back to Forge
        </button>
      </main>
    );
  }

  if (!verdict) {
    return (
      <main className="relative z-10 flex min-h-[60vh] items-center justify-center">
        <div className="font-mono text-xs uppercase tracking-[0.3em] text-white/35">
          Loading verdict…
        </div>
      </main>
    );
  }

  const v = VERDICT_COPY[verdict.verdict];
  const pct = Math.round(verdict.confidence * 100);
  const date = new Date(verdict.createdAt * 1000);

  return (
    <main className="relative z-10 mx-auto w-full max-w-4xl px-4 pb-24 pt-28 sm:px-6 sm:pt-32">
      <button
        type="button"
        onClick={onBack}
        className="mb-6 text-[10px] uppercase tracking-[0.32em] text-white/40 hover:text-ember-gold"
      >
        ← Back to Forge
      </button>

      <header className="mb-8">
        <div className="text-[10px] font-medium uppercase tracking-[0.4em] text-ember-gold/70">
          Forensic Verdict · {verdict.slug}
        </div>
        <h1 className="wordmark text-glow mt-2 text-4xl font-semibold leading-tight sm:text-5xl">
          {v.label}
        </h1>
        <p className="mt-2 font-mono text-[11px] uppercase tracking-[0.22em] text-white/40">
          {date.toUTCString()}
        </p>
      </header>

      {/* Hero verdict block */}
      <GlassPanel hot edge className="overflow-hidden">
        {verdict.hasMedia && (
          <div className="relative bg-black/60">
            {verdict.kind === 'image' ? (
              <img
                src={verdictMediaUrl(verdict.slug)}
                alt={verdict.originalName ?? 'analyzed media'}
                className="block max-h-[60vh] w-full object-contain"
              />
            ) : (
              <video
                src={verdictMediaUrl(verdict.slug)}
                controls
                className="block max-h-[60vh] w-full bg-black object-contain"
              />
            )}
            {verdict.boxes.length > 0 && (
              <BoundingBoxOverlay boxes={verdict.boxes} reveal={1} />
            )}
          </div>
        )}

        <div className="grid grid-cols-1 gap-6 p-6 sm:grid-cols-[auto_1fr] sm:p-8">
          <div className="flex items-center gap-4">
            <div className="relative">
              <div
                className="h-32 w-32 animate-pulse-slow rounded-full p-[2px]"
                style={{
                  background: `conic-gradient(from -90deg, ${v.color} 0deg, ${v.color} ${pct * 3.6}deg, rgba(255,255,255,0.06) ${pct * 3.6}deg)`,
                }}
                aria-hidden
              >
                <div className="flex h-full w-full flex-col items-center justify-center rounded-full bg-obsidian-900">
                  <div
                    className="font-display text-[36px] font-semibold leading-none text-glow"
                    style={{ color: v.color }}
                  >
                    {pct}
                    <span className="text-lg">%</span>
                  </div>
                  <div className="mt-1 text-[8px] uppercase tracking-[0.3em] text-white/45">
                    AI Confidence
                  </div>
                </div>
              </div>
              <div
                className="absolute inset-0 -z-10 blur-2xl"
                style={{ background: v.color, opacity: 0.18, borderRadius: '9999px' }}
              />
            </div>
          </div>

          <dl className="grid grid-cols-2 gap-x-4 gap-y-2 self-center text-[12px] sm:text-[13px]">
            <Meta label="Subject" value={verdict.originalName ?? '(unnamed)'} />
            <Meta label="Type" value={verdict.kind} mono />
            <Meta label="Model" value={verdict.modelTag} mono />
            <Meta label="Duration" value={`${verdict.durationMs} ms`} mono />
            {verdict.sha256 && (
              <Meta
                label="SHA-256"
                value={`${verdict.sha256.slice(0, 12)}…${verdict.sha256.slice(-8)}`}
                mono
                full
              />
            )}
          </dl>
        </div>

        <div className="flex flex-wrap items-center gap-2 border-t border-white/[0.05] px-6 py-4 sm:px-8">
          <button
            type="button"
            onClick={copyLink}
            className="rounded-full border border-white/10 bg-white/[0.04] px-4 py-2 text-[10px] uppercase tracking-[0.28em] text-white/65 transition hover:border-ember-gold/40 hover:text-white"
          >
            {copied ? 'Link copied' : 'Copy link'}
          </button>
          <button
            type="button"
            onClick={downloadPdf}
            disabled={pdfState === 'loading'}
            className="rounded-full border border-ember-fire/40 bg-ember-fire/[0.08] px-4 py-2 text-[10px] uppercase tracking-[0.28em] text-ember-gold transition hover:bg-ember-fire/15 hover:shadow-ember-glow disabled:opacity-50"
          >
            {pdfState === 'loading' ? 'Generating…' : 'Download PDF Report'}
          </button>
          {!me?.authenticated && (
            <span className="font-mono text-[10px] uppercase tracking-[0.22em] text-white/35">
              · Sign in for the PDF
            </span>
          )}
        </div>
      </GlassPanel>

      {/* Findings */}
      {verdict.findings.length > 0 && (
        <GlassPanel edge className="mt-6 p-6 sm:p-8">
          <div className="mb-5 flex items-center justify-between">
            <h2 className="font-display text-sm font-semibold uppercase tracking-[0.32em] text-white/60">
              Forensic Breakdown
            </h2>
            <span className="font-mono text-[10px] uppercase tracking-[0.2em] text-white/35">
              {verdict.findings.length} signal{verdict.findings.length === 1 ? '' : 's'}
            </span>
          </div>
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            {verdict.findings.map((f, i) => {
              const sev = Math.round(f.weight * 100);
              return (
                <div
                  key={i}
                  className="rounded-xl border border-white/[0.06] bg-gradient-to-br from-white/[0.03] to-transparent p-4"
                >
                  <div className="mb-2 flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <span className="h-1.5 w-1.5 rounded-full bg-ember-fire shadow-ember-glow" />
                      <span className="font-mono text-[10px] uppercase tracking-[0.22em] text-ember-gold/80">
                        {f.category}
                      </span>
                    </div>
                    <span className="font-mono text-[10px] tracking-wider text-white/40">
                      {sev}% weight
                    </span>
                  </div>
                  <h3 className="font-display text-base font-medium leading-snug text-white">
                    {f.title}
                  </h3>
                  <p className="mt-1.5 text-[13px] leading-relaxed text-white/55">{f.detail}</p>
                  <div className="mt-3 h-[2px] w-full overflow-hidden rounded-full bg-white/[0.04]">
                    <div
                      className="h-full rounded-full bg-gradient-to-r from-ember-gold via-ember-fire to-ember-blood"
                      style={{ width: `${sev}%` }}
                    />
                  </div>
                </div>
              );
            })}
          </div>
        </GlassPanel>
      )}

      {/* Disclaimer */}
      <p className="mt-8 text-center font-mono text-[10px] uppercase leading-relaxed tracking-[0.22em] text-white/30">
        Verdicts are probabilistic estimates from automated detection models. Not legal evidence.
      </p>
      <div className="mt-2 text-center font-mono text-[10px] uppercase tracking-[0.32em] text-white/40">
        Built on{' '}
        <button
          type="button"
          onClick={onBack}
          className="text-ember-gold hover:text-ember-fire"
        >
          Mythos 0X Forge →
        </button>
      </div>
    </main>
  );
}

function Meta({
  label,
  value,
  mono,
  full,
}: {
  label: string;
  value: string;
  mono?: boolean;
  full?: boolean;
}) {
  return (
    <div className={full ? 'col-span-2' : ''}>
      <dt className="font-mono text-[9px] uppercase tracking-[0.28em] text-white/35">{label}</dt>
      <dd className={mono ? 'font-mono text-white/85' : 'text-white/85'}>{value}</dd>
    </div>
  );
}
