import { NextResponse } from 'next/server';
import { currentUser } from '@/lib/server/auth';
import { db } from '@/lib/server/db';
import { jsonError, requireRole } from '@/lib/server/http';
import { listIncidentsForEvent } from '@/lib/server/incident-repository';
import { listAssignedTasksForSubOrganizer, listTaskActivities } from '@/lib/server/task-repository';

export async function GET() {
  const user = await currentUser();
  const denied = requireRole(user, ['sub_organizer']);
  if (denied) return denied;
  const database = db();
  const assignments = database.prepare(`
    SELECT ta.id,ta.event_id,ta.responsibility,ta.status,ta.zones,e.name AS event_name,e.start_at,e.end_at,e.venue,e.lifecycle
    FROM team_assignments ta JOIN events e ON e.id=ta.event_id
    WHERE ta.user_id=? AND ta.status='active' ORDER BY e.start_at,ta.created_at
  `).all(user!.id);
  const eventIds = [...new Set(assignments.map(row => String(row.event_id)))];
  const events = eventIds.map(eventId => {
    const row = assignments.find(item => String(item.event_id) === eventId)!;
    return { id: eventId, name: String(row.event_name), startAt: String(row.start_at), endAt: String(row.end_at), venue: row.venue ? String(row.venue) : null, status: String(row.lifecycle || 'upcoming') };
  });
  const tasks = listAssignedTasksForSubOrganizer(database, user!.id).map(task => ({
    id: String(task.id), eventId: String(task.event_id), eventName: String(task.event_name), title: String(task.title),
    description: String(task.description || ''), priority: String(task.priority), status: String(task.status),
    deadline: String(task.due_at || ''), department: task.department ? String(task.department) : null,
    organizerName: String(task.organizer_name), createdAt: String(task.created_at), updatedAt: String(task.updated_at),
    comments: database.prepare('SELECT c.id,c.user_id,u.name AS user_name,c.content,c.created_at FROM task_comments c JOIN users u ON u.id=c.user_id WHERE c.task_id=? ORDER BY c.created_at DESC LIMIT 10').all(task.id),
    activities: listTaskActivities(database, String(task.id)),
    assignedAt: task.assigned_at ? String(task.assigned_at) : null,
    completedAt: task.completed_at ? String(task.completed_at) : null,
    relatedIncidentId: task.related_incident_id ? String(task.related_incident_id) : null,
  }));
  const incidents = eventIds.flatMap(eventId => listIncidentsForEvent(eventId, { responderId: user!.id }).map(incident => ({ ...incident, eventName: events.find(event => event.id === eventId)?.name || 'Event' })));
  const tickets = eventIds.length ? database.prepare(`
    SELECT t.id,t.event_id,e.name AS event_name,t.participant_id,u.name AS participant_name,t.title,t.description,
      t.category,t.status,t.priority,t.assignee_id,t.reference_number,t.created_at,t.updated_at,t.resolved_at,t.escalated_at
    FROM support_tickets t JOIN events e ON e.id=t.event_id JOIN users u ON u.id=t.participant_id
    WHERE t.event_id IN (SELECT event_id FROM team_assignments WHERE user_id=? AND status='active')
    ORDER BY CASE t.status WHEN 'open' THEN 0 WHEN 'acknowledged' THEN 1 ELSE 2 END,t.created_at DESC LIMIT 100
  `).all(user!.id).map(ticket => ({
    id: String(ticket.id), eventId: String(ticket.event_id), eventName: String(ticket.event_name), participantId: String(ticket.participant_id),
    participantName: String(ticket.participant_name), title: String(ticket.title), description: String(ticket.description),
    category: String(ticket.category), status: String(ticket.status), priority: String(ticket.priority), assigneeId: ticket.assignee_id ? String(ticket.assignee_id) : null,
    referenceNumber: String(ticket.reference_number), createdAt: String(ticket.created_at), updatedAt: String(ticket.updated_at), resolvedAt: ticket.resolved_at ? String(ticket.resolved_at) : null, escalatedAt: ticket.escalated_at ? String(ticket.escalated_at) : null,
  })) : [];
  const profile = database.prepare('SELECT skills,zones,availability,phone,preferred_contact_method FROM responder_profiles WHERE user_id=?').get(user!.id);
  const capabilities = eventIds.length ? database.prepare(`SELECT event_id,category,name,proficiency,experience_years,description,verified_at
    FROM responder_capabilities WHERE user_id=? AND event_id IN (${eventIds.map(() => '?').join(',')}) ORDER BY event_id,category,name`).all(user!.id, ...eventIds).map(item => ({
      eventId: String(item.event_id), category: String(item.category), name: String(item.name), proficiency: String(item.proficiency),
      experienceYears: item.experience_years == null ? null : Number(item.experience_years), description: String(item.description || ''), verified: item.verified_at != null,
    })) : [];
  const notifications = database.prepare('SELECT id,event_id,type,title,message,read,created_at FROM in_app_notifications WHERE user_id=? ORDER BY created_at DESC LIMIT 30').all(user!.id)
    .filter(item => !item.event_id || eventIds.includes(String(item.event_id))).map(item => ({ id: String(item.id), eventId: item.event_id ? String(item.event_id) : null, type: String(item.type), title: String(item.title), message: String(item.message), read: Boolean(item.read), createdAt: String(item.created_at) }));
  return NextResponse.json({
    serverNow: Date.now(),
    user: { id: user!.id, name: user!.name, email: user!.email }, assignments: assignments.map(item => ({ id: String(item.id), eventId: String(item.event_id), responsibility: String(item.responsibility), zones: item.zones ? String(item.zones) : '' })),
    events, tasks, incidents, tickets, notifications,
    profile: { skills: profile?.skills ? String(profile.skills) : '', zones: profile?.zones ? String(profile.zones) : '', availability: profile?.availability ? String(profile.availability) : 'available', phone: profile?.phone ? String(profile.phone) : null, preferredContactMethod: profile?.preferred_contact_method ? String(profile.preferred_contact_method) : null },
    capabilities,
  });
}

