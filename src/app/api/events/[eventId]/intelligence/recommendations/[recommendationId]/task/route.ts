import { NextResponse } from 'next/server';
import { currentUser } from '@/lib/server/auth';
import { db, id, nowIso } from '@/lib/server/db';
import { canAccessEvent } from '@/lib/server/event-repository';
import { jsonError, requireRole, validOrigin } from '@/lib/server/http';

type Context={params:Promise<{eventId:string;recommendationId:string}>};
export async function POST(request:Request,context:Context){
  if(!validOrigin(request))return jsonError('Invalid request origin.',403,'INVALID_ORIGIN');
  const user=await currentUser();const denied=requireRole(user,['organizer','sub_organizer']);if(denied)return denied;
  const {eventId,recommendationId}=await context.params;if(!canAccessEvent(eventId,user!.id,user!.role))return jsonError('Event not found.',404,'EVENT_NOT_FOUND');
  const rec=db().prepare('SELECT * FROM event_intelligence_recommendations WHERE id=? AND event_id=?').get(recommendationId,eventId);
  if(!rec)return jsonError('Recommendation not found.',404,'NOT_FOUND');
  const existing=db().prepare('SELECT * FROM tasks WHERE related_recommendation_id=?').get(recommendationId);
  if(existing)return NextResponse.json({taskId:existing.id,existing:true});
  const timestamp=nowIso();const taskId=id('task');
  try{
    db().exec('BEGIN IMMEDIATE');
    const raced=db().prepare('SELECT id FROM tasks WHERE related_recommendation_id=?').get(recommendationId);
    if(raced){db().exec('COMMIT');return NextResponse.json({taskId:raced.id,existing:true});}
    db().prepare(`INSERT INTO tasks(id,event_id,title,description,priority,status,due_at,owner_id,department,related_recommendation_id,created_at,updated_at) VALUES(?,?,?,?,?,'pending',?,NULL,?,?,?,?)`).run(taskId,eventId,String(rec.action).slice(0,200),String(rec.explanation),rec.priority,new Date(Date.now()+86_400_000).toISOString(),String(rec.category).slice(0,60),recommendationId,timestamp,timestamp);
    db().prepare('UPDATE event_intelligence_recommendations SET status=?,related_task_id=? WHERE id=?').run('in_progress',taskId,recommendationId);
    db().prepare('INSERT INTO event_recommendation_history(id,recommendation_id,user_id,from_status,to_status,outcome,created_at) VALUES(?,?,?,?,?,?,?)').run(id('rech'),recommendationId,user!.id,String(rec.status),'in_progress','Organizer explicitly created a task from this recommendation.',timestamp);
    db().exec('COMMIT');
  }catch(error){db().exec('ROLLBACK');throw error;}
  return NextResponse.json({taskId,existing:false},{status:201});
}
