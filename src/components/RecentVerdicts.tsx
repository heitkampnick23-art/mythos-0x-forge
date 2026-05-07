import { useEffect, useState } from 'react';
import { fetchRecentVerdicts, type RecentVerdict } from '../lib/api';

interface Props {
  onNavigate: (path: string) => void;
}

const VERDICT_COLOR: Record<RecentVerdict['verdict'], string> = {
  authentic: '#7be3a4',
  suspect: '#ffb347',
  synthetic: '#c81d25',
};

export function RecentVerdicts({ onNavigate }: Props) {
  const [verdicts, setVerdicts] = useState<RecentVerdict[] | null>(null);

  useEffect(() => {
    fetchRecentVerdicts()
      .then(setVerdicts)
      .catch(() => setVerdicts([]));
  }, []);

  if (!verdicts || verdicts.length === 0) return null;

  return (
    <section className="pointer-events-none relative z-10 mx-auto w-full max-w-5xl px-4 pb-2 pt-6 sm:px-6">
      <div className="mb-3 flex items-center justify-center gap-3">
        <span className="h-px w-12 bg-gradient-to-r from-transparent to-ember-gold/40" />
        <span className="font-mono text-[10px] uppercase tracking-[0.32em] text-ember-gold/60">
          Recent public verdicts
        </span>
        <span className="h-px w-12 bg-gradient-to-l from-transparent to-ember-gold/40" />
      </div>
      <div className="flex gap-2 overflow-x-auto pb-2">
        {verdicts.map((v) => {
          const pct = Math.round(v.confidence * 100);
          const color = VERDICT_COLOR[v.verdict];
          return (
            <button
              key={v.share_slug}
              type="button"
              onClick={() => onNavigate(`/v/${v.share_slug}`)}
              className="pointer-events-auto group flex shrink-0 items-center gap-2.5 rounded-full border border-white/[0.06] bg-white/[0.02] px-3 py-1.5 backdrop-blur-2xl transition hover:border-ember-fire/40 hover:bg-white/[0.04]"
            >
              <span
                className="h-1.5 w-1.5 rounded-full"
                style={{ background: color, boxShadow: `0 0 8px ${color}` }}
              />
              <span
                className="font-display text-xs font-semibold"
                style={{ color }}
              >
                {pct}%
              </span>
              <span className="font-mono text-[9px] uppercase tracking-[0.18em] text-white/55 group-hover:text-white/80">
                {v.verdict}
              </span>
              <span className="font-mono text-[9px] uppercase tracking-[0.18em] text-white/30">
                · {v.kind}
              </span>
            </button>
          );
        })}
      </div>
    </section>
  );
}
