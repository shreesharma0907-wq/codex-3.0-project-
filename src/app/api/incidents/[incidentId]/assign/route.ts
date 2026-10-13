import { NextRequest, NextResponse } from 'next/server';
import { db, id, nowIso } from '@/lib/server/db';
import { currentUser } from '@/lib/server/auth';
import { jsonError, requireRole, validOrigin } from '@/lib/server/http';
import { canAccessEvent } from '@/lib/server/event-repository';
import {
  getIncidentById,
  recommendResponders,
  logIncidentActivity,
  createNotification,
} from '@/lib/server/incident-repository';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ incidentId: string }> }
) {
  const user = await currentUser();
  const authError = requireRole(user, ['organizer']);
  if (authError) return authError;
  const { incidentId } = await params;

  const incident = getIncidentById(incidentId);
  if (!incident) return jsonError('Incident not found.', 404, 'NOT_FOUND');
  if (!canAccessEvent(incident.eventId, user!.id, user!.role)) return jsonError('Incident not found.', 404, 'NOT_FOUND');

  const recommendations = recommendResponders(incident.eventId, {
    category: incident.category,
    zone: incident.zone,
  });

  return NextResponse.json(recommendations);
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ incidentId: string }> }
) {
  if (!validOrigin(request)) return jsonError('Invalid request origin.', 403, 'INVALID_ORIGIN');
  const user = await currentUser();
  const authError = requireRole(user, ['organizer']);
  if (authError) return authError;
  const { incidentId } = await params;

  const incident = getIncidentById(incidentId);
  if (!incident) return jsonError('Incident not found.', 404, 'NOT_FOUND');
  if (!canAccessEvent(incident.eventId, user!.id, user!.role)) return jsonError('Incident not found.', 404, 'NOT_FOUND');

  const body = await request.json().catch(() => ({}));
  const responderId = String(body.responderId || '').trim();
  const reason = String(body.reason || 'Assigned by organizer dispatch').trim();

  if (!responderId) {
    return jsonError('Responder ID is required.', 400, 'VALIDATION_ERROR');
  }

  const responder = db().prepare(`
    SELECT u.id, u.name, u.email FROM users u
    JOIN team_assignments ta ON ta.user_id=u.id AND ta.event_id=? AND ta.status='active'
    WHERE u.id=? AND u.status='active' AND u.role IN ('sub_organizer','organizer')
  `).get(incident.eventId, responderId);
  if (!responder) {
    return jsonError('Responder not found.', 404, 'NOT_FOUND');
  }

  const now = nowIso();
  const assignId = id('asgn');

  // Mark previous active assignment as reassigned if any
  db().prepare(`
    UPDATE incident_assignments SET status='reassigned' WHERE incident_id=? AND status IN ('assigned', 'acknowledged')
  `).run(incidentId);

  // Insert assignment record
  db().prepare(`
    INSERT INTO incident_assignments (id, incident_id, responder_id, assigned_by, reason, status, assigned_at)
    VALUES (?, ?, ?, ?, ?, 'assigned', ?)
  `).run(assignId, incidentId, responderId, user!.id, reason, now);

  // Update incident status to assigned
  db().prepare(`
    UPDATE incidents
    SET assigned_responder_id=?, assigned_at=?, status='assigned', updated_at=?
    WHERE id=?
  `).run(responderId, now, now, incidentId);

  // Activity audit log
  logIncidentActivity(
    incidentId,
    user!.id,
    'assigned',
    `Assigned to ${responder.name}. Reason: ${reason}`
  );

  // Persistent in-app notification to the assigned responder
  createNotification({
    userId: responderId,
    eventId: incident.eventId,
    incidentId,
    type: incident.urgency === 'critical' ? 'error' : 'warning',
    title: `Incident Dispatched: ${incident.referenceNumber}`,
    message: `You were dispatched to handle "${incident.title}" (${incident.category.toUpperCase()} - Zone: ${incident.zone || 'All'}). Reason: ${reason}`,
  });

  return NextResponse.json({
    success: true,
    incidentId,
    responderId,
    responderName: responder.name,
    assignedAt: now,
  });
}
