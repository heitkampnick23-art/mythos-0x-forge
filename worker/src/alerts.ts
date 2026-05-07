// Anomaly + activity alerts. Runs hourly via Cron Trigger; posts to a Slack
// or Discord webhook when anything interesting happens.
//
// Triggers:
//   1. Any user hit their daily budget cap (paying customer signal: "raise me")
//   2. Total platform spend today > 2× yesterday's same-time spend
//   3. Any anon identity blew past 3× normal anon usage (abuse signal)
//   4. New paid subscription created in the last hour
//
// Webhook URL is in env.ALERT_WEBHOOK_URL (set via wrangler secret put).
// Posts JSON {text: ...} which both Slack incoming-webhooks and Discord webhooks
// (with /slack suffix) accept identically.

import type { Env } from './types';
import { utcDay } from './auth';

interface AlertLine {
  emoji: string;
  text: string;
}

export async function runAlertsCheck(env: Env): Promise<{ posted: number }> {
  if (!env.ALERT_WEBHOOK_URL) {
    console.log('alerts: webhook not configured, skipping');
    return { posted: 0 };
  }

  const lines: AlertLine[] = [];
  const day = utcDay();
  const yesterday = utcDay(Date.now() - 24 * 60 * 60 * 1000);

  // 1. Users at-cap
  const atCap = await env.DB.prepare(
    `SELECT b.identity, b.est_cost_microcents, u.email, u.tier
     FROM user_budget_daily b
     LEFT JOIN users u ON ('user:' || u.id) = b.identity
     WHERE b.day = ? AND b.est_cost_microcents >= 26500
     ORDER BY b.est_cost_microcents DESC LIMIT 10`,
  )
    .bind(day)
    .all<{ identity: string; est_cost_microcents: number; email: string | null; tier: string | null }>();

  for (const r of atCap.results ?? []) {
    const dollars = (r.est_cost_microcents / 10000).toFixed(2);
    if (r.email && r.tier === 'max') {
      lines.push({
        emoji: '🔥',
        text: `*${r.email}* (Max) hit cap at $${dollars} today — sales signal`,
      });
    } else if (r.email) {
      lines.push({
        emoji: '⚠️',
        text: `*${r.email}* (${r.tier}) hit cap at $${dollars} today — upgrade prompt`,
      });
    } else {
      lines.push({
        emoji: '🛑',
        text: `Anon \`${r.identity.slice(5, 17)}…\` hit cap at $${dollars} — possible abuse`,
      });
    }
  }

  // 2. Platform spend today vs yesterday
  const todayTotal = await env.DB.prepare(
    'SELECT COALESCE(SUM(est_cost_microcents), 0) as total FROM user_budget_daily WHERE day = ?',
  )
    .bind(day)
    .first<{ total: number }>();
  const yTotal = await env.DB.prepare(
    'SELECT COALESCE(SUM(est_cost_microcents), 0) as total FROM user_budget_daily WHERE day = ?',
  )
    .bind(yesterday)
    .first<{ total: number }>();
  const tDollars = (todayTotal?.total ?? 0) / 10000;
  const yDollars = (yTotal?.total ?? 0) / 10000;
  if (tDollars > 1 && tDollars > yDollars * 2) {
    lines.push({
      emoji: '🚀',
      text: `Platform spend today $${tDollars.toFixed(2)} vs $${yDollars.toFixed(2)} yesterday — 2× spike`,
    });
  }

  // 3. New paid subs in last hour
  const oneHourAgo = Math.floor(Date.now() / 1000) - 3600;
  const newSubs = await env.DB.prepare(
    `SELECT s.tier, s.interval, u.email
     FROM subscriptions s LEFT JOIN users u ON u.id = s.user_id
     WHERE s.status IN ('active', 'trialing') AND s.created_at >= ?
     ORDER BY s.created_at DESC`,
  )
    .bind(oneHourAgo)
    .all<{ tier: string; interval: string; email: string | null }>();
  for (const s of newSubs.results ?? []) {
    lines.push({
      emoji: '🎉',
      text: `New ${s.tier} subscription (${s.interval}) — ${s.email ?? 'unknown'}`,
    });
  }

  // 4. Heartbeat soul-message anomaly: any anon over 200 msgs/day (3× free cap)
  const chatAbuse = await env.DB.prepare(
    `SELECT identity, message_count FROM soul_usage_daily
     WHERE day = ? AND message_count > 150
     ORDER BY message_count DESC LIMIT 5`,
  )
    .bind(day)
    .all<{ identity: string; message_count: number }>();
  for (const c of chatAbuse.results ?? []) {
    if (c.identity.startsWith('anon:')) {
      lines.push({
        emoji: '🛑',
        text: `Anon \`${c.identity.slice(5, 17)}…\` sent ${c.message_count} Soul messages — possible abuse`,
      });
    }
  }

  if (lines.length === 0) return { posted: 0 };

  // Compose message — works for both Slack and Discord (with /slack suffix)
  const body = {
    text:
      `*Mythos · 0X · Forge — ${day}* (${new Date().toISOString().slice(11, 16)} UTC)\n` +
      lines.map((l) => `${l.emoji}  ${l.text}`).join('\n'),
  };

  const r = await fetch(env.ALERT_WEBHOOK_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!r.ok) {
    console.error('alerts: webhook failed', r.status, await r.text().catch(() => ''));
    return { posted: 0 };
  }
  return { posted: lines.length };
}
