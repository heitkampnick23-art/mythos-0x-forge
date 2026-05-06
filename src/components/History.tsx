import { useEffect, useState } from 'react';
import { listAnalyses, type AnalysisRow, type MeResponse } from '../lib/api';
import { GlassPanel } from './glass';

interface Props {
  me: MeResponse | null;
  onNavigate: (path: '/' | '/pricing' | '/account' | '/history') => void;
}

export function History({ me, onNavigate }: Props) {
  const [rows, setRows] = useState<AnalysisRow[] | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (!me?.authenticated) return;
    listAnalyses()
      .then(setRows)
      .catch((e) => setErr((e as Error).message));
  }, [me?.authenticated]);

  if (!me?.authenticated) {
    return (
      <main className="relative z-10 mx-auto flex w-full max-w-3xl flex-col items-center px-4 pb-24 pt-32 text-center">
        <h1 className="font-display text-3xl font-semibold text-white">Sign in to see history</h1>
        <p className="mt-3 text-sm text-white/55">Anonymous analyses aren't tied to an account.</p>
        <button
          type="button"
          onClick={() => onNavigate('/')}
          className="mt-8 rounded-full border border-white/10 bg-white/[0.03] px-5 py-2 text-[10px] uppercase tracking-[0.28em] text-white/60 hover:text-white"
        >
          Back to Forge
        </button>
      </main>
    );
  }

  return (
    <main className="relative z-10 mx-auto w-full max-w-4xl px-4 pb-24 pt-28 sm:px-6 sm:pt-32">
      <button
        type="button"
        onClick={() => onNavigate('/')}
        className="mb-8 text-[10px] uppercase tracking-[0.32em] text-white/40 hover:text-ember-gold"
      >
        ← Back to Forge
      </button>
      <header className="mb-8">
        <div className="text-[10px] font-medium uppercase tracking-[0.4em] text-ember-gold/70">
          History
        </div>
        <h1 className="mt-2 font-display text-4xl font-semibold tracking-tight text-white sm:text-5xl">
          Your last 50 verdicts
        </h1>
      </header>

      {err && (
        <GlassPanel edge className="mb-4 border-ember-blood/30 p-4 text-sm text-ember-blood">
          {err}
        </GlassPanel>
      )}

      {rows === null && !err && (
        <div className="font-mono text-xs uppercase tracking-[0.3em] text-white/35">Loading…</div>
      )}

      {rows && rows.length === 0 && (
        <GlassPanel edge className="p-7 text-center text-sm text-white/55">
          No analyses yet. Run one from the Forge to see it here.
        </GlassPanel>
      )}

      {rows && rows.length > 0 && (
        <GlassPanel edge className="overflow-hidden">
          <ul className="divide-y divide-white/[0.05]">
            {rows.map((r) => (
              <Row key={r.id} row={r} />
            ))}
          </ul>
        </GlassPanel>
      )}
    </main>
  );
}

function Row({ row }: { row: AnalysisRow }) {
  const pct = Math.round(row.confidence * 100);
  const color =
    row.verdict === 'synthetic'
      ? '#c81d25'
      : row.verdict === 'suspect'
      ? '#ffb347'
      : '#7be3a4';
  const date = new Date(row.created_at * 1000);
  return (
    <li className="flex items-center gap-4 px-5 py-4 sm:px-6">
      <div
        className="h-2 w-2 shrink-0 rounded-full shadow-ember-glow"
        style={{ background: color }}
      />
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline gap-3">
          <span
            className="font-display text-base font-semibold tracking-tight"
            style={{ color }}
          >
            {pct}%
          </span>
          <span className="font-mono text-[10px] uppercase tracking-[0.22em] text-white/40">
            {row.verdict}
          </span>
          <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-white/30">
            {row.kind}
          </span>
        </div>
        <div className="mt-0.5 truncate font-mono text-[10px] uppercase tracking-[0.18em] text-white/30">
          {row.model_tag} · {row.duration_ms} ms
        </div>
      </div>
      <div className="text-right font-mono text-[10px] uppercase tracking-[0.2em] text-white/35">
        {date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}
        <br />
        {date.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })}
      </div>
    </li>
  );
}
