import { useEffect, useRef, useState } from 'react';
import type { AnalysisResult } from '../lib/analyzeMedia';
import type { Tier } from '../lib/api';
import { fetchVerdictAudio } from '../lib/api';

interface Props {
  result: AnalysisResult;
  tier: Tier;
  authenticated: boolean;
  onUpgrade: () => void;
  onSignIn: () => void;
}

type State = 'idle' | 'loading' | 'playing' | 'paused' | 'error';

export function VoiceReadout({ result, tier, authenticated, onUpgrade, onSignIn }: Props) {
  const [state, setState] = useState<State>('idle');
  const [err, setErr] = useState<string | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const urlRef = useRef<string | null>(null);

  // Cleanup blob URL when result changes
  useEffect(() => {
    return () => {
      if (urlRef.current) URL.revokeObjectURL(urlRef.current);
      urlRef.current = null;
      audioRef.current?.pause();
      audioRef.current = null;
    };
  }, [result]);

  const handleClick = async () => {
    if (!authenticated) return onSignIn();
    if (tier === 'free') return onUpgrade();

    if (audioRef.current && state === 'paused') {
      void audioRef.current.play();
      setState('playing');
      return;
    }
    if (audioRef.current && state === 'playing') {
      audioRef.current.pause();
      setState('paused');
      return;
    }

    setErr(null);
    setState('loading');
    try {
      const url = await fetchVerdictAudio({
        confidence: result.confidence,
        verdict: result.verdict,
        findings: result.findings,
      });
      urlRef.current = url;
      const a = new Audio(url);
      audioRef.current = a;
      a.addEventListener('ended', () => setState('idle'));
      a.addEventListener('error', () => {
        setState('error');
        setErr('Audio playback failed.');
      });
      await a.play();
      setState('playing');
    } catch (e) {
      const error = e as { status?: number; message?: string };
      if (error.status === 402) {
        onUpgrade();
        setState('idle');
      } else if (error.status === 401) {
        onSignIn();
        setState('idle');
      } else {
        setErr(error.message ?? 'Voice failed');
        setState('error');
      }
    }
  };

  const label = (() => {
    if (!authenticated) return 'Sign in for voice';
    if (tier === 'free') return 'Upgrade for voice';
    if (state === 'loading') return 'Synthesizing…';
    if (state === 'playing') return 'Pause';
    if (state === 'paused') return 'Resume';
    if (state === 'error') return 'Retry voice';
    return tier === 'max' ? 'Hear verdict (Adam)' : 'Hear verdict';
  })();

  return (
    <div className="flex flex-col items-end gap-1">
      <button
        type="button"
        onClick={handleClick}
        disabled={state === 'loading'}
        className={`group flex items-center gap-2 rounded-full border px-4 py-2 text-[10px] uppercase tracking-[0.28em] transition ${
          tier !== 'free' && authenticated
            ? 'border-ember-gold/40 bg-ember-gold/[0.08] text-ember-gold hover:border-ember-fire/60 hover:bg-ember-fire/15 hover:text-white hover:shadow-ember-glow'
            : 'border-white/10 bg-white/[0.03] text-white/55 hover:border-ember-fire/40 hover:text-white'
        } disabled:opacity-50`}
      >
        <SpeakerIcon active={state === 'playing'} loading={state === 'loading'} />
        {label}
      </button>
      {err && <span className="text-[10px] text-ember-blood">{err}</span>}
    </div>
  );
}

function SpeakerIcon({ active, loading }: { active: boolean; loading: boolean }) {
  if (loading) {
    return (
      <span className="inline-block h-3 w-3 animate-spin rounded-full border-[1.5px] border-current border-r-transparent" />
    );
  }
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={active ? 'text-ember-fire' : ''}
    >
      <path d="M11 5L6 9H2v6h4l5 4V5z" />
      {active && (
        <>
          <path d="M15.54 8.46a5 5 0 0 1 0 7.07" />
          <path d="M19.07 4.93a10 10 0 0 1 0 14.14" />
        </>
      )}
    </svg>
  );
}
