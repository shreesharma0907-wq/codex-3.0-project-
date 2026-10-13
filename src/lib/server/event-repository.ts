import { db, id, nowIso } from './db';
import type { Event, EventSession, Task } from '@/lib/types';

function lifecycle(startAt: string, endAt: string): Event['lifecycle'] {
  const now = Date.now();
  const start = Date.parse(startAt);
  const end = Date.parse(endAt);
  if (!Number.isFinite(start) || !Number.isFinite(end)) return 'draft';
  if (now < start) return 'upcoming';
  if (now <= end) return 'in-progress';
  return 'completed';
}

function sessionsFor(eventId: string): EventSession[] {
  return db().prepare('SELECT * FROM event_sessions WHERE event_id=? ORDER BY start_at').all(eventId).map(row => ({
    id: String(row.id), name: String(row.name), description: String(row.description || ''),
    date: String(row.start_at).slice(0, 10), startTime: String(row.start_at).slice(11, 16), endTime: String(row.end_at).slice(11, 16),
    venue: String(row.venue || ''),
  }));
}

export function eventFromRow(row: Record<string, unknown>): Event {
  const eventId = String(row.id);
  const startAt = String(row.start_at);
  const endAt = String(row.end_at);
  const daysRemaining = Date.parse(startAt);

  // Derive counts from actual database records
  const regCount = Number(
    db().prepare('SELECT COUNT(*) as count FROM registrations WHERE event_id=? AND status<>\'cancelled\'').get(eventId)?.count || 0
  );
  const partnerStats = db().prepare(
    'SELECT COUNT(*) as total, SUM(CASE WHEN status=\'confirmed\' THEN 1 ELSE 0 END) as confirmed FROM partners WHERE event_id=?'
  ).get(eventId);
  const totalPartners = Number(partnerStats?.total || 0);
  const partnerConfirmations = Number(partnerStats?.confirmed || 0);

  return {
    id: eventId, name: String(row.name), type: String(row.event_type), date: startAt.slice(0, 10),
    startDate: startAt.slice(0, 10), endDate: endAt.slice(0, 10), startTime: startAt.slice(11, 16), endTime: endAt.slice(11, 16),
    timezone: String(row.timezone), targetRegistrations: Number(row.registration_target), currentRegistrations: regCount,
    participantCapacity: row.capacity == null ? undefined : Number(row.capacity), expectedAttendance: Number(row.expected_attendance),
    partnerConfirmations, totalPartners, venueConfirmed: Boolean(row.venue),
    daysRemaining: Number.isFinite(daysRemaining) ? Math.max(0, Math.ceil((daysRemaining - Date.now()) / 86_400_000)) : 0,
    audience: String(row.audience || ''), format: row.format as Event['format'], venue: row.venue ? String(row.venue) : undefined,
    meetingUrl: row.meeting_url ? String(row.meeting_url) : undefined, joiningInstructions: row.joining_instructions ? String(row.joining_instructions) : undefined,
    lifecycle: lifecycle(startAt, endAt), sessions: sessionsFor(eventId),
  };
}

export function accessibleEventWhere(userId: string, role: string) {
  if (role === 'organizer') return { sql: 'e.organizer_id=?', values: [userId] };
  return { sql: 'EXISTS (SELECT 1 FROM team_assignments ta WHERE ta.event_id=e.id AND ta.user_id=? AND ta.status=\'active\') OR EXISTS (SELECT 1 FROM registrations r WHERE r.event_id=e.id AND r.participant_id=? AND r.status<>\'cancelled\')', values: [userId, userId] };
}

export function canAccessEvent(eventId: string, userId: string, role: string): boolean {
  const access = accessibleEventWhere(userId, role);
  return Boolean(db().prepare(`SELECT e.id FROM events e WHERE e.id=? AND (${access.sql})`).get(eventId, ...access.values));
}

