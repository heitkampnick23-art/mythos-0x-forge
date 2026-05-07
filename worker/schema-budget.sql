-- User profile + cost-tracking schema additions.

-- Profile columns (idempotent ALTERs since SQLite doesn't have ADD COLUMN IF NOT EXISTS;
-- D1 errors on duplicate columns are caught by wrangler and skipped on re-run).
ALTER TABLE users ADD COLUMN display_name TEXT;
ALTER TABLE users ADD COLUMN default_voice_id TEXT NOT NULL DEFAULT 'pNInz6obpgDQGcFmaJgB';
ALTER TABLE users ADD COLUMN auto_speak INTEGER NOT NULL DEFAULT 1;
ALTER TABLE users ADD COLUMN notify_email INTEGER NOT NULL DEFAULT 1;

-- Per-day cost rollup (silent margin protection). Identity is user:<id> for
-- signed-in users, anon:<sha> for anon. Cost is in micro-cents (1/100 of a
-- cent) for integer math; convert to dollars at display time.
CREATE TABLE IF NOT EXISTS user_budget_daily (
  identity TEXT NOT NULL,
  day TEXT NOT NULL,                            -- 'YYYY-MM-DD' UTC
  -- Per-provider counters
  sightengine_ops INTEGER NOT NULL DEFAULT 0,
  anthropic_in_tokens INTEGER NOT NULL DEFAULT 0,
  anthropic_out_tokens INTEGER NOT NULL DEFAULT 0,
  elevenlabs_chars INTEGER NOT NULL DEFAULT 0,
  -- Total estimated cost in micro-cents
  est_cost_microcents INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (identity, day)
);

CREATE INDEX IF NOT EXISTS idx_budget_day ON user_budget_daily(day);
