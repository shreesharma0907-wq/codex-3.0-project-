import { NextResponse } from 'next/server';
import { currentUser } from '@/lib/server/auth';
import { db, id } from '@/lib/server/db';
import { canAccessEvent, taskFromRow } from '@/lib/server/event-repository';
import { jsonError, requireRole, validOrigin } from '@/lib/server/http';
import { canAccessSubOrganizerTask, canAssignSubOrganizerToEvent } from '@/lib/server/team-repository';
import { createNotification } from '@/lib/server/incident-repository';
import { createTaskCompletionNotification, listTaskActivities, recordTaskActivity, recordTaskActivityId } from '@/lib/server/task-repository';

type Context = { params: Promise<{ taskId: string }> };

export async function GET(_request: Request, context: Context) {
  const user = await currentUser();
  const denied = requireRole(user, ['organizer', 'sub_organizer']);
  if (denied) return denied;
  const { taskId } = await context.params;
  const database = db();
  const row = database.prepare(`SELECT t.*,u.name AS owner_name,e.name AS event_name,
      i.id AS linked_incident_id,i.reference_number AS linked_incident_reference,i.title AS linked_incident_title
    FROM tasks t JOIN events e ON e.id=t.event_id
    LEFT JOIN users u ON u.id=t.owner_id
    LEFT JOIN incidents i ON i.id=t.related_incident_id AND i.event_id=t.event_id
    WHERE t.id=?`).get(taskId);
  if (!row || !canAccessEvent(String(row.event_id), user!.id, user!.role)) return jsonError('Task not found.', 404, 'TASK_NOT_FOUND');
  if (user!.role === 'sub_organizer' && !canAccessSubOrganizerTask(database, taskId, user!.id)) return jsonError('Task not found.', 404, 'TASK_NOT_FOUND');
  const comments = database.prepare(`SELECT c.id,c.task_id AS taskId,c.user_id AS userId,u.name AS userName,c.content,c.created_at AS createdAt
    FROM task_comments c JOIN users u ON u.id=c.user_id WHERE c.task_id=? ORDER BY c.created_at,c.id`).all(taskId);
  return NextResponse.json({
    ...taskFromRow(row),
    eventName: String(row.event_name),
    linkedIncident: row.linked_incident_id ? { id: String(row.linked_incident_id), referenceNumber: String(row.linked_incident_reference || ''), title: String(row.linked_incident_title || '') } : null,
    comments,
    activities: listTaskActivities(database, taskId),
  });
}

