// Cold-email automation — Max-only.
//
// Flow:
//   1. Owner creates a campaign with 3 templates (touch 1/2/3) + throttle
//   2. Imports a CSV of leads (email, first_name?, last_name?, firm?)
//   3. Hits Start — campaign.status = 'running'
//   4. Cron tick (every minute) finds due touches, sends via Resend, throttled
//      to max_per_hour + max_per_day. Tracks each send + bumps contact stage.
//   5. List-Unsubscribe header on every send + /v1/unsubscribe link in footer
//      keeps us CAN-SPAM compliant.

import type { Env, User } from './types';
import { randomToken } from './auth';

const MAX_BATCH_PER_TICK = 5; // safety: never send more than 5 per cron tick

interface Campaign {
  id: string;
  user_id: string;
  name: string;
  status: 'draft' | 'running' | 'paused' | 'done';
  subject_t1: string;
  body_t1: string;
  subject_t2: string;
  body_t2: string;
  subject_t3: string;
  body_t3: string;
  gap_t2_secs: number;
  gap_t3_secs: number;
  max_per_hour: number;
  max_per_day: number;
  reply_to_email: string;
  from_email: string;
  created_at: number;
  started_at: number | null;
  completed_at: number | null;
}

interface Contact {
  id: string;
  campaign_id: string;
  email: string;
  first_name: string | null;
  last_name: string | null;
  firm: string | null;
  stage: number;
  last_send_at: number | null;
  reply_at: number | null;
  bounce_at: number | null;
  notes: string | null;
  created_at: number;
}

// ---- helpers --------------------------------------------------------------

function fillTemplate(
  tpl: string,
  contact: { first_name?: string | null; last_name?: string | null; firm?: string | null; email: string },
): string {
  return tpl
    .replace(/\{\{\s*first_name\s*\}\}/gi, contact.first_name || 'there')
    .replace(/\{\{\s*last_name\s*\}\}/gi, contact.last_name || '')
    .replace(/\{\{\s*firm\s*\}\}/gi, contact.firm || 'your firm')
    .replace(/\{\{\s*email\s*\}\}/gi, contact.email);
}

function unsubscribeFooter(env: Env, contactId: string): { html: string; text: string; url: string } {
  const url = `${env.SITE_URL}/u/${contactId}`;
  return {
    url,
    text: `\n\n—\nIf you'd rather not hear from me, opt out here: ${url}`,
    html: `<br><br>—<br><a href="${url}" style="color:#888;font-size:11px">Opt out of future emails</a>`,
  };
}

function plainToHtml(text: string): string {
  return text
    .split('\n\n')
    .map(
      (para) =>
        `<p style="margin:0 0 14px;line-height:1.6;font-size:14.5px;color:#222">${para
          .replace(/&/g, '&amp;')
          .replace(/</g, '&lt;')
          .replace(/>/g, '&gt;')
          .replace(/\n/g, '<br>')}</p>`,
    )
    .join('');
}

// ---- public API -----------------------------------------------------------

