import { NextRequest, NextResponse } from 'next/server';
import { currentUser } from '@/lib/server/auth';
import { jsonError, requireRole } from '@/lib/server/http';
import {
  getNotificationsForUser,
  markNotificationRead,
  markAllNotificationsRead,
} from '@/lib/server/incident-repository';

export async function GET() {
  const user = await currentUser();
  const authError = requireRole(user, ['organizer', 'sub_organizer', 'participant']);
  if (authError) return authError;

  const notifications = getNotificationsForUser(user!.id);
  const unreadCount = notifications.filter(n => !n.read).length;

  return NextResponse.json({
    notifications,
    unreadCount,
  });
}

export async function PATCH(request: NextRequest) {
  const user = await currentUser();
  const authError = requireRole(user, ['organizer', 'sub_organizer', 'participant']);
  if (authError) return authError;

  const body = await request.json().catch(() => ({}));
  const notificationId = body.notificationId ? String(body.notificationId) : undefined;
  const markAll = Boolean(body.markAll);

  if (markAll) {
    markAllNotificationsRead(user!.id);
  } else if (notificationId) {
    markNotificationRead(notificationId, user!.id);
  } else {
    return jsonError('notificationId or markAll is required.', 400, 'VALIDATION_ERROR');
  }

  return NextResponse.json({ success: true });
}
