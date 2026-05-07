-- Generic key/value settings (Stripe meter/price IDs, feature flags, etc.).
CREATE TABLE IF NOT EXISTS app_settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);

-- Phone numbers attached to Souls (Twilio). One number per Soul.
ALTER TABLE souls ADD COLUMN phone_number TEXT;
ALTER TABLE souls ADD COLUMN phone_provider TEXT;

CREATE INDEX IF NOT EXISTS idx_souls_phone ON souls(phone_number);