export async function PATCH(request: Request, context: Context) {
  if (!validOrigin(request)) return jsonError('Invalid request origin.', 403, 'INVALID_ORIGIN');
  const user = await currentUser(); const denied = requireRole(user, ['organizer', 'sub_organizer']); if (denied) return denied;
  const { taskId } = await context.params;
  let task = db().prepare('SELECT * FROM tasks WHERE id=?').get(taskId);
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
  if (body?.requestId !== undefined && (typeof body.requestId !== 'string' || !/^[a-zA-Z0-9_-]{8,100}$/.test(body.requestId))) return jsonError('The task request identifier is invalid.', 422, 'INVALID_REQUEST_ID');
  const requestKey = typeof body?.requestId === 'string' && /^[a-zA-Z0-9_-]{8,100}$/.test(body.requestId) ? body.requestId : null;
  if (progressNote.length > 2000) return jsonError('Progress notes must be under 2,000 characters.', 422, 'INVALID_NOTE');
  if (requestHelp && !progressNote) return jsonError('Describe the help you need.', 422, 'HELP_DETAILS_REQUIRED');
  if (newStatus === 'blocked' && !progressNote) return jsonError('Add a reason when blocking a task.', 422, 'BLOCK_REASON_REQUIRED');
  if (newStatus === 'completed' && !progressNote && user!.role === 'sub_organizer') return jsonError('Add a completion summary before submitting work.', 422, 'COMPLETION_SUMMARY_REQUIRED');

  const title = body?.title !== undefined ? String(body.title).trim() : undefined;
  if (title !== undefined && (!title || title.length > 200)) return jsonError('Enter a task title up to 200 characters.', 422, 'INVALID_TASK');
  const description = body?.description !== undefined ? String(body.description) : undefined;
  if (description !== undefined && description.length > 5000) return jsonError('Task descriptions must be under 5,000 characters.', 422, 'INVALID_DESCRIPTION');
  const priority = body?.priority !== undefined ? String(body.priority) : undefined;
  if (priority !== undefined && !['urgent', 'high', 'medium', 'low'].includes(priority)) return jsonError('Choose a valid task priority.', 422, 'INVALID_PRIORITY');
  if (body?.assignee !== undefined && (typeof body.assignee !== 'string' || !['marketing', 'partnerships', 'operations', 'programme', 'leadership'].includes(body.assignee))) return jsonError('Choose a valid task function.', 422, 'INVALID_FUNCTION');
  const deadline = body?.deadline !== undefined ? String(body.deadline) : undefined;
  if (deadline !== undefined && deadline && !Number.isFinite(Date.parse(deadline))) return jsonError('Enter a valid task deadline.', 422, 'INVALID_DEADLINE');
  const departmentInput = body?.functionName ?? body?.assignee;
  const department = departmentInput !== undefined ? (String(departmentInput) || null) : undefined;
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
  task = database.prepare('SELECT * FROM tasks WHERE id=?').get(taskId);
  if (!task || !canAccessEvent(String(task.event_id), user!.id, user!.role)) throw new Error('TASK_ACCESS_REVOKED');
  if (user!.role === 'sub_organizer' && !canAccessSubOrganizerTask(database, taskId, user!.id)) throw new Error('TASK_ACCESS_REVOKED');
  if (requestKey && database.prepare(`SELECT 1 FROM task_activities WHERE task_id=? AND actor_id=? AND request_key IN (?,?,?) LIMIT 1`).get(taskId, user!.id, `${requestKey}-status`, `${requestKey}-assignment`, `${requestKey}-note`)) {
    database.exec('COMMIT');
    const current = database.prepare('SELECT t.*,u.name AS owner_name FROM tasks t LEFT JOIN users u ON u.id=t.owner_id WHERE t.id=?').get(taskId)!;
    const comments = database.prepare('SELECT c.*,u.name AS user_name FROM task_comments c JOIN users u ON u.id=c.user_id WHERE c.task_id=? ORDER BY c.created_at').all(taskId);
    return NextResponse.json({ ...taskFromRow(current), comments, activities: listTaskActivities(database, taskId) });
  }
  if (hasOwnerId && ownerId && !canAssignSubOrganizerToEvent(database, String(task.event_id), ownerId)) throw new Error('INVALID_ASSIGNEE');
  const currentStatus = String(task.status);
  const transitions: Record<string, string[]> = { pending: ['in-progress', 'blocked', 'completed'], 'in-progress': ['pending', 'blocked', 'completed'], blocked: ['pending', 'in-progress', 'completed'], completed: ['pending', 'in-progress'] };
  if (newStatus && newStatus !== currentStatus && !transitions[currentStatus]?.includes(newStatus)) throw new Error('INVALID_STATUS_TRANSITION');
  if (user!.role === 'sub_organizer' && currentStatus === 'completed' && newStatus && newStatus !== 'completed') throw new Error('ORGANIZER_REOPEN_REQUIRED');
  const currentOwnerId = task.owner_id ? String(task.owner_id) : null;
  const taskChanged = Boolean(newStatus && newStatus !== currentStatus);
  const assignmentChanged = hasOwnerId && ownerId !== currentOwnerId;
  database.prepare(`
    UPDATE tasks
    SET status=COALESCE(?, status),
        title=COALESCE(?, title),
        description=COALESCE(?, description),
        priority=COALESCE(?, priority),
        due_at=COALESCE(?, due_at),
        department=COALESCE(?, department),
        owner_id=CASE WHEN ?=1 THEN ? ELSE owner_id END,
        assigned_at=CASE WHEN ?=1 THEN ? ELSE assigned_at END,
        completed_at=CASE WHEN ?='completed' THEN COALESCE(completed_at,?) WHEN ? IS NOT NULL AND ?<>'completed' THEN NULL ELSE completed_at END,
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
    assignmentChanged ? 1 : 0,
    assignmentChanged && ownerId ? now : null,
    newStatus ?? null,
    now,
    newStatus ?? null,
    newStatus ?? null,
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
  const statusAction = newStatus === 'completed' ? 'completed' : newStatus === 'blocked' ? 'blocked' : currentStatus === 'completed' && newStatus ? 'reopened' : 'status_changed';
  const statusActivityId = taskChanged ? recordTaskActivityId(database, { taskId, actorId: user!.id, action: statusAction, details: progressNote, fromStatus: currentStatus, toStatus: newStatus, requestKey: requestKey ? `${requestKey}-status` : null, createdAt: now }) : null;
  const statusActivityInserted = statusActivityId !== null;
  if (assignmentChanged) {
    const oldOwner = currentOwnerId ? database.prepare('SELECT name FROM users WHERE id=?').get(currentOwnerId) : undefined;
    const newOwner = ownerId ? database.prepare('SELECT name FROM users WHERE id=?').get(ownerId) : undefined;
    recordTaskActivity(database, { taskId, actorId: user!.id, action: ownerId ? currentOwnerId ? 'reassigned' : 'assigned' : 'reassigned', details: ownerId ? `${currentOwnerId ? `Reassigned from ${String(oldOwner?.name || 'former responder')} to` : 'Assigned to'} ${String(newOwner?.name || 'responder')}.` : `Unassigned from ${String(oldOwner?.name || 'former responder')}.`, requestKey: requestKey ? `${requestKey}-assignment` : null, createdAt: now });
    if (currentOwnerId && currentOwnerId !== ownerId) createNotification({ userId: currentOwnerId, eventId: String(task.event_id), taskId, type: 'info', title: 'Task assignment changed', message: `“${String(task.title)}” is no longer assigned to you.` });
  }
  if (progressInserted) recordTaskActivity(database, { taskId, actorId: user!.id, action: requestHelp ? 'assistance_requested' : 'progress_update', details: progressNote, requestKey: requestKey ? `${requestKey}-note` : null, createdAt: now });
  if (assignmentChanged && ownerId) createNotification({ userId: ownerId, eventId: String(task.event_id), taskId, type: 'info', title: currentOwnerId ? 'Task reassigned to you' : 'New task assigned', message: `You were assigned “${String(task.title)}”.` });
  if ((taskChanged || progressInserted) && user!.role === 'sub_organizer') {
    const event = database.prepare('SELECT organizer_id,name FROM events WHERE id=?').get(task.event_id);
    if (event?.organizer_id && newStatus === 'completed' && statusActivityInserted && statusActivityId) {
      createTaskCompletionNotification(database, { userId: String(event.organizer_id), eventId: String(task.event_id), taskId,
        sourceKey: `task-completion:${statusActivityId}`, taskTitle: String(task.title), actorName: user!.name,
        eventName: String(event.name), completedAt: now, summary: progressNote });
    } else if (event?.organizer_id && newStatus !== 'completed') createNotification({
      userId: String(event.organizer_id), eventId: String(task.event_id), taskId,
      type: newStatus === 'blocked' ? 'warning' : 'info',
      title: requestHelp ? `Assistance requested: ${String(task.title)}` : taskChanged ? `Task ${newStatus!.replace('-', ' ')}` : `Task progress: ${String(task.title)}`,
      message: requestHelp ? `${user!.name} requested help: ${progressNote}` : `${user!.name} updated “${String(task.title)}”${newStatus ? ` to ${newStatus.replace('-', ' ')}` : ''}${progressNote ? `: ${progressNote}` : '.'}`,
    });
  }
  database.exec('COMMIT');
  } catch (error) {
    try { database.exec('ROLLBACK'); } catch { /* transaction already closed */ }
    if (error instanceof Error && error.message === 'TASK_ACCESS_REVOKED') return jsonError('Task not found.', 404, 'TASK_NOT_FOUND');
    if (error instanceof Error && error.message === 'INVALID_ASSIGNEE') return jsonError('Choose an active sub-organizer assigned to this event.', 422, 'INVALID_ASSIGNEE');
    if (error instanceof Error && error.message === 'INVALID_STATUS_TRANSITION') return jsonError('That task status transition is not allowed.', 422, 'INVALID_STATUS_TRANSITION');
    if (error instanceof Error && error.message === 'ORGANIZER_REOPEN_REQUIRED') return jsonError('Ask the organizer to reopen completed work.', 403, 'FORBIDDEN');
    throw error;
  }

  const updated = database.prepare('SELECT t.*,u.name AS owner_name FROM tasks t LEFT JOIN users u ON u.id=t.owner_id WHERE t.id=?').get(taskId)!;
  const comments = database.prepare('SELECT c.*,u.name AS user_name FROM task_comments c JOIN users u ON u.id=c.user_id WHERE c.task_id=? ORDER BY c.created_at').all(taskId);
  return NextResponse.json({ ...taskFromRow(updated), updatedAt: updated.updated_at, createdAt: updated.created_at, comments, activities: listTaskActivities(database, taskId) });
}
