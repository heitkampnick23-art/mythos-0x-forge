import { useState } from 'react';
import { logout, openBillingPortal, type MeResponse } from '../lib/api';
import { GlassPanel } from './glass';

interface Props {
  me: MeResponse | null;
  onRefresh: () => void;
  onNavigate: (path: '/' | '/pricing' | '/account') => void;
}

export function Account({ me, onRefresh, onNavigate }: Props) {
  const [loading, setLoading] = useState<string | null>(null);

  if (!me?.authenticated || !me.user) {
    return (
      <main className="relative z-10 mx-auto flex w-full max-w-3xl flex-col items-center px-4 pb-24 pt-32 text-center">
        <h1 className="font-display text-3xl font-semibold text-white">Not signed in</h1>
        <p className="mt-3 text-sm text-white/55">
          Use the Sign in button up top to enter the Forge.
        </p>
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

  return (
    <main className="relative z-10 mx-auto w-full max-w-3xl px-4 pb-24 pt-28 sm:px-6 sm:pt-32">
      <button
        type="button"
        onClick={() => onNavigate('/')}
        className="mb-8 text-[10px] uppercase tracking-[0.32em] text-white/40 hover:text-ember-gold"
      >
        ← Back to Forge
      </button>

      <h1 className="wordmark text-glow text-4xl font-semibold leading-tight">Your Forge</h1>

      <GlassPanel edge className="mt-8 flex flex-col gap-5 p-7">
        <Row label="Email" value={me.user.email} />
        <Row
          label="Tier"
          value={
            <span className="font-display text-xl font-semibold uppercase tracking-[0.22em] text-ember-gold">
              {me.user.tier}
            </span>
          }
        />
        <Row
          label="Daily limit"
          value={`${me.limits[me.user.tier]} analyses/day`}
        />
      </GlassPanel>

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

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-4">
      <span className="font-mono text-[10px] uppercase tracking-[0.28em] text-white/40">
        {label}
      </span>
      <span className="text-right text-sm text-white/85">{value}</span>
    </div>
  );
}
