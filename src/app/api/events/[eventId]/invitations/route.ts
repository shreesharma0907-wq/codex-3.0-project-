import { NextResponse } from 'next/server';
import { createHash, randomBytes } from 'node:crypto';
import { currentUser } from '@/lib/server/auth';
import { db, id, nowIso } from '@/lib/server/db';
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
  reg_count?: number;
  outreach_source?: string | null;
  campaign_name?: string | null;
}

type Context = { params: Promise<{ eventId: string }> };

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

export async function GET(_request: Request, context: Context) {
  const user = await currentUser();
  const denied = requireRole(user, ['organizer', 'sub_organizer']);
  if (denied) return denied;

  const { eventId } = await context.params;
  if (!canAccessEvent(eventId, user!.id, user!.role)) return jsonError('Event not found.', 404, 'EVENT_NOT_FOUND');

  const database = db();
  const invitations = database.prepare(`
    SELECT i.*,
      (SELECT COUNT(*) FROM registrations r WHERE (r.invitation_id = i.id OR r.invitation_code = i.code) AND r.status <> 'cancelled') as reg_count
    FROM invitations i
    WHERE i.event_id = ?
    ORDER BY i.created_at DESC
  `).all(eventId) as unknown as InvitationRow[];

  return NextResponse.json(invitations.map(inv => ({
    id: inv.id,
    eventId: inv.event_id,
    code: inv.code,
    token: inv.token,
    accessMode: inv.access_mode || 'both',
    outreachSource: inv.outreach_source || null,
    campaignName: inv.campaign_name || null,
    requireApproval: Boolean(inv.require_approval),
    createdBy: inv.created_by,
    createdAt: inv.created_at,
    expiresAt: inv.expires_at,
    maxUses: inv.max_uses,
    usedCount: inv.used_count,
    registrationCount: Number(inv.reg_count || inv.used_count || 0),
    status: inv.status === 'revoked' ? 'revoked' : inv.expires_at && Date.parse(inv.expires_at) < Date.now() ? 'expired' : inv.max_uses && inv.used_count >= inv.max_uses ? 'exhausted' : inv.status,
    revokedAt: inv.revoked_at,
    revokedBy: inv.revoked_by,
  })));
}

export async function POST(request: Request, context: Context) {
  if (!validOrigin(request)) return jsonError('Invalid request origin.', 403, 'INVALID_ORIGIN');
  const user = await currentUser();
  const denied = requireRole(user, ['organizer', 'sub_organizer']);
  if (denied) return denied;

  const { eventId } = await context.params;
  if (!canAccessEvent(eventId, user!.id, user!.role)) return jsonError('Event not found.', 404, 'EVENT_NOT_FOUND');

  const body = await request.json().catch(() => null) as {
    expiresAt?: string | null;
    maxUses?: number | null;
    accessMode?: 'link' | 'code' | 'both';
    requireApproval?: boolean;
    customCode?: string;
    outreachSource?: string;
    campaignName?: string;
  } | null;
  if (!body) return jsonError('A JSON body is required.', 422, 'INVALID_BODY');

  const database = db();
  const event = database.prepare('SELECT * FROM events WHERE id = ?').get(eventId) as { id: string; joining_enabled?: number } | undefined;
  if (!event) return jsonError('Event not found.', 404, 'EVENT_NOT_FOUND');

  let code = body.customCode ? body.customCode.trim().toUpperCase().replace(/[^A-Z0-9-]/g, '') : '';
  if (!code || code.length < 4) {
    code = generateCode();
  }

  // Ensure collision-free code
  let attempts = 0;
  while (database.prepare('SELECT id FROM invitations WHERE code = ?').get(code) && attempts < 10) {
    code = generateCode();
    attempts++;
  }

  const rawToken = generateToken();
  const tokenDigest = hashToken(rawToken);
  const invitationId = id('inv');
  const timestamp = nowIso();
  const accessMode = body.accessMode === 'link' || body.accessMode === 'code' ? body.accessMode : 'both';
  const requireApproval = body.requireApproval ? 1 : 0;
  const maxUses = body.maxUses && body.maxUses > 0 ? body.maxUses : null;
  const expiresAt = body.expiresAt && body.expiresAt.trim() ? body.expiresAt : null;

  const validSources = ['email','campus ambassador','social media','partner','other'];
  const source = typeof body.outreachSource === 'string' && validSources.includes(body.outreachSource.toLowerCase()) ? body.outreachSource.toLowerCase() : null;
  const campaignName = typeof body.campaignName === 'string' ? body.campaignName.trim().slice(0,120) || null : null;
  database.prepare(`
    INSERT INTO invitations(id, event_id, code, token, token_hash, access_mode, require_approval, created_by, created_at, expires_at, max_uses, used_count, status, outreach_source, campaign_name)
    VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
  `).run(invitationId, eventId, code, rawToken, tokenDigest, accessMode, requireApproval, user!.id, timestamp, expiresAt, maxUses, 0, 'active', source, campaignName);

  const invitation = database.prepare('SELECT * FROM invitations WHERE id = ?').get(invitationId) as InvitationRow | undefined;
  if (!invitation) return jsonError('Failed to create invitation.', 500, 'INVITATION_CREATION_FAILED');

  return NextResponse.json({
    id: invitation.id,
    eventId: invitation.event_id,
    code: invitation.code,
    token: invitation.token,
    accessMode: invitation.access_mode || 'both',
    outreachSource: source,
    campaignName,
    requireApproval: Boolean(invitation.require_approval),
    createdBy: invitation.created_by,
    createdAt: invitation.created_at,
    expiresAt: invitation.expires_at,
    maxUses: invitation.max_uses,
    usedCount: invitation.used_count,
    registrationCount: 0,
    status: invitation.status,
    revokedAt: invitation.revoked_at,
    revokedBy: invitation.revoked_by,
    joinUrl: shareUrl(request, `/participant/join?invite=${encodeURIComponent(invitation.token)}`),
    joinCodeUrl: shareUrl(request, `/participant/join?code=${encodeURIComponent(invitation.code)}`),
  }, { status: 201 });
}
