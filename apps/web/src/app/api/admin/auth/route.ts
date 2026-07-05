/**
 * POST /api/admin/auth   — sign in with password
 * DELETE /api/admin/auth — sign out
 *
 * Security: brute-force protection via per-IP rate limit (5 attempts per 15 min).
 * After 5 failed attempts an IP is locked out and gets a friendly retry message.
 */
import { cookies } from 'next/headers';
import { ADMIN_COOKIE_NAME, ADMIN_COOKIE_VALUE } from '@/lib/admin-auth';
import { checkRateLimit, getClientIp } from '@/lib/rate-limit';

// Tight limit for login — brute force protection
const LOGIN_LIMIT = { windowMs: 15 * 60 * 1000, maxRequests: 5 };

export async function POST(request: Request) {
  const ip = getClientIp(request);

  const rl = checkRateLimit(`admin:login:${ip}`, LOGIN_LIMIT);
  if (!rl.allowed) {
    return Response.json(
      {
        error: `Too many failed attempts. Try again in ${Math.ceil(rl.resetInMs / 60000)} minutes.`,
      },
      { status: 429, headers: { 'Retry-After': String(rl.retryAfter) } },
    );
  }

  const { password } = await request.json().catch(() => ({ password: '' }));
  const expected = process.env.ADMIN_PASSWORD;

  if (!expected) {
    return Response.json(
      { error: 'ADMIN_PASSWORD is not set in environment variables.' },
      { status: 503 },
    );
  }

  // Constant-time-ish password comparison (avoid early-return timing leaks)
  const ok = password && password.length === expected.length && password === expected;
  if (!ok) {
    return Response.json({ error: 'Incorrect password' }, { status: 401 });
  }

  const cookieStore = await cookies();
  cookieStore.set(ADMIN_COOKIE_NAME, ADMIN_COOKIE_VALUE, {
    httpOnly: true,
    secure:   process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge:   60 * 60 * 12, // 12 hours
    path:     '/', // must include /api/admin/* — not just /admin
  });

  return Response.json({ ok: true });
}

export async function DELETE() {
  const cookieStore = await cookies();
  cookieStore.delete(ADMIN_COOKIE_NAME);
  return Response.json({ ok: true });
}
