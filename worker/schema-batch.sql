-- Bulk URL analysis — Max-tier B2B feature.
-- A "batch" is a job containing N URLs to analyze. Worker fetches each URL,
-- runs detection, persists each result as an analysis row (so each gets its
-- own /v/<slug> page), tracks completion in D1.

CREATE TABLE IF NOT EXISTS batch_jobs (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  total INTEGER NOT NULL,
  done INTEGER NOT NULL DEFAULT 0,
  failed INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'queued',  -- queued | processing | done
  created_at INTEGER NOT NULL,
  completed_at INTEGER,
  FOREIGN KEY (user_id) REFERENCES users(id)
);

CREATE INDEX IF NOT EXISTS idx_batch_user ON batch_jobs(user_id, created_at DESC);

CREATE TABLE IF NOT EXISTS batch_items (
  id TEXT PRIMARY KEY,
  batch_id TEXT NOT NULL,
  position INTEGER NOT NULL,
  url TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',  -- pending | done | failed
  analysis_id TEXT,
  share_slug TEXT,
  confidence REAL,
  verdict TEXT,
  error TEXT,
  created_at INTEGER NOT NULL,
  completed_at INTEGER,
  FOREIGN KEY (batch_id) REFERENCES batch_jobs(id)
);

CREATE INDEX IF NOT EXISTS idx_items_batch ON batch_items(batch_id, position);
