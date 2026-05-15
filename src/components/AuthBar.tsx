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
                Continue with Google, or get a magic sign-in link by email.
              </p>
            </div>
            <a
              href={(import.meta.env.VITE_FORGE_API_URL as string | undefined) ? `${import.meta.env.VITE_FORGE_API_URL}/v1/auth/google/start` : 'https://api.mythos0x.com/v1/auth/google/start'}
              className="flex items-center justify-center gap-2 rounded-xl bg-white px-4 py-3 font-display text-sm font-medium text-neutral-900 transition hover:brightness-95"
            >
              <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
                <path fill="#EA4335" d="M12 10.2v3.9h5.5c-.24 1.4-1.7 4.1-5.5 4.1-3.3 0-6-2.7-6-6.1s2.7-6.1 6-6.1c1.9 0 3.2.8 3.9 1.5l2.7-2.6C16.9 3.4 14.7 2.4 12 2.4 6.7 2.4 2.4 6.7 2.4 12s4.3 9.6 9.6 9.6c5.5 0 9.2-3.9 9.2-9.4 0-.6-.07-1.1-.16-1.6H12z"/>
              </svg>
              Continue with Google
            </a>
            <div className="flex items-center gap-3 text-[10px] uppercase tracking-[0.28em] text-white/30">
              <span className="h-px flex-1 bg-white/10" />
              <span>or</span>
              <span className="h-px flex-1 bg-white/10" />
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
