import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/server/db';
import { currentUser, normalizeEmail, validatePassword } from '@/lib/server/auth';
import { jsonError, requireRole, validOrigin } from '@/lib/server/http';
import { createSubOrganizerAccount, ExistingAccountError } from '@/lib/server/account-repository';

export async function POST(request: NextRequest) {
  if (!validOrigin(request)) return jsonError('Invalid request origin.', 403, 'INVALID_ORIGIN');

  const user = await currentUser();
  const authError = requireRole(user, ['organizer']);
  if (authError) return authError;

  const body = await request.json().catch(() => null) as {
    name?: unknown; email?: unknown; password?: unknown;
    responsibility?: unknown; eventId?: unknown;
    skills?: unknown; zones?: unknown; phone?: unknown; preferredContactMethod?: unknown;
    permittedResponsibilities?: unknown;
  } | null;

  const name = typeof body?.name === 'string' ? body.name.trim() : '';
  const email = typeof body?.email === 'string' ? normalizeEmail(body.email) : '';
  const password = typeof body?.password === 'string' ? body.password : '';
  const responsibility = typeof body?.responsibility === 'string' ? body.responsibility.trim() : '';
  const eventId = typeof body?.eventId === 'string' ? body.eventId.trim() : '';
  const skills = typeof body?.skills === 'string' ? body.skills.trim() : 'operations';
  const zones = typeof body?.zones === 'string' ? body.zones.trim() : 'all';
  const phone = typeof body?.phone === 'string' ? body.phone.trim() : '';
  const preferredContactMethod = typeof body?.preferredContactMethod === 'string' ? body.preferredContactMethod : '';
  const permittedResponsibilities = Array.isArray(body?.permittedResponsibilities)
    ? body.permittedResponsibilities.filter((item): item is string => typeof item === 'string').map(item => item.trim()).filter(Boolean).slice(0, 20)
    : [];

  // Validation
  if (!name) return jsonError('Name is required.', 422, 'MISSING_NAME');
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return jsonError('A valid email address is required.', 422, 'INVALID_EMAIL');
  }
  const passwordError = validatePassword(password);
  if (passwordError) return jsonError(passwordError, 422, 'WEAK_PASSWORD');
  if (!responsibility) return jsonError('Responsibility is required.', 422, 'MISSING_RESPONSIBILITY');
  if (!eventId) return jsonError('Event ID is required.', 422, 'MISSING_EVENT');
  if (phone.length > 32 || (phone && (!/^[+()\d.\-\s]+$/.test(phone) || phone.replace(/\D/g, '').length < 7))) return jsonError('Enter a valid phone number or leave it blank.', 422, 'INVALID_PHONE');
  if (preferredContactMethod && !['email', 'phone', 'sms'].includes(preferredContactMethod)) return jsonError('Choose email, phone, or SMS as the preferred contact method.', 422, 'INVALID_CONTACT_METHOD');

  // Verify the event belongs to this organizer
  const event = db().prepare('SELECT id FROM events WHERE id=? AND organizer_id=?').get(eventId, user!.id);
  if (!event) return jsonError('Event not found or you are not the organizer.', 404, 'EVENT_NOT_FOUND');

  try {
    const created = await createSubOrganizerAccount(db(), {
      name, email, password, responsibility, eventId, skills, zones,
      phone: phone || null,
      preferredContactMethod: preferredContactMethod || null,
      permittedResponsibilities,
    });
    return NextResponse.json(created, { status: 201 });
  } catch (error) {
    if (error instanceof ExistingAccountError) return jsonError(error.message, 409, 'EMAIL_EXISTS');
    return jsonError('Failed to create sub-organizer account.', 500, 'DB_ERROR');
  }
}
