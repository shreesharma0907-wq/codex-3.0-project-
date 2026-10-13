import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { registrationAnalytics, outreachAnalytics } from '../src/lib/event-intelligence-metrics.ts';
import { validateIntelligenceAnalysis } from '../src/lib/ai-response-validation.ts';

describe('event intelligence metrics',()=>{
 test('groups by registration creation date and excludes cancelled records from active trend',()=>{
  const now=new Date('2026-10-13T12:00:00Z');
  const result=registrationAnalytics({now,days:7,target:10,capacity:20,eventStart:'2026-10-20T10:00:00Z',registrationDeadline:'2026-10-19T00:00:00Z',registrations:[
   {created_at:'2026-10-12T08:00:00Z',status:'confirmed'},
   {created_at:'2026-10-13T08:00:00Z',status:'pending'},
   {created_at:'2026-10-13T09:00:00Z',status:'cancelled'},
  ]});
  assert.equal(result.confirmed,1);assert.equal(result.pending,1);assert.equal(result.cancelled,1);assert.equal(result.total,2);
  assert.equal(result.series.find(x=>x.date==='2026-10-12').registrations,1);
  assert.equal(result.series.find(x=>x.date==='2026-10-13').registrations,1);
  assert.equal(result.forecast.sufficientData,false);assert.equal(result.forecast.estimate,null);
 });
 test('forecast remains absent when dated history is insufficient and appears after adequate observations',()=>{
  const registrations=[];for(let day=2;day<=8;day++)for(let n=0;n<2;n++)registrations.push({created_at:`2026-10-${String(day).padStart(2,'0')}T0${n}:00:00Z`,status:'confirmed'});
  const result=registrationAnalytics({now:new Date('2026-10-08T12:00:00Z'),days:7,target:30,capacity:null,eventStart:'2026-10-20T12:00:00Z',registrationDeadline:'2026-10-18T12:00:00Z',registrations});
  assert.equal(result.forecast.sufficientData,true);assert.equal(result.forecast.estimate,34);assert.ok(result.forecast.low<=result.forecast.estimate);assert.ok(result.forecast.high>=result.forecast.estimate);
 });
 test('calculates invitation attribution without claiming delivery or opens',()=>{
  const result=outreachAnalytics([{id:'i1',code:'A',outreach_source:'email',campaign_name:'Fall',created_at:'x',registrations:3,confirmedRegistrations:2,used_count:3},{id:'i2',code:'B',outreach_source:'email',campaign_name:'Fall',created_at:'x',registrations:1,confirmedRegistrations:1,used_count:1}]);
  assert.equal(result.invitationsGenerated,2);assert.equal(result.registrationsAttributed,4);assert.equal(result.confirmedRegistrationsAttributed,3);assert.equal(result.deliveryTracked,false);assert.equal(result.linkOpensTracked,false);assert.equal(result.sources[0].attributedPerGeneratedInvitation,2);
 });
 test('validates structured AI output and rejects malformed content',()=>{
  const valid={health:'At risk',registrationOutlook:'Below target pace',topIssues:['Pace'],positiveDevelopments:[],upcomingDeadlines:[],limitations:['Sparse history'],recommendedActions:[{category:'registration',priority:'high',evidence:['3 of 10'],explanation:'Below pace',action:'Plan outreach',expectedOutcome:'Improved pace'}]};
  assert.equal(validateIntelligenceAnalysis(valid).recommendedActions[0].priority,'high');
  assert.throws(()=>validateIntelligenceAnalysis({...valid,recommendedActions:'not an array'}));
  assert.throws(()=>validateIntelligenceAnalysis({...valid,recommendedActions:[{...valid.recommendedActions[0],priority:'extreme'}]}));
 });
});
