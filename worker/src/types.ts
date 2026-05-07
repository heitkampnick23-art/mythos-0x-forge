export interface Env {
  MEDIA: R2Bucket;
  DB: D1Database;
  ALLOWED_ORIGIN: string;
  ENABLE_MOCK_FALLBACK: string;
  SITE_URL: string;

  PRICE_PRO_MONTHLY: string;
  PRICE_PRO_YEARLY: string;
  PRICE_MAX_MONTHLY: string;
  PRICE_MAX_YEARLY: string;

  SIGHTENGINE_USER?: string;
  SIGHTENGINE_SECRET?: string;
  ANTHROPIC_API_KEY?: string;
  STRIPE_SECRET_KEY?: string;
  STRIPE_WEBHOOK_SECRET?: string;
  RESEND_API_KEY?: string;
  /** Override the from address; defaults to onboarding@resend.dev until
   *  mythos0x.com is verified in Resend. Set to "Mythos 0X Forge <auth@mythos0x.com>"
   *  via wrangler secret put RESEND_FROM once verified. */
  RESEND_FROM?: string;
  /** ElevenLabs TTS for verdict readout (Pro+ feature). */
  ELEVENLABS_API_KEY?: string;
  /** Slack/Discord webhook URL for anomaly alerts (cron-driven). */
  ALERT_WEBHOOK_URL?: string;
}

export type Tier = 'free' | 'pro' | 'max';
export type MediaKind = 'image' | 'video';

export interface User {
  id: string;
  email: string;
  stripe_customer_id: string | null;
  tier: Tier;
  created_at: number;
  last_seen_at: number;
}

export interface BoundingBox {
  x: number;
  y: number;
  width: number;
  height: number;
  label: string;
  severity: number;
}

export interface Finding {
  category:
    | 'lighting'
    | 'reflection'
    | 'texture'
    | 'motion'
    | 'frequency'
    | 'geometry'
    | 'compression';
  title: string;
  detail: string;
  weight: number;
}

export interface AnalysisResult {
  kind: MediaKind;
  confidence: number;
  verdict: 'authentic' | 'suspect' | 'synthetic';
  modelTag: string;
  durationMs: number;
  boxes: BoundingBox[];
  findings: Finding[];
}

export const DAILY_LIMITS: Record<Tier, number> = {
  free: 3,
  pro: 100,
  max: 1000,
};
