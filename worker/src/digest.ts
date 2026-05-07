// Weekly digest email. Sent every Monday ~9am ET (14:00 UTC) to every user
// who hasn't unsubscribed (notify_email != 0). Drives re-engagement; for
// users with referrals it also makes commission earnings feel real.
//
// Body shows:
//   - This week's analyses + their verdict mix
//   - Referral standings (signed up / paying / cents owed)
//   - One-click link back to /account
//
// Sent in batches to stay well under Resend's per-second rate limit.

import type { Env } from './types';
import { codeForUser } from './referrals';

const BATCH_SIZE = 8;
const BATCH_DELAY_MS = 1100;

interface UserRow {
  id: string;
  email: string;
  tier: string;
  display_name: string | null;
}

interface WeekStats {
  total: number;
  authentic: number;
  suspect: number;
  synthetic: number;
}

interface ReferralCounts {
  signed_up: number;
  paid: number;
  cents_owed: number;
}

export async function runWeeklyDigest(env: Env): Promise<{ sent: number; skipped: number; failed: number }> {
  if (!env.RESEND_API_KEY) {
    console.log('digest: RESEND_API_KEY not set, skipping');
    return { sent: 0, skipped: 0, failed: 0 };
  }
  const since = Math.floor(Date.now() / 1000) - 7 * 24 * 60 * 60;

  const users = await env.DB.prepare(
    `SELECT id, email, tier, display_name FROM users
     WHERE notify_email != 0 AND email IS NOT NULL`,
  ).all<UserRow>();

  let sent = 0;
  let skipped = 0;
  let failed = 0;
  const rows = users.results ?? [];

  for (let i = 0; i < rows.length; i += BATCH_SIZE) {
    const batch = rows.slice(i, i + BATCH_SIZE);
    const results = await Promise.all(
      batch.map(async (u) => {
        try {
          const [stats, refs] = await Promise.all([
            weekStats(env, u.id, since),
            referralCounts(env, u.id),
          ]);
          // Skip users with literally zero activity & no referral movement.
          if (stats.total === 0 && refs.signed_up === 0) return 'skip';
          const ok = await sendDigest(env, u, stats, refs);
          return ok ? 'sent' : 'fail';
        } catch (e) {
          console.error('digest_user_failed', u.id, (e as Error).message);
          return 'fail';
        }
      }),
    );
    for (const r of results) {
      if (r === 'sent') sent++;
      else if (r === 'skip') skipped++;
      else failed++;
    }
    if (i + BATCH_SIZE < rows.length) {
      await new Promise((res) => setTimeout(res, BATCH_DELAY_MS));
    }
  }

  console.log('digest: sent', sent, 'skipped', skipped, 'failed', failed);
  return { sent, skipped, failed };
}

async function weekStats(env: Env, userId: string, since: number): Promise<WeekStats> {
  const r = await env.DB.prepare(
    `SELECT verdict, COUNT(*) as n FROM analyses
     WHERE user_id = ? AND created_at >= ?
     GROUP BY verdict`,
  )
    .bind(userId, since)
    .all<{ verdict: string; n: number }>();
  const out: WeekStats = { total: 0, authentic: 0, suspect: 0, synthetic: 0 };
  for (const row of r.results ?? []) {
    out.total += row.n;
    if (row.verdict === 'authentic') out.authentic = row.n;
    else if (row.verdict === 'suspect') out.suspect = row.n;
    else if (row.verdict === 'synthetic') out.synthetic = row.n;
  }
  return out;
}

async function referralCounts(env: Env, userId: string): Promise<ReferralCounts> {
  const r = await env.DB.prepare(
    `SELECT
       COUNT(*) as total,
       SUM(CASE WHEN status = 'paid' OR status = 'paid_out' THEN 1 ELSE 0 END) as paid,
       SUM(CASE WHEN status = 'paid' THEN cents_attributable ELSE 0 END) as cents_raw
     FROM referrals WHERE referrer_user_id = ?`,
  )
    .bind(userId)
    .first<{ total: number; paid: number; cents_raw: number }>();
  const cents = Math.round((r?.cents_raw ?? 0) * 0.2);
  return { signed_up: r?.total ?? 0, paid: r?.paid ?? 0, cents_owed: cents };
}

