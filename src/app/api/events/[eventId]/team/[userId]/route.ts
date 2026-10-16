import { NextResponse } from 'next/server';
import { currentUser } from '@/lib/server/auth';
import { db, nowIso } from '@/lib/server/db';
import { jsonError, requireRole, validOrigin } from '@/lib/server/http';

type Context = { params: Promise<{ eventId: string; userId: string }> };
export async function DELETE(request: Request, context: Context) {
  if (!validOrigin(request)) return jsonError('Invalid request origin.', 403, 'INVALID_ORIGIN');
  const user=await currentUser(); const denied=requireRole(user,['organizer']); if(denied)return denied;
  const {eventId,userId}=await context.params; const database=db();
  if(!database.prepare('SELECT id FROM events WHERE id=? AND organizer_id=?').get(eventId,user!.id)) return jsonError('Event not found.',404,'EVENT_NOT_FOUND');
  const timestamp=nowIso(); database.exec('BEGIN IMMEDIATE');
  try {
    const result=database.prepare(`UPDATE team_assignments SET status='inactive',updated_at=? WHERE event_id=? AND user_id=? AND status='active'`).run(timestamp,eventId,userId);
    if(!result.changes){database.exec('ROLLBACK');return jsonError('Active team membership not found.',404,'MEMBERSHIP_NOT_FOUND');}
    database.prepare(`UPDATE team_invitations SET status='revoked',revoked_by=?,revoked_at=?,updated_at=? WHERE event_id=? AND accepted_by=? AND status='pending_approval'`).run(user!.id,timestamp,timestamp,eventId,userId);
    database.exec('COMMIT');
  } catch(error){try{database.exec('ROLLBACK');}catch{/* transaction already closed */}throw error;}
  return NextResponse.json({success:true,userId,eventId,status:'inactive'});
}
