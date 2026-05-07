-- Heartbeat KB documents — text uploaded to a Soul as retrievable knowledge.
-- Vector chunks live in Cloudflare Vectorize, but doc-level metadata stays
-- in D1 so we can list / delete / cap.

CREATE TABLE IF NOT EXISTS soul_kb_docs (
  id TEXT PRIMARY KEY,
  soul_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  filename TEXT NOT NULL,
  content_type TEXT NOT NULL,
  size_bytes INTEGER NOT NULL,
  r2_key TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'processing',  -- processing | indexed | failed
  chunk_count INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  FOREIGN KEY (soul_id) REFERENCES souls(id),
  FOREIGN KEY (user_id) REFERENCES users(id)
);

CREATE INDEX IF NOT EXISTS idx_kbdocs_soul ON soul_kb_docs(soul_id);
CREATE INDEX IF NOT EXISTS idx_kbdocs_user ON soul_kb_docs(user_id);
