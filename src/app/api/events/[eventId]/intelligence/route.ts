import { NextResponse } from 'next/server';
import { currentUser } from '@/lib/server/auth';
import { db, id, nowIso } from '@/lib/server/db';
import { canAccessEvent } from '@/lib/server/event-repository';
import { collectEventIntelligence, generateGeminiAnalysis, persistAnalysis } from '@/lib/server/event-intelligence';
import { jsonError, requireRole, validOrigin } from '@/lib/server/http';

type Context = { params: Promise<{eventId:string}> };
function authorize(user: Awaited<ReturnType<typeof currentUser>>, eventId:string) {
  const denied=requireRole(user,['organizer','sub_organizer']);
  if(denied)return denied;
  if(!canAccessEvent(eventId,user!.id,user!.role))return jsonError('Event not found.',404,'EVENT_NOT_FOUND');
  return null;
}
export async function GET(request:Request,context:Context) {
  const user=await currentUser();const {eventId}=await context.params;const denied=authorize(user,eventId);if(denied)return denied;
  const raw=Number(new URL(request.url).searchParams.get('days')||30);if(!Number.isInteger(raw)||raw<7||raw>90)return jsonError('days must be an integer between 7 and 90.',400,'INVALID_RANGE');
  const result=collectEventIntelligence(eventId,raw);if(!result)return jsonError('Event not found.',404,'EVENT_NOT_FOUND');
  const aiState=process.env.GEMINI_API_KEY?.trim()?'ready':'missing_key';
  return NextResponse.json({...result,aiState});
}
export async function POST(request:Request,context:Context) {
  if(!validOrigin(request))return jsonError('Invalid request origin.',403,'INVALID_ORIGIN');
  const user=await currentUser();const {eventId}=await context.params;const denied=authorize(user,eventId);if(denied)return denied;
  const latest=db().prepare('SELECT generated_at FROM event_intelligence_analyses WHERE event_id=? ORDER BY generated_at DESC LIMIT 1').get(eventId);
  if(latest&&Date.now()-Date.parse(String(latest.generated_at))<60_000)return jsonError('Please wait one minute between Gemini analyses.',429,'ANALYSIS_RATE_LIMITED');
  const data=collectEventIntelligence(eventId,30);if(!data)return jsonError('Event not found.',404,'EVENT_NOT_FOUND');
  const generated=await generateGeminiAnalysis(data.stats);
  if(!generated.ok)return NextResponse.json({aiState:generated.state,message:generated.message},{status:generated.state==='missing_key'?503:generated.state==='rate_limited'?429:502});
  const generatedAt=persistAnalysis(eventId,generated.model,generated.analysis);
  return NextResponse.json({analysis:generated.analysis,generatedAt,model:generated.model,stale:false});
}

export async function PATCH(request:Request,context:Context) {
  if(!validOrigin(request))return jsonError('Invalid request origin.',403,'INVALID_ORIGIN');
  const user=await currentUser();const {eventId}=await context.params;const denied=authorize(user,eventId);if(denied)return denied;
  const body=await request.json().catch(()=>null) as {recommendationId?:string;status?:string;outcome?:string}|null;
  const allowed=['accepted','dismissed','in_progress','completed'];if(!body||typeof body.recommendationId!=='string'||!allowed.includes(String(body.status)))return jsonError('A valid recommendationId and status are required.',422,'INVALID_RECOMMENDATION_STATUS');
  const database=db();const row=database.prepare('SELECT status FROM event_intelligence_recommendations WHERE id=? AND event_id=?').get(body.recommendationId,eventId);
  if(!row)return jsonError('Recommendation not found.',404,'NOT_FOUND');
  const fromStatus=String(row.status);const toStatus=String(body.status);
  database.exec('BEGIN');try{
    database.prepare('UPDATE event_intelligence_recommendations SET status=? WHERE id=? AND event_id=?').run(toStatus,body.recommendationId,eventId);
    database.prepare('INSERT INTO event_recommendation_history(id,recommendation_id,user_id,from_status,to_status,outcome,created_at) VALUES(?,?,?,?,?,?,?)').run(id('rech'),body.recommendationId,user!.id,fromStatus,toStatus,typeof body.outcome==='string'?body.outcome.trim().slice(0,1000)||null:null,nowIso());
    database.exec('COMMIT');
  }catch(error){database.exec('ROLLBACK');throw error;}
  return NextResponse.json({ok:true,status:toStatus});
}
