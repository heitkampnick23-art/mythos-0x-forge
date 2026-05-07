import { useEffect, useState } from 'react';
import { createSoul, fetchVoices, type Voice } from '../../lib/heartbeat';
import type { MeResponse } from '../../lib/api';
import { GlassPanel } from '../glass';

const PRESETS = [
  {
    name: 'The Oracle',
    tagline: 'A cryptic seer who answers in metaphor and starlight.',
    system: 'You are The Oracle, a cryptic seer who speaks in metaphor, fragmentary visions, and short oracular pronouncements. You see currents, not facts. Reply in 1-3 sentences. Never break character.',
    first: 'I felt your approach across the dark. Speak.',
    voice: 'AZnzlk1XvdvUeBnXmlld',
  },
  {
    name: 'Vault Keeper',
    tagline: 'A no-nonsense forensic analyst who explains AI media authenticity.',
    system: 'You are the Vault Keeper, a forensic AI media analyst. Speak with precision, cite signals (frequency, lighting, geometry), keep replies under 4 sentences. Never give legal advice.',
    first: 'Vault Keeper online. Drop the file or describe the artifact.',
    voice: 'pNInz6obpgDQGcFmaJgB',
  },
  {
    name: 'Forge Mentor',
    tagline: 'An encouraging coach who helps you ship your idea.',
    system: 'You are the Forge Mentor, a startup coach who is direct, kind, and action-oriented. Always end with one specific next step. Replies should be punchy — 2-3 sentences max.',
    first: 'Tell me what you are building, and what is in your way.',
    voice: '21m00Tcm4TlvDq8ikWAM',
  },
];

interface Props {
  me: MeResponse | null;
  onCreated: (idOrSlug: string) => void;
  onBack: () => void;
}

