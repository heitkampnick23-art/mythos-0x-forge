// Real-time voice via ElevenLabs Convai. Lazy-loads their <elevenlabs-convai>
// web component the first time the user clicks "Live voice", fetches a signed
// WebSocket URL from our Worker (so the EL key never reaches the browser), and
// drops the widget into the chat panel.

import { useEffect, useRef, useState } from 'react';
import { getConvaiSignedUrl } from '../../lib/heartbeat';
import { GlassPanel } from '../glass';

const SDK_URL = 'https://unpkg.com/@elevenlabs/convai-widget-embed';
let sdkLoading: Promise<void> | null = null;

function loadSdk(): Promise<void> {
  if (typeof window === 'undefined') return Promise.resolve();
  if (sdkLoading) return sdkLoading;
  sdkLoading = new Promise<void>((resolve, reject) => {
    if (document.querySelector(`script[data-mythos-convai="1"]`)) return resolve();
    const s = document.createElement('script');
    s.src = SDK_URL;
    s.async = true;
    s.dataset.mythosConvai = '1';
    s.onload = () => resolve();
    s.onerror = () => reject(new Error('failed_to_load_convai_sdk'));
    document.head.appendChild(s);
  });
  return sdkLoading;
}

interface Props {
  soulIdOrSlug: string;
  hasRealtime: boolean;
}

export function RealtimeVoice({ soulIdOrSlug, hasRealtime }: Props) {
  const [active, setActive] = useState(false);
  const [signedUrl, setSignedUrl] = useState<string | null>(null);
  const [agentId, setAgentId] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  if (!hasRealtime) return null;

  const startCall = async () => {
    setErr(null);
    setLoading(true);
    try {
      const [{ signed_url, agent_id }] = await Promise.all([
        getConvaiSignedUrl(soulIdOrSlug),
        loadSdk(),
      ]);
      setSignedUrl(signed_url);
      setAgentId(agent_id);
      setActive(true);
    } catch (e) {
      const error = e as { detail?: string; message?: string };
      setErr(error.detail || error.message || 'Failed to start');
    } finally {
      setLoading(false);
    }
  };

  // Mount the web component once we have signed_url. The component handles
  // mic permission, WebSocket, audio playback. We nudge it via attributes.
  useEffect(() => {
    if (!active || !signedUrl || !agentId || !containerRef.current) return;
    const el = document.createElement('elevenlabs-convai');
    el.setAttribute('agent-id', agentId);
    el.setAttribute('signed-url', signedUrl);
    // Their widget is dark-friendly out of the box
    containerRef.current.replaceChildren(el);
    return () => {
      try {
        containerRef.current?.replaceChildren();
      } catch {
        /* noop */
      }
    };
  }, [active, signedUrl, agentId]);

  return (
    <div className="mb-3">
      {!active ? (
        <button
          type="button"
          onClick={startCall}
          disabled={loading}
          className="flex w-full items-center justify-between rounded-xl border border-ember-fire/40 bg-gradient-to-r from-ember-fire/[0.10] to-ember-blood/[0.06] px-4 py-3 text-left transition hover:from-ember-fire/[0.18] hover:to-ember-blood/[0.10] hover:shadow-ember-glow disabled:opacity-50"
        >
          <div>
            <div className="font-mono text-[10px] uppercase tracking-[0.28em] text-ember-gold">
              Real-time voice · ElevenLabs
            </div>
            <div className="mt-0.5 text-[12px] text-white/60">
              {loading ? 'Connecting…' : 'Tap to start a live conversation (~300 ms latency)'}
            </div>
          </div>
          <span className="font-display text-xs font-semibold uppercase tracking-[0.22em] text-white">
            Start
          </span>
        </button>
      ) : (
        <GlassPanel hot edge className="flex flex-col gap-3 p-4">
          <div className="flex items-center justify-between">
            <div className="font-mono text-[10px] uppercase tracking-[0.28em] text-ember-gold">
              ● Live · ElevenLabs Convai
            </div>
            <button
              type="button"
              onClick={() => {
                setActive(false);
                setSignedUrl(null);
              }}
              className="font-mono text-[10px] uppercase tracking-[0.22em] text-white/55 hover:text-ember-blood"
            >
              End call
            </button>
          </div>
          <div ref={containerRef} className="flex min-h-[120px] items-center justify-center" />
          <p className="font-mono text-[9px] uppercase tracking-[0.22em] text-white/35">
            Speak naturally — the agent listens, thinks, and replies in voice.
          </p>
        </GlassPanel>
      )}
      {err && <div className="mt-2 text-[11px] text-ember-blood">{err}</div>}
    </div>
  );
}
