-- Real-time voice agents via ElevenLabs Convai. When set, the Soul has a
-- corresponding agent in ElevenLabs that handles WebSocket voice in/out at
-- ~300ms latency (vs 1-2s for the DIY Anthropic+TTS pipeline).

ALTER TABLE souls ADD COLUMN convai_agent_id TEXT;
ALTER TABLE souls ADD COLUMN convai_synced_at INTEGER;

CREATE INDEX IF NOT EXISTS idx_souls_convai ON souls(convai_agent_id);
