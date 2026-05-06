-- Mythos 0X Forge — D1 schema
-- Single source of truth for users, subscriptions, and per-day usage.

CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,                          -- nanoid
  email TEXT UNIQUE NOT NULL,
  stripe_customer_id TEXT UNIQUE,
  tier TEXT NOT NULL DEFAULT 'free',            -- 'free' | 'pro' | 'max'
  created_at INTEGER NOT NULL,                  -- unix seconds
  last_seen_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_users_stripe_customer ON users(stripe_customer_id);

CREATE TABLE IF NOT EXISTS subscriptions (
  id TEXT PRIMARY KEY,                          -- Stripe subscription ID (sub_…)
  user_id TEXT NOT NULL,
  stripe_customer_id TEXT NOT NULL,
  status TEXT NOT NULL,                         -- active | past_due | canceled | etc.
  price_id TEXT NOT NULL,                       -- Stripe price ID
  tier TEXT NOT NULL,                           -- 'pro' | 'max'
  interval TEXT NOT NULL,                       -- 'month' | 'year'
  current_period_end INTEGER NOT NULL,          -- unix seconds
  cancel_at_period_end INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  FOREIGN KEY (user_id) REFERENCES users(id)
);

CREATE INDEX IF NOT EXISTS idx_subs_user ON subscriptions(user_id);
CREATE INDEX IF NOT EXISTS idx_subs_status ON subscriptions(status);

-- Per-day usage counter. Identity is either a user_id (signed-in) or an
-- anon hash (sha256 of IP + day) so the same body sees a stable counter.
CREATE TABLE IF NOT EXISTS usage_daily (
  identity TEXT NOT NULL,                       -- 'user:<id>' or 'anon:<sha>'
  day TEXT NOT NULL,                            -- 'YYYY-MM-DD' UTC
  count INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (identity, day)
);

-- Append-only log of analyses for history pages and abuse review.
CREATE TABLE IF NOT EXISTS analyses (
  id TEXT PRIMARY KEY,                          -- nanoid
  user_id TEXT,                                 -- nullable for anon
  identity TEXT NOT NULL,                       -- same as usage_daily
  kind TEXT NOT NULL,                           -- 'image' | 'video'
  confidence REAL NOT NULL,
  verdict TEXT NOT NULL,
  model_tag TEXT NOT NULL,
  duration_ms INTEGER NOT NULL,
  r2_key TEXT,                                  -- for re-display / public verdict pages
  created_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_analyses_user ON analyses(user_id);
CREATE INDEX IF NOT EXISTS idx_analyses_created ON analyses(created_at DESC);

-- Magic-link auth tokens (single-use, ~15 min TTL).
CREATE TABLE IF NOT EXISTS magic_tokens (
  token TEXT PRIMARY KEY,                       -- 32-byte hex
  email TEXT NOT NULL,
  expires_at INTEGER NOT NULL,
  consumed_at INTEGER,
  created_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_magic_email ON magic_tokens(email);

-- Sessions: opaque cookies → user lookup. ~30 day TTL.
CREATE TABLE IF NOT EXISTS sessions (
  token TEXT PRIMARY KEY,                       -- 32-byte hex
  user_id TEXT NOT NULL,
  expires_at INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  FOREIGN KEY (user_id) REFERENCES users(id)
);

CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);
