import { NextResponse } from 'next/server';
import { db } from '@/lib/server/db';
import { currentUser } from '@/lib/server/auth';
import { canAccessEvent } from '@/lib/server/event-repository';
import { jsonError, requireRole } from '@/lib/server/http';

type Context = { params: Promise<{ eventId: string }> };

export async function GET(_request: Request, context: Context) {
  const user = await currentUser(); const denied = requireRole(user, ['organizer', 'sub_organizer']); if (denied) return denied;
  const { eventId } = await context.params; if (!canAccessEvent(eventId, user!.id, user!.role)) return jsonError('Event not found.', 404, 'EVENT_NOT_FOUND');
  const rows = db().prepare('SELECT * FROM partners WHERE event_id=? ORDER BY created_at ASC').all(eventId);
  const partners = rows.map((r: Record<string, unknown>) => ({
    id: String(r.id),
    name: String(r.name),
    type: r.tier as 'Platinum' | 'Gold' | 'Silver' | 'Bronze',
    status: r.status as 'confirmed' | 'pending',
    contact: String(r.contact || ''),
    deadline: String(r.deadline),
  }));
  return NextResponse.json(partners);
}