export function createEvent(input: Record<string, unknown>, organizerId: string): Event & { tasks: Task[] } {
  const name = String(input.name || '').trim();
  const type = String(input.type || input.eventType || '').trim();
  const startDate = String(input.startDate || input.date || '');
  const endDate = String(input.endDate || startDate);
  const startTime = String(input.startTime || '00:00');
  const endTime = String(input.endTime || '23:59');
  const startAt = `${startDate}T${startTime}:00`;
  const endAt = `${endDate}T${endTime}:00`;
  const start = Date.parse(startAt); const end = Date.parse(endAt);
  if (!name || !type || !/^\d{4}-\d{2}-\d{2}$/.test(startDate) || !/^\d{4}-\d{2}-\d{2}$/.test(endDate) || !Number.isFinite(start) || !Number.isFinite(end) || end < start) throw new Error('Provide a valid event name, type and date range.');
  const format = input.format === 'virtual' ? 'virtual' : input.format === 'hybrid' ? 'hybrid' : 'in-person';
  if ((format === 'in-person' || format === 'hybrid') && !String(input.venue || '').trim()) throw new Error('A venue is required for this event format.');
  if ((format === 'virtual' || format === 'hybrid') && !String(input.meetingUrl || input.joiningInstructions || '').trim()) throw new Error('Online events need joining information.');
  const capacity = input.participantCapacity == null ? null : Number(input.participantCapacity);
  const target = Number(input.targetRegistrations || 0); const attendance = Number(input.expectedAttendance || 0);
  if (![capacity, target, attendance].every(value => value === null || Number.isInteger(value) && value >= 0) || (capacity !== null && attendance > capacity)) throw new Error('Attendance and capacity values are invalid.');
  const eventId = id('evt'); const timestamp = nowIso(); const database = db();
  database.exec('BEGIN');
  try {
    database.prepare(`INSERT INTO events(id,organizer_id,name,description,event_type,format,start_at,end_at,timezone,venue,meeting_url,joining_instructions,audience,expected_attendance,registration_target,capacity,lifecycle,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(eventId, organizerId, name, String(input.objectives || input.description || ''), type, format, startAt, endAt, String(input.timezone || 'UTC'), String(input.venue || '').trim() || null, String(input.meetingUrl || '').trim() || null, String(input.joiningInstructions || '').trim() || null, String(input.audience || ''), attendance, target, capacity, lifecycle(startAt, endAt), timestamp, timestamp);
    const sessions = Array.isArray(input.sessions) ? input.sessions : [];
    for (const session of sessions as Record<string, unknown>[]) {
      const sessionStart = `${String(session.date)}T${String(session.startTime)}:00`; const sessionEnd = `${String(session.date)}T${String(session.endTime)}:00`;
      database.prepare('INSERT INTO event_sessions(id,event_id,name,description,start_at,end_at,venue,meeting_url) VALUES(?,?,?,?,?,?,?,?)').run(id('ses'), eventId, String(session.name || '').trim(), String(session.description || ''), sessionStart, sessionEnd, String(session.venue || '').trim() || null, null);
    }
    if (Array.isArray(input.tasks)) {
      for (const [index, task] of (input.tasks as Record<string, unknown>[]).entries()) {
        database.prepare('INSERT INTO tasks(id,event_id,title,description,priority,status,due_at,department,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?)').run(`${eventId}-task-${index + 1}`, eventId, String(task.title || '').trim(), String(task.description || ''), String(task.priority || 'medium'), String(task.status || 'pending'), String(task.deadline || endDate), String(task.functionName || task.assignee || '') || null, timestamp, timestamp);
      }
    }
    database.exec('COMMIT');
  } catch (error) { database.exec('ROLLBACK'); throw error; }
  const event = eventFromRow(database.prepare('SELECT * FROM events WHERE id=?').get(eventId)!);
  const tasks = database.prepare('SELECT * FROM tasks WHERE event_id=? ORDER BY created_at,id').all(eventId).map(taskFromRow);
  return { ...event, tasks };
}

export function taskFromRow(row: Record<string, unknown>): Task {
  const assignee = ['marketing', 'partnerships', 'operations', 'programme', 'leadership'].includes(String(row.department)) ? String(row.department) as Task['assignee'] : 'operations';
  return { id: String(row.id), eventId: String(row.event_id), title: String(row.title), description: String(row.description || ''), priority: row.priority as Task['priority'], status: row.status as Task['status'], deadline: String(row.due_at), assignee, functionName: row.department ? String(row.department) : undefined };
}
