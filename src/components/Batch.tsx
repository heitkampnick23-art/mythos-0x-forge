import { useEffect, useRef, useState } from 'react';
import {
  createBatch,
  downloadBatchCsv,
  fetchBatch,
  fetchMyBatches,
  type BatchItem,
  type BatchJob,
  type MeResponse,
} from '../lib/api';
import { GlassPanel } from './glass';

interface Props {
  me: MeResponse | null;
  onNavigate: (path: string) => void;
}

export function Batch({ me, onNavigate }: Props) {
  const [text, setText] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [job, setJob] = useState<BatchJob | null>(null);
  const [items, setItems] = useState<BatchItem[]>([]);
  const [history, setHistory] = useState<BatchJob[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const pollRef = useRef<number | null>(null);

  // Load history
  useEffect(() => {
    if (!me?.authenticated) return;
    fetchMyBatches()
      .then(setHistory)
      .catch(() => setHistory([]));
  }, [me?.authenticated]);

  // Poll the active job
  useEffect(() => {
    if (!activeId) return;
    let stopped = false;
    const tick = async () => {
      try {
        const r = await fetchBatch(activeId);
        if (stopped) return;
        setJob(r.job);
        setItems(r.items);
        if (r.job.status === 'done') {
          if (pollRef.current) window.clearInterval(pollRef.current);
        }
      } catch (e) {
        setErr((e as Error).message);
      }
    };
    void tick();
    pollRef.current = window.setInterval(tick, 2000);
    return () => {
      stopped = true;
      if (pollRef.current) window.clearInterval(pollRef.current);
    };
  }, [activeId]);

  if (!me?.authenticated) {
    return (
      <main className="relative z-10 mx-auto flex w-full max-w-3xl flex-col items-center px-4 pb-24 pt-32 text-center">
        <h1 className="font-display text-3xl font-semibold text-white">Sign in for Bulk Analysis</h1>
        <p className="mt-3 text-sm text-white/55">Bulk URL upload is a Max-tier feature.</p>
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

  const tier = me.user?.tier ?? 'free';
  const canSubmit = tier === 'max';

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErr(null);
    if (!canSubmit) {
      onNavigate('/pricing');
      return;
    }
    const urls = text
      .split('\n')
      .map((u) => u.trim())
      .filter(Boolean);
    if (urls.length === 0) {
      setErr('Paste at least one URL.');
      return;
    }
    setSubmitting(true);
    try {
      const r = await createBatch(urls);
      setActiveId(r.batch_id);
      setText('');
      // Refresh history
      fetchMyBatches()
        .then(setHistory)
        .catch(() => undefined);
    } catch (e) {
      const error = e as { detail?: string; message?: string; status?: number };
      if (error.status === 402) onNavigate('/pricing');
      else setErr(error.detail || error.message || 'Failed to start batch');
    } finally {
      setSubmitting(false);
    }
  };

  const progress = job ? (job.done + job.failed) / Math.max(1, job.total) : 0;

  return (
    <main className="relative z-10 mx-auto w-full max-w-5xl px-4 pb-24 pt-28 sm:px-6 sm:pt-32">
      <button
        type="button"
        onClick={() => onNavigate('/')}
        className="mb-6 text-[10px] uppercase tracking-[0.32em] text-white/40 hover:text-ember-gold"
      >
        ← Back to Forge
      </button>

      <header className="mb-8">
        <div className="text-[10px] font-medium uppercase tracking-[0.4em] text-ember-gold/70">
          Bulk Analysis · Max tier
        </div>
        <h1 className="wordmark text-glow mt-2 text-4xl font-semibold leading-tight sm:text-5xl">
          Forge Eye, at scale.
        </h1>
        <p className="mt-3 max-w-xl text-sm text-white/55">
          Paste up to 200 image URLs. We fetch each, run multi-model forensic analysis, and return a
          CSV — every row links to a sharable verdict page.
        </p>
      </header>

      {!canSubmit && (
        <GlassPanel edge className="mb-6 border-ember-gold/30 p-5">
          <p className="text-sm text-white/70">
            Bulk analysis is a Max-tier feature ($79/mo). Run unlimited single analyses on Free/Pro.
          </p>
          <button
            type="button"
            onClick={() => onNavigate('/pricing')}
            className="mt-3 rounded-full border border-ember-fire/50 bg-gradient-to-r from-ember-fire/30 to-ember-blood/30 px-5 py-2.5 text-[10px] font-semibold uppercase tracking-[0.28em] text-white shadow-ember-glow"
          >
            Upgrade to Max
          </button>
        </GlassPanel>
      )}

      {/* New batch form */}
      <form onSubmit={onSubmit}>
        <GlassPanel edge className="flex flex-col gap-4 p-6">
          <div>
            <div className="mb-2 flex items-center justify-between">
              <label className="font-mono text-[10px] uppercase tracking-[0.28em] text-ember-gold/70">
                Image URLs · one per line
              </label>
              <span className="font-mono text-[10px] uppercase tracking-[0.22em] text-white/35">
                {text.split('\n').filter((s) => s.trim()).length} / 200
              </span>
            </div>
            <textarea
              rows={8}
              value={text}
              onChange={(e) => setText(e.target.value)}
              disabled={!canSubmit || submitting}
              placeholder={'https://example.com/image1.jpg\nhttps://example.com/image2.png\n...'}
              className="w-full resize-y rounded-xl border border-white/10 bg-black/40 px-4 py-3 font-mono text-[12px] leading-relaxed text-white placeholder:text-white/30 focus:border-ember-fire/50 focus:outline-none disabled:opacity-50"
            />
          </div>
          {err && <div className="text-sm text-ember-blood">{err}</div>}
          <div className="flex items-center justify-between">
            <span className="font-mono text-[10px] uppercase tracking-[0.22em] text-white/40">
              Each URL counts toward your daily 1,000-analysis limit
            </span>
            <button
              type="submit"
              disabled={!canSubmit || submitting || !text.trim()}
              className="rounded-full border border-ember-fire/50 bg-gradient-to-r from-ember-fire/30 to-ember-blood/30 px-5 py-2.5 text-[10px] font-semibold uppercase tracking-[0.28em] text-white shadow-ember-glow transition hover:from-ember-fire/45 hover:to-ember-blood/45 disabled:opacity-40"
            >
              {submitting ? 'Queueing…' : 'Run Batch'}
            </button>
          </div>
        </GlassPanel>
      </form>

      {/* Active job */}
      {job && (
        <GlassPanel hot edge className="mt-6 p-6">
          <div className="mb-3 flex items-center justify-between">
            <div>
              <h2 className="font-display text-lg font-semibold text-white">Batch {job.id}</h2>
              <div className="mt-1 font-mono text-[10px] uppercase tracking-[0.22em] text-white/45">
                {job.status} · {job.done} done · {job.failed} failed · {job.total} total
              </div>
            </div>
            {job.status === 'done' && (
              <button
                type="button"
                onClick={() => downloadBatchCsv(job.id)}
                className="rounded-full border border-ember-fire/40 bg-ember-fire/[0.08] px-4 py-2 text-[10px] uppercase tracking-[0.28em] text-ember-gold transition hover:bg-ember-fire/15 hover:shadow-ember-glow"
              >
                Download CSV
              </button>
            )}
          </div>
          <div className="mb-5 h-[3px] w-full overflow-hidden rounded-full bg-white/[0.04]">
            <div
              className="h-full rounded-full bg-gradient-to-r from-ember-gold via-ember-fire to-ember-blood transition-all duration-500"
              style={{ width: `${Math.min(100, progress * 100)}%` }}
            />
          </div>
          <div className="max-h-[400px] overflow-y-auto">
            {items.map((it) => (
              <ItemRow key={it.id} item={it} />
            ))}
          </div>
        </GlassPanel>
      )}

      {/* History */}
      {history && history.length > 0 && (
        <section className="mt-10">
          <h2 className="mb-4 font-mono text-[10px] uppercase tracking-[0.32em] text-ember-gold/70">
            Recent Batches
          </h2>
          <GlassPanel edge>
            <ul className="divide-y divide-white/[0.05]">
              {history.map((j) => (
                <li
                  key={j.id}
                  className="flex items-center gap-3 px-5 py-3 hover:bg-white/[0.02]"
                >
                  <span
                    className={`h-2 w-2 shrink-0 rounded-full ${
                      j.status === 'done'
                        ? 'bg-ember-gold shadow-ember-glow'
                        : j.status === 'processing'
                        ? 'animate-pulse bg-ember-fire'
                        : 'bg-white/30'
                    }`}
                  />
                  <button
                    type="button"
                    onClick={() => setActiveId(j.id)}
                    className="min-w-0 flex-1 text-left"
                  >
                    <div className="truncate font-mono text-[11px] uppercase tracking-[0.18em] text-white/65">
                      {j.id}
                    </div>
                    <div className="mt-0.5 text-[12px] text-white/45">
                      {j.done}/{j.total} done {j.failed > 0 && `· ${j.failed} failed`} ·{' '}
                      {new Date(j.created_at * 1000).toLocaleString()}
                    </div>
                  </button>
                  {j.status === 'done' && (
                    <button
                      type="button"
                      onClick={() => downloadBatchCsv(j.id)}
                      className="font-mono text-[10px] uppercase tracking-[0.22em] text-white/45 hover:text-ember-gold"
                    >
                      CSV
                    </button>
                  )}
                </li>
              ))}
            </ul>
          </GlassPanel>
        </section>
      )}
    </main>
  );
}

function ItemRow({ item }: { item: BatchItem }) {
  const color =
    item.verdict === 'synthetic'
      ? '#c81d25'
      : item.verdict === 'suspect'
      ? '#ffb347'
      : item.verdict === 'authentic'
      ? '#7be3a4'
      : 'rgba(255,255,255,0.3)';
  const pct = item.confidence !== null ? Math.round(item.confidence * 100) : null;
  return (
    <div className="flex items-center gap-3 border-b border-white/[0.04] py-2 last:border-0">
      <span
        className={`h-1.5 w-1.5 shrink-0 rounded-full ${
          item.status === 'pending' ? 'animate-pulse bg-ember-fire' : ''
        }`}
        style={
          item.status !== 'pending'
            ? { background: color, boxShadow: item.status === 'done' ? `0 0 8px ${color}` : 'none' }
            : undefined
        }
      />
      <span className="w-12 shrink-0 font-mono text-[10px] uppercase tracking-[0.18em] text-white/35">
        #{item.position + 1}
      </span>
      <a
        href={item.url}
        target="_blank"
        rel="noopener"
        className="min-w-0 flex-1 truncate font-mono text-[11px] text-white/55 hover:text-ember-gold"
      >
        {item.url}
      </a>
      <span
        className="shrink-0 font-display text-[12px] font-semibold"
        style={{ color }}
      >
        {item.status === 'failed'
          ? 'failed'
          : item.status === 'pending'
          ? '…'
          : `${pct}% ${item.verdict}`}
      </span>
      {item.share_slug && (
        <a
          href={`/v/${item.share_slug}`}
          target="_blank"
          rel="noopener"
          className="shrink-0 font-mono text-[10px] uppercase tracking-[0.22em] text-white/35 hover:text-ember-gold"
        >
          view
        </a>
      )}
    </div>
  );
}
