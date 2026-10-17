import { NextResponse } from 'next/server';
import { createHash } from 'node:crypto';
import { currentUser } from '@/lib/server/auth';
import { db, id, nowIso } from '@/lib/server/db';
import { jsonError, requireRole } from '@/lib/server/http';
import { issueTicket } from '@/lib/server/ticket-repository';

interface InvitationRow {
  id: string;
  code: string;
  token: string;
  token_hash?: string | null;
  event_id: string;
  access_mode?: string;
  require_approval?: number;
  expires_at: string | null;
  max_uses: number | null;
  used_count: number;
  status: string;
  revoked_at: string | null;
}

interface EventRow {
  id: string;
  name: string;
  event_type: string;
  start_at: string;
  end_at: string;
  timezone: string;
  format: 'in-person' | 'virtual' | 'hybrid';
  venue: string | null;
  meeting_url: string | null;
  joining_instructions: string | null;
  audience: string;
  capacity: number | null;
  registration_target: number;
  eligibility_requirements: string | null;
  registration_deadline: string | null;
  joining_enabled?: number;
  require_approval?: number;
  invitation_access_mode?: string;
}

type Context = { params: Promise<{ code: string }> };

function findInvitation(param: string): { invitation?: InvitationRow; method: 'code' | 'token' } {
  const database = db();
  const cleanParam = param.trim();

  // Try exact token match first (if 32+ hex/chars)
  if (cleanParam.length >= 24) {
    const byToken = database.prepare('SELECT * FROM invitations WHERE token = ?').get(cleanParam) as InvitationRow | undefined;
    if (byToken) return { invitation: byToken, method: 'token' };

    const hash = createHash('sha256').update(cleanParam).digest('hex');
    const byHash = database.prepare('SELECT * FROM invitations WHERE token_hash = ?').get(hash) as InvitationRow | undefined;
    if (byHash) return { invitation: byHash, method: 'token' };
  }

  // Try code match (case-insensitive uppercase)
  const upperCode = cleanParam.toUpperCase();
  const byCode = database.prepare('SELECT * FROM invitations WHERE UPPER(code) = ?').get(upperCode) as InvitationRow | undefined;
  if (byCode) return { invitation: byCode, method: 'code' };

  // Fallback: search token directly just in case
  const fallbackToken = database.prepare('SELECT * FROM invitations WHERE token = ?').get(cleanParam) as InvitationRow | undefined;
  if (fallbackToken) return { invitation: fallbackToken, method: 'token' };

  return { invitation: undefined, method: 'code' };
}

