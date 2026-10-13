import { NextResponse } from 'next/server';
import { currentUser } from '@/lib/server/auth';
import { db, id } from '@/lib/server/db';
import { canAccessEvent, taskFromRow } from '@/lib/server/event-repository';
import { jsonError, requireRole, validOrigin } from '@/lib/server/http';
import { canAccessSubOrganizerTask, canAssignSubOrganizerToEvent } from '@/lib/server/team-repository';
import { createNotification } from '@/lib/server/incident-repository';

type Context = { params: Promise<{ taskId: string }> };

export async function PATCH(request: Request, context: Context) {
  if (!validOrigin(request)) return jsonError('Invalid request origin.', 403, 'INVALID_ORIGIN');
  const user = await currentUser(); const denied = requireRole(user, ['organizer', 'sub_organizer']); if (denied) return denied;
  const { taskId } = await context.params;
  const task = db().prepare('SELECT * FROM tasks WHERE id=?').get(taskId);
  if (!task || !canAccessEvent(String(task.event_id), user!.id, user!.role)) return jsonError('Task not found.', 404, 'TASK_NOT_FOUND');
  const body = await request.json().catch(() => null) as Record<string, unknown> | null;
  if (!body || typeof body !== 'object' || Array.isArray(body)) return jsonError('A valid task update is required.', 422, 'INVALID_BODY');
  if (user!.role === 'sub_organizer' && !canAccessSubOrganizerTask(db(), taskId, user!.id)) return jsonError('Task not found.', 404, 'TASK_NOT_FOUND');
  if (user!.role === 'sub_organizer' && body && Object.keys(body).some(key => !['status', 'progressNote', 'requestId', 'requestHelp'].includes(key))) return jsonError('Sub-organizers may update task progress only.', 403, 'FORBIDDEN');
  const now = new Date().toISOString();

  const newStatus = body?.status ? String(body.status) : undefined;
  if (newStatus && !['pending', 'in-progress', 'completed', 'blocked'].includes(newStatus)) {
    return jsonError('A valid task status is required.', 422, 'INVALID_STATUS');
  }
  if (user!.role === 'sub_organizer' && newStatus && !['in-progress', 'completed', 'blocked'].includes(newStatus)) return jsonError('Choose in progress, blocked, or completed.', 422, 'INVALID_STATUS');
  const previousStatus = String(task.status);
  if (user!.role === 'sub_organizer' && previousStatus === 'completed' && newStatus && newStatus !== 'completed') return jsonError('Ask the organizer to reopen completed work.', 403, 'FORBIDDEN');
  const progressNote = typeof body?.progressNote === 'string' ? body.progressNote.trim() : '';
  const requestHelp = body?.requestHelp === true;
  const requestKey = typeof body?.requestId === 'string' && /^[a-zA-Z0-9_-]{8,100}$/.test(body.requestId) ? body.requestId : null;
  if (progressNote.length > 2000) return jsonError('Progress notes must be under 2,000 characters.', 422, 'INVALID_NOTE');
  if (requestHelp && !progressNote) return jsonError('Describe the help you need.', 422, 'HELP_DETAILS_REQUIRED');
  if (newStatus === 'blocked' && !progressNote) return jsonError('Add a reason when blocking a task.', 422, 'BLOCK_REASON_REQUIRED');
  if (newStatus === 'completed' && !progressNote && user!.role === 'sub_organizer') return jsonError('Add a completion summary before submitting work.', 422, 'COMPLETION_SUMMARY_REQUIRED');

  const title = body?.title !== undefined ? String(body.title).trim() : undefined;
  const description = body?.description !== undefined ? String(body.description) : undefined;
  const priority = body?.priority !== undefined ? String(body.priority) : undefined;
  const deadline = body?.deadline !== undefined ? String(body.deadline) : undefined;
  const department = body?.functionName !== undefined ? (String(body.functionName) || null) : undefined;
  const hasOwnerId = Boolean(body && Object.prototype.hasOwnProperty.call(body, 'ownerId'));
  let ownerId: string | null = null;
  if (hasOwnerId) {
    if (user!.role !== 'organizer') return jsonError('Only the event organizer can change task responder assignments.', 403, 'FORBIDDEN');
    const requestedOwnerId = body?.ownerId;
    if (requestedOwnerId !== null && typeof requestedOwnerId !== 'string') return jsonError('A valid responder is required.', 422, 'INVALID_ASSIGNEE');
    ownerId = typeof requestedOwnerId === 'string' && requestedOwnerId.trim() ? requestedOwnerId.trim() : null;
    if (ownerId) {
      if (user!.role !== 'organizer') return jsonError('Only the event organizer can assign a responder to a task.', 403, 'FORBIDDEN');
      if (!canAssignSubOrganizerToEvent(db(), String(task.event_id), ownerId)) return jsonError('Choose an active sub-organizer assigned to this event.', 422, 'INVALID_ASSIGNEE');
    }
  }

  const database = db();
  database.exec('BEGIN IMMEDIATE');
  try {
  const taskChanged = Boolean(newStatus && newStatus !== previousStatus);
  database.prepare(`
    UPDATE tasks
    SET status=COALESCE(?, status),
        title=COALESCE(?, title),
        description=COALESCE(?, description),
        priority=COALESCE(?, priority),
        due_at=COALESCE(?, due_at),
        department=COALESCE(?, department),
        owner_id=CASE WHEN ?=1 THEN ? ELSE owner_id END,
        updated_at=?
    WHERE id=?
  `).run(
    newStatus ?? null,
    title ?? null,
    description ?? null,
    priority ?? null,
    deadline ?? null,
    department ?? null,
    hasOwnerId ? 1 : 0,
    ownerId,
    now,
    taskId
  );

  let progressInserted = false;
  if (progressNote) {
    if (requestKey) {
      progressInserted = database.prepare('INSERT INTO task_comments(id,task_id,user_id,content,request_key,created_at) VALUES(?,?,?,?,?,?) ON CONFLICT(task_id,user_id,request_key) WHERE request_key IS NOT NULL DO NOTHING')
        .run(id('comment'), taskId, user!.id, progressNote, requestKey, now).changes > 0;
    } else {
      database.prepare('INSERT INTO task_comments(id,task_id,user_id,content,created_at) VALUES(?,?,?,?,?)').run(id('comment'), taskId, user!.id, progressNote, now);
      progressInserted = true;
    }
  }
  if ((taskChanged || requestHelp && (progressInserted || !requestKey)) && user!.role === 'sub_organizer') {
    const event = database.prepare('SELECT organizer_id FROM events WHERE id=?').get(task.event_id);
    if (event?.organizer_id) createNotification({
      userId: String(event.organizer_id), eventId: String(task.event_id), taskId,
      type: newStatus === 'blocked' ? 'warning' : newStatus === 'completed' ? 'success' : 'info',
      title: requestHelp ? `Assistance requested: ${String(task.title)}` : `Task ${newStatus!.replace('-', ' ')}`,
      message: requestHelp ? `${user!.name} requested help: ${progressNote}` : `${user!.name} updated “${String(task.title)}” to ${newStatus!.replace('-', ' ')}${progressNote ? `: ${progressNote}` : '.'}`,
    });
  }
  database.exec('COMMIT');
  } catch (error) {
    try { database.exec('ROLLBACK'); } catch { /* transaction already closed */ }
    throw error;
  }

  const updated = database.prepare('SELECT t.*,u.name AS owner_name FROM tasks t LEFT JOIN users u ON u.id=t.owner_id WHERE t.id=?').get(taskId)!;
  const comments = database.prepare('SELECT c.*,u.name AS user_name FROM task_comments c JOIN users u ON u.id=c.user_id WHERE c.task_id=? ORDER BY c.created_at').all(taskId);
  return NextResponse.json({ ...taskFromRow(updated), updatedAt: updated.updated_at, createdAt: updated.created_at, comments });
}
