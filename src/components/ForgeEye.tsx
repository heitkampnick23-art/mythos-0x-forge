import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
  type DragEvent,
} from 'react';
import {
  validateFileType,
  probeVideoDuration,
  MAX_VIDEO_SECONDS,
} from '../lib/fileValidation';
import { analyzeMedia, type AnalysisResult } from '../lib/analyzeMedia';
import { BoundingBoxOverlay } from './BoundingBoxOverlay';
import { ResultsPanel } from './ResultsPanel';
import { GlassPanel } from './glass';

export type ForgeState =
  | { kind: 'idle' }
  | { kind: 'previewing'; file: File; url: string; mediaKind: 'image' | 'video' }
  | {
      kind: 'scanning';
      file: File;
      url: string;
      mediaKind: 'image' | 'video';
      progress: number;
    }
  | {
      kind: 'results';
      file: File;
      url: string;
      mediaKind: 'image' | 'video';
      result: AnalysisResult;
    };

interface ForgeEyeProps {
  state: ForgeState;
  setState: (s: ForgeState) => void;
  onError: (msg: string) => void;
  /** kicks ember field into the right mode */
  onModeChange: (m: 'idle' | 'scanning' | 'flagged') => void;
}

export interface ForgeEyeHandle {
  pickFile: () => void;
  ingestFile: (f: File) => void;
  startScan: () => void;
  reset: () => void;
}

export const ForgeEye = forwardRef<ForgeEyeHandle, ForgeEyeProps>(function ForgeEye(
  { state, setState, onError, onModeChange },
  ref,
) {
  const inputRef = useRef<HTMLInputElement>(null);
  const abortRef = useRef<AbortController | null>(null);
  const [dragActive, setDragActive] = useState(false);

  // Mode propagation
  useEffect(() => {
    if (state.kind === 'scanning') onModeChange('scanning');
    else if (state.kind === 'results' && state.result.confidence >= 0.7)
      onModeChange('flagged');
    else onModeChange('idle');
  }, [state, onModeChange]);

  // Cleanup object URLs
  useEffect(() => {
    return () => {
      if (state.kind !== 'idle') URL.revokeObjectURL(state.url);
    };
  }, [state]);

  const ingestFile = async (file: File) => {
    abortRef.current?.abort();

    const v = validateFileType(file);
    if (!v.ok) {
      onError(v.reason);
      return;
    }
    const url = URL.createObjectURL(file);

    if (v.kind === 'video') {
      try {
        const seconds = await probeVideoDuration(url);
        if (seconds > MAX_VIDEO_SECONDS) {
          URL.revokeObjectURL(url);
          onError(
            `Video exceeds ${MAX_VIDEO_SECONDS}s limit (${seconds.toFixed(1)}s).`,
          );
          return;
        }
      } catch {
        URL.revokeObjectURL(url);
        onError('Could not read video — file may be corrupt.');
        return;
      }
    }

    setState({ kind: 'previewing', file, url, mediaKind: v.kind });
  };

  const startScan = async () => {
    if (state.kind !== 'previewing' && state.kind !== 'results') return;
    const { file, url, mediaKind } = state;
    abortRef.current = new AbortController();
    setState({ kind: 'scanning', file, url, mediaKind, progress: 0 });

    try {
      const result = await analyzeMedia(file, {
        signal: abortRef.current.signal,
        onProgress: (t) =>
          setState({ kind: 'scanning', file, url, mediaKind, progress: t }),
      });
      setState({ kind: 'results', file, url, mediaKind, result });
    } catch (e) {
      if ((e as Error).name !== 'AbortError') {
        onError('Analysis failed. Try again.');
      }
      setState({ kind: 'previewing', file, url, mediaKind });
    }
  };

  const reset = () => {
    abortRef.current?.abort();
    if (state.kind !== 'idle') URL.revokeObjectURL(state.url);
    setState({ kind: 'idle' });
  };

  useImperativeHandle(
    ref,
    () => ({
      pickFile: () => inputRef.current?.click(),
      ingestFile,
      startScan,
      reset,
    }),
    [state],
  );

  const handleDrop = (e: DragEvent<HTMLButtonElement>) => {
    e.preventDefault();
    setDragActive(false);
    const file = e.dataTransfer.files[0];
    if (file) void ingestFile(file);
  };

  return (
    <section className="relative z-10 mx-auto w-full max-w-5xl px-4 pb-44 pt-12 sm:px-6 sm:pt-16">
      <input
        ref={inputRef}
        type="file"
        accept="image/jpeg,image/png,image/webp,video/mp4,video/webm"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) void ingestFile(f);
          e.target.value = '';
        }}
      />

      {state.kind === 'idle' ? (
        <DropZone
          dragActive={dragActive}
          onDragOver={(e) => {
            e.preventDefault();
            setDragActive(true);
          }}
          onDragLeave={() => setDragActive(false)}
          onDrop={handleDrop}
          onClick={() => inputRef.current?.click()}
        />
      ) : (
        <div className="flex flex-col gap-6">
          <MediaPreview state={state} onReset={reset} onScan={startScan} />
          {state.kind === 'results' && <ResultsPanel result={state.result} onReset={reset} />}
        </div>
      )}
    </section>
  );
});

