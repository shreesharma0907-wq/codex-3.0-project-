import { NextResponse } from 'next/server';
import { currentUser } from '@/lib/server/auth';
import { db } from '@/lib/server/db';
import { canAccessEvent } from '@/lib/server/event-repository';
import { jsonError, requireRole } from '@/lib/server/http';
import { ticketForRegistration } from '@/lib/server/ticket-repository';

type Context = { params: Promise<{ eventId: string }> };

export async function GET(_request: Request, context: Context) {
  const user = await currentUser();
  const denied = requireRole(user, ['participant', 'organizer', 'sub_organizer']);
  if (denied) return denied;
  const { eventId } = await context.params;
  if (!canAccessEvent(eventId, user!.id, user!.role)) return jsonError('Event not found.', 404, 'EVENT_NOT_FOUND');

  const database = db();
  const registration = user!.role === 'participant'
    ? database.prepare('SELECT * FROM registrations WHERE event_id = ? AND participant_id = ? AND status <> \'cancelled\'').get(eventId, user!.id)
    : database.prepare('SELECT * FROM registrations WHERE event_id = ? ORDER BY created_at DESC').get(eventId);
  if (!registration) return NextResponse.json({ registration: null, ticket: null });

  const row = registration as Record<string, unknown>;
  const ticket = ticketForRegistration(String(row.id));
  return NextResponse.json({
    registration: {
      id: String(row.id), eventId: String(row.event_id), participantId: String(row.participant_id),
      invitationCode: row.invitation_code ? String(row.invitation_code) : null,
      status: String(row.status), paymentStatus: String(row.payment_status),
      registeredAt: String(row.created_at), referenceNumber: String(row.reference_number || ''),
    },
    ticket: ticket ? { id: ticket.id, ticketNumber: ticket.ticket_number, status: ticket.status, issuedAt: ticket.issued_at } : null,
  });
}