export async function PATCH(request: Request) {
  const user = await currentUser();
  const denied = requireRole(user, ['sub_organizer']);
  if (denied) return denied;
  const body = await request.json().catch(() => null) as { availability?: unknown; phone?: unknown; preferredContactMethod?: unknown } | null;
  if (!body || Object.keys(body).some(key => !['availability', 'phone', 'preferredContactMethod'].includes(key))) return jsonError('Only your availability and contact details can be updated here.', 422, 'INVALID_BODY');
  const database = db();
  const current = database.prepare('SELECT skills,zones,availability,phone,preferred_contact_method FROM responder_profiles WHERE user_id=?').get(user!.id);
  const availability = body.availability === undefined ? String(current?.availability || 'available') : String(body.availability);
  if (!['available', 'busy', 'offline'].includes(availability)) return jsonError('Choose available, busy, or offline.', 422, 'INVALID_AVAILABILITY');
  const phone = body.phone === undefined ? (current?.phone ? String(current.phone) : null) : typeof body.phone === 'string' && body.phone.trim() ? body.phone.trim() : null;
  if (phone && (phone.length > 32 || !/^[+()\d.\-\s]+$/.test(phone) || phone.replace(/\D/g, '').length < 7)) return jsonError('Enter a valid phone number or leave it blank.', 422, 'INVALID_PHONE');
  const preferredContactMethod = body.preferredContactMethod === undefined
    ? (current?.preferred_contact_method ? String(current.preferred_contact_method) : null)
    : typeof body.preferredContactMethod === 'string' && body.preferredContactMethod ? body.preferredContactMethod : null;
  if (preferredContactMethod && !['email', 'phone', 'sms'].includes(preferredContactMethod)) return jsonError('Choose email, phone, SMS, or no preference.', 422, 'INVALID_CONTACT_METHOD');
  database.prepare(`INSERT INTO responder_profiles(user_id,skills,zones,availability,phone,preferred_contact_method,updated_at)
    VALUES(?,?,?,?,?,?,?) ON CONFLICT(user_id) DO UPDATE SET availability=excluded.availability,phone=excluded.phone,preferred_contact_method=excluded.preferred_contact_method,updated_at=excluded.updated_at`)
    .run(user!.id, current?.skills || 'operations', current?.zones || 'all', availability, phone, preferredContactMethod, new Date().toISOString());
  return NextResponse.json({ availability, phone, preferredContactMethod });
}
