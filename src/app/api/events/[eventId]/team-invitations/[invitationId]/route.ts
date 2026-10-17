import { NextResponse } from 'next/server';
import { currentUser } from '@/lib/server/auth';
import { db, nowIso } from '@/lib/server/db';
import { jsonError, requireRole, validOrigin } from '@/lib/server/http';

type Context = { params: Promise<{ eventId: string; invitationId: string }> };
export async function PATCH(request: Request, context: Context) {
  if (!validOrigin(request)) return jsonError('Invalid request origin.', 403, 'INVALID_ORIGIN');
  const user = await currentUser(); const denied = requireRole(user, ['organizer']); if (denied) return denied;
  const { eventId, invitationId } = await context.params; const database = db();
  if (!database.prepare('SELECT id FROM events WHERE id=? AND organizer_id=?').get(eventId, user!.id)) return jsonError('Event not found.', 404, 'EVENT_NOT_FOUND');
  const invitation = database.prepare(`SELECT * FROM team_invitations WHERE id=? AND event_id=?`).get(invitationId, eventId);
  if (!invitation) return jsonError('Invitation not found.', 404, 'INVITATION_NOT_FOUND');
  const body = await request.json().catch(() => null) as { action?: unknown } | null;
  const now = nowIso();
  if (body?.action === 'revoke') {
    const result = database.prepare(`UPDATE team_invitations SET status='revoked',revoked_by=?,revoked_at=?,updated_at=? WHERE id=? AND status IN ('pending','pending_approval')`).run(user!.id, now, now, invitationId);
    if (!result.changes) return jsonError('Only a pending invitation can be revoked.', 409, 'INVITATION_NOT_PENDING');
    return NextResponse.json({ success: true, status: 'revoked' });
  }
  if (body?.action === 'approve') {
    if (invitation.status !== 'pending_approval' || !invitation.accepted_by) return jsonError('This invitation is not awaiting approval.', 409, 'APPROVAL_NOT_PENDING');
    database.exec('BEGIN IMMEDIATE');
    try {
      database.prepare(`UPDATE team_assignments SET status='active',updated_at=? WHERE event_id=? AND user_id=? AND responsibility=?`).run(now, eventId, invitation.accepted_by, invitation.responsibility);
      database.prepare(`UPDATE team_invitations SET status='accepted',updated_at=? WHERE id=? AND status='pending_approval'`).run(now, invitationId);
      database.exec('COMMIT');
    } catch (error) { try { database.exec('ROLLBACK'); } catch { /* no active tx */ } throw error; }
    return NextResponse.json({ success: true, status: 'accepted' });
  }
  return jsonError('Choose a supported invitation action.', 422, 'INVALID_ACTION');
}
