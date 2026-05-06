import { useState } from 'react';
import { startCheckout, PRICES, type MeResponse } from '../lib/api';
import { GlassPanel } from './glass';

interface Props {
  me: MeResponse | null;
  onNavigate: (path: '/' | '/pricing' | '/account') => void;
}

export function Pricing({ me, onNavigate }: Props) {
  const [interval, setInterval] = useState<'monthly' | 'yearly'>('monthly');
  const [loading, setLoading] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const buy = async (priceId: string) => {
    setErr(null);
    setLoading(priceId);
    try {
      const url = await startCheckout(priceId, me?.user?.email);
      window.location.href = url;
    } catch (e) {
      setErr((e as Error).message);
      setLoading(null);
    }
  };

  return (
    <main className="relative z-10 mx-auto w-full max-w-6xl px-4 pb-24 pt-28 sm:px-6 sm:pt-32">
      <button
        type="button"
        onClick={() => onNavigate('/')}
        className="mb-8 text-[10px] uppercase tracking-[0.32em] text-white/40 hover:text-ember-gold"
      >
        ← Back to Forge
      </button>

      <header className="mb-10 text-center">
        <div className="mb-3 text-[10px] font-medium uppercase tracking-[0.4em] text-ember-gold/70">
          Pricing
        </div>
        <h1 className="wordmark text-glow text-4xl font-semibold leading-tight sm:text-5xl">
          Pay for the truth.
        </h1>
        <p className="mt-4 text-sm tracking-wide text-white/55 sm:text-base">
          One Forge. Three altitudes. Cancel anytime.
        </p>
      </header>

      {/* Interval toggle */}
      <div className="mb-12 flex items-center justify-center">
        <div className="inline-flex rounded-full border border-white/10 bg-white/[0.03] p-1">
          {(['monthly', 'yearly'] as const).map((i) => (
            <button
              key={i}
              type="button"
              onClick={() => setInterval(i)}
              className={`rounded-full px-4 py-2 text-[10px] uppercase tracking-[0.28em] transition ${
                interval === i
                  ? 'bg-gradient-to-r from-ember-fire/30 to-ember-blood/30 text-white shadow-ember-glow'
                  : 'text-white/45 hover:text-white'
              }`}
            >
              {i}
              {i === 'yearly' && (
                <span className="ml-2 text-ember-gold/80">−2 months</span>
              )}
            </button>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-1 gap-5 md:grid-cols-3">
        <TierCard
          name="Free"
          price="$0"
          interval=""
          accent="white"
          features={[
            '3 analyses per day',
            'Forensic AI breakdown',
            'Real provider detection',
            'Mythos watermark on results',
          ]}
          ctaLabel={me?.authenticated ? 'Current tier' : 'Sign in'}
          ctaDisabled={me?.authenticated && me.user?.tier === 'free'}
          onCta={() => onNavigate('/')}
        />
        <TierCard
          name="Pro"
          price={interval === 'monthly' ? '$19' : '$190'}
          interval={interval === 'monthly' ? '/ month' : '/ year'}
          subline={interval === 'yearly' ? '$15.83/mo billed yearly' : undefined}
          accent="fire"
          highlight
          features={[
            '100 analyses per day',
            'No watermarks',
            'Voice readout of verdicts',
            'Priority queue',
          ]}
          ctaLabel={loading === PRICES.pro[interval].id ? 'Redirecting…' : 'Subscribe'}
          ctaDisabled={loading !== null || me?.user?.tier === 'pro'}
          onCta={() => buy(PRICES.pro[interval].id)}
        />
        <TierCard
          name="Max"
          price={interval === 'monthly' ? '$79' : '$790'}
          interval={interval === 'monthly' ? '/ month' : '/ year'}
          subline={interval === 'yearly' ? '$65.83/mo billed yearly' : undefined}
          accent="blood"
          features={[
            '1,000 analyses per day',
            'Public API access',
            'Shareable verdict pages',
            'Voice readout (premium voice)',
            'Priority support',
          ]}
          ctaLabel={loading === PRICES.max[interval].id ? 'Redirecting…' : 'Subscribe'}
          ctaDisabled={loading !== null || me?.user?.tier === 'max'}
          onCta={() => buy(PRICES.max[interval].id)}
        />
      </div>

      {err && (
        <div className="mt-6 rounded-xl border border-ember-blood/30 bg-ember-blood/[0.06] px-4 py-3 text-sm text-ember-blood">
          {err}
        </div>
      )}

      <p className="mt-12 text-center font-mono text-[10px] uppercase tracking-[0.32em] text-white/30">
        Cancel anytime · 7-day refund · Stripe-secured
      </p>
    </main>
  );
}

interface TierCardProps {
  name: string;
  price: string;
  interval: string;
  subline?: string;
  accent: 'white' | 'fire' | 'blood';
  highlight?: boolean;
  features: string[];
  ctaLabel: string;
  ctaDisabled?: boolean;
  onCta: () => void;
}

function TierCard({
  name,
  price,
  interval,
  subline,
  accent,
  highlight,
  features,
  ctaLabel,
  ctaDisabled,
  onCta,
}: TierCardProps) {
  return (
    <GlassPanel
      hot={highlight}
      edge
      className={`flex flex-col gap-6 p-7 ${highlight ? 'md:scale-[1.02]' : ''}`}
    >
      <div>
        <div className="flex items-baseline justify-between">
          <h2 className="font-display text-xl font-semibold uppercase tracking-[0.22em] text-white">
            {name}
          </h2>
          {highlight && (
            <span className="rounded-full border border-ember-gold/40 bg-ember-gold/[0.08] px-2 py-0.5 text-[9px] uppercase tracking-[0.28em] text-ember-gold">
              Most popular
            </span>
          )}
        </div>
        <div className="mt-3 flex items-baseline gap-1">
          <span
            className={`font-display text-5xl font-semibold leading-none ${
              accent === 'fire'
                ? 'text-glow text-ember-gold'
                : accent === 'blood'
                ? 'text-glow text-ember-blood'
                : 'text-white'
            }`}
          >
            {price}
          </span>
          {interval && (
            <span className="text-sm tracking-wide text-white/40">{interval}</span>
          )}
        </div>
        {subline && <div className="mt-1 text-xs text-white/40">{subline}</div>}
      </div>

      <ul className="flex flex-col gap-2.5">
        {features.map((f, i) => (
          <li key={i} className="flex items-start gap-2 text-sm text-white/75">
            <span className="mt-2 h-1 w-1 shrink-0 rounded-full bg-ember-fire shadow-ember-glow" />
            {f}
          </li>
        ))}
      </ul>

      <button
        type="button"
        onClick={onCta}
        disabled={ctaDisabled}
        className={`mt-auto rounded-full px-5 py-3 text-[10px] font-semibold uppercase tracking-[0.28em] transition ${
          accent === 'white'
            ? 'border border-white/10 bg-white/[0.03] text-white/70 hover:border-white/25 hover:text-white'
            : 'border border-ember-fire/50 bg-gradient-to-r from-ember-fire/30 to-ember-blood/30 text-white shadow-ember-glow hover:from-ember-fire/45 hover:to-ember-blood/45'
        } disabled:opacity-40 disabled:cursor-not-allowed`}
      >
        {ctaLabel}
      </button>
    </GlassPanel>
  );
}