export async function GET(_request: Request, context: Context) {
  const sessionUser = await currentUser();
  const { code: rawParam } = await context.params;

  const { invitation, method } = findInvitation(rawParam);
  if (!invitation) return jsonError('Invalid invitation code or link.', 404, 'INVALID_INVITATION');

  const database = db();
  const event = database.prepare('SELECT * FROM events WHERE id = ?').get(invitation.event_id) as EventRow | undefined;
  if (!event) return jsonError('Associated event not found.', 404, 'EVENT_NOT_FOUND');

  // Check invitation status
  let status: 'valid' | 'expired' | 'revoked' | 'exhausted' | 'disabled' | 'invalid' = 'valid';
  let message = '';

  if (event.joining_enabled === 0) {
    status = 'disabled';
    message = 'Participant joining is currently disabled for this event.';
  } else if (invitation.status !== 'active') {
    status = invitation.status as 'expired' | 'revoked' | 'exhausted';
    message = `This invitation has been ${status}.`;
  } else if (invitation.expires_at && Date.parse(invitation.expires_at) < Date.now()) {
    status = 'expired';
    message = 'This invitation has expired.';
  } else if (invitation.max_uses && invitation.used_count >= invitation.max_uses) {
    status = 'exhausted';
    message = 'This invitation has reached its usage limit.';
  } else if (invitation.revoked_at) {
    status = 'revoked';
    message = 'This invitation has been revoked.';
  } else if (invitation.access_mode === 'link' && method === 'code') {
    status = 'invalid';
    message = 'This event requires accessing via direct invite link.';
  } else if (invitation.access_mode === 'code' && method === 'token') {
    status = 'invalid';
    message = 'This event requires entering the invitation code directly.';
  }

  // Check if user is already registered
  let alreadyRegistered = false;
  let userCanJoin = status === 'valid';
  let existingStatus: string | undefined;

  if (sessionUser) {
    const existingReg = database.prepare('SELECT * FROM registrations WHERE event_id = ? AND participant_id = ? AND status <> \'cancelled\'').get(event.id, sessionUser.id) as { status: string } | undefined;
    if (existingReg) {
      alreadyRegistered = true;
      userCanJoin = false;
      existingStatus = existingReg.status;
    }
  }

  const currentCount = Number(
    database.prepare('SELECT COUNT(*) as count FROM registrations WHERE event_id = ? AND status <> \'cancelled\'').get(event.id)?.count || 0
  );

  const requireApproval = Boolean(invitation.require_approval || event.require_approval);

  return NextResponse.json({
    invitation: {
      id: invitation.id,
      code: invitation.code,
      eventId: invitation.event_id,
      expiresAt: invitation.expires_at,
      maxUses: invitation.max_uses,
      usedCount: invitation.used_count,
      status: invitation.status,
      accessMode: invitation.access_mode || 'both',
      requireApproval,
    },
    event: {
      id: event.id,
      name: event.name,
      type: event.event_type,
      date: event.start_at.slice(0, 10),
      startDate: event.start_at.slice(0, 10),
      endDate: event.end_at.slice(0, 10),
      startTime: event.start_at.slice(11, 16),
      endTime: event.end_at.slice(11, 16),
      timezone: event.timezone,
      format: event.format,
      venue: event.venue,
      meetingUrl: event.meeting_url,
      joiningInstructions: event.joining_instructions,
      audience: event.audience,
      participantCapacity: event.capacity,
      currentRegistrations: currentCount,
      targetRegistrations: event.registration_target,
      eligibilityRequirements: event.eligibility_requirements,
      requireApproval,
    },
    status,
    message,
    alreadyRegistered,
    existingStatus,
    userCanJoin,
    requiresAuth: !sessionUser,
  });
}

