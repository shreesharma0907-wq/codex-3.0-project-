import { NextResponse } from 'next/server';
import { currentUser } from '@/lib/server/auth';
import { db } from '@/lib/server/db';
import { jsonError, requireRole } from '@/lib/server/http';
import { listEventSubOrganizers } from '@/lib/server/team-repository';

type Context = { params: Promise<{ eventId: string }> };

export async function GET(_request: Request, context: Context) {
  const user = await currentUser();
  const denied = requireRole(user, ['organizer']);
  if (denied) return denied;

  const { eventId } = await context.params;
  const ownsEvent = db().prepare('SELECT 1 FROM events WHERE id=? AND organizer_id=?').get(eventId, user!.id);
  if (!ownsEvent) return jsonError('Event not found or you are not authorized to manage it.', 404, 'EVENT_NOT_FOUND');

  return NextResponse.json(listEventSubOrganizers(db(), eventId));
}
