import { NextResponse } from 'next/server';
import { currentUser } from '@/lib/server/auth';
import { db, nowIso } from '@/lib/server/db';
import { jsonError, requireRole, validOrigin } from '@/lib/server/http';
import { canManageMemberCapabilities, listCapabilities, saveMemberCapabilities } from '@/lib/server/team-repository';
import { validateCapability, type CapabilityInput } from '@/lib/team-capabilities';

type Context = { params: Promise<{ eventId: string; userId: string }> };

function verifyScope(eventId: string, userId: string, organizerId: string) {
  return canManageMemberCapabilities(db(), eventId, organizerId, userId);
}

export async function GET(_request: Request, context: Context) {
  const user = await currentUser();
  const denied = requireRole(user, ['organizer', 'sub_organizer']);
  if (denied) return denied;
  const { eventId, userId } = await context.params;
  if (user!.role === 'organizer' && !verifyScope(eventId, userId, user!.id)) return jsonError('Team member not found.', 404, 'TEAM_MEMBER_NOT_FOUND');
  if (user!.role === 'sub_organizer' && (user!.id !== userId || !db().prepare("SELECT id FROM team_assignments WHERE event_id=? AND user_id=? AND status='active'").get(eventId, user!.id))) {
    return jsonError('Team member not found.', 404, 'TEAM_MEMBER_NOT_FOUND');
  }
  return NextResponse.json({ capabilities: listCapabilities(db(), eventId, userId) });
}

export async function PUT(request: Request, context: Context) {
  if (!validOrigin(request)) return jsonError('Invalid request origin.', 403, 'INVALID_ORIGIN');
  const user = await currentUser();
  const denied = requireRole(user, ['organizer']);
  if (denied) return denied;
  const { eventId, userId } = await context.params;
  if (!verifyScope(eventId, userId, user!.id)) return jsonError('Team member not found.', 404, 'TEAM_MEMBER_NOT_FOUND');
  const body = await request.json().catch(() => null) as { capabilities?: unknown } | null;
  if (!Array.isArray(body?.capabilities) || body.capabilities.length > 30) {
    return jsonError('Provide up to 30 capabilities.', 422, 'INVALID_CAPABILITIES');
  }

  const parsed: Array<{ id?: string; error?: string; value?: NonNullable<ReturnType<typeof validateCapability>['value']> }> = body.capabilities.map((item: unknown) => {
    const input: CapabilityInput & { id?: unknown } = item && typeof item === 'object'
      ? item as CapabilityInput & { id?: unknown }
      : { category: undefined, name: undefined, proficiency: undefined };
    const result = validateCapability(input);
    return result.error ? { error: result.error } : { id: typeof input.id === 'string' && !input.id.startsWith('new-') ? input.id : undefined, value: result.value };
  });
  const invalid = parsed.find(item => item.error);
  if (invalid?.error) return jsonError(invalid.error, 422, 'INVALID_CAPABILITY');
  const values = parsed.flatMap(item => item.value ? [item.value] : []);
  const uniqueKeys = new Set(values.map(item => `${item.category}:${item.name.toLocaleLowerCase()}`));
  if (uniqueKeys.size !== values.length) return jsonError('Capability names must be unique within each category.', 422, 'DUPLICATE_CAPABILITY');

  try {
    const capabilities = saveMemberCapabilities(db(), eventId, userId, user!.id, parsed.flatMap(item => item.value ? [{ ...item.value, id: item.id }] : []), nowIso());
    return NextResponse.json({ capabilities });
  } catch (error) {
    if (error instanceof Error && error.message === 'INVALID_CAPABILITY_ID') return jsonError('A capability does not belong to this team member and event.', 422, 'INVALID_CAPABILITY_ID');
    return jsonError('Could not save capabilities. No changes were saved.', 500, 'CAPABILITY_SAVE_FAILED');
  }
}