async function sendDigest(
  env: Env,
  user: UserRow,
  stats: WeekStats,
  refs: ReferralCounts,
): Promise<boolean> {
  const refCode = codeForUser(user.id);
  const refLink = `https://mythos0x.com/?ref=${refCode}`;
  const greeting = user.display_name ? `Hey ${escapeHtml(user.display_name)}` : 'Hey there';
  const html = `<div style="font-family:system-ui,sans-serif;max-width:560px;margin:0 auto;padding:32px;background:#0a0608;color:#fff;border-radius:12px">
  <h1 style="background:linear-gradient(180deg,#ffe6c4,#ffb347 50%,#c81d25);-webkit-background-clip:text;background-clip:text;color:transparent;font-size:28px;margin:0 0 8px">Mythos 0X Forge</h1>
  <p style="color:#888;margin:0 0 24px;font-size:11px;letter-spacing:0.24em;text-transform:uppercase">Your week in the Forge</p>

  <p style="color:#ccc;margin:0 0 24px">${greeting} — here's what happened this past week:</p>

  <div style="background:rgba(255,255,255,0.03);border:1px solid rgba(255,255,255,0.06);border-radius:8px;padding:18px;margin:0 0 18px">
    <div style="font-size:11px;letter-spacing:0.22em;text-transform:uppercase;color:#888;margin-bottom:8px">Analyses</div>
    <div style="font-size:28px;font-weight:600">${stats.total}</div>
    <div style="margin-top:10px;display:flex;gap:14px;flex-wrap:wrap;font-size:12px">
      <span><span style="color:#7be3a4">●</span> ${stats.authentic} authentic</span>
      <span><span style="color:#ffb347">●</span> ${stats.suspect} suspect</span>
      <span><span style="color:#c81d25">●</span> ${stats.synthetic} synthetic</span>
    </div>
  </div>

  <div style="background:rgba(255,255,255,0.03);border:1px solid rgba(255,179,71,0.18);border-radius:8px;padding:18px;margin:0 0 24px">
    <div style="font-size:11px;letter-spacing:0.22em;text-transform:uppercase;color:#ffb347;margin-bottom:8px">Referrals · 20% recurring</div>
    <table style="width:100%;border-collapse:collapse;font-size:13px">
      <tr><td style="color:#aaa;padding:4px 0">Signed up</td><td style="text-align:right;color:#fff">${refs.signed_up}</td></tr>
      <tr><td style="color:#aaa;padding:4px 0">Paying</td><td style="text-align:right;color:#fff">${refs.paid}</td></tr>
      <tr><td style="color:#aaa;padding:4px 0">Owed</td><td style="text-align:right;color:#7be3a4;font-weight:600">$${(refs.cents_owed / 100).toFixed(2)}</td></tr>
    </table>
    <div style="margin-top:14px;font-size:12px;color:#888">Your link: <a href="${refLink}" style="color:#ffb347;word-break:break-all">${refLink}</a></div>
  </div>

  <p style="margin:0 0 24px"><a href="https://mythos0x.com/account" style="display:inline-block;padding:12px 24px;background:linear-gradient(90deg,#ff5722,#c81d25);color:#fff;text-decoration:none;border-radius:999px;font-weight:600;letter-spacing:0.05em;font-size:13px">Open dashboard</a></p>

  <p style="color:#555;font-size:11px;margin:32px 0 0;border-top:1px solid rgba(255,255,255,0.06);padding-top:16px">
    You're receiving this because you have a Mythos 0X Forge account.
    <a href="https://mythos0x.com/account" style="color:#888">Manage preferences</a> ·
    <a href="https://mythos0x.com/account?notify=off" style="color:#888">Unsubscribe</a>
  </p>
</div>`;

  const subject = refs.cents_owed > 0
    ? `$${(refs.cents_owed / 100).toFixed(2)} owed · ${stats.total} verdicts this week`
    : stats.total > 0
    ? `${stats.total} verdicts this week`
    : `Your Forge week`;

  const from = env.RESEND_FROM ?? 'Mythos 0X Forge <hello@mythos0x.com>';
  const r = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${env.RESEND_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ from, to: [user.email], subject, html }),
  });
  if (!r.ok) {
    const detail = await r.text().catch(() => '');
    console.error('digest_resend_failed', r.status, user.email, detail.slice(0, 200));
    return false;
  }
  return true;
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
}
