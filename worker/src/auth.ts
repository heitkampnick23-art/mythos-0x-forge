// Session and identity helpers. Sessions are opaque hex tokens stored in D1
// with a 30-day TTL, set as a same-site=lax cookie. Anonymous traffic is
// identified by a daily-rotating sha256(IP|day) hash so per-day counters
// are stable but identifiers don't persist across days.

import type { Env, User, Tier } from './types';

const SESSION_TTL_DAYS = 30;
const COOKIE_NAME = 'mfs';

export function randomToken(bytes = 32): string {
  const a = new Uint8Array(bytes);
  crypto.getRandomValues(a);
  return Array.from(a, (b) => b.toString(16).padStart(2, '0')).join('');
}

export async function sha256Hex(input: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(input));
  return Array.from(new Uint8Array(buf), (b) => b.toString(16).padStart(2, '0')).join('');
}

export function utcDay(at: number = Date.now()): string {
  return new Date(at).toISOString().slice(0, 10);
}

export function readSessionCookie(req: Request): string | null {
  const header = req.headers.get('cookie') ?? '';
  const match = header.match(new RegExp(`(?:^|; )${COOKIE_NAME}=([^;]+)`));
  return match ? decodeURIComponent(match[1]) : null;
}

export function setSessionCookieHeader(token: string): string {
  const max = 60 * 60 * 24 * SESSION_TTL_DAYS;
  return `${COOKIE_NAME}=${encodeURIComponent(token)}; Path=/; Max-Age=${max}; HttpOnly; Secure; SameSite=None; Domain=.mythos0x.com`;
}

export function clearSessionCookieHeader(): string {
  return `${COOKIE_NAME}=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=None; Domain=.mythos0x.com`;
}

export async function createSession(env: Env, userId: string): Promise<string> {
  const token = randomToken();
  const now = Math.floor(Date.now() / 1000);
  const expires = now + 60 * 60 * 24 * SESSION_TTL_DAYS;
  await env.DB.prepare(
    'INSERT INTO sessions (token, user_id, expires_at, created_at) VALUES (?, ?, ?, ?)',
  )
    .bind(token, userId, expires, now)
    .run();
  return token;
}

export async function lookupSession(env: Env, token: string): Promise<User | null> {
  if (!token) return null;
  const row = await env.DB.prepare(
    `SELECT u.* FROM users u
     JOIN sessions s ON s.user_id = u.id
     WHERE s.token = ? AND s.expires_at > ?`,
  )
    .bind(token, Math.floor(Date.now() / 1000))
    .first<User>();
  return row ?? null;
}

export async function deleteSession(env: Env, token: string): Promise<void> {
  await env.DB.prepare('DELETE FROM sessions WHERE token = ?').bind(token).run();
}

/** Stable per-day anonymous identifier from IP. Rotates daily. */
export async function anonIdentity(req: Request): Promise<string> {
  const ip =
    req.headers.get('cf-connecting-ip') ??
    req.headers.get('x-real-ip') ??
    'unknown';
  const day = utcDay();
  const hash = await sha256Hex(`${ip}|${day}|mythos0x`);
  return `anon:${hash.slice(0, 24)}`;
}

export function userIdentity(userId: string): string {
  return `user:${userId}`;
}

/** Returns current tier based on active subscription, defaulting to 'free'. */
export async function tierForUser(env: Env, userId: string): Promise<Tier> {
  const row = await env.DB.prepare(
    `SELECT tier FROM subscriptions
     WHERE user_id = ? AND status IN ('active','trialing')
     ORDER BY current_period_end DESC LIMIT 1`,
  )
    .bind(userId)
    .first<{ tier: Tier }>();
  return row?.tier ?? 'free';
}

export async function upsertUserByEmail(env: Env, email: string): Promise<User> {
  const now = Math.floor(Date.now() / 1000);
  const normalized = email.trim().toLowerCase();
  const existing = await env.DB.prepare('SELECT * FROM users WHERE email = ?')
    .bind(normalized)
    .first<User>();
  if (existing) {
    await env.DB.prepare('UPDATE users SET last_seen_at = ? WHERE id = ?')
      .bind(now, existing.id)
      .run();
    return existing;
  }
  const id = randomToken(12);
  await env.DB.prepare(
    'INSERT INTO users (id, email, tier, created_at, last_seen_at) VALUES (?, ?, ?, ?, ?)',
  )
    .bind(id, normalized, 'free', now, now)
    .run();
  return {
    id,
    email: normalized,
    stripe_customer_id: null,
    tier: 'free',
    created_at: now,
    last_seen_at: now,
  };
}
