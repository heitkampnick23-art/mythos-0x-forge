import { useEffect, useState } from 'react';
import {
  fetchMarketplace,
  fetchMine,
  type SoulOwner,
  type SoulPublic,
} from '../../lib/heartbeat';
import type { MeResponse } from '../../lib/api';
import { GlassPanel } from '../glass';

interface Props {
  me: MeResponse | null;
  onOpen: (idOrSlug: string) => void;
  onCreate: () => void;
}

export function Marketplace({ me, onOpen, onCreate }: Props) {
  const [marketplace, setMarketplace] = useState<SoulPublic[] | null>(null);
  const [mine, setMine] = useState<SoulOwner[] | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    fetchMarketplace()
      .then(setMarketplace)
      .catch((e) => setErr((e as Error).message));
    if (me?.authenticated) {
      fetchMine()
        .then(setMine)
        .catch(() => setMine([]));
    }
  }, [me?.authenticated]);

  const tier = me?.user?.tier ?? 'free';
  const canCreate = tier !== 'free';

  return (
    <main className="relative z-10 mx-auto w-full max-w-6xl px-4 pb-24 pt-28 sm:px-6 sm:pt-32">
      <header className="mb-10 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <div className="mb-2 text-[10px] font-medium uppercase tracking-[0.4em] text-ember-gold/70">
            Heartbeat
          </div>
          <h1 className="wordmark text-glow text-4xl font-semibold leading-tight sm:text-5xl">
            Voice agents with souls.
          </h1>
          <p className="mt-3 max-w-xl text-sm tracking-wide text-white/55 sm:text-base">
            Build, deploy, and remix AI personas that talk back. Powered by Claude + ElevenLabs.
          </p>
        </div>
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={onCreate}
            disabled={!canCreate}
            className="rounded-full border border-ember-fire/50 bg-gradient-to-r from-ember-fire/30 to-ember-blood/30 px-5 py-3 text-[10px] font-semibold uppercase tracking-[0.28em] text-white shadow-ember-glow transition hover:from-ember-fire/45 hover:to-ember-blood/45 disabled:opacity-40"
          >
            {canCreate ? 'Forge a Soul' : 'Pro+ to forge'}
          </button>
        </div>
      </header>

      {err && (
        <GlassPanel edge className="mb-6 border-ember-blood/30 p-4 text-sm text-ember-blood">
          {err}
        </GlassPanel>
      )}

      {mine && mine.length > 0 && (
        <section className="mb-12">
          <h2 className="mb-4 font-mono text-[10px] uppercase tracking-[0.32em] text-ember-gold/70">
            Your Souls
          </h2>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 md:grid-cols-3">
            {mine.map((s) => (
              <SoulCard key={s.id} soul={s} onOpen={onOpen} owned />
            ))}
          </div>
        </section>
      )}

      <section>
        <h2 className="mb-4 font-mono text-[10px] uppercase tracking-[0.32em] text-ember-gold/70">
          Marketplace
        </h2>
        {marketplace === null && !err && (
          <div className="font-mono text-xs uppercase tracking-[0.3em] text-white/35">
            Loading souls…
          </div>
        )}
        {marketplace && marketplace.length === 0 && (
          <GlassPanel edge className="p-7 text-center text-sm text-white/55">
            No public Souls yet. Forge yours and ship it to the marketplace.
          </GlassPanel>
        )}
        {marketplace && marketplace.length > 0 && (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 md:grid-cols-3">
            {marketplace.map((s) => (
              <SoulCard key={s.id} soul={s} onOpen={onOpen} />
            ))}
          </div>
        )}
      </section>
    </main>
  );
}

function SoulCard({
  soul,
  onOpen,
  owned,
}: {
  soul: SoulPublic;
  onOpen: (idOrSlug: string) => void;
  owned?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={() => onOpen(soul.slug ?? soul.id)}
      className="group text-left"
    >
      <GlassPanel
        edge
        className="flex h-full flex-col gap-3 p-5 transition hover:border-ember-fire/40 hover:shadow-[0_0_48px_-16px_rgba(255,122,31,0.4)]"
      >
        <div className="flex items-start justify-between gap-2">
          <h3 className="font-display text-lg font-semibold tracking-tight text-white group-hover:text-ember-gold">
            {soul.name}
          </h3>
          {owned && (
            <span className="rounded-full border border-ember-gold/40 bg-ember-gold/[0.08] px-2 py-0.5 text-[8px] uppercase tracking-[0.28em] text-ember-gold">
              Yours
            </span>
          )}
        </div>
        {soul.tagline && (
          <p className="text-[13px] leading-relaxed text-white/60 line-clamp-3">
            {soul.tagline}
          </p>
        )}
        <div className="mt-auto flex items-center justify-between font-mono text-[10px] uppercase tracking-[0.22em] text-white/35">
          <span className="flex items-center gap-1.5">
            <span className="h-1 w-1 rounded-full bg-ember-fire shadow-ember-glow" />
            {soul.voice_label}
          </span>
          <span>
            {soul.chat_count.toLocaleString()} chats
            {soul.remix_count > 0 && ` · ${soul.remix_count} remixes`}
          </span>
        </div>
      </GlassPanel>
    </button>
  );
}
