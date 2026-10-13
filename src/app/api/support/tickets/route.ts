import { NextResponse } from 'next/server';
import { currentUser } from '@/lib/server/auth';
import { db, id, nowIso } from '@/lib/server/db';
import { canAccessEvent } from '@/lib/server/event-repository';
import { jsonError, requireRole, validOrigin } from '@/lib/server/http';

export async function GET(request: Request) {
  const user = await currentUser();
  if (!user) return jsonError('Authentication required.', 401, 'UNAUTHENTICATED');

  const { searchParams } = new URL(request.url);
  const eventId = searchParams.get('eventId');
  const status = searchParams.get('status');
  const priority = searchParams.get('priority');
  const assigneeId = searchParams.get('assigneeId');
  const page = parseInt(searchParams.get('page') || '1', 10);
  const limit = parseInt(searchParams.get('limit') || '20', 10);
  const offset = (page - 1) * limit;

  const database = db();

  const conditions: string[] = [];
  const values: (string | number)[] = [];

  // Role-based filtering
  if (user.role === 'participant') {
    conditions.push('t.participant_id = ?');
    values.push(user.id);
  } else if (user.role === 'sub_organizer') {
    // Sub-organizers see tickets for events they're assigned to
    conditions.push(`
      t.event_id IN (
        SELECT ta.event_id FROM team_assignments ta
        WHERE ta.user_id = ? AND ta.status = 'active'
      )
    `);
    values.push(user.id);
  } else {
    conditions.push('t.event_id IN (SELECT e.id FROM events e WHERE e.organizer_id=?)');
    values.push(user.id);
  }
  // Organizers see all tickets for their events (handled by eventId filter or no filter)

  if (eventId) {
    if (!canAccessEvent(eventId, user.id, user.role)) return jsonError('Event not found.', 404, 'EVENT_NOT_FOUND');
    conditions.push('t.event_id = ?');
    values.push(eventId);
  }

  if (status) {
    conditions.push('t.status = ?');
    values.push(status);
  }

  if (priority) {
    conditions.push('t.priority = ?');
    values.push(priority);
  }

  if (assigneeId) {
    conditions.push('t.assignee_id = ?');
    values.push(assigneeId);
  }

  const whereClause = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

  // Get total count
  const countRow = database.prepare(`SELECT COUNT(*) as total FROM support_tickets t ${whereClause}`).get(...values);
  const total = (countRow as { total: number } | undefined)?.total || 0;

  // Get tickets with event and participant info
  const rows = database.prepare(`
    SELECT t.*, e.name as event_name, u.name as participant_name, u.email as participant_email,
           a.name as assignee_name
    FROM support_tickets t
    JOIN events e ON e.id = t.event_id
    JOIN users u ON u.id = t.participant_id
    LEFT JOIN users a ON a.id = t.assignee_id
    ${whereClause}
    ORDER BY t.created_at DESC
    LIMIT ? OFFSET ?
  `).all(...values, limit, offset) as Array<{
    id: string;
    event_id: string;
    participant_id: string;
    title: string;
    description: string;
    category: string;
    status: string;
    priority: string;
    assignee_id: string | null;
    created_at: string;
    updated_at: string;
    resolved_at: string | null;
    escalated_at: string | null;
    reference_number: string;
    event_name: string;
    participant_name: string;
    participant_email: string;
    assignee_name: string | null;
  }>;

  const tickets = rows.map(row => ({
    id: row.id,
    eventId: row.event_id,
    eventName: row.event_name,
    participantId: row.participant_id,
    participantName: row.participant_name,
    title: row.title,
    description: row.description,
    category: row.category,
    status: row.status,
    priority: row.priority,
    assigneeId: row.assignee_id,
    assigneeName: row.assignee_name,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    resolvedAt: row.resolved_at,
    escalatedAt: row.escalated_at,
    referenceNumber: row.reference_number,
  }));

  return NextResponse.json({
    tickets,
    pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
  });
}

export async function POST(request: Request) {
  if (!validOrigin(request)) return jsonError('Invalid request origin.', 403, 'INVALID_ORIGIN');
  const user = await currentUser();
  if (!user) return jsonError('Authentication required.', 401, 'UNAUTHENTICATED');

  const denied = requireRole(user, ['participant']);
  if (denied) return denied;

  const body = await request.json().catch(() => null) as {
    eventId: string;
    title: string;
    description: string;
    category: string;
    priority?: string;
  } | null;

  if (!body || !body.eventId || !body.title || !body.description || !body.category) {
    return jsonError('Missing required fields: eventId, title, description, category.', 422, 'INVALID_BODY');
  }

  if (!canAccessEvent(body.eventId, user.id, user.role)) return jsonError('Event not found.', 404, 'EVENT_NOT_FOUND');

  const validCategories = ['registration', 'payment', 'schedule', 'checkin', 'technical', 'communication', 'other'];
  if (!validCategories.includes(body.category)) return jsonError('Invalid category.', 422, 'INVALID_CATEGORY');

  const validPriorities = ['low', 'normal', 'high', 'critical'];
  const priority = validPriorities.includes(body.priority || '') ? body.priority : 'normal';

  const database = db();
  const ticketId = id('ticket');
  const referenceNumber = `SUP-${Date.now().toString(36).toUpperCase()}`;
  const timestamp = nowIso();

  database.prepare(`
    INSERT INTO support_tickets(id, event_id, participant_id, title, description, category, status, priority, reference_number, created_at, updated_at)
    VALUES(?,?,?,?,?,?,?,?,?,?,?)
  `).run(ticketId, body.eventId, user.id, body.title, body.description, body.category, 'open', priority, referenceNumber, timestamp, timestamp);

  const ticket = database.prepare('SELECT * FROM support_tickets WHERE id = ?').get(ticketId) as {
    id: string;
    event_id: string;
    participant_id: string;
    title: string;
    description: string;
    category: string;
    status: string;
    priority: string;
    assignee_id: string | null;
    created_at: string;
    updated_at: string;
    reference_number: string;
  } | undefined;

  if (!ticket) return jsonError('Ticket created but could not be retrieved.', 500, 'TICKET_RETRIEVAL_FAILED');

  // Notify event staff (create notification)
  const event = database.prepare('SELECT organizer_id FROM events WHERE id = ?').get(body.eventId) as { organizer_id: string } | undefined;
  if (event) {
    database.prepare(`
      INSERT INTO notifications(id, user_id, message, type, read, created_at)
      VALUES(?,?,?,?,?,?)
    `).run(id('notif'), event.organizer_id, `New support ticket: ${body.title}`, 'info', 0, timestamp);
  }

  return NextResponse.json({
    id: ticket.id,
    eventId: ticket.event_id,
    participantId: ticket.participant_id,
    title: ticket.title,
    description: ticket.description,
    category: ticket.category,
    status: ticket.status,
    priority: ticket.priority,
    assigneeId: ticket.assignee_id,
    createdAt: ticket.created_at,
    updatedAt: ticket.updated_at,
    referenceNumber: ticket.reference_number,
  }, { status: 201 });
}
