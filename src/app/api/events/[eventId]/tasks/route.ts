import { NextResponse } from 'next/server';
import { currentUser } from '@/lib/server/auth';
import { db, id, nowIso } from '@/lib/server/db';
import { canAccessEvent, taskFromRow } from '@/lib/server/event-repository';
import { jsonError, requireRole, validOrigin } from '@/lib/server/http';
import { canAssignSubOrganizerToEvent } from '@/lib/server/team-repository';
import { createNotification } from '@/lib/server/incident-repository';
import { listTaskActivities, recordTaskActivity } from '@/lib/server/task-repository';

type Context = { params: Promise<{ eventId: string }> };

export async function GET(request: Request, context: Context) {
  const user = await currentUser(); const denied = requireRole(user, ['organizer', 'sub_organizer']); if (denied) return denied;
  const { eventId } = await context.params; if (!canAccessEvent(eventId, user!.id, user!.role)) return jsonError('Event not found.', 404, 'EVENT_NOT_FOUND');
  const url = new URL(request.url); const status = url.searchParams.get('status');
  const assignedOnly = user!.role === 'sub_organizer';
  const rows = db().prepare(`SELECT t.*,u.name AS owner_name FROM tasks t LEFT JOIN users u ON u.id=t.owner_id WHERE t.event_id=? ${assignedOnly ? 'AND t.owner_id=?' : ''} ${status ? 'AND t.status=?' : ''} ORDER BY t.due_at`).all(...[eventId, ...(assignedOnly ? [user!.id] : []), ...(status ? [status] : [])]);
  return NextResponse.json(rows.map(row => ({
    ...taskFromRow(row),
    comments: db().prepare('SELECT c.id,c.task_id AS taskId,c.user_id AS userId,u.name AS userName,c.content,c.created_at AS createdAt FROM task_comments c JOIN users u ON u.id=c.user_id WHERE c.task_id=? ORDER BY c.created_at').all(row.id),
    activities: listTaskActivities(db(), String(row.id)),
  })));
}

