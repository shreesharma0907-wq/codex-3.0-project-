import { NextResponse } from 'next/server';
import { currentUser } from '@/lib/server/auth';
import { db } from '@/lib/server/db';
import { canAccessEvent } from '@/lib/server/event-repository';
import { jsonError, requireRole } from '@/lib/server/http';

type Context = { params: Promise<{ eventId: string }> };

export async function GET(_request: Request, context: Context) {
  const user = await currentUser(); const denied = requireRole(user, ['organizer', 'sub_organizer']); if (denied) return denied;
  const { eventId } = await context.params; if (!canAccessEvent(eventId, user!.id, user!.role)) return jsonError('Event not found.', 404, 'EVENT_NOT_FOUND');
  const event = db().prepare('SELECT registration_target,capacity FROM events WHERE id=?').get(eventId)!;
  const target = Number(event.registration_target);

  const regCount = Number(
    db().prepare('SELECT COUNT(*) as count FROM registrations WHERE event_id=? AND status<>\'cancelled\'').get(eventId)?.count || 0
  );
  const partnerStats = db().prepare(
    'SELECT COUNT(*) as total, SUM(CASE WHEN status=\'confirmed\' THEN 1 ELSE 0 END) as confirmed FROM partners WHERE event_id=?'
  ).get(eventId);
  const totalPartners = Number(partnerStats?.total || 0);
  const partnerConfirmations = Number(partnerStats?.confirmed || 0);

  const taskCounts = db().prepare("SELECT COUNT(*) AS total,SUM(CASE WHEN status='completed' THEN 1 ELSE 0 END) AS completed FROM tasks WHERE event_id=?").get(eventId)!;
  const completed = Number(taskCounts.completed || 0); const total = Number(taskCounts.total || 0);
  const taskPct = total ? Math.round(completed / total * 100) : 0;
  const regPct = target ? Math.min(100, Math.round(regCount / target * 100)) : 0;
  const partnerPct = totalPartners ? Math.round(partnerConfirmations / totalPartners * 100) : 100;
  const eventReadiness = Math.round((taskPct * 0.4) + (regPct * 0.35) + (partnerPct * 0.25));

  return NextResponse.json({
    registrations: {
      current: regCount,
      target,
      gap: Math.max(0, target - regCount),
      percentage: regPct,
    },
    partnerConfirmations: {
      current: partnerConfirmations,
      total: totalPartners,
      percentage: partnerPct,
    },
    taskCompletion: {
      completed,
      total,
      percentage: taskPct,
    },
    eventReadiness,
  });
}
