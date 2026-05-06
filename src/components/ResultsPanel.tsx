import type { AnalysisResult, Finding } from '../lib/analyzeMedia';
import { GlassPanel } from './glass';
import { ConfidenceMeter } from './ConfidenceMeter';

interface Props {
  result: AnalysisResult;
  onReset: () => void;
}

export function ResultsPanel({ result, onReset }: Props) {
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
          <button
            type="button"
            onClick={onReset}
            className="self-end rounded-full border border-white/10 bg-white/[0.03] px-4 py-2 text-[10px] uppercase tracking-[0.28em] text-white/60 transition hover:border-ember-fire/40 hover:bg-ember-fire/[0.08] hover:text-white"
          >
            New Analysis
          </button>
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
