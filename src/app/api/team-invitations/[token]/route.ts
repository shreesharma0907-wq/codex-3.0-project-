import { NextResponse } from 'next/server';
import { currentUser } from '@/lib/server/auth';
import { db, nowIso } from '@/lib/server/db';
import { acceptTeamInvitation, InvalidTeamInvitationError, InvitationIdentityMismatchError, digestTeamInviteToken } from '@/lib/server/signup-repository';
import { jsonError, requireRole, validOrigin } from '@/lib/server/http';

type Context = { params: Promise<{ token: string }> };

export async function GET(_request: Request, context: Context) {
  const { token } = await context.params;
  if (token.length < 30 || token.length > 100) return jsonError('This team invitation is invalid.', 404, 'INVALID_INVITATION');
  const row = db().prepare(`SELECT ti.id,ti.event_id,ti.responsibility,ti.responsibilities_json,ti.zones,ti.requires_approval,ti.status,ti.expires_at,e.name AS event_name,u.name AS organizer_name FROM team_invitations ti JOIN events e ON e.id=ti.event_id AND e.organizer_id=ti.organizer_id JOIN users u ON u.id=ti.organizer_id WHERE ti.token_hash=?`).get(digestTeamInviteToken(token));
  if (!row) return jsonError('This team invitation is invalid.', 404, 'INVALID_INVITATION');
  const status = row.status === 'pending' && Date.parse(String(row.expires_at)) <= Date.now() ? 'expired' : row.status;
  const user = await currentUser();
  return NextResponse.json({ invitation: { eventId: row.event_id, eventName: row.event_name, organizerName: row.organizer_name, responsibility: row.responsibility, responsibilities: JSON.parse(String(row.responsibilities_json || '[]')), zones: row.zones, requiresApproval: Boolean(row.requires_approval), expiresAt: row.expires_at, status }, authenticated: Boolean(user), role: user?.role ?? null });
}

export async function POST(request: Request, context: Context) {
  if (!validOrigin(request)) return jsonError('Invalid request origin.', 403, 'INVALID_ORIGIN');
  const user = await currentUser(); const denied = requireRole(user, ['sub_organizer']); if (denied) return denied;
  const { token } = await context.params;
  const body = await request.json().catch(() => null) as { action?: unknown } | null;
  if (body?.action === 'decline') {
    const invitation = db().prepare(`SELECT id,intended_email,status FROM team_invitations WHERE token_hash=?`).get(digestTeamInviteToken(token));
    if (!invitation || invitation.status !== 'pending') return jsonError('This team invitation is no longer available.', 410, 'INVALID_INVITATION');
    if (invitation.intended_email && String(invitation.intended_email).toLowerCase() !== user!.email.toLowerCase()) return jsonError('Sign in with the email address this invitation was sent to.', 403, 'INVITATION_EMAIL_MISMATCH');
    db().prepare(`UPDATE team_invitations SET status='declined',updated_at=? WHERE id=? AND status='pending'`).run(nowIso(), invitation.id);
    return NextResponse.json({ success: true, status: 'declined' });
  }
  try {
    const membership = acceptTeamInvitation(db(), token, user!.id, user!.email);
    return NextResponse.json({ success: true, ...membership });
  } catch (error) {
    if (error instanceof InvitationIdentityMismatchError) return jsonError('Sign in with the email address this invitation was sent to.', 403, 'INVITATION_EMAIL_MISMATCH');
    if (error instanceof InvalidTeamInvitationError) return jsonError('This team invitation is invalid, expired, revoked, or already used.', 410, 'INVALID_TEAM_INVITATION');
    return jsonError('The invitation could not be accepted.', 500, 'INVITATION_ACCEPT_FAILED');
  }
}
