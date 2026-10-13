import { NextResponse } from 'next/server';
import { db, nowIso } from '@/lib/server/db';
import { authenticateUser, createSession, ensureBootstrapOrganizer, normalizeEmail, sessionCookie } from '@/lib/server/auth';
import { jsonError, validOrigin } from '@/lib/server/http';

export async function POST(request: Request) {
  if (!validOrigin(request)) return jsonError('Invalid request origin.', 403, 'INVALID_ORIGIN');
  await ensureBootstrapOrganizer();
  const body = await request.json().catch(() => null) as { email?: unknown; password?: unknown } | null;
  const email = typeof body?.email === 'string' ? normalizeEmail(body.email) : '';
  const password = typeof body?.password === 'string' ? body.password : '';
  const user = await authenticateUser(db(), email, password);
  if (!user) return jsonError('Email or password is incorrect.', 401, 'INVALID_CREDENTIALS');
  db().prepare('DELETE FROM auth_sessions WHERE expires_at<=?').run(nowIso());
  const session = await createSession(user.id);
  const response = NextResponse.json({ user });
  response.cookies.set(sessionCookie(session.token, session.expires));
  return response;
}
