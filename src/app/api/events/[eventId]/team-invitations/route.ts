import { NextResponse } from 'next/server';
import { currentUser } from '@/lib/server/auth';
import { db, id, nowIso } from '@/lib/server/db';
import { createRawTeamInviteToken, digestTeamInviteToken } from '@/lib/server/signup-repository';
import { jsonError, requireRole, validOrigin } from '@/lib/server/http';

type Context = { params: Promise<{ eventId: string }> };
function safeOrigin(request: Request) {
  const configured = process.env.NEXT_PUBLIC_APP_URL?.trim();
  try { const url = configured ? new URL(configured) : new URL(request.url); return url.origin; }
  catch { return new URL(request.url).origin; }
}

export async function GET(_request: Request, context: Context) {
  const user = await currentUser(); const denied = requireRole(user, ['organizer']); if (denied) return denied;
  const { eventId } = await context.params;
  if (!db().prepare('SELECT id FROM events WHERE id=? AND organizer_id=?').get(eventId, user!.id)) return jsonError('Event not found.', 404, 'EVENT_NOT_FOUND');
  const rows = db().prepare(`SELECT ti.id,ti.event_id,ti.intended_email,ti.responsibility,ti.responsibilities_json,ti.zones,ti.requires_approval,ti.status,ti.accepted_by,ti.accepted_at,ti.expires_at,ti.created_at,u.name AS accepted_name FROM team_invitations ti LEFT JOIN users u ON u.id=ti.accepted_by WHERE ti.event_id=? ORDER BY ti.created_at DESC`).all(eventId);
  return NextResponse.json(rows.map(row => ({ id: row.id, eventId: row.event_id, intendedEmail: row.intended_email, responsibility: row.responsibility, responsibilities: JSON.parse(String(row.responsibilities_json || '[]')), zones: row.zones, requiresApproval: Boolean(row.requires_approval), status: row.status === 'pending' && Date.parse(String(row.expires_at)) <= Date.now() ? 'expired' : row.status, acceptedBy: row.accepted_name || null, acceptedAt: row.accepted_at, expiresAt: row.expires_at, createdAt: row.created_at })));
}

export async function POST(request: Request, context: Context) {
  if (!validOrigin(request)) return jsonError('Invalid request origin.', 403, 'INVALID_ORIGIN');
  const user = await currentUser(); const denied = requireRole(user, ['organizer']); if (denied) return denied;
  const { eventId } = await context.params; const database = db();
  if (!database.prepare('SELECT id FROM events WHERE id=? AND organizer_id=?').get(eventId, user!.id)) return jsonError('Event not found.', 404, 'EVENT_NOT_FOUND');
  const body = await request.json().catch(() => null) as { email?: unknown; responsibility?: unknown; responsibilities?: unknown; zones?: unknown; expiresInDays?: unknown; requiresApproval?: unknown } | null;
  const responsibility = typeof body?.responsibility === 'string' ? body.responsibility.trim() : '';
  const intendedEmail = typeof body?.email === 'string' && body.email.trim() ? body.email.trim().toLowerCase() : null;
  const responsibilities = Array.isArray(body?.responsibilities) ? body!.responsibilities.filter((v): v is string => typeof v === 'string').map(v => v.trim()).filter(Boolean).slice(0,20) : [];
  const zones = typeof body?.zones === 'string' ? body.zones.trim().slice(0,500) : '';
  const days = typeof body?.expiresInDays === 'number' && Number.isInteger(body.expiresInDays) ? body.expiresInDays : 7;
  if (!responsibility || responsibility.length > 120) return jsonError('Enter a responsibility up to 120 characters.', 422, 'INVALID_RESPONSIBILITY');
  if (intendedEmail && (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(intendedEmail) || intendedEmail.length > 254)) return jsonError('Enter a valid invitation email address.', 422, 'INVALID_EMAIL');
  if (days < 1 || days > 30) return jsonError('Invitation expiry must be between 1 and 30 days.', 422, 'INVALID_EXPIRY');
  const token = createRawTeamInviteToken(); const now = nowIso(); const expiresAt = new Date(Date.now() + days * 86400000).toISOString(); const invitationId = id('team_inv');
  database.prepare(`INSERT INTO team_invitations(id,event_id,organizer_id,token_hash,intended_email,responsibility,responsibilities_json,zones,requires_approval,status,expires_at,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,'pending',?,?,?)`)
    .run(invitationId, eventId, user!.id, digestTeamInviteToken(token), intendedEmail, responsibility, JSON.stringify(responsibilities), zones || null, body?.requiresApproval === true ? 1 : 0, expiresAt, now, now);
  return NextResponse.json({ id: invitationId, eventId, email: intendedEmail, responsibility, responsibilities, zones: zones || null, requiresApproval: body?.requiresApproval === true, expiresAt, status: 'pending', invitationUrl: `${safeOrigin(request)}/join/team/${encodeURIComponent(token)}` }, { status: 201 });
}
