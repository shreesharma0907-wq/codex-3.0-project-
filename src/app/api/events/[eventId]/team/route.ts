import { NextResponse } from 'next/server';
import { currentUser } from '@/lib/server/auth';
import { db, id, nowIso } from '@/lib/server/db';
import { jsonError, requireRole, validOrigin } from '@/lib/server/http';
import { canReadEventTeam, listTeamMembers } from '@/lib/server/team-repository';

type Context = { params: Promise<{ eventId: string }> };

export async function GET(_request: Request, context: Context) {
  const user = await currentUser(); const denied = requireRole(user, ['organizer', 'sub_organizer']); if (denied) return denied;
  const { eventId } = await context.params;
  if (!canReadEventTeam(db(), eventId, user!.id, user!.role)) return jsonError('Event not found.', 404, 'EVENT_NOT_FOUND');
  return NextResponse.json(listTeamMembers(db(), eventId, nowIso()));
}

export async function POST(request: Request, context: Context) {
  if (!validOrigin(request)) return jsonError('Invalid request origin.', 403, 'INVALID_ORIGIN');
  const user = await currentUser(); const denied = requireRole(user, ['organizer']); if (denied) return denied;
  const { eventId } = await context.params;
  if (!db().prepare('SELECT id FROM events WHERE id=? AND organizer_id=?').get(eventId, user!.id)) return jsonError('Event not found.', 404, 'EVENT_NOT_FOUND');
  const body = await request.json().catch(() => null) as { userId?: unknown; responsibility?: unknown } | null;
  const userId = typeof body?.userId === 'string' ? body.userId : ''; const responsibility = typeof body?.responsibility === 'string' ? body.responsibility.trim() : '';
  if (!userId || !responsibility) return jsonError('User and responsibility are required.', 422, 'INVALID_ASSIGNMENT');
  const assigned = db().prepare("SELECT id FROM users WHERE id=? AND role='sub_organizer' AND status='active'").get(userId);
  if (!assigned) return jsonError('Only active sub-organizer accounts can be assigned.', 422, 'INVALID_ASSIGNEE');
  const timestamp = nowIso(); const assignmentId = id('assignment');
  try { db().prepare('INSERT INTO team_assignments(id,event_id,user_id,responsibility,status,created_at,updated_at) VALUES(?,?,?,?,?,?,?)').run(assignmentId, eventId, userId, responsibility, 'active', timestamp, timestamp); }
  catch { return jsonError('This assignment already exists.', 409, 'ASSIGNMENT_EXISTS'); }
  return NextResponse.json(db().prepare('SELECT ta.*,u.name,u.email,u.role FROM team_assignments ta JOIN users u ON u.id=ta.user_id WHERE ta.id=?').get(assignmentId), { status: 201 });
}
