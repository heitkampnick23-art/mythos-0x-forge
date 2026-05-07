import { useState } from 'react';
import { attachPhoneToSoul, detachPhoneFromSoul } from '../../lib/heartbeat';
import { GlassPanel } from '../glass';

interface Props {
  soulIdOrSlug: string;
  currentNumber: string | null | undefined;
  onChanged: () => void;
}

export function PhonePanel({ soulIdOrSlug, currentNumber, onChanged }: Props) {
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
          {currentNumber ? (
            <>
              <p className="text-[12px] leading-relaxed text-white/55">
                When someone calls <span className="font-mono text-ember-gold">{currentNumber}</span>, they'll
                be connected to this Soul. Make sure your Twilio voice webhook for this number points
                at <span className="font-mono text-ember-gold">https://api.mythos0x.com/v1/phone/incoming</span> (HTTP&nbsp;POST).
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
                Buy a phone number at <a href="https://console.twilio.com/us1/develop/phone-numbers/manage/search" target="_blank" rel="noopener" className="text-ember-gold hover:text-ember-fire">Twilio</a> (~$1/mo + per-minute).
                Set its <strong>Voice webhook</strong> to:
              </p>
              <code className="rounded-lg border border-white/10 bg-black/40 px-3 py-2 font-mono text-[11px] text-ember-gold">
                https://api.mythos0x.com/v1/phone/incoming
              </code>
              <p className="text-[12px] leading-relaxed text-white/45">
                Then enter the number here in <span className="font-mono">+1XXXXXXXXXX</span> format.
                Callers will hear this Soul's first message and can hold a real conversation.
              </p>
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
                  {busy ? 'Attaching…' : 'Attach Number'}
                </button>
              </form>
            </>
          )}
        </GlassPanel>
      )}
    </div>
  );
}