export async function POST(_request: Request, context: Context) {
  const user = await currentUser();
  if (!user) return jsonError('Authentication required to join an event.', 401, 'UNAUTHENTICATED');

  const denied = requireRole(user, ['participant']);
  if (denied) return denied;

  const { code: rawParam } = await context.params;
  const { invitation, method } = findInvitation(rawParam);
  if (!invitation) return jsonError('Invalid invitation code or link.', 404, 'INVALID_INVITATION');

  const database = db();
  const event = database.prepare('SELECT * FROM events WHERE id = ?').get(invitation.event_id) as EventRow | undefined;
  if (!event) return jsonError('Associated event not found.', 404, 'EVENT_NOT_FOUND');

  if (event.joining_enabled === 0) {
    return jsonError('Participant joining is currently disabled for this event.', 422, 'JOINING_DISABLED');
  }

  // Validate invitation
  if (invitation.status !== 'active') return jsonError('This invitation is no longer active.', 422, 'INVITATION_INVALID');
  if (invitation.expires_at && Date.parse(invitation.expires_at) < Date.now()) return jsonError('This invitation has expired.', 422, 'INVITATION_EXPIRED');
  if (invitation.max_uses && invitation.used_count >= invitation.max_uses) return jsonError('This invitation has reached its usage limit.', 422, 'INVITATION_EXHAUSTED');
  if (invitation.revoked_at) return jsonError('This invitation has been revoked.', 422, 'INVITATION_REVOKED');

  if (invitation.access_mode === 'link' && method === 'code') {
    return jsonError('This event requires joining via direct invite link.', 422, 'LINK_REQUIRED');
  }
  if (invitation.access_mode === 'code' && method === 'token') {
    return jsonError('This event requires joining by typing the invite code.', 422, 'CODE_REQUIRED');
  }

  // Check if already registered
  const existingReg = database.prepare('SELECT * FROM registrations WHERE event_id = ? AND participant_id = ? AND status <> \'cancelled\'').get(event.id, user.id);
  if (existingReg) return jsonError('You are already registered for this event.', 422, 'ALREADY_REGISTERED');

  // Check event capacity
  if (event.capacity) {
    const currentRegs = database.prepare('SELECT COUNT(*) as count FROM registrations WHERE event_id = ? AND status <> \'cancelled\'').get(event.id) as { count: number } | undefined;
    if ((currentRegs?.count || 0) >= (event.capacity as number)) {
      return jsonError('Event has reached maximum capacity.', 422, 'EVENT_FULL');
    }
  }

  // Check registration deadline
  if (event.registration_deadline && Date.parse(event.registration_deadline) < Date.now()) {
    return jsonError('Registration deadline has passed.', 422, 'REGISTRATION_CLOSED');
  }

  const requireApproval = Boolean(invitation.require_approval || event.require_approval);
  const regStatus = requireApproval ? 'pending' : 'confirmed';

  // Create registration
  const registrationId = id('reg');
  const referenceNumber = `REG-${Date.now().toString(36).toUpperCase()}`;
  const timestamp = nowIso();

  database.exec('BEGIN IMMEDIATE');
  try {
    // Re-check the invitation and capacity after acquiring SQLite's write lock.
    // This prevents concurrent joins from consuming more uses or capacity than allowed.
    const claim = database.prepare(`
      UPDATE invitations
      SET used_count = used_count + 1,
          status = CASE WHEN max_uses IS NOT NULL AND used_count + 1 >= max_uses THEN 'exhausted' ELSE status END
      WHERE id = ? AND status = 'active'
        AND (expires_at IS NULL OR expires_at > ?)
        AND (max_uses IS NULL OR used_count < max_uses)
    `).run(invitation.id, timestamp);
    if (claim.changes !== 1) throw new Error('INVITATION_EXHAUSTED');
    const lockedCount = Number(database.prepare('SELECT COUNT(*) as count FROM registrations WHERE event_id = ? AND status <> \'cancelled\'').get(event.id)?.count || 0);
    if (event.capacity && lockedCount >= event.capacity) throw new Error('EVENT_FULL');
    database.prepare(`
      INSERT INTO registrations(id, event_id, participant_id, invitation_id, invitation_code, status, payment_status, reference_number, created_at, updated_at)
      VALUES(?,?,?,?,?,?,?,?,?,?)
    `).run(registrationId, event.id, user.id, invitation.id, invitation.code, regStatus, 'not_applicable', referenceNumber, timestamp, timestamp);

    // Update event registration count
    database.prepare('UPDATE events SET current_registrations = current_registrations + 1 WHERE id = ?').run(event.id);

    if (regStatus === 'confirmed') issueTicket(registrationId, event.id, user.id, timestamp);

    // If approval required, create notification for organizer
    const organizer = database.prepare('SELECT organizer_id FROM events WHERE id = ?').get(event.id) as { organizer_id: string } | undefined;
    if (organizer) {
      database.prepare(`
        INSERT INTO in_app_notifications(id, user_id, event_id, type, title, message, read, created_at)
        VALUES(?,?,?,?,?,?,?,?)
      `).run(
        id('notif'),
        organizer.organizer_id,
        event.id,
        'info',
        requireApproval ? 'New Registration Pending Approval' : 'New Participant Joined',
        `${user.name} joined via invite code ${invitation.code}.${requireApproval ? ' Review and approve in workspace.' : ''}`,
        0,
        timestamp
      );
    }

    database.exec('COMMIT');
  } catch (error) {
    database.exec('ROLLBACK');
    if (error instanceof Error && error.message === 'INVITATION_EXHAUSTED') return jsonError('This invitation has reached its usage limit.', 422, 'INVITATION_EXHAUSTED');
    if (error instanceof Error && error.message === 'EVENT_FULL') return jsonError('Event has reached maximum capacity.', 422, 'EVENT_FULL');
    throw error;
  }

  return NextResponse.json({
    message: requireApproval ? 'Registration submitted for organizer approval!' : 'Successfully joined the event!',
    status: regStatus,
    requireApproval,
    registration: {
      id: registrationId,
      referenceNumber,
      eventName: event.name,
      status: regStatus,
    },
    ticket: regStatus === 'confirmed' ? { ticketNumber: database.prepare('SELECT ticket_number FROM tickets WHERE registration_id = ?').get(registrationId)?.ticket_number } : null,
  }, { status: 201 });
}
