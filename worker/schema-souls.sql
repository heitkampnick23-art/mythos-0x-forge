-- Heartbeat: voice agents ("Souls") on top of Mythos 0X Forge.

CREATE TABLE IF NOT EXISTS souls (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  name TEXT NOT NULL,
  tagline TEXT NOT NULL DEFAULT '',
  system_prompt TEXT NOT NULL,
  first_message TEXT NOT NULL DEFAULT 'Hello.',
  voice_id TEXT NOT NULL,
  voice_label TEXT NOT NULL DEFAULT '',
  -- Public souls are discoverable in the marketplace and remixable.
  public INTEGER NOT NULL DEFAULT 0,
  remixed_from TEXT,
  -- For sharable URLs: /agents/<slug> is friendlier than the id.
  slug TEXT UNIQUE,
  -- Stats for marketplace ranking
  chat_count INTEGER NOT NULL DEFAULT 0,
  remix_count INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  FOREIGN KEY (user_id) REFERENCES users(id)
);

CREATE INDEX IF NOT EXISTS idx_souls_user ON souls(user_id);
CREATE INDEX IF NOT EXISTS idx_souls_public ON souls(public, chat_count DESC);
CREATE INDEX IF NOT EXISTS idx_souls_slug ON souls(slug);

-- Conversation messages — one row per turn (user or assistant).
CREATE TABLE IF NOT EXISTS soul_messages (
  id TEXT PRIMARY KEY,
  soul_id TEXT NOT NULL,
  session_id TEXT NOT NULL,
  user_id TEXT,
  role TEXT NOT NULL,                          -- 'user' | 'assistant'
  content TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  FOREIGN KEY (soul_id) REFERENCES souls(id)
);

CREATE INDEX IF NOT EXISTS idx_msgs_session ON soul_messages(session_id, created_at);
CREATE INDEX IF NOT EXISTS idx_msgs_user ON soul_messages(user_id, created_at DESC);

-- Per-day chat-minute counter for tier limits (separate from analyses).
CREATE TABLE IF NOT EXISTS soul_usage_daily (
  identity TEXT NOT NULL,
  day TEXT NOT NULL,
  message_count INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (identity, day)
);