export async function POST(request: Request, context: Context) {
  if (!validOrigin(request)) return jsonError('Invalid request origin.', 403, 'INVALID_ORIGIN');
  const user = await currentUser(); const denied = requireRole(user, ['organizer', 'sub_organizer']); if (denied) return denied;
  const { eventId } = await context.params; if (!canAccessEvent(eventId, user!.id, user!.role)) return jsonError('Event not found.', 404, 'EVENT_NOT_FOUND');
  if (user!.role !== 'organizer') return jsonError('Only the event organizer can create and assign tasks.', 403, 'FORBIDDEN');
  const body = await request.json().catch(() => null) as Record<string, unknown> | null;
  const title = typeof body?.title === 'string' ? body.title.trim() : '';
  if (!title || title.length > 200) return jsonError('Enter a task title up to 200 characters.', 422, 'INVALID_TASK');
  const description = typeof body?.description === 'string' ? body.description.trim() : '';
  if (description.length > 5000) return jsonError('Task descriptions must be under 5,000 characters.', 422, 'INVALID_DESCRIPTION');
  const priority = typeof body?.priority === 'string' ? body.priority : 'medium';
  if (!['urgent', 'high', 'medium', 'low'].includes(priority)) return jsonError('Choose a valid task priority.', 422, 'INVALID_PRIORITY');
  if (body?.assignee !== undefined && (typeof body.assignee !== 'string' || !['marketing', 'partnerships', 'operations', 'programme', 'leadership'].includes(body.assignee))) return jsonError('Choose a valid task function.', 422, 'INVALID_FUNCTION');
  const deadline = typeof body?.deadline === 'string' ? body.deadline.trim() : '';
  if (deadline && !Number.isFinite(Date.parse(deadline))) return jsonError('Enter a valid task deadline.', 422, 'INVALID_DEADLINE');
  const requestIdSupplied = body?.requestId !== undefined;
  const requestKey = typeof body?.requestId === 'string' && /^[a-zA-Z0-9_-]{8,100}$/.test(body.requestId) ? body.requestId : null;
  if (requestIdSupplied && !requestKey) return jsonError('The task request identifier is invalid.', 422, 'INVALID_REQUEST_ID');
  const relatedIncidentId = typeof body?.relatedIncidentId === 'string' && body.relatedIncidentId.trim() ? body.relatedIncidentId.trim() : null;
  if (relatedIncidentId && !db().prepare('SELECT id FROM incidents WHERE id=? AND event_id=?').get(relatedIncidentId, eventId)) return jsonError('The related incident must belong to this event.', 422, 'INVALID_RELATED_INCIDENT');
  const ownerId = typeof body?.ownerId === 'string' && body.ownerId.trim() ? body.ownerId.trim() : null;
  if (ownerId) {
    if (user!.role !== 'organizer') return jsonError('Only the event organizer can assign a responder to a task.', 403, 'FORBIDDEN');
    if (!canAssignSubOrganizerToEvent(db(), eventId, ownerId)) return jsonError('Choose an active sub-organizer assigned to this event.', 422, 'INVALID_ASSIGNEE');
  }
  const functionInput = body?.functionName ?? body?.assignee;
  const functionName = typeof functionInput === 'string' ? functionInput.trim().slice(0, 120) : '';
  const timestamp = nowIso(); const database = db(); const taskId = id('task');
  database.exec('BEGIN IMMEDIATE');
  try {
    const duplicate = requestKey ? database.prepare('SELECT id FROM tasks WHERE created_by=? AND request_key=?').get(user!.id, requestKey) : undefined;
    if (duplicate) {
      const existingTask = database.prepare('SELECT event_id FROM tasks WHERE id=?').get(duplicate.id);
      database.exec('COMMIT');
      if (String(existingTask?.event_id) !== eventId) return jsonError('This request identifier was already used for a different event.', 409, 'IDEMPOTENCY_CONFLICT');
      const existing = database.prepare('SELECT t.*,u.name AS owner_name FROM tasks t LEFT JOIN users u ON u.id=t.owner_id WHERE t.id=?').get(duplicate.id)!;
      return NextResponse.json({ ...taskFromRow(existing), comments: [], activities: listTaskActivities(database, String(existing.id)) });
    }
    const incidentTask = relatedIncidentId ? database.prepare('SELECT id FROM tasks WHERE event_id=? AND related_incident_id=?').get(eventId, relatedIncidentId) : undefined;
    if (incidentTask) {
      database.exec('COMMIT');
      const existing = database.prepare('SELECT t.*,u.name AS owner_name FROM tasks t LEFT JOIN users u ON u.id=t.owner_id WHERE t.id=?').get(incidentTask.id)!;
      return NextResponse.json({ ...taskFromRow(existing), comments: [], activities: listTaskActivities(database, String(existing.id)) });
    }
    if (ownerId && !canAssignSubOrganizerToEvent(database, eventId, ownerId)) throw new Error('INVALID_ASSIGNEE');
    database.prepare(`INSERT INTO tasks(id,event_id,title,description,priority,status,due_at,owner_id,created_by,assigned_at,related_incident_id,request_key,department,created_at,updated_at,completed_at)
      VALUES(?,?,?,?,?,'pending',?,?,?,?,?,?,?, ?, ?, NULL)`)
      .run(taskId, eventId, title, description, priority, deadline, ownerId, user!.id, ownerId ? timestamp : null, relatedIncidentId, requestKey, functionName || null, timestamp, timestamp);
    recordTaskActivity(database, { taskId, actorId: user!.id, action: 'created', details: title, requestKey: requestKey ? `${requestKey}-created` : null, createdAt: timestamp });
    if (ownerId) {
      const owner = database.prepare('SELECT name FROM users WHERE id=?').get(ownerId);
      recordTaskActivity(database, { taskId, actorId: user!.id, action: 'assigned', details: `Assigned to ${String(owner?.name || 'responder')}`, requestKey: requestKey ? `${requestKey}-assigned` : null, createdAt: timestamp });
      createNotification({ userId: ownerId, eventId, taskId, type: 'info', title: 'New task assigned', message: `You were assigned “${title}”.` });
    }
    database.exec('COMMIT');
  } catch (error) {
    try { database.exec('ROLLBACK'); } catch { /* transaction may already be closed */ }
    if (error instanceof Error && error.message === 'INVALID_ASSIGNEE') return jsonError('Choose an active sub-organizer assigned to this event.', 422, 'INVALID_ASSIGNEE');
    if (relatedIncidentId) {
      const existing = database.prepare('SELECT t.*,u.name AS owner_name FROM tasks t LEFT JOIN users u ON u.id=t.owner_id WHERE t.event_id=? AND t.related_incident_id=?').get(eventId, relatedIncidentId);
      if (existing) return NextResponse.json({ ...taskFromRow(existing), comments: [], activities: listTaskActivities(database, String(existing.id)) });
    }
    throw error;
  }
  const created = database.prepare('SELECT t.*,u.name AS owner_name FROM tasks t LEFT JOIN users u ON u.id=t.owner_id WHERE t.id=?').get(taskId)!;
  return NextResponse.json({ ...taskFromRow(created), comments: [], activities: listTaskActivities(database, taskId) }, { status: 201 });
}
