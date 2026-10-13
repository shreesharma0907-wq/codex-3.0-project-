import { NextRequest, NextResponse } from 'next/server';
import { db, id, nowIso } from '@/lib/server/db';
import { currentUser } from '@/lib/server/auth';
import { jsonError, requireRole, validOrigin } from '@/lib/server/http';
import {
  calculatePriority,
  createNotification,
  listIncidentsForEvent,
  logIncidentActivity,
} from '@/lib/server/incident-repository';
import type { IncidentCategory, IncidentUrgency } from '@/lib/types';
import { canAccessEvent } from '@/lib/server/event-repository';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ eventId: string }> }
) {
  const user = await currentUser();
  const authError = requireRole(user, ['organizer', 'sub_organizer', 'participant']);
  if (authError) return authError;
  const { eventId } = await params;
  if (!canAccessEvent(eventId, user!.id, user!.role)) return jsonError('Event not found.', 404, 'EVENT_NOT_FOUND');

  // Verify access
  if (user!.role === 'participant') {
    // Only return incidents reported by this participant
    const incidents = listIncidentsForEvent(eventId, { reporterId: user!.id });
    return NextResponse.json(incidents);
  }

  if (user!.role === 'sub_organizer') {
    const incidents = listIncidentsForEvent(eventId, { responderId: user!.id });
    return NextResponse.json(incidents);
  }

  // Organizer sees all incidents
  const incidents = listIncidentsForEvent(eventId);
  return NextResponse.json(incidents);
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ eventId: string }> }
) {
  if (!validOrigin(request)) return jsonError('Invalid request origin.', 403, 'INVALID_ORIGIN');
  const user = await currentUser();
  const authError = requireRole(user, ['organizer', 'sub_organizer', 'participant']);
  if (authError) return authError;
  const { eventId } = await params;
  if (!canAccessEvent(eventId, user!.id, user!.role)) return jsonError('Event not found.', 404, 'EVENT_NOT_FOUND');
  if (user!.role === 'sub_organizer' && !db().prepare("SELECT 1 FROM team_assignments WHERE event_id=? AND user_id=? AND status='active'").get(eventId, user!.id)) return jsonError('Event not found.', 404, 'EVENT_NOT_FOUND');

  const body = await request.json().catch(() => ({}));
  const category = String(body.category || 'other').trim() as IncidentCategory;
  const title = String(body.title || '').trim();
  const description = String(body.description || '').trim();
  const zone = body.zone ? String(body.zone).trim() : undefined;
  const urgency = String(body.urgency || 'medium').trim() as IncidentUrgency;
  const contactPreference = body.contactPreference ? String(body.contactPreference).trim() : undefined;
  const affectedSessionId = body.affectedSessionId ? String(body.affectedSessionId).trim() : undefined;

  if (!title || !description) {
    return jsonError('Title and description are required.', 400, 'VALIDATION_ERROR');
  }

  // Generate reference number: INC-YEAR-RANDOM
  const randomSuffix = Math.floor(1000 + Math.random() * 9000);
  const referenceNumber = `INC-${new Date().getFullYear()}-${randomSuffix}`;
  const incidentId = id('inc');
  const now = nowIso();

  // Check affected session timing if provided
  let minutesUntilSession: number | undefined = undefined;
  if (affectedSessionId) {
    const sessionRow = db().prepare('SELECT start_at FROM event_sessions WHERE id=?').get(affectedSessionId);
    if (sessionRow?.start_at) {
      const sessionStart = Date.parse(String(sessionRow.start_at));
      if (Number.isFinite(sessionStart)) {
        minutesUntilSession = Math.max(0, Math.round((sessionStart - Date.now()) / 60000));
      }
    }
  }

  const { score, reason } = calculatePriority({
    category,
    urgency,
    zone,
    hasAffectedSession: Boolean(affectedSessionId),
    minutesUntilSession,
  });

  // Check if there is an existing risk related to this category (e.g. transport)
  const existingRisk = db().prepare(
    `SELECT id FROM risks WHERE event_id=? AND (LOWER(title) LIKE ? OR LOWER(description) LIKE ?) LIMIT 1`
  ).get(eventId, `%${category.toLowerCase()}%`, `%${category.toLowerCase()}%`);

  const relatedRiskId = existingRisk?.id ? String(existingRisk.id) : null;

  db().prepare(`
    INSERT INTO incidents (
      id, reference_number, event_id, reporter_id, category, title, description,
      zone, affected_session_id, urgency, contact_preference, priority_score, priority_reason,
      status, related_risk_id, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'new', ?, ?, ?)
  `).run(
    incidentId,
    referenceNumber,
    eventId,
    user!.id,
    category,
    title,
    description,
    zone ?? null,
    affectedSessionId ?? null,
    urgency,
    contactPreference ?? null,
    score,
    reason,
    relatedRiskId,
    now,
    now
  );

  // Log audit activity
  logIncidentActivity(incidentId, user!.id, 'created', `Incident ${referenceNumber} reported: ${title}`);

  // Notify organizers
  const eventRow = db().prepare('SELECT organizer_id, name FROM events WHERE id=?').get(eventId);
  if (eventRow?.organizer_id) {
    createNotification({
      userId: String(eventRow.organizer_id),
      eventId,
      incidentId,
      type: urgency === 'critical' ? 'error' : urgency === 'high' ? 'warning' : 'info',
      title: `New Incident Reported: ${referenceNumber}`,
      message: `${title} (${category.toUpperCase()} - Urgency: ${urgency}). Priority score: ${score}/100.`,
    });
  }

  const createdRow = db().prepare(`
    SELECT i.*, u.name as reporter_name
    FROM incidents i
    JOIN users u ON u.id = i.reporter_id
    WHERE i.id=?
  `).get(incidentId);

  return NextResponse.json(createdRow, { status: 201 });
}
