import type { AnalysisResult } from '../lib/analyzeMedia';

interface Props {
  result: AnalysisResult;
}

const VERDICT_COPY: Record<AnalysisResult['verdict'], { label: string; color: string }> = {
  authentic: { label: 'Likely Authentic', color: '#7be3a4' },
  suspect: { label: 'Suspect', color: '#ffb347' },
  synthetic: { label: 'AI-Generated', color: '#c81d25' },
};

export function ConfidenceMeter({ result }: Props) {
  const pct = Math.round(result.confidence * 100);
  const v = VERDICT_COPY[result.verdict];

  // Conic gradient fills based on percent
  const ring = `conic-gradient(from -90deg, ${v.color} 0deg, ${v.color} ${pct * 3.6}deg, rgba(255,255,255,0.06) ${pct * 3.6}deg)`;

  return (
    <div className="flex items-center gap-6">
      <div className="relative">
        <div
          className="h-36 w-36 animate-pulse-slow rounded-full p-[2px]"
          style={{ background: ring }}
          aria-hidden
        >
          <div className="flex h-full w-full flex-col items-center justify-center rounded-full bg-obsidian-900">
            <div
              className="font-display text-[44px] font-semibold leading-none text-glow"
              style={{ color: v.color }}
            >
              {pct}
              <span className="text-xl">%</span>
            </div>
            <div className="mt-1 text-[9px] uppercase tracking-[0.3em] text-white/45">
              AI Confidence
            </div>
          </div>
        </div>
        <div
          className="absolute inset-0 -z-10 blur-2xl"
          style={{ background: v.color, opacity: 0.18, borderRadius: '9999px' }}
        />
      </div>
      <div className="flex flex-col gap-1.5">
        <div className="text-[10px] uppercase tracking-[0.34em] text-white/40">Verdict</div>
        <div
          className="font-display text-3xl font-semibold tracking-tight"
          style={{ color: v.color }}
        >
          {v.label}
        </div>
        <div className="font-mono text-[11px] uppercase tracking-[0.18em] text-white/35">
          {result.modelTag} · {result.durationMs} ms · {result.kind}
        </div>
      </div>
    </div>
  );
}