function DropZone({
  dragActive,
  onDragOver,
  onDragLeave,
  onDrop,
  onClick,
}: {
  dragActive: boolean;
  onDragOver: (e: DragEvent<HTMLButtonElement>) => void;
  onDragLeave: () => void;
  onDrop: (e: DragEvent<HTMLButtonElement>) => void;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
      className={`group relative w-full overflow-hidden rounded-3xl border text-left transition-all duration-300 ${
        dragActive
          ? 'border-ember-fire/70 shadow-[0_0_64px_-12px_rgba(255,87,34,0.55)]'
          : 'border-white/[0.07] hover:border-ember-fire/40 hover:shadow-[0_0_48px_-16px_rgba(255,122,31,0.4)]'
      } bg-gradient-to-br from-white/[0.025] to-white/[0.01] backdrop-blur-2xl`}
      style={{
        background: dragActive
          ? 'radial-gradient(circle at 50% 40%, rgba(255,87,34,0.14), rgba(10,6,8,0.9))'
          : undefined,
      }}
    >
      <div className="glass-edge absolute inset-0 rounded-3xl" />
      <div className="relative flex aspect-[16/10] flex-col items-center justify-center px-8 py-14 text-center">
        <ForgeEyeGlyph active={dragActive} />
        <h2 className="mt-8 font-display text-3xl font-semibold tracking-tight text-white sm:text-4xl">
          Open the <span className="wordmark">Forge Eye</span>
        </h2>
        <p className="mt-3 max-w-md text-sm leading-relaxed text-white/55">
          Drop an image or short video. The Eye will scan its origin —
          generative artifacts, lighting forensics, motion residue.
        </p>
        <div className="mt-6 flex flex-wrap items-center justify-center gap-2 font-mono text-[10px] uppercase tracking-[0.2em] text-white/35">
          <Pill>JPG · PNG · WEBP · 20 MB</Pill>
          <Pill>MP4 · WEBM · 30 s · 50 MB</Pill>
        </div>
        <div className="mt-8 inline-flex items-center gap-3 rounded-full border border-ember-fire/40 bg-ember-fire/10 px-5 py-2 text-xs uppercase tracking-[0.28em] text-ember-gold shadow-ember-glow">
          Drop or Click to Forge
        </div>
      </div>
    </button>
  );
}

function Pill({ children }: { children: React.ReactNode }) {
  return (
    <span className="rounded-full border border-white/[0.08] bg-white/[0.03] px-3 py-1">
      {children}
    </span>
  );
}

