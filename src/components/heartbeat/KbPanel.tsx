import { useEffect, useRef, useState } from 'react';
import { deleteKbDoc, fetchKbDocs, uploadKbDoc, type KbDoc } from '../../lib/heartbeat';
import { GlassPanel } from '../glass';

interface Props {
  soulIdOrSlug: string;
  onUpgrade: () => void;
}

export function KbPanel({ soulIdOrSlug, onUpgrade }: Props) {
  const [docs, setDocs] = useState<KbDoc[] | null>(null);
  const [open, setOpen] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const refresh = async () => {
    try {
      setDocs(await fetchKbDocs(soulIdOrSlug));
    } catch {
      setDocs([]);
    }
  };

  useEffect(() => {
    if (open) void refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const onUpload = async (file: File) => {
    setErr(null);
    setUploading(true);
    try {
      await uploadKbDoc(soulIdOrSlug, file);
      await refresh();
    } catch (e) {
      const error = e as { status?: number; detail?: string; message?: string };
      if (error.status === 402) {
        onUpgrade();
      } else {
        setErr(error.detail || error.message || 'Upload failed');
      }
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  };

  const onRemove = async (id: string) => {
    if (!confirm('Remove this document? Its embeddings will be deleted.')) return;
    try {
      await deleteKbDoc(soulIdOrSlug, id);
      await refresh();
    } catch (e) {
      setErr((e as Error).message);
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
            Knowledge Base
          </div>
          <div className="mt-0.5 text-[12px] text-white/55">
            {docs === null
              ? 'Tap to expand'
              : docs.length === 0
              ? 'No documents — upload .txt/.md to ground replies'
              : `${docs.length} doc${docs.length === 1 ? '' : 's'} indexed`}
          </div>
        </div>
        <span
          className={`font-mono text-xs text-white/35 transition ${open ? 'rotate-90' : ''}`}
        >
          ›
        </span>
      </button>

      {open && (
        <GlassPanel edge className="mt-2 flex flex-col gap-3 p-4">
          {docs === null ? (
            <div className="font-mono text-[10px] uppercase tracking-[0.3em] text-white/35">
              Loading…
            </div>
          ) : (
            <>
              {docs.length === 0 && (
                <p className="text-[12px] leading-relaxed text-white/55">
                  Upload a <code className="rounded bg-white/[0.05] px-1 text-ember-gold">.txt</code>{' '}
                  or <code className="rounded bg-white/[0.05] px-1 text-ember-gold">.md</code> file
                  (Pro: ≤1 MB, Max: ≤10 MB). The Soul will retrieve relevant chunks at chat time
                  and ground replies in your content. PDFs coming in v1.
                </p>
              )}
              {docs.map((d) => (
                <div
                  key={d.id}
                  className="flex items-center gap-3 rounded-xl border border-white/[0.06] bg-white/[0.02] px-3 py-2"
                >
                  <span
                    className={`h-1.5 w-1.5 shrink-0 rounded-full ${
                      d.status === 'indexed'
                        ? 'bg-ember-gold shadow-ember-glow'
                        : d.status === 'processing'
                        ? 'animate-pulse bg-ember-fire'
                        : 'bg-ember-blood'
                    }`}
                  />
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-[13px] text-white/85">{d.filename}</div>
                    <div className="mt-0.5 font-mono text-[9px] uppercase tracking-[0.18em] text-white/35">
                      {d.status} · {d.chunk_count} chunks · {(d.size_bytes / 1024).toFixed(1)} KB
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => onRemove(d.id)}
                    className="font-mono text-[9px] uppercase tracking-[0.22em] text-white/40 hover:text-ember-blood"
                  >
                    Remove
                  </button>
                </div>
              ))}

              <input
                ref={fileRef}
                type="file"
                accept=".txt,.md,text/plain,text/markdown"
                className="hidden"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) void onUpload(f);
                }}
              />
              <button
                type="button"
                disabled={uploading}
                onClick={() => fileRef.current?.click()}
                className="rounded-full border border-ember-fire/40 bg-ember-fire/[0.08] px-4 py-2 text-[10px] font-semibold uppercase tracking-[0.28em] text-ember-gold transition hover:bg-ember-fire/15 hover:shadow-ember-glow disabled:opacity-50"
              >
                {uploading ? 'Indexing…' : 'Upload Document'}
              </button>
              {err && (
                <div className="text-[11px] text-ember-blood">{err}</div>
              )}
            </>
          )}
        </GlassPanel>
      )}
    </div>
  );
}
