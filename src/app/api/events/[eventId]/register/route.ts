import { NextResponse } from 'next/server';
import { currentUser } from '@/lib/server/auth';
import { db, id, nowIso } from '@/lib/server/db';
import { canAccessEvent } from '@/lib/server/event-repository';
import { jsonError, requireRole, validOrigin } from '@/lib/server/http';
import { issueTicket } from '@/lib/server/ticket-repository';

interface EventRow {
  id: string;
  lifecycle: string;
  registration_deadline: string | null;
  capacity: number | null;
  ticket_type: string | null;
  ticket_price: number | null;
}

interface TicketOptionRow {
  id: string;
  event_id: string;
  type: 'free' | 'paid';
  price: number;
  capacity: number | null;
  sold_count: number;
  sales_start: string | null;
  sales_end: string | null;
}

interface RegistrationRow {
  id: string;
  event_id: string;
  participant_id: string;
  ticket_option_id: string | null;
  invitation_code: string | null;
  status: string;
  payment_status: string;
  reference_number: string;
  created_at: string;
}

type Context = { params: Promise<{ eventId: string }> };

export async function POST(request: Request, context: Context) {
  if (!validOrigin(request)) return jsonError('Invalid request origin.', 403, 'INVALID_ORIGIN');
  const user = await currentUser();
  const denied = requireRole(user, ['participant']);
  if (denied) return denied;

  const { eventId } = await context.params;
  if (!canAccessEvent(eventId, user!.id, user!.role)) return jsonError('Event not found.', 404, 'EVENT_NOT_FOUND');

  const body = await request.json().catch(() => null) as { ticketOptionId?: string; invitationCode?: string } | null;
  if (!body) return jsonError('A JSON body is required.', 422, 'INVALID_BODY');

  const database = db();

  // Get event
  const event = database.prepare('SELECT * FROM events WHERE id = ?').get(eventId) as EventRow | undefined;
  if (!event) return jsonError('Event not found.', 404, 'EVENT_NOT_FOUND');

  // Check if event is open for registration
  if (event.lifecycle !== 'upcoming' && event.lifecycle !== 'in-progress') {
    return jsonError('This event is not open for registration.', 422, 'EVENT_NOT_OPEN');
  }

  if (event.registration_deadline && Date.parse(event.registration_deadline) < Date.now()) {
    return jsonError('Registration deadline has passed.', 422, 'REGISTRATION_CLOSED');
  }

  // Check if already registered
  const existingRegistration = database.prepare('SELECT * FROM registrations WHERE event_id = ? AND participant_id = ? AND status <> \'cancelled\'').get(eventId, user!.id);
  if (existingRegistration) {
    return jsonError('You are already registered for this event.', 422, 'ALREADY_REGISTERED');
  }

  // Handle invitation code if provided
  const invitationCode = body.invitationCode;
  const ticketOptionId = body.ticketOptionId;

  if (invitationCode) {
    const invitation = database.prepare('SELECT * FROM invitations WHERE code = ? AND event_id = ?').get(invitationCode, eventId) as { status: string; expires_at: string | null; max_uses: number | null; used_count: number; revoked_at: string | null } | undefined;
    if (!invitation) return jsonError('Invalid invitation code.', 422, 'INVALID_INVITATION');
    if (invitation.status !== 'active') return jsonError('This invitation is no longer valid.', 422, 'INVITATION_INVALID');
    if (invitation.expires_at && Date.parse(invitation.expires_at) < Date.now()) return jsonError('This invitation has expired.', 422, 'INVITATION_EXPIRED');
    if (invitation.max_uses && invitation.used_count >= invitation.max_uses) return jsonError('This invitation has reached its usage limit.', 422, 'INVITATION_EXHAUSTED');
    if (invitation.revoked_at) return jsonError('This invitation has been revoked.', 422, 'INVITATION_REVOKED');
  }

  // Determine ticket option
  let ticketOption: TicketOptionRow | undefined;
  if (ticketOptionId) {
    ticketOption = database.prepare('SELECT * FROM ticket_options WHERE id = ? AND event_id = ? AND is_active = 1').get(ticketOptionId, eventId) as unknown as TicketOptionRow | undefined;
    if (!ticketOption) return jsonError('Invalid ticket option.', 422, 'INVALID_TICKET');
    if (ticketOption.sales_start && Date.parse(ticketOption.sales_start) > Date.now()) return jsonError('Ticket sales have not started yet.', 422, 'SALES_NOT_STARTED');
    if (ticketOption.sales_end && Date.parse(ticketOption.sales_end) < Date.now()) return jsonError('Ticket sales have ended.', 422, 'SALES_ENDED');
    if (ticketOption.capacity && ticketOption.sold_count >= ticketOption.capacity) return jsonError('This ticket option is sold out.', 422, 'SOLD_OUT');
  } else {
    // Auto-select first available ticket option
    const options = database.prepare('SELECT * FROM ticket_options WHERE event_id = ? AND is_active = 1 ORDER BY price ASC').all(eventId) as unknown as TicketOptionRow[];
    ticketOption = options[0] || undefined;
  }

  // Determine payment status
  const isFree = !ticketOption || (ticketOption.type === 'free' && (ticketOption.price === 0 || ticketOption.price === null));
  const paymentStatus = isFree ? 'not_applicable' : 'pending';

  // Check capacity
  if (event.capacity) {
    const currentRegs = database.prepare('SELECT COUNT(*) as count FROM registrations WHERE event_id = ? AND status = \'confirmed\'').get(eventId) as { count: number } | undefined;
    if ((currentRegs?.count || 0) >= (event.capacity as number)) {
      return jsonError('Event has reached maximum capacity.', 422, 'EVENT_FULL');
    }
  }

  // Create registration
  const registrationId = id('reg');
  const referenceNumber = `REG-${Date.now().toString(36).toUpperCase()}`;
  const timestamp = nowIso();

  database.exec('BEGIN');
  try {
    database.prepare(`
      INSERT INTO registrations(id, event_id, participant_id, ticket_option_id, invitation_code, status, payment_status, reference_number, created_at, updated_at)
      VALUES(?,?,?,?,?,?,?,?,?,?)
    `).run(registrationId, eventId, user!.id, ticketOption?.id || null, invitationCode || null, 'confirmed', paymentStatus, referenceNumber, timestamp, timestamp);

    // Update ticket option sold count
    if (ticketOption?.id) {
      database.prepare('UPDATE ticket_options SET sold_count = sold_count + 1 WHERE id = ?').run(ticketOption.id);
    }

    // Update invitation used count
    if (invitationCode) {
      database.prepare('UPDATE invitations SET used_count = used_count + 1 WHERE code = ? AND event_id = ?').run(invitationCode, eventId);
    }

    // Update event registration count
    database.prepare('UPDATE events SET current_registrations = current_registrations + 1 WHERE id = ?').run(eventId);

    if (isFree) issueTicket(registrationId, eventId, user!.id, timestamp);

    database.exec('COMMIT');
  } catch (error) {
    database.exec('ROLLBACK');
    throw error;
  }

  // Get the created registration
  const registration = database.prepare('SELECT * FROM registrations WHERE id = ?').get(registrationId) as RegistrationRow | undefined;

  if (!registration) {
    return jsonError('Registration created but could not be retrieved.', 500, 'REGISTRATION_RETRIEVAL_FAILED');
  }

  return NextResponse.json({
    registration: {
      id: registration.id,
      eventId: registration.event_id,
      participantId: registration.participant_id,
      ticketOptionId: registration.ticket_option_id,
      invitationCode: registration.invitation_code,
      status: registration.status,
      paymentStatus: registration.payment_status,
      registeredAt: registration.created_at,
      referenceNumber: registration.reference_number,
      ticket: isFree ? (() => { const ticket = database.prepare('SELECT ticket_number, status, issued_at FROM tickets WHERE registration_id = ?').get(registration.id) as { ticket_number: string; status: string; issued_at: string } | undefined; return ticket ? { ticketNumber: ticket.ticket_number, status: ticket.status, issuedAt: ticket.issued_at } : null; })() : null,
    },
    message: isFree ? 'Registration confirmed! You are now registered for this event.' : 'Registration created. Please complete payment to confirm your spot.',
  }, { status: 201 });
}
