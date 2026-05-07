-- Referral attribution. Every user gets a unique referral code derived from
-- their user id. When a new visitor lands with ?ref=<code>, we set a cookie
-- and persist the referrer when they create an account. When that referred
-- user becomes a paying subscriber, the referral is marked 'paid' and the
-- referrer can be paid 20% recurring (manually for v0).

ALTER TABLE users ADD COLUMN referral_code TEXT;
ALTER TABLE users ADD COLUMN referred_by TEXT;  -- referrer's user_id

CREATE UNIQUE INDEX IF NOT EXISTS idx_users_referral_code ON users(referral_code);
CREATE INDEX IF NOT EXISTS idx_users_referred_by ON users(referred_by);

CREATE TABLE IF NOT EXISTS referrals (
  id TEXT PRIMARY KEY,
  referrer_user_id TEXT NOT NULL,
  referred_user_id TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'signed_up',  -- signed_up | paid | paid_out | refunded
  first_paid_subscription_id TEXT,
  cents_attributable INTEGER NOT NULL DEFAULT 0,
  signed_up_at INTEGER NOT NULL,
  paid_at INTEGER,
  paid_out_at INTEGER,
  FOREIGN KEY (referrer_user_id) REFERENCES users(id),
  FOREIGN KEY (referred_user_id) REFERENCES users(id)
);

CREATE INDEX IF NOT EXISTS idx_referrals_referrer ON referrals(referrer_user_id, signed_up_at DESC);
CREATE INDEX IF NOT EXISTS idx_referrals_status ON referrals(status);
