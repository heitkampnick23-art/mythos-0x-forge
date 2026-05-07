import { useEffect, useState } from 'react';
import {
  fetchUsage,
  logout,
  openBillingPortal,
  updateProfile,
  type MeResponse,
  type UsageResponse,
} from '../lib/api';
import { fetchVoices, type Voice } from '../lib/heartbeat';
import { GlassPanel } from './glass';
import { ReferralWidget } from './ReferralWidget';

interface Props {
  me: MeResponse | null;
  onRefresh: () => void;
  onNavigate: (path: string) => void;
}

export function Account({ me, onRefresh, onNavigate }: Props) {
  const [loading, setLoading] = useState<string | null>(null);
  const [usage, setUsage] = useState<UsageResponse | null>(null);
  const [voices, setVoices] = useState<Voice[]>([]);
  const [draft, setDraft] = useState({
    display_name: '',
    default_voice_id: '',
    auto_speak: true,
    notify_email: true,
  });
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    if (!me?.authenticated || !me.user) return;
    setDraft({
      display_name: me.user.display_name ?? '',
      default_voice_id: me.user.default_voice_id,
      auto_speak: me.user.auto_speak,
      notify_email: me.user.notify_email,
    });
    fetchUsage().then(setUsage).catch(() => undefined);
    fetchVoices().then(setVoices).catch(() => setVoices([]));
  }, [me?.authenticated, me?.user]);

  if (!me?.authenticated || !me.user) {
    return (
      <main className="relative z-10 mx-auto flex w-full max-w-3xl flex-col items-center px-4 pb-24 pt-32 text-center">
        <h1 className="font-display text-3xl font-semibold text-white">Not signed in</h1>
        <p className="mt-3 text-sm text-white/55">Use the Sign in button up top to enter the Forge.</p>
        <button
          type="button"
          onClick={() => onNavigate('/')}
          className="mt-8 rounded-full border border-white/10 bg-white/[0.03] px-5 py-2 text-[10px] uppercase tracking-[0.28em] text-white/60 hover:text-white"
        >
          Back to Forge
        </button>
      </main>
    );
  }

  const billingPortal = async () => {
    setLoading('portal');
    try {
      const url = await openBillingPortal();
      window.location.href = url;
    } catch {
      setLoading(null);
    }
  };

  const signOut = async () => {
    setLoading('logout');
    try {
      await logout();
      onRefresh();
      onNavigate('/');
    } finally {
      setLoading(null);
    }
  };

  const saveProfile = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading('profile');
    setSaved(false);
    try {
      await updateProfile(draft);
      onRefresh();
      setSaved(true);
      setTimeout(() => setSaved(false), 2500);
    } finally {
      setLoading(null);
    }
  };

  const tier = me.user.tier;

  return (
    <main className="relative z-10 mx-auto w-full max-w-4xl px-4 pb-24 pt-28 sm:px-6 sm:pt-32">
      <button
        type="button"
        onClick={() => onNavigate('/')}
        className="mb-6 text-[10px] uppercase tracking-[0.32em] text-white/40 hover:text-ember-gold"
      >
        ← Back to Forge
      </button>

      <header className="mb-8 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <div className="text-[10px] font-medium uppercase tracking-[0.4em] text-ember-gold/70">
            Account
          </div>
          <h1 className="wordmark text-glow mt-1 text-4xl font-semibold leading-tight sm:text-5xl">
            {me.user.display_name || me.user.email.split('@')[0]}
          </h1>
          <p className="mt-1 font-mono text-[11px] uppercase tracking-[0.22em] text-white/40">
            {me.user.email}
          </p>
        </div>
        <TierBadge tier={tier} />
      </header>

      <ReferralWidget />

      {/* Usage dashboard */}
      <section className="mb-8 grid grid-cols-1 gap-4 md:grid-cols-3">
        <UsageCard
          label="Today's spend"
          primary={usage ? `$${usage.budget.used_cents.toFixed(3)}` : '—'}
          secondary={usage ? `of $${usage.budget.cap_cents.toFixed(2)} cap` : 'loading…'}
          ratio={usage?.budget.ratio ?? 0}
          warn={!!usage?.budget.near_limit}
          critical={!!usage?.budget.exceeded}
        />
        <UsageCard
          label="Analyses today"
          primary={usage ? `${usage.analyses.used}` : '—'}
          secondary={usage ? `of ${usage.analyses.limit} / day` : 'loading…'}
          ratio={usage ? usage.analyses.used / Math.max(1, usage.analyses.limit) : 0}
        />
        <UsageCard
          label="Soul messages today"
          primary={usage ? `${usage.soul_messages.used}` : '—'}
          secondary={usage ? `of ${usage.soul_messages.limit} / day` : 'loading…'}
          ratio={usage ? usage.soul_messages.used / Math.max(1, usage.soul_messages.limit) : 0}
        />
      </section>

      {/* Profile / settings */}
      <form onSubmit={saveProfile}>
        <GlassPanel edge className="flex flex-col gap-5 p-7">
          <h2 className="font-mono text-[10px] uppercase tracking-[0.32em] text-ember-gold/70">
            Profile & Preferences
          </h2>

          <Field label="Display name" hint="Shown in the marketplace and on shareable verdicts.">
            <input
              maxLength={60}
              value={draft.display_name}
              onChange={(e) => setDraft({ ...draft, display_name: e.target.value })}
              placeholder={me.user.email.split('@')[0]}
              className="w-full rounded-xl border border-white/10 bg-black/40 px-4 py-3 text-sm text-white placeholder:text-white/35 focus:border-ember-fire/50 focus:outline-none"
            />
          </Field>

          <Field label="Default voice" hint="Used for verdict readouts and as the default for new Souls.">
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              {voices.map((v) => (
                <button
                  key={v.id}
                  type="button"
                  onClick={() => setDraft({ ...draft, default_voice_id: v.id })}
                  className={`rounded-xl border px-3 py-2.5 text-left text-xs transition ${
                    draft.default_voice_id === v.id
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

          <Toggle
            label="Auto-speak verdicts and Soul replies"
            hint="Audio plays automatically when a result arrives. Tap to mute per session."
            on={draft.auto_speak}
            onToggle={(v) => setDraft({ ...draft, auto_speak: v })}
          />
          <Toggle
            label="Email notifications"
            hint="Receipts, account changes, and product updates. We never share your email."
            on={draft.notify_email}
            onToggle={(v) => setDraft({ ...draft, notify_email: v })}
          />

          <div className="flex items-center justify-end gap-3 pt-2">
            {saved && (
              <span className="font-mono text-[10px] uppercase tracking-[0.28em] text-ember-gold">
                Saved
              </span>
            )}
            <button
              type="submit"
              disabled={loading === 'profile'}
              className="rounded-full border border-ember-fire/50 bg-gradient-to-r from-ember-fire/30 to-ember-blood/30 px-5 py-2.5 text-[10px] font-semibold uppercase tracking-[0.28em] text-white shadow-ember-glow transition hover:from-ember-fire/45 hover:to-ember-blood/45 disabled:opacity-40"
            >
              {loading === 'profile' ? 'Saving…' : 'Save Changes'}
            </button>
          </div>
        </GlassPanel>
      </form>

      {/* Billing + actions */}
      <div className="mt-6 flex flex-wrap items-center gap-3">
        {me.user.hasStripe && (
          <button
            type="button"
            onClick={billingPortal}
            disabled={loading !== null}
            className="rounded-full border border-ember-fire/50 bg-gradient-to-r from-ember-fire/20 to-ember-blood/20 px-5 py-3 text-[10px] font-semibold uppercase tracking-[0.28em] text-white shadow-ember-glow transition hover:from-ember-fire/35 hover:to-ember-blood/35 disabled:opacity-40"
          >
            {loading === 'portal' ? 'Opening…' : 'Manage Billing'}
          </button>
        )}
        <button
          type="button"
          onClick={() => onNavigate('/pricing')}
          className="rounded-full border border-white/10 bg-white/[0.03] px-5 py-3 text-[10px] uppercase tracking-[0.28em] text-white/70 hover:border-ember-gold/40 hover:text-white"
        >
          Change Plan
        </button>
        <button
          type="button"
          onClick={() => onNavigate('/history')}
          className="rounded-full border border-white/10 bg-white/[0.03] px-5 py-3 text-[10px] uppercase tracking-[0.28em] text-white/70 hover:border-ember-gold/40 hover:text-white"
        >
          History
        </button>
        <button
          type="button"
          onClick={signOut}
          disabled={loading !== null}
          className="ml-auto rounded-full border border-white/10 bg-white/[0.03] px-5 py-3 text-[10px] uppercase tracking-[0.28em] text-white/50 hover:border-ember-blood/40 hover:text-ember-blood disabled:opacity-40"
        >
          {loading === 'logout' ? 'Signing out…' : 'Sign Out'}
        </button>
      </div>
    </main>
  );
}

function TierBadge({ tier }: { tier: 'free' | 'pro' | 'max' }) {
  const color = tier === 'max' ? '#c81d25' : tier === 'pro' ? '#ff7a1f' : 'rgba(255,255,255,0.4)';
  return (
    <div
      className="inline-flex items-center gap-2 rounded-full border px-4 py-2 font-display text-xs font-semibold uppercase tracking-[0.32em]"
      style={{ borderColor: color, color, background: `${color}10` }}
    >
      <span className="h-1.5 w-1.5 rounded-full" style={{ background: color, boxShadow: `0 0 12px ${color}` }} />
      {tier}
    </div>
  );
}

function UsageCard({
  label,
  primary,
  secondary,
  ratio,
  warn,
  critical,
}: {
  label: string;
  primary: string;
  secondary: string;
  ratio: number;
  warn?: boolean;
  critical?: boolean;
}) {
  const color = critical ? '#c81d25' : warn ? '#ffb347' : '#ff7a1f';
  return (
    <GlassPanel edge className="p-5">
      <div className="font-mono text-[10px] uppercase tracking-[0.28em] text-white/45">{label}</div>
      <div
        className="mt-2 font-display text-3xl font-semibold tracking-tight"
        style={{ color: critical || warn ? color : '#fff' }}
      >
        {primary}
      </div>
      <div className="mt-0.5 font-mono text-[10px] uppercase tracking-[0.18em] text-white/35">
        {secondary}
      </div>
      <div className="mt-3 h-[3px] w-full overflow-hidden rounded-full bg-white/[0.04]">
        <div
          className="h-full rounded-full transition-all duration-500"
          style={{ width: `${Math.min(100, ratio * 100)}%`, background: color, boxShadow: `0 0 8px ${color}` }}
        />
      </div>
    </GlassPanel>
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

function Toggle({
  label,
  hint,
  on,
  onToggle,
}: {
  label: string;
  hint: string;
  on: boolean;
  onToggle: (v: boolean) => void;
}) {
  return (
    <button
      type="button"
      onClick={() => onToggle(!on)}
      className="flex items-start justify-between gap-4 text-left"
    >
      <div className="flex-1">
        <div className="font-display text-sm font-medium text-white">{label}</div>
        <div className="mt-0.5 text-xs text-white/45">{hint}</div>
      </div>
      <span
        className={`mt-1 inline-flex h-6 w-11 items-center rounded-full border transition ${
          on
            ? 'border-ember-fire/50 bg-gradient-to-r from-ember-fire/40 to-ember-blood/40 shadow-ember-glow'
            : 'border-white/10 bg-white/[0.05]'
        }`}
      >
        <span
          className={`inline-block h-4 w-4 transform rounded-full bg-white transition ${
            on ? 'translate-x-6' : 'translate-x-1'
          }`}
        />
      </span>
    </button>
  );
}
