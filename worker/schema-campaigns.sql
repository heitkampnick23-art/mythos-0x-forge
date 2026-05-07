-- Cold-email automation. Max-only feature. The owner uploads a CSV of leads,
-- picks/edits 3 email templates, hits Start. Cron-tick advances each contact
-- through the 3-touch sequence with rate-limit + per-day caps to keep the
-- domain reputation clean.

CREATE TABLE IF NOT EXISTS campaigns (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  name TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'draft',  -- draft | running | paused | done
  -- 3-touch sequence; {{first_name}} and {{firm}} placeholders supported
  subject_t1 TEXT NOT NULL,
  body_t1 TEXT NOT NULL,
  subject_t2 TEXT NOT NULL,
  body_t2 TEXT NOT NULL,
  subject_t3 TEXT NOT NULL,
  body_t3 TEXT NOT NULL,
  -- Spacing in seconds between touches
  gap_t2_secs INTEGER NOT NULL DEFAULT 345600,   -- 4 days
  gap_t3_secs INTEGER NOT NULL DEFAULT 950400,   -- 11 days from t1 (7 days from t2)
  -- Throttle so we don't burn the domain
  max_per_hour INTEGER NOT NULL DEFAULT 25,
  max_per_day INTEGER NOT NULL DEFAULT 80,
  reply_to_email TEXT NOT NULL,
  from_email TEXT NOT NULL,                      -- e.g. 'Nick Heitkamp <nick@mythos0x.com>'
  created_at INTEGER NOT NULL,
  started_at INTEGER,
  completed_at INTEGER,
  FOREIGN KEY (user_id) REFERENCES users(id)
);

CREATE INDEX IF NOT EXISTS idx_campaigns_user ON campaigns(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_campaigns_status ON campaigns(status);

CREATE TABLE IF NOT EXISTS campaign_contacts (
  id TEXT PRIMARY KEY,
  campaign_id TEXT NOT NULL,
  email TEXT NOT NULL,
  first_name TEXT,
  last_name TEXT,
  firm TEXT,
  -- 0=queued, 1=touch1 sent, 2=touch2 sent, 3=touch3 sent (done),
  -- -1=replied, -2=bounced, -3=unsubscribed, -4=opted_out
  stage INTEGER NOT NULL DEFAULT 0,
  last_send_at INTEGER,
  reply_at INTEGER,
  bounce_at INTEGER,
  notes TEXT,
  created_at INTEGER NOT NULL,
  FOREIGN KEY (campaign_id) REFERENCES campaigns(id)
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_contacts_campaign_email ON campaign_contacts(campaign_id, email);
CREATE INDEX IF NOT EXISTS idx_contacts_stage ON campaign_contacts(campaign_id, stage);

CREATE TABLE IF NOT EXISTS campaign_sends (
  id TEXT PRIMARY KEY,
  campaign_id TEXT NOT NULL,
  contact_id TEXT NOT NULL,
  touch INTEGER NOT NULL,                        -- 1, 2, or 3
  resend_id TEXT,
  subject TEXT NOT NULL,
  status TEXT NOT NULL,                          -- sent | failed | bounced
  error TEXT,
  sent_at INTEGER NOT NULL,
  FOREIGN KEY (campaign_id) REFERENCES campaigns(id),
  FOREIGN KEY (contact_id) REFERENCES campaign_contacts(id)
);

CREATE INDEX IF NOT EXISTS idx_sends_campaign ON campaign_sends(campaign_id, sent_at DESC);
