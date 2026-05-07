// Side-by-side comparison page. Two dropzones, two verdicts, the gap between
// them shown big and bold — a built-for-screenshots viral mechanic.
//
// Reuses the existing /v1/analyze endpoint via analyzeMedia(); no new
// backend surface.

import { useState } from 'react';
import { analyzeMedia, type AnalysisResult } from '../lib/analyzeMedia';
import { GlassPanel } from './glass';

interface Props {
  onNavigate: (path: string) => void;
}

interface SlotState {
  file: File | null;
  preview: string | null;
  result: AnalysisResult | null;
  loading: boolean;
  error: string | null;
}

const EMPTY: SlotState = {
  file: null,
  preview: null,
  result: null,
  loading: false,
  error: null,
};

const VERDICT_COLOR = {
  authentic: '#7be3a4',
  suspect: '#ffb347',
  synthetic: '#c81d25',
} as const;

export function Compare({ onNavigate }: Props) {
  const [left, setLeft] = useState<SlotState>(EMPTY);
  const [right, setRight] = useState<SlotState>(EMPTY);

  const setSlot = (side: 'L' | 'R') => (side === 'L' ? setLeft : setRight);

  async function run(side: 'L' | 'R', file: File) {
    if (!file.type.startsWith('image/')) {
      setSlot(side)((s) => ({ ...s, error: 'Images only.' }));
      return;
    }
    const preview = URL.createObjectURL(file);
    setSlot(side)({ file, preview, result: null, loading: true, error: null });
    try {
      const result = await analyzeMedia(file);
      setSlot(side)((s) => ({ ...s, result, loading: false }));
    } catch (err) {
      const e = err as { rateLimited?: boolean; message?: string };
      setSlot(side)((s) => ({
        ...s,
        loading: false,
        error: e.rateLimited
          ? 'Daily free limit hit. Sign in for more.'
          : e.message ?? 'analysis_failed',
      }));
    }
  }

  const reset = () => {
    setLeft(EMPTY);
    setRight(EMPTY);
  };

  const bothDone = !!left.result && !!right.result;
  const gap = bothDone
    ? Math.round(Math.abs(left.result!.confidence - right.result!.confidence) * 100)
    : null;

  return (
    <main className="relative z-10 mx-auto w-full max-w-6xl px-4 py-12 sm:px-6">
      <header className="mb-8 max-w-3xl">
        <p className="font-mono text-[10px] uppercase tracking-[0.32em] text-ember-amber/70">
          Compare
        </p>
        <h1 className="mt-2 font-display text-4xl font-semibold text-white sm:text-5xl">
          Two images. One forensic verdict each. Mind the gap.
        </h1>
        <p className="mt-4 text-sm text-white/60">
          Drop any two images — your photo vs. a deepfake of you, the original
          news photo vs. the version going viral, before vs. after. Same multi-model
          forensic stack. Side by side.
        </p>
      </header>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <Slot label="Image A" side="L" state={left} onDrop={(f) => run('L', f)} />
        <Slot label="Image B" side="R" state={right} onDrop={(f) => run('R', f)} />
      </div>

      {bothDone && (
        <GlassPanel className="mt-6 p-6 text-center">
          <p className="font-mono text-[10px] uppercase tracking-[0.32em] text-ember-amber/70">
            Confidence gap
          </p>
          <p className="mt-2 font-display text-5xl font-semibold text-white">{gap}%</p>
          <p className="mt-2 text-sm text-white/60">
            Image A: {Math.round(left.result!.confidence * 100)}% {left.result!.verdict}
            {' · '}
            Image B: {Math.round(right.result!.confidence * 100)}% {right.result!.verdict}
          </p>
          <div className="mt-5 flex flex-wrap justify-center gap-3">
            {left.result!.shareSlug && (
              <button
                type="button"
                onClick={() => onNavigate(`/v/${left.result!.shareSlug}`)}
                className="rounded-full border border-white/10 bg-white/[0.03] px-5 py-2 text-[10px] uppercase tracking-[0.28em] text-white/70 hover:border-ember-amber/40 hover:text-ember-amber"
              >
                Open A report
              </button>
            )}
            {right.result!.shareSlug && (
              <button
                type="button"
                onClick={() => onNavigate(`/v/${right.result!.shareSlug}`)}
                className="rounded-full border border-white/10 bg-white/[0.03] px-5 py-2 text-[10px] uppercase tracking-[0.28em] text-white/70 hover:border-ember-amber/40 hover:text-ember-amber"
              >
                Open B report
              </button>
            )}
            <button
              type="button"
              onClick={reset}
              className="rounded-full border border-white/15 bg-white/[0.03] px-5 py-2 text-[10px] uppercase tracking-[0.28em] text-white/65 hover:border-white/30 hover:text-white"
            >
              Compare another pair
            </button>
          </div>
        </GlassPanel>
      )}

      <footer className="mt-10 text-center font-mono text-[10px] uppercase tracking-[0.28em] text-white/35">
        Powered by Mythos 0X Forge · multi-model forensic auth
      </footer>
    </main>
  );
}

function Slot({
  label,
  side,
  state,
  onDrop,
}: {
  label: string;
  side: 'L' | 'R';
  state: SlotState;
  onDrop: (file: File) => void;
}) {
  const [drag, setDrag] = useState(false);
  const accent = state.result ? VERDICT_COLOR[state.result.verdict] : '#ffb347';

  return (
    <div
      onDragOver={(e) => {
        e.preventDefault();
        setDrag(true);
      }}
      onDragLeave={() => setDrag(false)}
      onDrop={(e) => {
        e.preventDefault();
        setDrag(false);
        const f = e.dataTransfer.files?.[0];
        if (f) onDrop(f);
      }}
      className={`relative flex aspect-[4/3] flex-col items-center justify-center overflow-hidden rounded-xl border bg-black/40 transition ${
        drag ? 'border-ember-amber/60' : 'border-white/10'
      }`}
    >
      {state.preview ? (
        <img
          src={state.preview}
          alt={label}
          className="absolute inset-0 h-full w-full object-cover opacity-60"
        />
      ) : null}
      <div className="absolute inset-0 bg-gradient-to-t from-black/85 via-black/30 to-transparent" />
      <div className="relative flex flex-col items-center gap-2 px-4 text-center">
        <span className="font-mono text-[10px] uppercase tracking-[0.32em]" style={{ color: accent }}>
          {label} · {side}
        </span>
        {state.loading && <span className="font-display text-2xl text-white">Scanning…</span>}
        {state.error && <span className="text-xs text-ember-blood">{state.error}</span>}
        {state.result && (
          <>
            <span className="font-display text-5xl font-semibold" style={{ color: accent }}>
              {Math.round(state.result.confidence * 100)}%
            </span>
            <span className="font-mono text-[11px] uppercase tracking-[0.28em] text-white/80">
              {state.result.verdict}
            </span>
          </>
        )}
        {!state.file && !state.loading && (
          <>
            <span className="font-display text-lg text-white">Drop image</span>
            <label className="mt-2 cursor-pointer rounded-full border border-white/10 bg-white/[0.04] px-4 py-1.5 text-[10px] uppercase tracking-[0.28em] text-white/70 hover:border-ember-amber/40 hover:text-ember-amber">
              Choose file
              <input
                type="file"
                accept="image/*"
                className="hidden"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) onDrop(f);
                }}
              />
            </label>
          </>
        )}
      </div>
    </div>
  );
}
