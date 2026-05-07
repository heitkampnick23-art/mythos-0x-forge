// Anomaly + activity alerts. Runs hourly via Cron Trigger.
//
// Delivery channels (any combination):
//   1. Slack/Discord webhook  — set ALERT_WEBHOOK_URL
//   2. Email via Resend       — set ALERT_EMAIL (uses existing RESEND_API_KEY)
//
// If neither is configured, alerts are computed and logged but not delivered.
//
// Triggers:
//   1. Any user hit their daily budget cap (paying customer signal: "raise me")
//   2. Total platform spend today > 2× yesterday's same-time spend
//   3. New paid subscription created in the last hour
//   4. Anon hammering Soul chat (abuse)

import type { Env } from './types';
import { utcDay } from './auth';

interface AlertLine {
  emoji: string;
  text: string;
  /** plain text version without markdown (for email subject line bullets) */
  plain: string;
}

export async function runAlertsCheck(env: Env): Promise<{ posted: number; channels: string[] }> {
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
        plain: `${r.email} (Max) hit cap at $${dollars} today — sales signal`,
      });
    } else if (r.email) {
      lines.push({
        emoji: '⚠️',
        text: `*${r.email}* (${r.tier}) hit cap at $${dollars} today — upgrade prompt`,
        plain: `${r.email} (${r.tier}) hit cap at $${dollars} today — upgrade prompt`,
      });
    } else {
      lines.push({
        emoji: '🛑',
        text: `Anon \`${r.identity.slice(5, 17)}…\` hit cap at $${dollars} — possible abuse`,
        plain: `Anon ${r.identity.slice(5, 17)}… hit cap at $${dollars} — possible abuse`,
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
    const text = `Platform spend today $${tDollars.toFixed(2)} vs $${yDollars.toFixed(2)} yesterday — 2× spike`;
    lines.push({ emoji: '🚀', text, plain: text });
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
    const text = `New ${s.tier} subscription (${s.interval}) — ${s.email ?? 'unknown'}`;
    lines.push({ emoji: '🎉', text, plain: text });
  }

  // 4. Heartbeat soul-message anomaly
  const chatAbuse = await env.DB.prepare(
    `SELECT identity, message_count FROM soul_usage_daily
     WHERE day = ? AND message_count > 150
     ORDER BY message_count DESC LIMIT 5`,
  )
    .bind(day)
    .all<{ identity: string; message_count: number }>();
  for (const c of chatAbuse.results ?? []) {
    if (c.identity.startsWith('anon:')) {
      const text = `Anon \`${c.identity.slice(5, 17)}…\` sent ${c.message_count} Soul messages — possible abuse`;
      lines.push({
        emoji: '🛑',
        text,
        plain: `Anon ${c.identity.slice(5, 17)}… sent ${c.message_count} Soul messages — possible abuse`,
      });
    }
  }

  if (lines.length === 0) {
    console.log('alerts: nothing to report');
    return { posted: 0, channels: [] };
  }

  const heading = `Mythos 0X Forge — ${day} ${new Date().toISOString().slice(11, 16)} UTC`;
  const channels: string[] = [];

  // Webhook channel (Slack/Discord)
  if (env.ALERT_WEBHOOK_URL) {
    const body = {
      text: `*${heading}*\n` + lines.map((l) => `${l.emoji}  ${l.text}`).join('\n'),
    };
    try {
      const r = await fetch(env.ALERT_WEBHOOK_URL, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (r.ok) channels.push('webhook');
      else console.error('alerts webhook failed', r.status);
    } catch (e) {
      console.error('alerts webhook error', (e as Error).message);
    }
  }

  // Email channel (Resend)
  if (env.ALERT_EMAIL && env.RESEND_API_KEY) {
    const html = composeEmailHtml(heading, lines);
    const text = `${heading}\n\n${lines.map((l) => `• ${l.plain}`).join('\n')}`;
    const subject = `[Mythos] ${lines.length} alert${lines.length === 1 ? '' : 's'} · ${lines[0].plain.slice(0, 60)}`;
    try {
      const from = env.RESEND_FROM ?? 'Mythos 0X Forge Alerts <onboarding@resend.dev>';
      const r = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${env.RESEND_API_KEY}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          from,
          to: [env.ALERT_EMAIL],
          subject,
          html,
          text,
        }),
      });
      if (r.ok) channels.push('email');
      else {
        const detail = await r.text().catch(() => '');
        console.error('alerts email failed', r.status, detail.slice(0, 200));
      }
    } catch (e) {
      console.error('alerts email error', (e as Error).message);
    }
  }

  return { posted: lines.length, channels };
}

function composeEmailHtml(heading: string, lines: AlertLine[]): string {
  return `<!doctype html>
<html><body style="margin:0;background:#0a0608;color:#fff;font-family:system-ui,-apple-system,sans-serif">
  <div style="max-width:560px;margin:0 auto;padding:32px 28px;background:#0a0608">
    <h1 style="margin:0 0 4px;background:linear-gradient(180deg,#ffe6c4,#ffb347 50%,#c81d25);-webkit-background-clip:text;background-clip:text;color:transparent;font-size:24px;letter-spacing:-0.01em">Mythos · 0X · Forge</h1>
    <div style="font-size:9px;text-transform:uppercase;letter-spacing:0.32em;color:rgba(255,180,71,0.7);margin-bottom:20px">Anomaly Alerts</div>
    <div style="font-family:ui-monospace,monospace;font-size:11px;text-transform:uppercase;letter-spacing:0.22em;color:rgba(255,255,255,0.45);margin-bottom:18px">${heading}</div>
    <div style="background:rgba(255,87,34,0.04);border:1px solid rgba(255,87,34,0.20);border-radius:14px;padding:18px 20px">
      ${lines
        .map(
          (l) => `<div style="padding:8px 0;border-bottom:1px solid rgba(255,255,255,0.05);color:rgba(255,255,255,0.85);font-size:14px;line-height:1.5">
        <span style="font-size:18px;margin-right:8px">${l.emoji}</span>${escapeHtml(l.plain)}
      </div>`,
        )
        .join('')}
    </div>
    <div style="margin-top:24px;text-align:center"><a href="https://mythos0x.com/account" style="color:#ffb347;text-decoration:none;font-size:11px;text-transform:uppercase;letter-spacing:0.28em">Open dashboard →</a></div>
    <div style="margin-top:32px;text-align:center;font-size:9px;text-transform:uppercase;letter-spacing:0.32em;color:rgba(255,255,255,0.25)">© Mythos · v0.1 alerts</div>
  </div>
</body></html>`;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
