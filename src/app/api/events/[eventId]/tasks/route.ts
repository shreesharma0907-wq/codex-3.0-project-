import { NextResponse } from 'next/server';
import { currentUser } from '@/lib/server/auth';
import { db, id, nowIso } from '@/lib/server/db';
import { canAccessEvent, taskFromRow } from '@/lib/server/event-repository';
import { jsonError, requireRole, validOrigin } from '@/lib/server/http';
import { canAssignSubOrganizerToEvent } from '@/lib/server/team-repository';
import { createNotification } from '@/lib/server/incident-repository';

type Context = { params: Promise<{ eventId: string }> };

export async function GET(request: Request, context: Context) {
  const user = await currentUser(); const denied = requireRole(user, ['organizer', 'sub_organizer']); if (denied) return denied;
  const { eventId } = await context.params; if (!canAccessEvent(eventId, user!.id, user!.role)) return jsonError('Event not found.', 404, 'EVENT_NOT_FOUND');
  const url = new URL(request.url); const status = url.searchParams.get('status');
  const assignedOnly = user!.role === 'sub_organizer';
  const rows = db().prepare(`SELECT t.*,u.name AS owner_name FROM tasks t LEFT JOIN users u ON u.id=t.owner_id WHERE t.event_id=? ${assignedOnly ? 'AND t.owner_id=?' : ''} ${status ? 'AND t.status=?' : ''} ORDER BY t.due_at`).all(...[eventId, ...(assignedOnly ? [user!.id] : []), ...(status ? [status] : [])]);
  return NextResponse.json(rows.map(row => ({
    ...taskFromRow(row), createdAt: row.created_at, updatedAt: row.updated_at,
    comments: db().prepare('SELECT c.id,c.task_id AS taskId,c.user_id AS userId,u.name AS userName,c.content,c.created_at AS createdAt FROM task_comments c JOIN users u ON u.id=c.user_id WHERE c.task_id=? ORDER BY c.created_at').all(row.id),
  })));
}

export async function POST(request: Request, context: Context) {
  if (!validOrigin(request)) return jsonError('Invalid request origin.', 403, 'INVALID_ORIGIN');
  const user = await currentUser(); const denied = requireRole(user, ['organizer', 'sub_organizer']); if (denied) return denied;
  const { eventId } = await context.params; if (!canAccessEvent(eventId, user!.id, user!.role)) return jsonError('Event not found.', 404, 'EVENT_NOT_FOUND');
  if (user!.role !== 'organizer') return jsonError('Only the event organizer can create and assign tasks.', 403, 'FORBIDDEN');
  const body = await request.json().catch(() => null) as Record<string, unknown> | null;
  const title = typeof body?.title === 'string' ? body.title.trim() : '';
  if (!title) return jsonError('Task title is required.', 422, 'INVALID_TASK');
  const ownerId = typeof body?.ownerId === 'string' && body.ownerId.trim() ? body.ownerId.trim() : null;
  if (ownerId) {
    if (user!.role !== 'organizer') return jsonError('Only the event organizer can assign a responder to a task.', 403, 'FORBIDDEN');
    if (!canAssignSubOrganizerToEvent(db(), eventId, ownerId)) return jsonError('Choose an active sub-organizer assigned to this event.', 422, 'INVALID_ASSIGNEE');
  }
  const timestamp = nowIso(); const taskId = id('task');
  db().prepare('INSERT INTO tasks(id,event_id,title,description,priority,status,due_at,owner_id,department,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)').run(taskId, eventId, title, String(body?.description || ''), String(body?.priority || 'medium'), String(body?.status || 'pending'), String(body?.deadline || ''), ownerId, String(body?.functionName || '') || null, timestamp, timestamp);
  if (ownerId) createNotification({ userId: ownerId, eventId, taskId, type: 'info', title: 'New task assigned', message: `You were assigned “${title}”.` });
  return NextResponse.json(taskFromRow(db().prepare('SELECT t.*,u.name AS owner_name FROM tasks t LEFT JOIN users u ON u.id=t.owner_id WHERE t.id=?').get(taskId)!), { status: 201 });
}
