import { useState } from 'react';
import { attachPhoneToSoul, detachPhoneFromSoul } from '../../lib/heartbeat';
import { GlassPanel } from '../glass';

interface Props {
  soulIdOrSlug: string;
  currentNumber: string | null | undefined;
  convaiAgentId?: string | null;
  onChanged: () => void;
}

export function PhonePanel({ soulIdOrSlug, currentNumber, convaiAgentId, onChanged }: Props) {
  const [open, setOpen] = useState(false);
  const [phone, setPhone] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const attach = async (e: React.FormEvent) => {
    e.preventDefault();
    setErr(null);
    setBusy(true);
    try {
      // Normalize: keep digits + leading +
      const normalized = phone.startsWith('+') ? '+' + phone.slice(1).replace(/\D/g, '') : '+' + phone.replace(/\D/g, '');
      await attachPhoneToSoul(soulIdOrSlug, normalized);
      setPhone('');
      onChanged();
    } catch (e) {
      const error = e as { detail?: string; message?: string };
      setErr(error.detail || error.message || 'Failed to attach');
    } finally {
      setBusy(false);
    }
  };

  const detach = async () => {
    if (!confirm('Detach the phone number? Calls will stop being routed to this Soul.')) return;
    setBusy(true);
    try {
      await detachPhoneFromSoul(soulIdOrSlug);
      onChanged();
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mb-3">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="flex w-full items-center justify-between rounded-xl border border-white/10 bg-white/[0.03] px-4 py-2.5 text-left transition hover:border-ember-gold/40"
      >
        <div>
          <div className="font-mono text-[10px] uppercase tracking-[0.28em] text-ember-gold/70">
            Phone Number
          </div>
          <div className="mt-0.5 text-[12px] text-white/55">
            {currentNumber ? (
              <span className="font-mono text-ember-gold">{currentNumber}</span>
            ) : (
              'Tap to wire a Twilio number'
            )}
          </div>
        </div>
        <span className={`font-mono text-xs text-white/35 transition ${open ? 'rotate-90' : ''}`}>›</span>
      </button>

      {open && (
        <GlassPanel edge className="mt-2 flex flex-col gap-3 p-4">
          {convaiAgentId ? (
            <>
              <div className="rounded-xl border border-ember-fire/30 bg-ember-fire/[0.06] p-3">
                <div className="mb-1 font-mono text-[9px] uppercase tracking-[0.28em] text-ember-gold">
                  Real-time mode (recommended)
                </div>
                <p className="text-[12px] leading-relaxed text-white/65">
                  This Soul has real-time voice enabled. For the lowest-latency phone calls
                  (~300 ms), connect a number directly through ElevenLabs:
                </p>
                <ol className="mt-2 list-decimal pl-5 text-[12px] leading-relaxed text-white/55">
                  <li>
                    Open{' '}
                    <a
                      href="https://elevenlabs.io/app/conversational-ai/phone-numbers"
                      target="_blank"
                      rel="noopener"
                      className="text-ember-gold hover:text-ember-fire"
                    >
                      ElevenLabs Phone Numbers
                    </a>
                  </li>
                  <li>Click <strong>Import a number</strong>, paste your Twilio SID + auth token</li>
                  <li>
                    Assign agent ID:{' '}
                    <code className="rounded bg-black/40 px-1 font-mono text-ember-gold">
                      {convaiAgentId}
                    </code>
                  </li>
                </ol>
                <p className="mt-2 text-[11px] leading-relaxed text-white/40">
                  ElevenLabs handles the entire audio bridge — you don't need to set Twilio webhooks
                  manually.
                </p>
              </div>
              <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-3">
                <div className="mb-1 font-mono text-[9px] uppercase tracking-[0.28em] text-white/45">
                  Fallback (Mythos webhook)
                </div>
                <p className="text-[11px] leading-relaxed text-white/45">
                  Or pin a Twilio number directly to Mythos here for a degraded ~3s/turn flow that
                  bypasses ElevenLabs Convai. Useful for accounts without Convai phone integration.
                </p>
              </div>
            </>
          ) : null}
          {currentNumber ? (
            <>
              <p className="text-[12px] leading-relaxed text-white/55">
                Mythos-hosted route active for{' '}
                <span className="font-mono text-ember-gold">{currentNumber}</span>. Your Twilio voice
                webhook should point at{' '}
                <span className="font-mono text-ember-gold">
                  https://api.mythos0x.com/v1/phone/incoming
                </span>{' '}
                (HTTP&nbsp;POST).
              </p>
              <button
                type="button"
                onClick={detach}
                disabled={busy}
                className="rounded-full border border-ember-blood/30 bg-ember-blood/[0.06] px-4 py-2 text-[10px] font-semibold uppercase tracking-[0.28em] text-ember-blood transition hover:bg-ember-blood/[0.12] disabled:opacity-50"
              >
                Detach Number
              </button>
            </>
          ) : (
            <>
              <p className="text-[12px] leading-relaxed text-white/55">
                Buy a phone number at{' '}
                <a
                  href="https://console.twilio.com/us1/develop/phone-numbers/manage/search"
                  target="_blank"
                  rel="noopener"
                  className="text-ember-gold hover:text-ember-fire"
                >
                  Twilio
                </a>{' '}
                (~$1/mo + per-minute), then either route via ElevenLabs (recommended above) or pin it
                here for the Mythos fallback flow:
              </p>
              <code className="rounded-lg border border-white/10 bg-black/40 px-3 py-2 font-mono text-[11px] text-ember-gold">
                https://api.mythos0x.com/v1/phone/incoming
              </code>
              <form onSubmit={attach} className="flex flex-col gap-2">
                <input
                  type="tel"
                  required
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  placeholder="+15551234567"
                  className="rounded-xl border border-white/10 bg-black/40 px-4 py-3 font-mono text-sm text-white placeholder:text-white/35 focus:border-ember-fire/50 focus:outline-none"
                />
                {err && <div className="text-[11px] text-ember-blood">{err}</div>}
                <button
                  type="submit"
                  disabled={busy || !phone}
                  className="rounded-full border border-ember-fire/40 bg-ember-fire/[0.08] px-4 py-2 text-[10px] font-semibold uppercase tracking-[0.28em] text-ember-gold transition hover:bg-ember-fire/15 hover:shadow-ember-glow disabled:opacity-50"
                >
                  {busy ? 'Attaching…' : 'Pin to Mythos fallback'}
                </button>
              </form>
            </>
          )}
        </GlassPanel>
      )}
    </div>
  );
}
