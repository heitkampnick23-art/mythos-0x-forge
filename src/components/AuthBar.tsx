import { useEffect, useState } from 'react';
import { logout, sendMagicLink, type MeResponse } from '../lib/api';
import { GlassPanel } from './glass';

interface Props {
  me: MeResponse | null;
  onRefresh: () => void;
  onNavigate: (path: string) => void;
  forceSignInOpen?: boolean;
  onSignInClose?: () => void;
}

export function AuthBar({ me, onRefresh, onNavigate, forceSignInOpen, onSignInClose }: Props) {
  const [open, setOpen] = useState(false);

  // Allow parents to programmatically open the sign-in modal
  useEffect(() => {
    if (forceSignInOpen) setOpen(true);
  }, [forceSignInOpen]);

  const close = () => {
    setOpen(false);
    onSignInClose?.();
  };

  return (
    <div className="pointer-events-none fixed right-4 top-4 z-40 flex items-center gap-2 sm:right-6 sm:top-6">
      <button
        type="button"
        onClick={() => onNavigate('/agents')}
        className="pointer-events-auto rounded-full border border-ember-gold/40 bg-ember-gold/[0.06] px-4 py-2 text-[10px] font-semibold uppercase tracking-[0.28em] text-ember-gold transition hover:bg-ember-gold/[0.12] hover:shadow-ember-glow"
      >
        Heartbeat
      </button>
      <button
        type="button"
        onClick={() => onNavigate('/pricing')}
        className="pointer-events-auto rounded-full border border-ember-fire/40 bg-ember-fire/[0.08] px-4 py-2 text-[10px] font-semibold uppercase tracking-[0.28em] text-ember-gold transition hover:bg-ember-fire/15 hover:shadow-ember-glow"
      >
        Pricing
      </button>

      {me?.authenticated && me.user ? (
        <button
          type="button"
          onClick={() => onNavigate('/account')}
          className="pointer-events-auto flex items-center gap-2 rounded-full border border-white/10 bg-white/[0.04] px-4 py-2 text-[10px] uppercase tracking-[0.28em] text-white/70 transition hover:border-ember-gold/40 hover:text-white"
        >
          <span
            className={`h-1.5 w-1.5 rounded-full ${
              me.user.tier === 'max'
                ? 'bg-ember-blood shadow-ember-glow'
                : me.user.tier === 'pro'
                ? 'bg-ember-fire'
                : 'bg-white/40'
            }`}
          />
          {me.user.tier}
        </button>
      ) : (
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="pointer-events-auto rounded-full border border-white/10 bg-white/[0.03] px-4 py-2 text-[10px] uppercase tracking-[0.28em] text-white/70 transition hover:border-ember-fire/40 hover:text-white"
        >
          Sign in
        </button>
      )}

      {open && (
        <SignInModal
          onClose={close}
          onSent={() => {
            close();
            void onRefresh();
          }}
        />
      )}
    </div>
  );
}

function SignInModal({ onClose, onSent }: { onClose: () => void; onSent: () => void }) {
  const [email, setEmail] = useState('');
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErr(null);
    setSending(true);
    try {
      await sendMagicLink(email);
      setSent(true);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setSending(false);
    }
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      onClick={onClose}
      className="pointer-events-auto fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm"
    >
      <GlassPanel
        edge
        onClick={(e: React.MouseEvent) => e.stopPropagation()}
        className="animate-slide-up w-[min(420px,92vw)] p-7"
      >
        {!sent ? (
          <form onSubmit={submit} className="flex flex-col gap-4">
            <div>
              <h2 className="font-display text-2xl font-semibold tracking-tight text-white">
                Enter the Forge
              </h2>
              <p className="mt-1 text-sm text-white/55">
                We'll email you a magic sign-in link. No password.
              </p>
            </div>
            <input
              type="email"
              required
              autoFocus
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@example.com"
              className="rounded-xl border border-white/10 bg-black/40 px-4 py-3 font-display text-sm text-white placeholder:text-white/35 focus:border-ember-fire/50 focus:outline-none"
            />
            {err && <div className="text-sm text-ember-blood">{err}</div>}
            <div className="flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={onClose}
                className="rounded-full border border-white/10 bg-white/[0.03] px-4 py-2 text-[10px] uppercase tracking-[0.28em] text-white/60 hover:text-white"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={sending}
                className="rounded-full border border-ember-fire/50 bg-gradient-to-r from-ember-fire/30 to-ember-blood/30 px-5 py-2 text-[10px] font-semibold uppercase tracking-[0.28em] text-white shadow-ember-glow transition hover:from-ember-fire/45 hover:to-ember-blood/45 disabled:opacity-40"
              >
                {sending ? 'Sending…' : 'Send Link'}
              </button>
            </div>
          </form>
        ) : (
          <div className="flex flex-col gap-3 text-center">
            <h2 className="font-display text-2xl font-semibold tracking-tight text-white">
              Check your email
            </h2>
            <p className="text-sm leading-relaxed text-white/55">
              A sign-in link is on its way to <span className="text-white/80">{email}</span>. It
              expires in 15 minutes. Click it to enter the Forge.
            </p>
            <button
              type="button"
              onClick={onSent}
              className="mt-2 rounded-full border border-white/10 bg-white/[0.03] px-5 py-2 text-[10px] uppercase tracking-[0.28em] text-white/70 hover:text-white"
            >
              Got it
            </button>
          </div>
        )}
      </GlassPanel>
    </div>
  );
}

export async function logoutAndRefresh(refresh: () => void) {
  try {
    await logout();
  } finally {
    refresh();
  }
}