function ForgeEyeGlyph({ active }: { active: boolean }) {
  return (
    <div className="relative h-28 w-28">
      <div
        className={`absolute inset-0 rounded-full border ${
          active ? 'border-ember-fire/70' : 'border-ember-fire/30'
        } animate-pulse-slow`}
      />
      <div
        className="absolute inset-2 rounded-full"
        style={{
          background:
            'radial-gradient(circle at 50% 50%, rgba(255,180,71,0.25), rgba(255,87,34,0.1) 55%, transparent 75%)',
        }}
      />
      <div
        className="absolute left-1/2 top-1/2 h-8 w-8 -translate-x-1/2 -translate-y-1/2 rounded-full"
        style={{
          background:
            'radial-gradient(circle, #ffb347 0%, #ff5722 55%, #c81d25 100%)',
          boxShadow: '0 0 32px rgba(255,87,34,0.7)',
        }}
      />
      <div className="absolute inset-0 animate-spin rounded-full" style={{ animationDuration: '12s' }}>
        <div className="absolute left-1/2 top-0 h-2 w-2 -translate-x-1/2 rounded-full bg-ember-gold shadow-ember-glow" />
      </div>
    </div>
  );
}

function MediaPreview({
  state,
  onReset,
  onScan,
}: {
  state: Exclude<ForgeState, { kind: 'idle' }>;
  onReset: () => void;
  onScan: () => void;
}) {
  const isScanning = state.kind === 'scanning';
  const hasResults = state.kind === 'results';
  const boxes = hasResults ? state.result.boxes : [];
  const reveal = isScanning ? state.progress : hasResults ? 1 : 0;

  return (
    <GlassPanel hot={hasResults} edge className="animate-slide-up overflow-hidden">
      <div className="relative">
        <div className="relative w-full bg-black/60">
          {state.mediaKind === 'image' ? (
            <img
              src={state.url}
              alt="Uploaded media for analysis"
              className="block max-h-[640px] w-full object-contain"
            />
          ) : (
            <video
              src={state.url}
              controls
              className="block max-h-[640px] w-full bg-black object-contain"
            />
          )}
          <BoundingBoxOverlay boxes={boxes} reveal={reveal} />
          {isScanning && <ScanSweep progress={state.progress} />}
        </div>

        <div className="flex items-center justify-between gap-3 border-t border-white/[0.05] px-5 py-4 sm:px-6">
          <div className="min-w-0 flex-1">
            <div className="font-mono text-[10px] uppercase tracking-[0.22em] text-ember-gold/70">
              {isScanning
                ? `Forge Eye scanning · ${Math.round(state.progress * 100)}%`
                : hasResults
                ? 'Analysis complete'
                : 'Awaiting command'}
            </div>
            <div className="mt-1 truncate text-sm text-white/70">{state.file.name}</div>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onReset}
              className="rounded-full border border-white/10 bg-white/[0.03] px-4 py-2 text-[10px] uppercase tracking-[0.28em] text-white/60 transition hover:border-white/25 hover:text-white"
            >
              Discard
            </button>
            {!isScanning && !hasResults && (
              <button
                type="button"
                onClick={onScan}
                className="rounded-full border border-ember-fire/50 bg-gradient-to-r from-ember-fire/30 to-ember-blood/30 px-5 py-2 text-[10px] font-semibold uppercase tracking-[0.28em] text-white shadow-ember-glow transition hover:from-ember-fire/45 hover:to-ember-blood/45"
              >
                Run Forge Eye
              </button>
            )}
          </div>
        </div>
      </div>
    </GlassPanel>
  );
}

function ScanSweep({ progress }: { progress: number }) {
  return (
    <div className="pointer-events-none absolute inset-0 overflow-hidden">
      <div
        className="absolute inset-x-0 h-[28%]"
        style={{
          top: `${progress * 100 - 14}%`,
          background:
            'linear-gradient(180deg, transparent 0%, rgba(255,180,71,0.08) 35%, rgba(255,87,34,0.35) 50%, rgba(255,180,71,0.08) 65%, transparent 100%)',
          boxShadow: '0 0 48px rgba(255,87,34,0.4)',
          transition: 'top 80ms linear',
        }}
      />
      <div
        className="absolute inset-x-0 h-px"
        style={{
          top: `${progress * 100}%`,
          background:
            'linear-gradient(90deg, transparent 0%, #ffb347 30%, #ff5722 50%, #c81d25 70%, transparent 100%)',
          boxShadow: '0 0 16px #ff5722',
          transition: 'top 80ms linear',
        }}
      />
    </div>
  );
}
