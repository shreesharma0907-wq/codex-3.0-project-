import { NextRequest, NextResponse } from 'next/server';
import { db, nowIso } from '@/lib/server/db';
import { currentUser } from '@/lib/server/auth';
import { jsonError, requireRole, validOrigin } from '@/lib/server/http';
import {
  getIncidentById,
  getIncidentMessages,
  getIncidentActivities,
  logIncidentActivity,
  createNotification,
  VALID_STATUS_TRANSITIONS,
} from '@/lib/server/incident-repository';
import type { IncidentStatus } from '@/lib/types';
import { canAccessEvent } from '@/lib/server/event-repository';
import { canAccessSubOrganizerIncident } from '@/lib/server/team-repository';

function canAccessIncident(user: NonNullable<Awaited<ReturnType<typeof currentUser>>>, incident: NonNullable<ReturnType<typeof getIncidentById>>) {
  if (user.role === 'participant') return incident.reporterId === user.id;
  if (user.role === 'organizer') return canAccessEvent(incident.eventId, user.id, user.role);
  return canAccessSubOrganizerIncident(db(), incident.id, user.id);
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ incidentId: string }> }
) {
  const user = await currentUser();
  const authError = requireRole(user, ['organizer', 'sub_organizer', 'participant']);
  if (authError) return authError;
  const { incidentId } = await params;

  const incident = getIncidentById(incidentId);
  if (!incident) return jsonError('Incident not found.', 404, 'NOT_FOUND');
  if (!canAccessIncident(user!, incident)) return jsonError('Incident not found.', 404, 'NOT_FOUND');

  const isInternalViewer = user!.role === 'organizer' || user!.role === 'sub_organizer';
  const messages = getIncidentMessages(incidentId, isInternalViewer);
  const activities = isInternalViewer ? getIncidentActivities(incidentId) : [];

  const assignments = isInternalViewer
    ? db()
        .prepare(`
          SELECT a.*, r.name as responder_name, u.name as assigned_by_name
          FROM incident_assignments a
          JOIN users r ON r.id = a.responder_id
          JOIN users u ON u.id = a.assigned_by
          WHERE a.incident_id = ?
          ORDER BY a.assigned_at DESC
        `)
        .all(incidentId)
        .map(row => ({
          id: String(row.id),
          incidentId: String(row.incident_id),
          responderId: String(row.responder_id),
          responderName: String(row.responder_name),
          assignedBy: String(row.assigned_by),
          assignedByName: String(row.assigned_by_name),
          reason: String(row.reason),
          status: row.status,
          assignedAt: String(row.assigned_at),
          acknowledgedAt: row.acknowledged_at ? String(row.acknowledged_at) : undefined,
        }))
    : [];

  return NextResponse.json({
    ...incident,
    messages,
    activities,
    assignments,
  });
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ incidentId: string }> }
) {
  if (!validOrigin(request)) return jsonError('Invalid request origin.', 403, 'INVALID_ORIGIN');
  const user = await currentUser();
  const authError = requireRole(user, ['organizer', 'sub_organizer', 'participant']);
  if (authError) return authError;
  const { incidentId } = await params;

  const incident = getIncidentById(incidentId);
  if (!incident) return jsonError('Incident not found.', 404, 'NOT_FOUND');
  if (!canAccessIncident(user!, incident)) return jsonError('Incident not found.', 404, 'NOT_FOUND');

  const body = await request.json().catch(() => ({}));
  if (user!.role === 'sub_organizer' && body.escalate === true) {
    const reason = typeof body.reason === 'string' ? body.reason.trim() : '';
    if (!reason || reason.length > 1500) return jsonError('Provide an escalation reason under 1,500 characters.', 422, 'INVALID_ESCALATION');
    const eventRow = db().prepare('SELECT organizer_id FROM events WHERE id=?').get(incident.eventId);
    if (!eventRow?.organizer_id) return jsonError('Event organizer could not be found.', 409, 'EVENT_OWNER_MISSING');
    const requestKey = typeof body.requestId === 'string' && /^[a-zA-Z0-9_-]{8,100}$/.test(body.requestId)
      ? body.requestId : `escalation-${user!.id}`;
    const database = db();
    database.exec('BEGIN IMMEDIATE');
    try {
      const inserted = logIncidentActivity(incidentId, user!.id, 'escalated', `${user!.name} requested organizer attention: ${reason}`, requestKey);
      if (inserted) createNotification({ userId: String(eventRow.organizer_id), eventId: incident.eventId, incidentId, type: incident.urgency === 'critical' ? 'error' : 'warning', title: `Escalation: ${incident.referenceNumber}`, message: reason });
      database.exec('COMMIT');
      return NextResponse.json({ success: true, duplicate: !inserted, escalatedAt: nowIso() });
    } catch (error) {
      try { database.exec('ROLLBACK'); } catch { /* transaction already closed */ }
      throw error;
    }
  }
  const targetStatus = body.status as IncidentStatus | undefined;
  const resolutionNotes = body.resolutionNotes ? String(body.resolutionNotes).trim() : undefined;
  const now = nowIso();

  if (targetStatus) {
    // Check legal transition
    const allowed = VALID_STATUS_TRANSITIONS[incident.status] || [];
    if (!allowed.includes(targetStatus)) {
      return jsonError(
        `Invalid status transition from '${incident.status}' to '${targetStatus}'. Allowed: ${allowed.join(', ')}`,
        400,
        'INVALID_TRANSITION'
      );
    }

    // Participants can only reopen or acknowledge
    if (user!.role === 'participant') {
      if (targetStatus !== 'reopened') {
        return jsonError('Participants can only reopen resolved incidents.', 403, 'FORBIDDEN');
      }
      if (incident.reporterId !== user!.id) {
        return jsonError('You can only update your own incident.', 403, 'FORBIDDEN');
      }
    }

    // Sub-organizers can acknowledge, set in_progress, waiting_external, or resolved if assigned
    if (user!.role === 'sub_organizer') {
      if (incident.assignedResponderId !== user!.id) {
        return jsonError('You can only update incidents assigned to you.', 403, 'FORBIDDEN');
      }
      if (targetStatus === 'closed') {
        return jsonError('Only organizers can close an incident.', 403, 'FORBIDDEN');
      }
    }

    let resolvedAt = incident.resolvedAt;
    let closedAt = incident.closedAt;
    let acknowledgedAt = incident.acknowledgedAt;

    if (targetStatus === 'acknowledged') {
      acknowledgedAt = now;
    } else if (targetStatus === 'resolved') {
      resolvedAt = now;
      if (!resolutionNotes && !incident.resolutionNotes) {
        return jsonError('Resolution notes are required when resolving an incident.', 400, 'VALIDATION_ERROR');
      }
    } else if (targetStatus === 'closed') {
      closedAt = now;
    }

    db().prepare(`
      UPDATE incidents
      SET status=?, resolution_notes=COALESCE(?, resolution_notes), acknowledged_at=?, resolved_at=?, closed_at=?, updated_at=?
      WHERE id=?
    `).run(
      targetStatus,
      resolutionNotes ?? null,
      acknowledgedAt ?? null,
      resolvedAt ?? null,
      closedAt ?? null,
      now,
      incidentId
    );

    // Activity log
    logIncidentActivity(
      incidentId,
      user!.id,
      `status_${targetStatus}`,
      `Status changed from ${incident.status} to ${targetStatus}${resolutionNotes ? `. Notes: ${resolutionNotes}` : ''}`
    );

    // Notify parties
    // 1. Notify reporter if resolved or closed or acknowledged
    if (['acknowledged', 'resolved', 'closed'].includes(targetStatus)) {
      createNotification({
        userId: incident.reporterId,
        eventId: incident.eventId,
        incidentId,
        type: targetStatus === 'resolved' ? 'success' : 'info',
        title: `Incident ${incident.referenceNumber} ${targetStatus.toUpperCase()}`,
        message: targetStatus === 'resolved'
          ? `Your issue has been resolved: ${resolutionNotes || 'Resolution details provided by responder.'}`
          : `Your report status is now: ${targetStatus}.`,
      });
    }

    // 2. Notify organizer if responder acknowledged or resolved
    if (user!.role === 'sub_organizer' && ['acknowledged', 'resolved'].includes(targetStatus)) {
      const eventRow = db().prepare('SELECT organizer_id FROM events WHERE id=?').get(incident.eventId);
      if (eventRow?.organizer_id) {
        createNotification({
          userId: String(eventRow.organizer_id),
          eventId: incident.eventId,
          incidentId,
          type: 'info',
          title: `Incident ${incident.referenceNumber} Updated by Responder`,
          message: `${user!.name} updated status to ${targetStatus}.`,
        });
      }
    }

    // If resolved, also check if linked operational task exists
    if (targetStatus === 'resolved' && incident.relatedTaskId) {
      db().prepare('UPDATE tasks SET status=\'completed\', updated_at=? WHERE id=?').run(now, incident.relatedTaskId);
    }
  }

  const updated = getIncidentById(incidentId);
  return NextResponse.json(updated);
}