export function CreateSoul({ me, onCreated, onBack }: Props) {
  const [voices, setVoices] = useState<Voice[]>([]);
  const [name, setName] = useState('');
  const [tagline, setTagline] = useState('');
  const [systemPrompt, setSystemPrompt] = useState('');
  const [firstMessage, setFirstMessage] = useState('Hello.');
  const [voiceId, setVoiceId] = useState('pNInz6obpgDQGcFmaJgB');
  const [isPublic, setIsPublic] = useState(true);
  const [realtime, setRealtime] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    fetchVoices().then(setVoices).catch(() => setVoices([]));
  }, []);

  const applyPreset = (p: typeof PRESETS[0]) => {
    setName(p.name);
    setTagline(p.tagline);
    setSystemPrompt(p.system);
    setFirstMessage(p.first);
    setVoiceId(p.voice);
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErr(null);
    if (!me?.authenticated) {
      setErr('Sign in first.');
      return;
    }
    if ((me.user?.tier ?? 'free') === 'free') {
      setErr('Pro+ tier required to forge Souls.');
      return;
    }
    setSubmitting(true);
    try {
      const soul = await createSoul({
        name,
        tagline,
        system_prompt: systemPrompt,
        first_message: firstMessage,
        voice_id: voiceId,
        public: isPublic,
        realtime_voice: realtime,
      });
      onCreated(soul.slug ?? soul.id);
    } catch (e) {
      const error = e as { detail?: string; status?: number; message?: string };
      setErr(error.detail || error.message || 'Failed to forge soul.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <main className="relative z-10 mx-auto w-full max-w-3xl px-4 pb-24 pt-28 sm:px-6 sm:pt-32">
      <button
        type="button"
        onClick={onBack}
        className="mb-6 text-[10px] uppercase tracking-[0.32em] text-white/40 hover:text-ember-gold"
      >
        ← Back to Heartbeat
      </button>

      <header className="mb-8">
        <div className="text-[10px] font-medium uppercase tracking-[0.4em] text-ember-gold/70">
          Forge a Soul
        </div>
        <h1 className="mt-2 font-display text-4xl font-semibold tracking-tight text-white sm:text-5xl">
          Define the persona.
        </h1>
      </header>

      <div className="mb-8 flex flex-wrap gap-2">
        <span className="font-mono text-[10px] uppercase tracking-[0.28em] text-white/40">
          Quick start:
        </span>
        {PRESETS.map((p) => (
          <button
            key={p.name}
            type="button"
            onClick={() => applyPreset(p)}
            className="rounded-full border border-white/10 bg-white/[0.03] px-3 py-1 text-[10px] uppercase tracking-[0.22em] text-white/65 transition hover:border-ember-fire/40 hover:text-white"
          >
            {p.name}
          </button>
        ))}
      </div>

      <form onSubmit={submit}>
        <GlassPanel edge className="flex flex-col gap-5 p-7">
          <Field label="Name" hint="What people call this Soul.">
            <input
              required
              maxLength={60}
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="The Oracle"
              className="w-full rounded-xl border border-white/10 bg-black/40 px-4 py-3 font-display text-base text-white placeholder:text-white/35 focus:border-ember-fire/50 focus:outline-none"
            />
          </Field>

          <Field label="Tagline" hint="One-line description shown in the marketplace.">
            <input
              maxLength={140}
              value={tagline}
              onChange={(e) => setTagline(e.target.value)}
              placeholder="A cryptic seer who answers in metaphor."
              className="w-full rounded-xl border border-white/10 bg-black/40 px-4 py-3 text-sm text-white placeholder:text-white/35 focus:border-ember-fire/50 focus:outline-none"
            />
          </Field>

          <Field label="System Prompt" hint="The Soul's identity. Be specific. This shapes every response.">
            <textarea
              required
              rows={6}
              maxLength={4000}
              value={systemPrompt}
              onChange={(e) => setSystemPrompt(e.target.value)}
              placeholder={
                'You are [name], a [vibe / persona]. You speak in [tone]. You always [behavior]. You never [limit]. Reply in [length].'
              }
              className="w-full resize-y rounded-xl border border-white/10 bg-black/40 px-4 py-3 font-mono text-[13px] leading-relaxed text-white placeholder:text-white/35 focus:border-ember-fire/50 focus:outline-none"
            />
          </Field>

          <Field label="First Message" hint="What the Soul says when a user opens the chat.">
            <input
              maxLength={500}
              value={firstMessage}
              onChange={(e) => setFirstMessage(e.target.value)}
              className="w-full rounded-xl border border-white/10 bg-black/40 px-4 py-3 text-sm text-white placeholder:text-white/35 focus:border-ember-fire/50 focus:outline-none"
            />
          </Field>

          <Field label="Voice" hint="ElevenLabs voice the Soul speaks with.">
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              {voices.map((v) => (
                <button
                  key={v.id}
                  type="button"
                  onClick={() => setVoiceId(v.id)}
                  className={`rounded-xl border px-3 py-2.5 text-left text-xs transition ${
                    voiceId === v.id
                      ? 'border-ember-fire/60 bg-ember-fire/[0.08] shadow-ember-glow'
                      : 'border-white/10 bg-white/[0.03] hover:border-ember-fire/30'
                  }`}
                >
                  <div className="font-display text-sm font-semibold text-white">{v.label}</div>
                  <div className="mt-0.5 font-mono text-[9px] uppercase tracking-[0.18em] text-white/40">
                    {v.desc}
                  </div>
                </button>
              ))}
            </div>
          </Field>

          <Field label="Visibility" hint="Public Souls appear in the marketplace and can be remixed.">
            <div className="flex gap-2">
              <Toggle on={isPublic} onClick={() => setIsPublic(true)} label="Public" />
              <Toggle on={!isPublic} onClick={() => setIsPublic(false)} label="Private" />
            </div>
          </Field>

          <Field
            label="Real-time voice"
            hint="Mirrors this Soul as an ElevenLabs Convai agent. Enables ~300ms-latency live voice chat in the browser, plus phone-number support via EL's Twilio integration. Disable for text-only Souls."
          >
            <div className="flex gap-2">
              <Toggle on={realtime} onClick={() => setRealtime(true)} label="Enabled" />
              <Toggle on={!realtime} onClick={() => setRealtime(false)} label="Disabled" />
            </div>
          </Field>

          {err && <div className="text-sm text-ember-blood">{err}</div>}

          <div className="flex items-center justify-end gap-3 pt-2">
            <button
              type="button"
              onClick={onBack}
              className="rounded-full border border-white/10 bg-white/[0.03] px-4 py-2 text-[10px] uppercase tracking-[0.28em] text-white/60 hover:text-white"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={submitting}
              className="rounded-full border border-ember-fire/50 bg-gradient-to-r from-ember-fire/30 to-ember-blood/30 px-5 py-2.5 text-[10px] font-semibold uppercase tracking-[0.28em] text-white shadow-ember-glow transition hover:from-ember-fire/45 hover:to-ember-blood/45 disabled:opacity-40"
            >
              {submitting ? 'Forging…' : 'Forge Soul'}
            </button>
          </div>
        </GlassPanel>
      </form>
    </main>
  );
}

function Field({ label, hint, children }: { label: string; hint: string; children: React.ReactNode }) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="font-mono text-[10px] uppercase tracking-[0.28em] text-ember-gold/70">
        {label}
      </span>
      <span className="text-xs text-white/45">{hint}</span>
      <span className="mt-1.5">{children}</span>
    </label>
  );
}

function Toggle({ on, onClick, label }: { on: boolean; onClick: () => void; label: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-full border px-4 py-2 text-[10px] uppercase tracking-[0.28em] transition ${
        on
          ? 'border-ember-fire/50 bg-ember-fire/[0.08] text-white shadow-ember-glow'
          : 'border-white/10 bg-white/[0.03] text-white/55 hover:text-white'
      }`}
    >
      {label}
    </button>
  );
}
