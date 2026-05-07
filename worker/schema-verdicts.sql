-- Persist full analysis state so we can render public verdict pages and
-- generate court-ready PDF reports on demand.

ALTER TABLE analyses ADD COLUMN share_slug TEXT;
ALTER TABLE analyses ADD COLUMN public INTEGER NOT NULL DEFAULT 0;
ALTER TABLE analyses ADD COLUMN sha256 TEXT;
ALTER TABLE analyses ADD COLUMN findings_json TEXT;
ALTER TABLE analyses ADD COLUMN boxes_json TEXT;
ALTER TABLE analyses ADD COLUMN original_name TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS idx_analyses_share_slug ON analyses(share_slug);
CREATE INDEX IF NOT EXISTS idx_analyses_public ON analyses(public, created_at DESC);