export async function createCampaign(
  env: Env,
  user: User,
  body: Partial<Campaign>,
): Promise<Campaign> {
  const id = randomToken(10);
  const now = Math.floor(Date.now() / 1000);
  const fromEmail = body.from_email || `Nicholas Heitkamp <nick@mythos0x.com>`;
  await env.DB.prepare(
    `INSERT INTO campaigns
       (id, user_id, name, status, subject_t1, body_t1, subject_t2, body_t2, subject_t3, body_t3,
        gap_t2_secs, gap_t3_secs, max_per_hour, max_per_day, reply_to_email, from_email, created_at)
     VALUES (?, ?, ?, 'draft', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  )
    .bind(
      id,
      user.id,
      body.name || 'Untitled campaign',
      body.subject_t1 || '',
      body.body_t1 || '',
      body.subject_t2 || '',
      body.body_t2 || '',
      body.subject_t3 || '',
      body.body_t3 || '',
      body.gap_t2_secs ?? 345600,
      body.gap_t3_secs ?? 950400,
      body.max_per_hour ?? 25,
      body.max_per_day ?? 80,
      body.reply_to_email || user.email,
      fromEmail,
      now,
    )
    .run();
  return (await getCampaign(env, user, id))!;
}

export async function getCampaign(env: Env, user: User, id: string): Promise<Campaign | null> {
  return env.DB.prepare('SELECT * FROM campaigns WHERE id = ? AND user_id = ?')
    .bind(id, user.id)
    .first<Campaign>();
}

export async function listCampaigns(env: Env, user: User): Promise<Campaign[]> {
  const r = await env.DB.prepare(
    'SELECT * FROM campaigns WHERE user_id = ? ORDER BY created_at DESC',
  )
    .bind(user.id)
    .all<Campaign>();
  return r.results ?? [];
}

export async function updateCampaign(
  env: Env,
  user: User,
  id: string,
  body: Partial<Campaign>,
): Promise<Campaign | null> {
  const c = await getCampaign(env, user, id);
  if (!c) return null;
  const allowed: Array<keyof Campaign> = [
    'name',
    'subject_t1',
    'body_t1',
    'subject_t2',
    'body_t2',
    'subject_t3',
    'body_t3',
    'gap_t2_secs',
    'gap_t3_secs',
    'max_per_hour',
    'max_per_day',
    'reply_to_email',
    'from_email',
    'status',
  ];
  const updates: string[] = [];
  const vals: unknown[] = [];
  for (const k of allowed) {
    if (body[k] !== undefined) {
      updates.push(`${k} = ?`);
      vals.push(body[k]);
    }
  }
  if (updates.length === 0) return c;
  vals.push(id);
  await env.DB.prepare(`UPDATE campaigns SET ${updates.join(', ')} WHERE id = ?`)
    .bind(...vals)
    .run();
  return await getCampaign(env, user, id);
}

export async function deleteCampaign(env: Env, user: User, id: string): Promise<boolean> {
  const r = await env.DB.prepare('DELETE FROM campaigns WHERE id = ? AND user_id = ?')
    .bind(id, user.id)
    .run();
  return (r.meta.changes ?? 0) > 0;
}

export async function importContacts(
  env: Env,
  user: User,
  campaignId: string,
  csvText: string,
): Promise<{ imported: number; skipped: number; errors: string[] }> {
  const c = await getCampaign(env, user, campaignId);
  if (!c) return { imported: 0, skipped: 0, errors: ['campaign_not_found'] };

  const lines = csvText.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  if (lines.length === 0) return { imported: 0, skipped: 0, errors: ['empty_csv'] };

  // Detect header
  const firstRow = parseCsvLine(lines[0]);
  const lower = firstRow.map((s) => s.toLowerCase());
  const hasHeader = lower.includes('email') || lower.includes('e-mail');
  const headers = hasHeader ? lower : ['email', 'first_name', 'last_name', 'firm'];
  const dataLines = hasHeader ? lines.slice(1) : lines;

  const idxEmail = headers.findIndex((h) => h === 'email' || h === 'e-mail');
  const idxFirst = headers.findIndex((h) => h === 'first_name' || h === 'firstname' || h === 'first');
  const idxLast = headers.findIndex((h) => h === 'last_name' || h === 'lastname' || h === 'last');
  const idxFirm = headers.findIndex((h) => h === 'firm' || h === 'company' || h === 'organization');

  const errors: string[] = [];
  let imported = 0;
  let skipped = 0;
  const now = Math.floor(Date.now() / 1000);

  // Insert in chunks of 25 to avoid D1 batch limits
  const chunks: Array<Array<{ email: string; first?: string; last?: string; firm?: string }>> = [];
  let cur: Array<{ email: string; first?: string; last?: string; firm?: string }> = [];
  for (const line of dataLines) {
    const row = parseCsvLine(line);
    const email = (row[idxEmail] ?? '').trim().toLowerCase();
    if (!email || !email.includes('@')) {
      skipped++;
      continue;
    }
    cur.push({
      email,
      first: idxFirst >= 0 ? row[idxFirst]?.trim() : undefined,
      last: idxLast >= 0 ? row[idxLast]?.trim() : undefined,
      firm: idxFirm >= 0 ? row[idxFirm]?.trim() : undefined,
    });
    if (cur.length >= 25) {
      chunks.push(cur);
      cur = [];
    }
  }
  if (cur.length > 0) chunks.push(cur);

  for (const chunk of chunks) {
    try {
      await env.DB.batch(
        chunk.map((c2) =>
          env.DB.prepare(
            `INSERT OR IGNORE INTO campaign_contacts
               (id, campaign_id, email, first_name, last_name, firm, stage, created_at)
             VALUES (?, ?, ?, ?, ?, ?, 0, ?)`,
          ).bind(
            randomToken(10),
            campaignId,
            c2.email,
            c2.first || null,
            c2.last || null,
            c2.firm || null,
            now,
          ),
        ),
      );
      imported += chunk.length;
    } catch (e) {
      errors.push(`batch_insert_failed: ${(e as Error).message.slice(0, 100)}`);
    }
  }

  return { imported, skipped, errors };
}

function parseCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"' && line[i + 1] === '"') {
        cur += '"';
        i++;
      } else if (ch === '"') {
        inQuotes = false;
      } else {
        cur += ch;
      }
    } else {
      if (ch === ',') {
        out.push(cur);
        cur = '';
      } else if (ch === '"' && cur === '') {
        inQuotes = true;
      } else {
        cur += ch;
      }
    }
  }
  out.push(cur);
  return out;
}

export async function listContacts(
  env: Env,
  user: User,
  campaignId: string,
  limit = 200,
): Promise<Contact[]> {
  const c = await getCampaign(env, user, campaignId);
  if (!c) return [];
  const r = await env.DB.prepare(
    'SELECT * FROM campaign_contacts WHERE campaign_id = ? ORDER BY stage ASC, created_at ASC LIMIT ?',
  )
    .bind(campaignId, limit)
    .all<Contact>();
  return r.results ?? [];
}

export async function unsubscribeContact(env: Env, contactId: string): Promise<boolean> {
  const r = await env.DB.prepare(
    `UPDATE campaign_contacts SET stage = -3 WHERE id = ?`,
  )
    .bind(contactId)
    .run();
  return (r.meta.changes ?? 0) > 0;
}

// ---- cron tick ------------------------------------------------------------

/** Find campaigns that are running and process due sends. Called every minute. */
export async function tickAllCampaigns(env: Env): Promise<{ sent: number; campaigns: number }> {
  if (!env.RESEND_API_KEY) return { sent: 0, campaigns: 0 };
  const running = await env.DB.prepare(
    "SELECT * FROM campaigns WHERE status = 'running'",
  ).all<Campaign>();
  let total = 0;
  for (const c of running.results ?? []) {
    const sent = await tickCampaign(env, c);
    total += sent;
  }
  return { sent: total, campaigns: (running.results ?? []).length };
}

async function tickCampaign(env: Env, c: Campaign): Promise<number> {
  // Throttle checks
  const now = Math.floor(Date.now() / 1000);
  const hourAgo = now - 3600;
  const dayAgo = now - 86400;

  const sentLastHour = await env.DB.prepare(
    `SELECT COUNT(*) as n FROM campaign_sends WHERE campaign_id = ? AND status = 'sent' AND sent_at > ?`,
  )
    .bind(c.id, hourAgo)
    .first<{ n: number }>();
  const sentLastDay = await env.DB.prepare(
    `SELECT COUNT(*) as n FROM campaign_sends WHERE campaign_id = ? AND status = 'sent' AND sent_at > ?`,
  )
    .bind(c.id, dayAgo)
    .first<{ n: number }>();

  const hourLeft = c.max_per_hour - (sentLastHour?.n ?? 0);
  const dayLeft = c.max_per_day - (sentLastDay?.n ?? 0);
  const sendBudget = Math.min(hourLeft, dayLeft, MAX_BATCH_PER_TICK);
  if (sendBudget <= 0) return 0;

  // Find due contacts in priority order:
  //   1. Stage 0 (touch 1) — send any
  //   2. Stage 1 + last_send_at < now - gap_t2_secs — send touch 2
  //   3. Stage 2 + last_send_at < now - (gap_t3_secs - gap_t2_secs) — send touch 3
  const dueT2 = now - c.gap_t2_secs;
  const dueT3 = now - (c.gap_t3_secs - c.gap_t2_secs);

  const due = await env.DB.prepare(
    `SELECT * FROM campaign_contacts
     WHERE campaign_id = ?
       AND (
         stage = 0
         OR (stage = 1 AND (last_send_at IS NULL OR last_send_at < ?))
         OR (stage = 2 AND (last_send_at IS NULL OR last_send_at < ?))
       )
     ORDER BY stage ASC, created_at ASC
     LIMIT ?`,
  )
    .bind(c.id, dueT2, dueT3, sendBudget)
    .all<Contact>();

  let sent = 0;
  for (const contact of due.results ?? []) {
    const ok = await sendOne(env, c, contact);
    if (ok) sent++;
    // Tiny delay between sends in a tick (Resend rate-limits at 10/sec)
    await new Promise((res) => setTimeout(res, 200));
  }

  // If no contacts remain, mark campaign done
  const remaining = await env.DB.prepare(
    `SELECT COUNT(*) as n FROM campaign_contacts WHERE campaign_id = ? AND stage IN (0, 1, 2)`,
  )
    .bind(c.id)
    .first<{ n: number }>();
  if ((remaining?.n ?? 0) === 0) {
    await env.DB.prepare(
      `UPDATE campaigns SET status = 'done', completed_at = ? WHERE id = ?`,
    )
      .bind(now, c.id)
      .run();
  }

  return sent;
}

async function sendOne(env: Env, c: Campaign, contact: Contact): Promise<boolean> {
  const nextTouch = (contact.stage + 1) as 1 | 2 | 3;
  const subject =
    nextTouch === 1 ? c.subject_t1 : nextTouch === 2 ? c.subject_t2 : c.subject_t3;
  const bodyTpl = nextTouch === 1 ? c.body_t1 : nextTouch === 2 ? c.body_t2 : c.body_t3;
  const filledSubject = fillTemplate(subject, contact);
  const filledBodyText = fillTemplate(bodyTpl, contact);

  const unsub = unsubscribeFooter(env, contact.id);
  const text = `${filledBodyText}${unsub.text}`;
  const html = `${plainToHtml(filledBodyText)}${unsub.html}`;

  const sendId = randomToken(10);
  const now = Math.floor(Date.now() / 1000);

  try {
    const r = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${env.RESEND_API_KEY}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        from: c.from_email,
        to: [contact.email],
        reply_to: c.reply_to_email,
        subject: filledSubject,
        text,
        html,
        headers: {
          'List-Unsubscribe': `<${unsub.url}>, <mailto:${c.reply_to_email}?subject=unsubscribe>`,
          'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
        },
      }),
    });
    if (!r.ok) {
      const detail = await r.text().catch(() => '');
      await env.DB.prepare(
        `INSERT INTO campaign_sends (id, campaign_id, contact_id, touch, subject, status, error, sent_at)
         VALUES (?, ?, ?, ?, ?, 'failed', ?, ?)`,
      )
        .bind(sendId, c.id, contact.id, nextTouch, filledSubject, detail.slice(0, 250), now)
        .run();
      console.error('campaign_send_failed', contact.email, r.status, detail.slice(0, 200));
      return false;
    }
    const data = (await r.json().catch(() => ({}))) as { id?: string };
    await env.DB.prepare(
      `INSERT INTO campaign_sends (id, campaign_id, contact_id, touch, resend_id, subject, status, sent_at)
       VALUES (?, ?, ?, ?, ?, ?, 'sent', ?)`,
    )
      .bind(sendId, c.id, contact.id, nextTouch, data.id ?? null, filledSubject, now)
      .run();
    await env.DB.prepare(
      `UPDATE campaign_contacts SET stage = ?, last_send_at = ? WHERE id = ?`,
    )
      .bind(nextTouch, now, contact.id)
      .run();
    return true;
  } catch (e) {
    console.error('campaign_send_exception', contact.email, (e as Error).message);
    return false;
  }
}
