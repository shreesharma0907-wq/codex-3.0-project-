import { NextResponse } from 'next/server';
import { currentUser } from '@/lib/server/auth';
import { db, id, nowIso } from '@/lib/server/db';
import { jsonError, validOrigin } from '@/lib/server/http';
import { createNotification } from '@/lib/server/incident-repository';
import { canAccessSubOrganizerSupportTicket } from '@/lib/server/team-repository';

interface ServerUser {
  id: string;
  name: string;
  email: string;
  role: 'organizer' | 'sub_organizer' | 'participant';
  status: 'active' | 'inactive';
}

interface TicketRow {
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
  reference_number: string;
  escalated_at?: string | null;
}

type Context = { params: Promise<{ id: string }> };

export async function GET(_request: Request, context: Context) {
  const user = await currentUser();
  if (!user) return jsonError('Authentication required.', 401, 'UNAUTHENTICATED');

  const { id } = await context.params;
  const database = db();

  const ticket = database.prepare('SELECT * FROM support_tickets WHERE id = ?').get(id) as TicketRow | undefined;
  if (!ticket) return jsonError('Ticket not found.', 404, 'TICKET_NOT_FOUND');

  // Check access
  if (user.role === 'participant' && ticket.participant_id !== user.id) {
    return jsonError('Access denied.', 403, 'ACCESS_DENIED');
  }
  if (user.role === 'sub_organizer') {
    if (!canAccessSubOrganizerSupportTicket(database, ticket.id, user.id)) return jsonError('Access denied.', 403, 'ACCESS_DENIED');
  }
  if (user.role === 'organizer') {
    const event = database.prepare('SELECT organizer_id FROM events WHERE id = ?').get(ticket.event_id) as { organizer_id: string } | undefined;
    if (event?.organizer_id !== user.id) {
      return jsonError('Access denied.', 403, 'ACCESS_DENIED');
    }
  }

  // Get event info
  const event = database.prepare('SELECT name FROM events WHERE id = ?').get(ticket.event_id) as { name: string } | undefined;
  // Get participant info
  const participant = database.prepare('SELECT name, email FROM users WHERE id = ?').get(ticket.participant_id) as { name: string; email: string } | undefined;
  // Get assignee info
  let assignee = null;
  if (ticket.assignee_id) {
    assignee = database.prepare('SELECT name FROM users WHERE id = ?').get(ticket.assignee_id) as { name: string } | undefined;
  }

  // Get messages (filter internal notes for participants)
  let messages;
  if (user.role === 'participant') {
    messages = database.prepare('SELECT * FROM support_messages WHERE ticket_id = ? AND is_internal = 0 ORDER BY created_at').all(ticket.id) as Array<{
      id: string;
      ticket_id: string;
      sender_id: string;
      sender_role: string;
      content: string;
      is_internal: number;
      created_at: string;
      attachments: string | null;
    }>;
  } else {
    messages = database.prepare('SELECT * FROM support_messages WHERE ticket_id = ? ORDER BY created_at').all(ticket.id) as Array<{
      id: string;
      ticket_id: string;
      sender_id: string;
      sender_role: string;
      content: string;
      is_internal: number;
      created_at: string;
      attachments: string | null;
    }>;
  }

  return NextResponse.json({
    id: ticket.id,
    eventId: ticket.event_id,
    eventName: event?.name,
    participantId: ticket.participant_id,
    participantName: participant?.name,
    title: ticket.title,
    description: ticket.description,
    category: ticket.category,
    status: ticket.status,
    priority: ticket.priority,
    assigneeId: ticket.assignee_id,
    assigneeName: assignee?.name || null,
    createdAt: ticket.created_at,
    updatedAt: ticket.updated_at,
    resolvedAt: ticket.resolved_at,
    escalatedAt: ticket.escalated_at || null,
    referenceNumber: ticket.reference_number,
    messages: messages.map(msg => ({
      id: msg.id,
      ticketId: msg.ticket_id,
      senderId: msg.sender_id,
      senderRole: msg.sender_role,
      content: msg.content,
      isInternal: Boolean(msg.is_internal),
      createdAt: msg.created_at,
      attachments: msg.attachments ? JSON.parse(msg.attachments) : [],
    })),
  });
}

