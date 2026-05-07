import { useEffect, useRef, useState } from 'react';
import {
  deleteSoul,
  fetchSoul,
  remixSoul,
  sendSoulMessage,
  speakSoulText,
  type SoulOwner,
  type SoulPublic,
} from '../../lib/heartbeat';
import type { MeResponse } from '../../lib/api';
import { GlassPanel } from '../glass';
import { useVoiceCommands } from '../../hooks/useVoiceCommands';
import { KbPanel } from './KbPanel';
import { PhonePanel } from './PhonePanel';

interface Props {
  idOrSlug: string;
  me: MeResponse | null;
  onBack: () => void;
  onUpgrade: () => void;
}

interface Message {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  audioUrl?: string;
}

export function SoulChat({ idOrSlug, me, onBack, onUpgrade }: Props) {
  const [soul, setSoul] = useState<SoulPublic | SoulOwner | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [sessionId, setSessionId] = useState<string | undefined>();
  const [sending, setSending] = useState(false);
  const [autoSpeak, setAutoSpeak] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const playingIdRef = useRef<string | null>(null);
  const [playingId, setPlayingId] = useState<string | null>(null);

  // Push-to-talk via Web Speech API
  const { supported: voiceSupported, listening, lastTranscript, start, stop } = useVoiceCommands({
    onCommand: (_, raw) => {
      if (raw.trim()) {
        setInput(raw);
        setTimeout(() => {
          void send(raw);
        }, 100);
      }
    },
  });

  useEffect(() => {
    fetchSoul(idOrSlug)
      .then((s) => {
        setSoul(s);
        setMessages([{ id: 'first', role: 'assistant', content: s.first_message }]);
      })
      .catch((e) => setErr((e as Error).message));
  }, [idOrSlug]);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
  }, [messages]);

  // Cleanup audio on unmount or new chat
  useEffect(() => {
    return () => {
      audioRef.current?.pause();
      messages.forEach((m) => m.audioUrl && URL.revokeObjectURL(m.audioUrl));
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [idOrSlug]);

  const playReply = async (msg: Message) => {
    if (!soul) return;
    if (playingIdRef.current === msg.id && audioRef.current) {
      audioRef.current.pause();
      playingIdRef.current = null;
      setPlayingId(null);
      return;
    }
    audioRef.current?.pause();
    let url = msg.audioUrl;
    try {
      if (!url) {
        url = await speakSoulText(soul.slug ?? soul.id, msg.content);
        setMessages((prev) => prev.map((m) => (m.id === msg.id ? { ...m, audioUrl: url } : m)));
      }
      const a = new Audio(url);
      a.addEventListener('ended', () => {
        playingIdRef.current = null;
        setPlayingId(null);
      });
      audioRef.current = a;
      playingIdRef.current = msg.id;
      setPlayingId(msg.id);
      await a.play();
    } catch (e) {
      const error = e as { status?: number };
      if (error.status === 402) onUpgrade();
      else setErr('Voice playback failed.');
      playingIdRef.current = null;
      setPlayingId(null);
    }
  };

  const send = async (text: string) => {
    if (!soul || !text.trim() || sending) return;
    setErr(null);
    setSending(true);

    const userMsg: Message = { id: `u_${Date.now()}`, role: 'user', content: text.trim() };
    setMessages((prev) => [...prev, userMsg]);
    setInput('');

    try {
      const res = await sendSoulMessage(soul.slug ?? soul.id, text.trim(), sessionId);
      setSessionId(res.session_id);
      const replyMsg: Message = { id: res.message_id, role: 'assistant', content: res.reply };
      setMessages((prev) => [...prev, replyMsg]);
      if (autoSpeak) void playReply(replyMsg);
    } catch (e) {
      const error = e as { status?: number; detail?: string; message?: string };
      if (error.status === 402) {
        setErr('Daily message limit reached. Upgrade for more.');
        setTimeout(onUpgrade, 1200);
      } else if (error.status === 401) {
        setErr('Sign in to chat.');
      } else {
        setErr(error.detail || error.message || 'Send failed.');
      }
    } finally {
      setSending(false);
    }
  };

  const onSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    void send(input);
  };

  const remix = async () => {
    if (!soul) return;
    if ((me?.user?.tier ?? 'free') === 'free') {
      onUpgrade();
      return;
    }
    try {
      const newSoul = await remixSoul(soul.slug ?? soul.id);
      window.location.href = `/agents/${newSoul.slug ?? newSoul.id}`;
    } catch (e) {
      setErr((e as Error).message);
    }
  };

  const remove = async () => {
    if (!soul || !('is_owner' in soul && soul.is_owner)) return;
    if (!confirm(`Delete ${soul.name}? This cannot be undone.`)) return;
    try {
      await deleteSoul(soul.id);
      onBack();
    } catch (e) {
      setErr((e as Error).message);
    }
  };

  if (err && !soul) {
    return (
      <main className="relative z-10 mx-auto w-full max-w-3xl px-4 pb-24 pt-32 text-center">
        <h1 className="font-display text-3xl font-semibold text-white">Soul not found</h1>
        <p className="mt-3 text-sm text-white/55">{err}</p>
        <button
          type="button"
          onClick={onBack}
          className="mt-8 rounded-full border border-white/10 bg-white/[0.03] px-5 py-2 text-[10px] uppercase tracking-[0.28em] text-white/60 hover:text-white"
        >
          Back to Heartbeat
        </button>
      </main>
    );
  }

  if (!soul) {
    return (
      <main className="relative z-10 flex min-h-[60vh] items-center justify-center">
        <div className="font-mono text-xs uppercase tracking-[0.3em] text-white/35">Loading…</div>
      </main>
    );
  }

  const owned = 'is_owner' in soul && soul.is_owner;

  return (
    <main className="relative z-10 mx-auto flex h-[100dvh] w-full max-w-3xl flex-col px-4 pb-4 pt-24 sm:px-6 sm:pt-28">
      <header className="mb-4 flex items-center justify-between gap-3">
        <button
          type="button"
          onClick={onBack}
          className="text-[10px] uppercase tracking-[0.32em] text-white/40 hover:text-ember-gold"
        >
          ← Heartbeat
        </button>
        <div className="flex items-center gap-2">
          {!owned && (
            <button
              type="button"
              onClick={remix}
              className="rounded-full border border-ember-gold/40 bg-ember-gold/[0.08] px-3 py-1.5 text-[10px] uppercase tracking-[0.22em] text-ember-gold transition hover:border-ember-fire/50 hover:text-white"
            >
              Remix
            </button>
          )}
          {owned && (
            <button
              type="button"
              onClick={remove}
              className="rounded-full border border-white/10 bg-white/[0.03] px-3 py-1.5 text-[10px] uppercase tracking-[0.22em] text-white/40 transition hover:border-ember-blood/40 hover:text-ember-blood"
            >
              Delete
            </button>
          )}
        </div>
      </header>

      <div className="mb-3 flex items-baseline justify-between gap-3">
        <div className="min-w-0">
          <h1 className="wordmark text-glow truncate font-display text-3xl font-semibold leading-tight">
            {soul.name}
          </h1>
          {soul.tagline && (
            <p className="mt-1 truncate text-sm text-white/55">{soul.tagline}</p>
          )}
        </div>
        <div className="flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.22em] text-white/40">
          <span className="h-1 w-1 rounded-full bg-ember-fire shadow-ember-glow" />
          {soul.voice_label}
        </div>
      </div>

      {owned && (
        <>
          <KbPanel soulIdOrSlug={idOrSlug} onUpgrade={onUpgrade} />
          <PhonePanel
            soulIdOrSlug={idOrSlug}
            currentNumber={(soul as { phone_number?: string | null }).phone_number ?? null}
            onChanged={() => {
              // Re-fetch soul to refresh phone display
              window.location.reload();
            }}
          />
        </>
      )}

      <div className="mb-3 flex items-center justify-end gap-3">
        <label className="flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.22em] text-white/45">
          <input
            type="checkbox"
            checked={autoSpeak}
            onChange={(e) => setAutoSpeak(e.target.checked)}
            className="accent-ember-fire"
          />
          Auto-speak
        </label>
      </div>

      <div
        ref={scrollRef}
        className="flex flex-1 flex-col gap-3 overflow-y-auto pr-1 sm:gap-4"
      >
        {messages.map((m) => (
          <Bubble
            key={m.id}
            msg={m}
            onSpeak={() => playReply(m)}
            playing={playingId === m.id}
          />
        ))}
        {sending && (
          <div className="self-start font-mono text-[10px] uppercase tracking-[0.28em] text-ember-gold/70">
            <span className="inline-flex items-center gap-2">
              <span className="h-1 w-1 animate-pulse rounded-full bg-ember-fire" />
              {soul.name} is thinking…
            </span>
          </div>
        )}
      </div>

      {err && (
        <div className="mb-2 rounded-xl border border-ember-blood/30 bg-ember-blood/[0.06] px-3 py-2 text-xs text-ember-blood">
          {err}
        </div>
      )}

      <GlassPanel edge className="mt-3 flex items-center gap-2 px-3 py-2.5 sm:px-4">
        {voiceSupported && (
          <button
            type="button"
            onClick={listening ? stop : start}
            aria-label={listening ? 'Stop listening' : 'Start voice input'}
            className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full border transition ${
              listening
                ? 'border-ember-blood/60 bg-ember-blood/15 shadow-ember-glow'
                : 'border-white/10 bg-white/[0.04] hover:border-ember-fire/40'
            }`}
          >
            <MicIcon active={listening} />
          </button>
        )}
        <form onSubmit={onSubmit} className="flex flex-1 items-center gap-2">
          <input
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder={listening ? lastTranscript || 'Listening…' : 'Speak to the Soul…'}
            disabled={sending}
            className="flex-1 bg-transparent font-display text-[15px] tracking-wide text-white placeholder:text-white/35 focus:outline-none disabled:opacity-40"
          />
          <button
            type="submit"
            disabled={!input.trim() || sending}
            className="rounded-full border border-ember-fire/50 bg-gradient-to-r from-ember-fire/30 to-ember-blood/30 px-4 py-2 text-[10px] font-semibold uppercase tracking-[0.28em] text-white shadow-ember-glow transition hover:from-ember-fire/45 hover:to-ember-blood/45 disabled:opacity-30"
          >
            Send
          </button>
        </form>
      </GlassPanel>
    </main>
  );
}

function Bubble({
  msg,
  onSpeak,
  playing,
}: {
  msg: Message;
  onSpeak: () => void;
  playing: boolean;
}) {
  const isUser = msg.role === 'user';
  return (
    <div className={`flex ${isUser ? 'justify-end' : 'justify-start'}`}>
      <div
        className={`group max-w-[80%] rounded-2xl px-4 py-3 text-[14px] leading-relaxed ${
          isUser
            ? 'border border-white/10 bg-white/[0.05] text-white'
            : 'border border-ember-fire/25 bg-gradient-to-br from-ember-fire/[0.08] to-ember-blood/[0.04] text-white shadow-glass-hot'
        }`}
      >
        <p className="whitespace-pre-wrap">{msg.content}</p>
        {!isUser && (
          <button
            type="button"
            onClick={onSpeak}
            className="mt-2 flex items-center gap-1.5 font-mono text-[9px] uppercase tracking-[0.28em] text-ember-gold/70 transition hover:text-ember-gold"
          >
            <SpeakIcon playing={playing} />
            {playing ? 'Pause' : 'Hear'}
          </button>
        )}
      </div>
    </div>
  );
}

function MicIcon({ active }: { active: boolean }) {
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
      className={active ? 'text-ember-blood' : 'text-white/70'}
    >
      <rect x="9" y="3" width="6" height="12" rx="3" />
      <path d="M5 11a7 7 0 0 0 14 0" />
      <line x1="12" y1="18" x2="12" y2="22" />
    </svg>
  );
}

function SpeakIcon({ playing }: { playing: boolean }) {
  return (
    <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M11 5L6 9H2v6h4l5 4V5z" />
      {playing && (
        <>
          <path d="M15.54 8.46a5 5 0 0 1 0 7.07" strokeLinecap="round" />
          <path d="M19.07 4.93a10 10 0 0 1 0 14.14" strokeLinecap="round" />
        </>
      )}
    </svg>
  );
}
