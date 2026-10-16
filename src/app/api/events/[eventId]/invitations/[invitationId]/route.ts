import { NextResponse } from 'next/server';
import { createHash, randomBytes } from 'node:crypto';
import { currentUser } from '@/lib/server/auth';
import { db, nowIso } from '@/lib/server/db';
import { canAccessEvent } from '@/lib/server/event-repository';
import { jsonError, requireRole, validOrigin } from '@/lib/server/http';

interface InvitationRow {
  id: string;
  event_id: string;
  code: string;
  token: string;
  token_hash?: string | null;
  access_mode?: string;
  require_approval?: number;
  created_by: string;
  created_at: string;
  expires_at: string | null;
  max_uses: number | null;
  used_count: number;
  status: string;
  revoked_at: string | null;
  revoked_by: string | null;
}

type Context = { params: Promise<{ eventId: string; invitationId: string }> };

function hashToken(raw: string): string {
  return createHash('sha256').update(raw).digest('hex');
}

function generateCode(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = '';
  const bytes = randomBytes(8);
  for (let i = 0; i < 8; i++) {
    code += chars[bytes[i] % chars.length];
  }
  return code;
}

function generateToken(): string {
  return randomBytes(24).toString('hex');
}

function shareUrl(request: Request, path: string): string {
  const configured = process.env.NEXT_PUBLIC_APP_URL?.trim();
  try { return new URL(path, configured ? new URL(configured).origin : new URL(request.url).origin).toString(); }
  catch { return new URL(path, new URL(request.url).origin).toString(); }
}

export async function PATCH(request: Request, context: Context) {
  if (!validOrigin(request)) return jsonError('Invalid request origin.', 403, 'INVALID_ORIGIN');
  const user = await currentUser();
  const denied = requireRole(user, ['organizer']);
  if (denied) return denied;

  const { eventId, invitationId } = await context.params;
  if (!canAccessEvent(eventId, user!.id, user!.role)) return jsonError('Event not found.', 404, 'EVENT_NOT_FOUND');

  const database = db();
  const invitation = database.prepare('SELECT * FROM invitations WHERE id = ? AND event_id = ?').get(invitationId, eventId) as InvitationRow | undefined;
  if (!invitation) return jsonError('Invitation not found.', 404, 'INVITATION_NOT_FOUND');

  const body = await request.json().catch(() => null) as {
    action?: 'revoke' | 'regenerate' | 'update';
    maxUses?: number | null;
    expiresAt?: string | null;
    accessMode?: 'link' | 'code' | 'both';
  } | null;

  if (!body) return jsonError('Invalid payload.', 422, 'INVALID_BODY');

  const timestamp = nowIso();

  if (body.action === 'revoke') {
    database.prepare(`
      UPDATE invitations
      SET status = 'revoked', revoked_at = ?, revoked_by = ?
      WHERE id = ?
    `).run(timestamp, user!.id, invitationId);
  } else if (body.action === 'regenerate') {
    let code = generateCode();
    let attempts = 0;
    while (database.prepare('SELECT id FROM invitations WHERE code = ?').get(code) && attempts < 10) {
      code = generateCode();
      attempts++;
    }
    const token = generateToken();
    const tokenDigest = hashToken(token);

    database.prepare(`
      UPDATE invitations
      SET code = ?, token = ?, token_hash = ?, status = 'active', revoked_at = NULL, revoked_by = NULL
      WHERE id = ?
    `).run(code, token, tokenDigest, invitationId);
  } else if (body.action === 'update') {
    const updates: string[] = [];
    const values: unknown[] = [];

    if (body.maxUses !== undefined) {
      updates.push('max_uses = ?');
      values.push(body.maxUses && body.maxUses > 0 ? body.maxUses : null);
    }
    if (body.expiresAt !== undefined) {
      updates.push('expires_at = ?');
      values.push(body.expiresAt && body.expiresAt.trim() ? body.expiresAt : null);
    }
    if (body.accessMode !== undefined) {
      updates.push('access_mode = ?');
      values.push(body.accessMode);
    }

    if (updates.length > 0) {
      values.push(invitationId);
      database.prepare(`UPDATE invitations SET ${updates.join(', ')} WHERE id = ?`).run(...values);
    }
  }

  const updated = database.prepare(`
    SELECT i.*, 
      (SELECT COUNT(*) FROM registrations r WHERE (r.invitation_id = i.id OR r.invitation_code = i.code) AND r.status <> 'cancelled') as reg_count
    FROM invitations i
    WHERE i.id = ?
  `).get(invitationId) as unknown as (InvitationRow & { reg_count?: number });

  return NextResponse.json({
    id: updated.id,
    eventId: updated.event_id,
    code: updated.code,
    token: updated.token,
    accessMode: updated.access_mode || 'both',
    requireApproval: Boolean(updated.require_approval),
    createdBy: updated.created_by,
    createdAt: updated.created_at,
    expiresAt: updated.expires_at,
    maxUses: updated.max_uses,
    usedCount: updated.used_count,
    registrationCount: Number(updated.reg_count || updated.used_count || 0),
    status: updated.status,
    revokedAt: updated.revoked_at,
    revokedBy: updated.revoked_by,
    joinUrl: shareUrl(request, `/participant/join?invite=${encodeURIComponent(updated.token)}`),
    joinCodeUrl: shareUrl(request, `/participant/join?code=${encodeURIComponent(updated.code)}`),
  });
}

export async function DELETE(request: Request, context: Context) {
  if (!validOrigin(request)) return jsonError('Invalid request origin.', 403, 'INVALID_ORIGIN');
  const user = await currentUser();
  const denied = requireRole(user, ['organizer']);
  if (denied) return denied;

  const { eventId, invitationId } = await context.params;
  if (!canAccessEvent(eventId, user!.id, user!.role)) return jsonError('Event not found.', 404, 'EVENT_NOT_FOUND');

  const database = db();
  const invitation = database.prepare('SELECT * FROM invitations WHERE id = ? AND event_id = ?').get(invitationId, eventId) as InvitationRow | undefined;
  if (!invitation) return jsonError('Invitation not found.', 404, 'INVITATION_NOT_FOUND');

  const timestamp = nowIso();
  database.prepare(`
    UPDATE invitations
    SET status = 'revoked', revoked_at = ?, revoked_by = ?
    WHERE id = ?
  `).run(timestamp, user!.id, invitationId);

  return NextResponse.json({ success: true, message: 'Invitation revoked.' });
}
