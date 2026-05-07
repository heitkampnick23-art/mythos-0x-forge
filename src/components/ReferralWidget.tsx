import { useEffect, useState } from 'react';
import { fetchReferralStats, type ReferralStats } from '../lib/api';
import { GlassPanel } from './glass';

/** Account-page widget: share link + signups + cents owed. 20% recurring,
 *  paid manually for v0. */
export function ReferralWidget() {
  const [stats, setStats] = useState<ReferralStats | null>(null);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchReferralStats()
      .then(setStats)
      .catch((e) => setError(e.message ?? 'failed_to_load'));
  }, []);

  if (error) return null; // Keep account page clean if endpoint hiccups
  const link = stats ? `https://mythos0x.com/?ref=${stats.code}` : '';

  return (
    <GlassPanel className="mb-8 p-6">
      <div className="mb-4 flex items-baseline justify-between">
        <h2 className="font-display text-xl font-semibold text-white">Refer & earn</h2>
        <span className="text-[10px] uppercase tracking-[0.28em] text-white/40">
          20% recurring
        </span>
      </div>
      <p className="mb-4 text-sm text-white/60">
        Share your link. When someone you refer subscribes, you earn 20% of every
        recurring payment for as long as they stay.
      </p>

      <div className="mb-5 flex items-center gap-2 rounded-lg border border-white/10 bg-black/40 px-3 py-2">
        <code className="flex-1 truncate text-xs text-white/80">{link || '—'}</code>
        <button
          type="button"
          onClick={() => {
            if (!link) return;
            navigator.clipboard.writeText(link).then(() => {
              setCopied(true);
              setTimeout(() => setCopied(false), 1500);
            });
          }}
          disabled={!link}
          className="rounded-full border border-white/10 px-4 py-1.5 text-[10px] uppercase tracking-[0.28em] text-white/70 hover:border-ember-amber/40 hover:text-ember-amber disabled:opacity-40"
        >
          {copied ? 'Copied' : 'Copy'}
        </button>
      </div>

      <div className="grid grid-cols-3 gap-3">
        <Stat label="Signed up" value={stats?.signed_up ?? 0} />
        <Stat label="Paying" value={stats?.paid ?? 0} />
        <Stat label="Owed" value={`$${((stats?.cents_owed ?? 0) / 100).toFixed(2)}`} />
      </div>
    </GlassPanel>
  );
}

function Stat({ label, value }: { label: string; value: number | string }) {
  return (
    <div className="rounded-lg border border-white/5 bg-white/[0.02] px-3 py-3">
      <div className="font-display text-2xl font-semibold text-white">{value}</div>
      <div className="mt-0.5 text-[10px] uppercase tracking-[0.24em] text-white/40">{label}</div>
    </div>
  );
}
