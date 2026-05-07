// First-run onboarding overlay. Shows two dropzones side-by-side: drop a
// real photo / drop an AI photo / see the difference. Activation lever — a
// visitor that sees their own files compared back-to-back is dramatically
// more likely to convert than one that just reads marketing copy.

import { useState } from 'react';
import { analyzeMedia, type AnalysisResult } from '../lib/analyzeMedia';
import { GlassPanel } from './glass';

interface Props {
  onClose: () => void;
  onSignUp: () => void;
}

type SlotKind = 'real' | 'fake';

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

export function Onboarding({ onClose, onSignUp }: Props) {
  const [real, setReal] = useState<SlotState>(EMPTY);
  const [fake, setFake] = useState<SlotState>(EMPTY);

  const setSlot = (kind: SlotKind) => (kind === 'real' ? setReal : setFake);

  async function handleDrop(kind: SlotKind, file: File) {
    if (!file.type.startsWith('image/')) {
      setSlot(kind)((s) => ({ ...s, error: 'Images only for the tour.' }));
      return;
    }
    const preview = URL.createObjectURL(file);
    setSlot(kind)({ file, preview, result: null, loading: true, error: null });
    try {
      const result = await analyzeMedia(file);
      setSlot(kind)((s) => ({ ...s, result, loading: false }));
    } catch (err) {
      const msg = (err as Error).message ?? 'analysis_failed';
      setSlot(kind)((s) => ({ ...s, loading: false, error: msg }));
    }
  }

  function dismiss() {
    try {
      localStorage.setItem('mfr_seen_welcome', '1');
    } catch {
      /* noop */
    }
    onClose();
  }

  const bothDone = !!real.result && !!fake.result;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/85 px-4 py-8 backdrop-blur-md">
      <GlassPanel className="relative w-full max-w-5xl overflow-hidden p-6 sm:p-8">
        <button
          type="button"
          onClick={dismiss}
          className="absolute right-4 top-4 rounded-full border border-white/10 bg-white/[0.03] px-3 py-1 text-[10px] uppercase tracking-[0.28em] text-white/50 hover:border-white/30 hover:text-white"
          aria-label="Close"
        >
          Skip
        </button>

        <header className="mb-6 max-w-2xl">
          <p className="font-mono text-[10px] uppercase tracking-[0.32em] text-ember-amber/70">
            Welcome to the Forge
          </p>
          <h2 className="mt-2 font-display text-3xl font-semibold text-white sm:text-4xl">
            Drop a real photo. Drop an AI photo. See the difference.
          </h2>
          <p className="mt-3 text-sm text-white/60">
            Two side-by-side scans on your own files — no signup needed. Watch
            the verdicts diverge.
          </p>
        </header>

        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <Slot
            label="Real photo"
            hint="Something from your camera roll"
            tone="authentic"
            state={real}
            onDrop={(f) => handleDrop('real', f)}
          />
          <Slot
            label="AI photo"
            hint="Try thispersondoesnotexist.com"
            tone="synthetic"
            state={fake}
            onDrop={(f) => handleDrop('fake', f)}
          />
        </div>

        {bothDone && (
          <div className="mt-6 flex flex-col items-center gap-3 rounded-xl border border-ember-amber/30 bg-ember-amber/5 px-6 py-5 text-center">
            <p className="font-display text-lg text-white">
              That's the Forge. {Math.round(Math.abs(real.result!.confidence - fake.result!.confidence) * 100)}% confidence gap.
            </p>
            <p className="max-w-lg text-sm text-white/60">
              Sign up to save your verdicts, share them, and download court-format
              PDF reports.
            </p>
            <div className="flex gap-3">
              <button
                type="button"
                onClick={() => {
                  dismiss();
                  onSignUp();
                }}
                className="rounded-full bg-gradient-to-r from-ember-fire to-ember-blood px-6 py-2.5 text-[11px] font-semibold uppercase tracking-[0.28em] text-white shadow-lg shadow-ember-blood/30 hover:brightness-110"
              >
                Create account
              </button>
              <button
                type="button"
                onClick={dismiss}
                className="rounded-full border border-white/15 bg-white/[0.03] px-6 py-2.5 text-[11px] uppercase tracking-[0.28em] text-white/70 hover:border-white/30 hover:text-white"
              >
                Keep exploring
              </button>
            </div>
          </div>
        )}
      </GlassPanel>
    </div>
  );
}

function Slot({
  label,
  hint,
  tone,
  state,
  onDrop,
}: {
  label: string;
  hint: string;
  tone: 'authentic' | 'synthetic';
  state: SlotState;
  onDrop: (file: File) => void;
}) {
  const [drag, setDrag] = useState(false);
  const accent = tone === 'authentic' ? '#7be3a4' : '#c81d25';

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
          {label}
        </span>
        {state.loading && (
          <span className="font-display text-2xl text-white">Scanning…</span>
        )}
        {state.error && (
          <span className="text-xs text-ember-blood">{state.error}</span>
        )}
        {state.result && (
          <>
            <span className="font-display text-4xl font-semibold" style={{ color: accent }}>
              {Math.round(state.result.confidence * 100)}%
            </span>
            <span className="font-mono text-[11px] uppercase tracking-[0.28em] text-white/80">
              {state.result.verdict}
            </span>
          </>
        )}
        {!state.file && !state.loading && (
          <>
            <span className="font-display text-lg text-white">Drop {label.toLowerCase()}</span>
            <span className="text-[11px] text-white/50">{hint}</span>
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
