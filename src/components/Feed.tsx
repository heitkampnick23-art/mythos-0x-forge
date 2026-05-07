import { useCallback, useEffect, useState } from 'react';
import { fetchFeed, verdictMediaUrl, type RecentVerdict } from '../lib/api';

interface Props {
  onNavigate: (path: string) => void;
}

const VERDICT_COLOR: Record<RecentVerdict['verdict'], string> = {
  authentic: '#7be3a4',
  suspect: '#ffb347',
  synthetic: '#c81d25',
};

type Filter = 'all' | RecentVerdict['verdict'];

export function Feed({ onNavigate }: Props) {
  const [items, setItems] = useState<RecentVerdict[]>([]);
  const [nextBefore, setNextBefore] = useState<number | null>(null);
  const [hasMore, setHasMore] = useState(true);
  const [loading, setLoading] = useState(false);
  const [filter, setFilter] = useState<Filter>('all');
  const [error, setError] = useState<string | null>(null);

  const loadPage = useCallback(
    async (before: number | undefined, currentFilter: Filter, append: boolean) => {
      setLoading(true);
      setError(null);
      try {
        const res = await fetchFeed({
          before,
          verdict: currentFilter === 'all' ? undefined : currentFilter,
          limit: 24,
        });
        setItems((prev) => (append ? [...prev, ...res.verdicts] : res.verdicts));
        setNextBefore(res.next_before);
        setHasMore(res.next_before !== null);
      } catch (e) {
        setError((e as Error).message ?? 'Failed to load feed');
      } finally {
        setLoading(false);
      }
    },
    [],
  );

  useEffect(() => {
    void loadPage(undefined, filter, false);
  }, [filter, loadPage]);

  return (
    <main className="relative z-10 mx-auto w-full max-w-7xl px-4 py-12 sm:px-6">
      <header className="mb-8 flex flex-col gap-3">
        <h1 className="font-display text-4xl font-semibold text-white">Public verdicts</h1>
        <p className="text-sm text-white/60">
          Every analysis users have chosen to share. Click any tile to see the full forensic
          breakdown — bounding boxes, model agreement, and the court-format report.
        </p>
        <div className="mt-2 flex flex-wrap gap-2">
          {(['all', 'synthetic', 'suspect', 'authentic'] as Filter[]).map((f) => (
            <button
              key={f}
              type="button"
              onClick={() => setFilter(f)}
              className={`rounded-full border px-4 py-1.5 text-[10px] uppercase tracking-[0.28em] transition ${
                filter === f
                  ? 'border-ember-amber/60 bg-ember-amber/10 text-ember-amber'
                  : 'border-white/10 bg-white/[0.02] text-white/55 hover:border-white/20 hover:text-white/80'
              }`}
            >
              {f}
            </button>
          ))}
        </div>
      </header>

      {error && (
        <div className="mb-6 rounded-lg border border-ember-blood/40 bg-ember-blood/10 px-4 py-3 text-sm text-ember-blood">
          {error}
        </div>
      )}

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6">
        {items.map((v) => (
          <FeedTile key={v.share_slug} verdict={v} onClick={() => onNavigate(`/v/${v.share_slug}`)} />
        ))}
      </div>

      {items.length === 0 && !loading && !error && (
        <div className="rounded-lg border border-white/10 bg-white/[0.02] px-6 py-12 text-center text-sm text-white/50">
          No public verdicts yet for this filter.
        </div>
      )}

      <div className="mt-10 flex justify-center">
        {hasMore && (
          <button
            type="button"
            onClick={() => loadPage(nextBefore ?? undefined, filter, true)}
            disabled={loading}
            className="rounded-full border border-white/10 bg-white/[0.03] px-6 py-2 text-[10px] uppercase tracking-[0.28em] text-white/70 hover:border-ember-amber/40 hover:text-ember-amber disabled:opacity-40"
          >
            {loading ? 'Loading…' : 'Load more'}
          </button>
        )}
      </div>
    </main>
  );
}

function FeedTile({ verdict, onClick }: { verdict: RecentVerdict; onClick: () => void }) {
  const pct = Math.round(verdict.confidence * 100);
  const color = VERDICT_COLOR[verdict.verdict];
  const [imgError, setImgError] = useState(false);
  return (
    <button
      type="button"
      onClick={onClick}
      className="group relative aspect-square overflow-hidden rounded-lg border border-white/[0.06] bg-black/40 transition hover:border-ember-fire/40"
    >
      {verdict.kind === 'image' && !imgError ? (
        <img
          src={verdictMediaUrl(verdict.share_slug)}
          alt={verdict.original_name ?? 'verdict'}
          loading="lazy"
          onError={() => setImgError(true)}
          className="absolute inset-0 h-full w-full object-cover opacity-70 transition group-hover:opacity-90"
        />
      ) : (
        <div className="absolute inset-0 bg-gradient-to-br from-white/[0.04] to-transparent" />
      )}
      <div className="absolute inset-0 bg-gradient-to-t from-black/85 via-black/30 to-transparent" />
      <div className="absolute inset-x-2 bottom-2 flex items-center gap-2">
        <span
          className="h-1.5 w-1.5 rounded-full"
          style={{ background: color, boxShadow: `0 0 8px ${color}` }}
        />
        <span className="font-display text-sm font-semibold" style={{ color }}>
          {pct}%
        </span>
        <span className="ml-auto font-mono text-[9px] uppercase tracking-[0.18em] text-white/70">
          {verdict.verdict}
        </span>
      </div>
    </button>
  );
}