export async function PATCH(request: Request, context: Context) {
  if (!validOrigin(request)) return jsonError('Invalid request origin.', 403, 'INVALID_ORIGIN');
  const user = await currentUser();
  if (!user) return jsonError('Authentication required.', 401, 'UNAUTHENTICATED');

  const { id } = await context.params;
  const database = db();

  const ticket = database.prepare('SELECT * FROM support_tickets WHERE id = ?').get(id) as TicketRow | undefined;
  if (!ticket) return jsonError('Ticket not found.', 404, 'TICKET_NOT_FOUND');

  // Check permissions
  if (user.role === 'participant') {
    if (ticket.participant_id !== user.id) return jsonError('Access denied.', 403, 'ACCESS_DENIED');
    // Participants can only add messages, not change status
    const body = await request.json().catch(() => null) as { message?: string; requestId?: string } | null;
    if (!body?.message) return jsonError('Message required.', 422, 'INVALID_BODY');
    return addMessage(database, ticket, user, body.message, false, body.requestId);
  }

  if (user.role === 'sub_organizer') {
    if (!canAccessSubOrganizerSupportTicket(database, ticket.id, user.id)) return jsonError('Access denied.', 403, 'ACCESS_DENIED');
  }
  if (user.role === 'organizer') {
    const event = database.prepare('SELECT organizer_id FROM events WHERE id = ?').get(ticket.event_id) as { organizer_id: string } | undefined;
    if (event?.organizer_id !== user.id) {
      return jsonError('Access denied.', 403, 'ACCESS_DENIED');
    }
  }

  const body = await request.json().catch(() => null) as {
    status?: string;
    priority?: string;
    assigneeId?: string;
    message?: string;
    isInternal?: boolean;
    escalate?: boolean;
    requestId?: string;
  } | null;

  if (!body) return jsonError('Invalid body.', 422, 'INVALID_BODY');
  if (typeof body.message === 'string' && body.message.trim().length > 4000) return jsonError('Messages must be under 4,000 characters.', 422, 'INVALID_MESSAGE');
  if (body.escalate) {
    const event = database.prepare('SELECT organizer_id FROM events WHERE id=?').get(ticket.event_id);
    if (!event?.organizer_id) return jsonError('Event organizer could not be found.', 409, 'EVENT_OWNER_MISSING');
    const timestamp = nowIso();
    const escalation = database.prepare('UPDATE support_tickets SET escalated_at=?,updated_at=? WHERE id=? AND escalated_at IS NULL').run(timestamp, timestamp, ticket.id);
    if (escalation.changes > 0) {
      createNotification({ userId: String(event.organizer_id), eventId: ticket.event_id, type: 'warning', title: `Participant request escalated: ${ticket.reference_number}`, message: typeof body.message === 'string' && body.message.trim() ? body.message.trim() : ticket.title });
    }
  }

  const updates: string[] = [];
  const values: (string | number)[] = [];

  if (body.status) {
    const validStatuses = ['open', 'acknowledged', 'in_progress', 'waiting_for_participant', 'resolved', 'closed'];
    if (!validStatuses.includes(body.status)) return jsonError('Invalid status.', 422, 'INVALID_STATUS');
    updates.push('status = ?');
    values.push(body.status);
    if (body.status === 'resolved' || body.status === 'closed') {
      updates.push('resolved_at = ?');
      values.push(new Date().toISOString());
    }
  }

  if (body.priority) {
    const validPriorities = ['low', 'normal', 'high', 'critical'];
    if (!validPriorities.includes(body.priority)) return jsonError('Invalid priority.', 422, 'INVALID_PRIORITY');
    updates.push('priority = ?');
    values.push(body.priority);
  }

  if (body.assigneeId !== undefined) {
    if (body.assigneeId) {
      const assignee = database.prepare(`SELECT u.id FROM users u JOIN team_assignments ta ON ta.user_id=u.id
        WHERE u.id=? AND u.status='active' AND u.role IN ('organizer','sub_organizer') AND ta.event_id=? AND ta.status='active'`).get(body.assigneeId, ticket.event_id);
      if (!assignee) return jsonError('Choose an active responder assigned to this event.', 422, 'INVALID_ASSIGNEE');
      if (user.role === 'sub_organizer' && body.assigneeId !== user.id) return jsonError('Sub-organizers may only take ownership of a request themselves.', 403, 'FORBIDDEN');
    }
    updates.push('assignee_id = ?');
    values.push(body.assigneeId ?? null);
  }

  if (updates.length > 0) {
    updates.push('updated_at = ?');
    values.push(new Date().toISOString());
    values.push(ticket.id);
    database.prepare(`UPDATE support_tickets SET ${updates.join(', ')} WHERE id = ?`).run(...values);
  }

  if (body.message) {
    const isInternal = (user.role === 'organizer' || user.role === 'sub_organizer') && body.isInternal !== false;
    addMessage(database, ticket, user, body.message, isInternal, body.requestId);
  }

  return NextResponse.json({ success: true });
}

function addMessage(database: ReturnType<typeof db>, ticket: TicketRow, user: ServerUser, content: string, isInternal: boolean, requestId?: string) {
  const requestKey = requestId && /^[a-zA-Z0-9_-]{8,100}$/.test(requestId) ? requestId : null;
  const messageId = id('msg');
  const timestamp = nowIso();

  const result = requestKey
    ? database.prepare(`INSERT INTO support_messages(id,ticket_id,sender_id,sender_role,content,is_internal,request_key,created_at)
        VALUES(?,?,?,?,?,?,?,?) ON CONFLICT(ticket_id,sender_id,request_key) WHERE request_key IS NOT NULL DO NOTHING`)
      .run(messageId, ticket.id, user.id, user.role, content, isInternal ? 1 : 0, requestKey, timestamp)
    : database.prepare(`INSERT INTO support_messages(id,ticket_id,sender_id,sender_role,content,is_internal,created_at) VALUES(?,?,?,?,?,?,?)`)
      .run(messageId, ticket.id, user.id, user.role, content, isInternal ? 1 : 0, timestamp);

  if (!result.changes) return NextResponse.json({ success: true, duplicate: true });

  // Update ticket status if participant replies
  if (user.role === 'participant' && ticket.status === 'waiting_for_participant') {
    database.prepare('UPDATE support_tickets SET status = ?, updated_at = ? WHERE id = ?').run('in_progress', new Date().toISOString(), ticket.id);
  } else if (user.role !== 'participant' && ticket.status === 'open') {
    database.prepare('UPDATE support_tickets SET status = ?, updated_at = ? WHERE id = ?').run('acknowledged', new Date().toISOString(), ticket.id);
  }

  // Notify participant if organizer replies
  if (user.role !== 'participant' && !isInternal) {
    database.prepare(`
      INSERT INTO notifications(id, user_id, message, type, read, created_at)
      VALUES(?,?,?,?,?,?)
    `).run(id('notif'), ticket.participant_id, `New update on your ticket: ${ticket.title}`, 'info', 0, timestamp);
  }
}
