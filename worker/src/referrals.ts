// Referral attribution. Every user has a stable referral_code derived from
// their user id. The flow:
//
//   1. Visitor clicks ?ref=<code> → frontend stores the code in a 30-day
//      first-party cookie (mfr=<code>).
//   2. Visitor signs up via magic-link. POST /v1/auth/magic-link forwards the
//      cookie. On consume, we look up referrer_user_id by code and write
//      users.referred_by + insert a row in referrals.
//   3. Stripe webhook fires customer.subscription.created. We check if the
//      paying user has a referrer; if yes, mark referrals row 'paid' and
//      stamp first_paid_subscription_id + cents_attributable.
//   4. The owner periodically queries /v1/admin/referrals/payouts and pays
//      the 20% manually for v0 (e.g. Stripe payout, Wise, PayPal).

import type { Env, User } from './types';

const REFERRAL_COOKIE = 'mfr';
const REFERRAL_TTL_DAYS = 30;

/** Stable referral code for a user. Keeps codes 6 chars (low collision at
 *  thousands-of-users scale). Derived from id so it never changes. */
export function codeForUser(userId: string): string {
  // Take first 6 hex chars — 16M space, plenty for v0
  return userId.slice(0, 6);
}

export function readReferralCookie(req: Request): string | null {
  const header = req.headers.get('cookie') ?? '';
  const m = header.match(new RegExp(`(?:^|; )${REFERRAL_COOKIE}=([^;]+)`));
  return m ? decodeURIComponent(m[1]).slice(0, 12) : null;
}

export function setReferralCookieHeader(code: string): string {
  const max = 60 * 60 * 24 * REFERRAL_TTL_DAYS;
  return `${REFERRAL_COOKIE}=${encodeURIComponent(code)}; Path=/; Max-Age=${max}; Secure; SameSite=Lax`;
}

/** Find a user by referral code. */
export async function findReferrerByCode(env: Env, code: string): Promise<{ id: string } | null> {
  if (!code || code.length !== 6) return null;
  // codes are derived from user.id prefix
  const r = await env.DB.prepare('SELECT id FROM users WHERE id LIKE ?')
    .bind(`${code}%`)
    .first<{ id: string }>();
  return r ?? null;
}

/** Backfill referral_code for users that pre-date this feature. Idempotent. */
export async function ensureReferralCode(env: Env, userId: string): Promise<string> {
  const existing = await env.DB.prepare('SELECT referral_code FROM users WHERE id = ?')
    .bind(userId)
    .first<{ referral_code: string | null }>();
  if (existing?.referral_code) return existing.referral_code;
  const code = codeForUser(userId);
  await env.DB.prepare('UPDATE users SET referral_code = ? WHERE id = ?')
    .bind(code, userId)
    .run();
  return code;
}

/** Called when a magic-link verifier creates or finds a user. If the cookie
 *  has a referral code, persist the attribution if the user is brand-new and
 *  the referrer differs from themselves. */
export async function applyReferralOnSignup(
  env: Env,
  user: User,
  cookieCode: string | null,
  isNewUser: boolean,
): Promise<void> {
  if (!cookieCode || !isNewUser) return;
  const referrer = await findReferrerByCode(env, cookieCode);
  if (!referrer || referrer.id === user.id) return;

  const now = Math.floor(Date.now() / 1000);
  await env.DB.prepare('UPDATE users SET referred_by = ? WHERE id = ?')
    .bind(referrer.id, user.id)
    .run();
  await env.DB.prepare(
    `INSERT INTO referrals (id, referrer_user_id, referred_user_id, status, signed_up_at)
     VALUES (?, ?, ?, 'signed_up', ?)`,
  )
    .bind(`r_${user.id}_${referrer.id}`.slice(0, 32), referrer.id, user.id, now)
    .run();
}

/** Called from Stripe webhook on customer.subscription.created.
 *  If the paying user has a referrer, mark referral 'paid'. */
export async function recordReferralPayment(
  env: Env,
  payingUserId: string,
  subscriptionId: string,
  centsAttributable: number,
): Promise<void> {
  const u = await env.DB.prepare('SELECT referred_by FROM users WHERE id = ?')
    .bind(payingUserId)
    .first<{ referred_by: string | null }>();
  if (!u?.referred_by) return;
  const now = Math.floor(Date.now() / 1000);
  await env.DB.prepare(
    `UPDATE referrals
     SET status = 'paid', first_paid_subscription_id = ?, cents_attributable = ?, paid_at = ?
     WHERE referrer_user_id = ? AND referred_user_id = ? AND status = 'signed_up'`,
  )
    .bind(subscriptionId, centsAttributable, now, u.referred_by, payingUserId)
    .run();
}

/** Stats for the user's account-page widget. */
export async function statsFor(env: Env, userId: string): Promise<{
  code: string;
  signed_up: number;
  paid: number;
  cents_owed: number;
}> {
  const code = await ensureReferralCode(env, userId);
  const counts = await env.DB.prepare(
    `SELECT
       COUNT(*) as total,
       SUM(CASE WHEN status = 'paid' OR status = 'paid_out' THEN 1 ELSE 0 END) as paid,
       SUM(CASE WHEN status = 'paid' THEN cents_attributable ELSE 0 END) as cents_owed_raw
     FROM referrals WHERE referrer_user_id = ?`,
  )
    .bind(userId)
    .first<{ total: number; paid: number; cents_owed_raw: number }>();

  // 20% recurring; pay on the 'cents_attributable' (which is the first-month sub price for v0)
  const cents_owed = Math.round((counts?.cents_owed_raw ?? 0) * 0.2);
  return {
    code,
    signed_up: counts?.total ?? 0,
    paid: counts?.paid ?? 0,
    cents_owed,
  };
}
