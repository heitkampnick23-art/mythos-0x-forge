// Cost tracking + per-tier daily budget enforcement.
//
// Every external API call is instrumented to estimate cost in micro-cents
// (1¢ = 100 microcents) and rolled up daily per user. Before expensive
// operations we check the running total against the tier's cap and 402 if
// exceeded, identical UX to a rate-limit response.
//
// Caps are calibrated to break-even at the subscription price, so a single
// runaway user can never cost us more than they pay. Burst allowance can be
// negotiated per-account by raising the tier-specific cap.

import type { Env, Tier } from './types';
import { utcDay } from './auth';

// Unit: micro-cent = 1/100 of a cent = 1/10,000 of a dollar.
// $1 = 100¢ = 10,000 mc.  $0.10 = 1,000 mc.  $1.00 = 10,000 mc.
//
// Pricing as of 2026-05. Update when providers change rates.
//   Anthropic Claude Haiku 4.5: $0.80/M input, $4/M output
//   ElevenLabs Turbo v2.5     : $0.05 / 1k chars (paid tier)
//   Sightengine genai         : $0.30 / 1k ops (after free tier)
const COST_RATES = {
  // microcents per million tokens — formula: tokens × rate / 1_000_000
  anthropic_in_per_m: 8_000,     // = $0.80 × 10,000 mc/$ = 8,000 mc/M tokens
  anthropic_out_per_m: 40_000,   // = $4.00 × 10,000 mc/$ = 40,000 mc/M tokens
  // microcents per 1k chars — formula: chars × rate / 1000
  elevenlabs_per_k_chars: 500,   // = $0.05 × 10,000 mc/$ = 500 mc/1k chars
  // microcents per op — formula: ops × rate
  sightengine_per_op: 3,         // = $0.0003 × 10,000 mc/$ = 3 mc/op
};

// Daily caps. Calibrated to ~1× monthly revenue / 30 days so worst case
// is break-even on a maxed-out user-day.
//   Free: $0.10/day (loss-leader, tight cap)
//   Pro:  $0.65/day (~$19.50/mo break-even at $19 retail)
//   Max:  $2.65/day (~$79.50/mo break-even at $79 retail)
export const DAILY_BUDGET_MICROCENTS: Record<Tier, number> = {
  free:   1_000,   // $0.10
  pro:    6_500,   // $0.65
  max:   26_500,   // $2.65
};

export interface BudgetState {
  used_microcents: number;
  cap_microcents: number;
  ratio: number;
  exceeded: boolean;
  near_limit: boolean; // > 80%
}

export async function getBudget(env: Env, identity: string, tier: Tier): Promise<BudgetState> {
  const day = utcDay();
  const row = await env.DB.prepare(
    'SELECT est_cost_microcents FROM user_budget_daily WHERE identity = ? AND day = ?',
  )
    .bind(identity, day)
    .first<{ est_cost_microcents: number }>();
  const used = row?.est_cost_microcents ?? 0;
  const cap = DAILY_BUDGET_MICROCENTS[tier];
  return {
    used_microcents: used,
    cap_microcents: cap,
    ratio: used / cap,
    exceeded: used >= cap,
    near_limit: used >= cap * 0.8,
  };
}

export async function chargeCost(
  env: Env,
  identity: string,
  charge: {
    sightengine_ops?: number;
    anthropic_in_tokens?: number;
    anthropic_out_tokens?: number;
    elevenlabs_chars?: number;
  },
): Promise<void> {
  const day = utcDay();
  const sg = charge.sightengine_ops ?? 0;
  const aIn = charge.anthropic_in_tokens ?? 0;
  const aOut = charge.anthropic_out_tokens ?? 0;
  const elc = charge.elevenlabs_chars ?? 0;

  // Compute the cost increment in micro-cents
  const delta =
    Math.round((aIn * COST_RATES.anthropic_in_per_m) / 1_000_000) +
    Math.round((aOut * COST_RATES.anthropic_out_per_m) / 1_000_000) +
    Math.round((elc * COST_RATES.elevenlabs_per_k_chars) / 1000) +
    sg * COST_RATES.sightengine_per_op;

  await env.DB.prepare(
    `INSERT INTO user_budget_daily (identity, day, sightengine_ops, anthropic_in_tokens, anthropic_out_tokens, elevenlabs_chars, est_cost_microcents)
     VALUES (?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(identity, day) DO UPDATE SET
       sightengine_ops = sightengine_ops + excluded.sightengine_ops,
       anthropic_in_tokens = anthropic_in_tokens + excluded.anthropic_in_tokens,
       anthropic_out_tokens = anthropic_out_tokens + excluded.anthropic_out_tokens,
       elevenlabs_chars = elevenlabs_chars + excluded.elevenlabs_chars,
       est_cost_microcents = est_cost_microcents + excluded.est_cost_microcents`,
  )
    .bind(identity, day, sg, aIn, aOut, elc, delta)
    .run();
}

/**
 * Estimate token count from a string. Cheap heuristic: ~4 chars/token for
 * English. Used to pre-flight gate expensive LLM calls.
 */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

export function microcentsToDollars(mc: number): string {
  return `$${(mc / 10_000).toFixed(4)}`;
}
