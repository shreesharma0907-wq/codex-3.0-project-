import { NextResponse } from 'next/server';
import { currentUser } from '@/lib/server/auth';
import { db, nowIso } from '@/lib/server/db';
import { jsonError, requireRole, validOrigin } from '@/lib/server/http';
import { canManageMemberCapabilities, canReadEventTeam } from '@/lib/server/team-repository';

type Context = { params: Promise<{ eventId: string; userId: string }> };

export async function PATCH(request: Request, context: Context) {
  if (!validOrigin(request)) return jsonError('Invalid request origin.', 403, 'INVALID_ORIGIN');
  const user = await currentUser();
  const denied = requireRole(user, ['organizer', 'sub_organizer']);
  if (denied) return denied;
  const { eventId, userId } = await context.params;
  const authorized = user!.role === 'organizer'
    ? canManageMemberCapabilities(db(), eventId, user!.id, userId)
    : user!.id === userId && canReadEventTeam(db(), eventId, user!.id, user!.role);
  if (!authorized) return jsonError('Team profile not found.', 404, 'TEAM_MEMBER_NOT_FOUND');

  const body = await request.json().catch(() => null) as { phone?: unknown; preferredContactMethod?: unknown } | null;
  const phone = typeof body?.phone === 'string' ? body.phone.trim() : body?.phone === null ? '' : undefined;
  const preferred = body?.preferredContactMethod;
  const preferredContactMethod = typeof preferred === 'string' ? preferred.trim() : preferred === null ? '' : undefined;
  if (phone === undefined || preferredContactMethod === undefined) return jsonError('Phone and preferred contact method are required.', 422, 'INVALID_CONTACT');
  if (phone.length > 32 || (phone && (!/^[+()\d.\-\s]+$/.test(phone) || phone.replace(/\D/g, '').length < 7))) return jsonError('Enter a valid phone number or leave it blank.', 422, 'INVALID_PHONE');
  if (preferredContactMethod && !['email', 'phone', 'sms'].includes(preferredContactMethod)) return jsonError('Choose email, phone, or SMS as the preferred contact method.', 422, 'INVALID_CONTACT_METHOD');

  try {
    db().prepare(`
      INSERT INTO responder_profiles(user_id,phone,preferred_contact_method,updated_at)
      VALUES(?,?,?,?)
      ON CONFLICT(user_id) DO UPDATE SET phone=excluded.phone,
        preferred_contact_method=excluded.preferred_contact_method,updated_at=excluded.updated_at
    `).run(userId, phone || null, preferredContactMethod || null, nowIso());
    return NextResponse.json({ phone: phone || null, preferredContactMethod: preferredContactMethod || null });
  } catch {
    return jsonError('Could not save contact details. Please try again.', 500, 'CONTACT_SAVE_FAILED');
  }
}
