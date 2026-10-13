import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { initDbSchema, migrateResponderProfileContactColumns } from '../src/lib/server/db.ts';
import { canAccessSubOrganizerIncident, canAccessSubOrganizerSupportTicket, canAccessSubOrganizerTask, canAssignSubOrganizerToEvent, canManageMemberCapabilities, canReadEventTeam, listTeamMembers, saveMemberCapabilities, upsertResponderProfile } from '../src/lib/server/team-repository.ts';
import { suggestResponders, validateCapability } from '../src/lib/team-capabilities.ts';

function fixture() {
  const database = new DatabaseSync(':memory:');
  initDbSchema(database);
  const now = '2026-10-13T10:00:00.000Z';
  const user = database.prepare(`INSERT INTO users(id,name,email,password_hash,role,status,created_at,updated_at) VALUES(?,?,?,'hash',?,'active',?,?)`);
  user.run('org','Organizer','org@test.invalid','organizer',now,now);
  user.run('sub-a','Sub A','suba@test.invalid','sub_organizer',now,now);
  user.run('sub-b','Sub B','subb@test.invalid','sub_organizer',now,now);
  user.run('participant','Participant','participant@test.invalid','participant',now,now);
  database.prepare(`INSERT INTO events(id,organizer_id,name,event_type,format,start_at,end_at,timezone,created_at,updated_at) VALUES('event-a','org','A','conference','in-person',?,?, 'UTC',?,?)`).run(now,now,now,now);
  database.prepare(`INSERT INTO events(id,organizer_id,name,event_type,format,start_at,end_at,timezone,created_at,updated_at) VALUES('event-b','org','B','conference','in-person',?,?, 'UTC',?,?)`).run(now,now,now,now);
  database.prepare(`INSERT INTO team_assignments(id,event_id,user_id,responsibility,status,created_at,updated_at) VALUES(?,?,'sub-a','Transport lead','active',?,?)`).run('assignment-a','event-a',now,now);
  database.prepare(`INSERT INTO team_assignments(id,event_id,user_id,responsibility,status,created_at,updated_at) VALUES(?,?,'sub-b','Stage lead','active',?,?)`).run('assignment-b','event-b',now,now);
  database.prepare(`INSERT INTO team_assignments(id,event_id,user_id,responsibility,status,created_at,updated_at) VALUES(?,?,'participant','Participant role','active',?,?)`).run('assignment-participant','event-a',now,now);
  database.prepare(`INSERT INTO responder_profiles(user_id,skills,zones,availability,phone,preferred_contact_method,updated_at) VALUES('sub-a','transport','Gate 2','available','+1 555 222 3333','sms',?)`).run(now);
  database.prepare(`INSERT INTO responder_capabilities(id,event_id,user_id,category,name,proficiency,experience_years,description,verified_by,verified_at,created_at,updated_at) VALUES('cap-a','event-a','sub-a','transport_logistics','Transport coordination','advanced',4,'Shuttle dispatch','org',? ,?,?)`).run(now,now,now);
  return { database, now };
}

test('capability validation rejects unsupported categories, levels, and malformed details', () => {
  assert.equal(validateCapability({ category: 'unknown', name: 'Ops', proficiency: 'expert' }).error, 'Choose a valid capability category.');
  assert.ok(validateCapability({ category: 'transport_logistics', name: 'Ops', proficiency: 'master' }).error);
  assert.ok(validateCapability({ category: 'transport_logistics', name: 'Ops', proficiency: 'expert', experienceYears: 81 }).error);
  assert.equal(validateCapability({ category: 'transport_logistics', name: 'Transport coordination', proficiency: 'advanced', experienceYears: 4, verified: true }).value.verified, true);
});

test('team profiles and performance metrics are limited to assigned event records', () => {
  const { database, now } = fixture();
  try {
    database.prepare(`INSERT INTO incidents(id,reference_number,event_id,reporter_id,category,title,description,urgency,status,assigned_responder_id,created_at,updated_at) VALUES('inc-a','INC-A','event-a','org','transport','Bus dispatch','Details','medium','in_progress','sub-a',?,?)`).run(now,now);
    database.prepare(`INSERT INTO incident_assignments(id,incident_id,responder_id,assigned_by,reason,status,assigned_at) VALUES('hist-a','inc-a','sub-a','org','Dispatch','assigned',?)`).run(now);
    database.prepare(`INSERT INTO incident_activities(id,incident_id,actor_id,action,details,created_at) VALUES('act-a','inc-a','sub-a','acknowledged','Responded',?)`).run(now);
    database.prepare(`INSERT INTO tasks(id,event_id,title,description,priority,status,due_at,owner_id,created_at,updated_at) VALUES('task-a','event-a','Route plan','','high','completed','2026-10-12','sub-a',?,?)`).run(now,now);
    database.prepare(`INSERT INTO tasks(id,event_id,title,description,priority,status,due_at,owner_id,created_at,updated_at) VALUES('task-a2','event-a','Gate setup','','medium','in-progress','2026-10-12','sub-a',?,?)`).run(now,now);
    const eventA = listTeamMembers(database, 'event-a', now);
    const eventB = listTeamMembers(database, 'event-b', now);
    assert.equal(eventA.length, 1);
    assert.equal(eventA[0].phone, '+1 555 222 3333');
    assert.equal(eventA[0].preferred_contact_method, 'sms');
    assert.equal(eventA[0].capabilities[0].verified, true);
    assert.equal(eventA[0].performance.incidentsAssigned, 1);
    assert.equal(eventA[0].performance.openIncidents, 1);
    assert.equal(eventA[0].performance.tasksCompleted, 1);
    assert.equal(eventA[0].performance.tasksActive, 1);
    assert.equal(eventA[0].performance.tasksOverdue, 1);
    assert.equal(eventA[0].performance.activeIncidents.length, 1);
    assert.equal(eventB.length, 1);
    assert.equal(eventB[0].id, 'sub-b');
    assert.equal(eventB[0].performance.incidentsAssigned, 0);
  } finally { database.close(); }
});

test('responder suggestions rank verified capability, zone, availability and real event workload with explanations', () => {
  const ranked = suggestResponders([
    { id: 'a', name: 'A', availability: 'available', zones: ['Gate 2'], activeIncidents: 1, capabilities: [{ name: 'Transport coordination', category: 'transport_logistics', proficiency: 'advanced', verified: true }] },
    { id: 'b', name: 'B', availability: 'available', zones: ['all'], activeIncidents: 0, capabilities: [], legacySkills: [] },
  ], 'transport', 'Gate 2');
  assert.equal(ranked[0].id, 'a');
  assert.match(ranked[0].reason, /Verified Transport coordination capability/);
  assert.match(ranked[0].reason, /Assigned to Gate 2/);
  assert.match(ranked[0].reason, /1 active incident/);
  assert.notEqual(ranked[0].reason, '');
});

test('resolution time is derived from persisted responder resolution actions and requires at least three valid samples', () => {
  const { database, now } = fixture();
  try {
    const end = Date.parse(now);
    for (const minutes of [60, 120, 180]) {
      const resolvedAt = new Date(end - 60_000).toISOString();
      const createdAt = new Date(end - (minutes + 1) * 60_000).toISOString();
      const incidentId = `resolved-${minutes}`;
      database.prepare(`INSERT INTO incidents(id,reference_number,event_id,reporter_id,category,title,description,urgency,status,assigned_responder_id,created_at,updated_at) VALUES(?,?,'event-a','org','transport','Resolved incident','Details','medium','resolved','sub-a',?,?)`).run(incidentId, `INC-${minutes}`, createdAt, resolvedAt);
      database.prepare(`INSERT INTO incident_activities(id,incident_id,actor_id,action,details,created_at) VALUES(?,?,?,'status_resolved','Completed response',?)`).run(`activity-${minutes}`, incidentId, 'sub-a', resolvedAt);
    }
    const member = listTeamMembers(database, 'event-a', now)[0];
    assert.equal(member.performance.incidentsResolved, 3);
    assert.equal(member.performance.resolutionSampleSize, 3);
    assert.equal(member.performance.medianResolutionMinutes, 120);
  } finally { database.close(); }
});

test('capability profiles create, edit, verify, audit, and delete transactionally; cross-event access is denied', () => {
  const { database, now } = fixture();
  try {
    assert.equal(canReadEventTeam(database, 'event-a', 'sub-a', 'sub_organizer'), true);
    assert.equal(canReadEventTeam(database, 'event-b', 'sub-a', 'sub_organizer'), false);
    assert.equal(canReadEventTeam(database, 'event-a', 'sub-b', 'sub_organizer'), false);
    assert.equal(canReadEventTeam(database, 'event-a', 'sub-a', 'participant'), false);
    assert.equal(canManageMemberCapabilities(database, 'event-a', 'org', 'sub-a'), true);
    assert.equal(canManageMemberCapabilities(database, 'event-b', 'org', 'sub-a'), false);
    assert.equal(canManageMemberCapabilities(database, 'event-a', 'sub-a', 'sub-a'), false);
    assert.equal(canAssignSubOrganizerToEvent(database, 'event-a', 'sub-a'), true);
    assert.equal(canAssignSubOrganizerToEvent(database, 'event-a', 'sub-b'), false);
    assert.equal(canAssignSubOrganizerToEvent(database, 'event-b', 'sub-b'), true);
    database.prepare("UPDATE team_assignments SET status='inactive' WHERE id='assignment-a'").run();
    assert.equal(canReadEventTeam(database, 'event-a', 'sub-a', 'sub_organizer'), false);
    assert.equal(canAssignSubOrganizerToEvent(database, 'event-a', 'sub-a'), false);

    const created = saveMemberCapabilities(database, 'event-a', 'sub-a', 'org', [{
      category: 'transport_logistics', name: 'Route coordination', proficiency: 'intermediate',
      experienceYears: 2, description: 'Venue transport routing', verified: false,
    }], now);
    assert.equal(created.length, 1);
    const verified = saveMemberCapabilities(database, 'event-a', 'sub-a', 'org', [{
      id: created[0].id, category: created[0].category, name: 'Route coordination', proficiency: 'advanced',
      experienceYears: 3, description: 'Verified routes', verified: true,
    }], '2026-10-14T10:00:00.000Z');
    assert.equal(verified[0].verified, true);
    assert.equal(verified[0].proficiency, 'advanced');
    const actions = database.prepare('SELECT action FROM responder_capability_audit WHERE capability_id=? ORDER BY created_at,id').all(created[0].id).map(row => row.action);
    assert.deepEqual(actions, ['created', 'verified']);
    saveMemberCapabilities(database, 'event-a', 'sub-a', 'org', [], '2026-10-15T10:00:00.000Z');
    assert.equal(database.prepare('SELECT COUNT(*) AS count FROM responder_capabilities WHERE event_id=? AND user_id=?').get('event-a', 'sub-a').count, 0);
    assert.equal(database.prepare("SELECT action FROM responder_capability_audit WHERE action='deleted'").get().action, 'deleted');
  } finally { database.close(); }
});

test('sub-organizer resource access requires active same-event membership and direct assignment where applicable', () => {
  const { database, now } = fixture();
  try {
    database.prepare(`INSERT INTO tasks(id,event_id,title,description,priority,status,due_at,owner_id,created_at,updated_at)
      VALUES('task-a','event-a','Task','','high','pending','', 'sub-a',?,?)`).run(now, now);
    database.prepare(`INSERT INTO tasks(id,event_id,title,description,priority,status,due_at,owner_id,created_at,updated_at)
      VALUES('task-b','event-b','Other event','','high','pending','', 'sub-b',?,?)`).run(now, now);
    database.prepare(`INSERT INTO incidents(id,reference_number,event_id,reporter_id,category,title,description,urgency,status,assigned_responder_id,created_at,updated_at)
      VALUES('incident-a','INC-A','event-a','participant','other','Help','','medium','assigned','sub-a',?,?)`).run(now, now);
    database.prepare(`INSERT INTO support_tickets(id,event_id,participant_id,title,description,category,status,priority,reference_number,created_at,updated_at)
      VALUES('ticket-a','event-a','participant','Help','','other','open','normal','SUP-A',?,?)`).run(now, now);

    assert.equal(canAccessSubOrganizerTask(database, 'task-a', 'sub-a'), true);
    assert.equal(canAccessSubOrganizerTask(database, 'task-a', 'sub-b'), false);
    assert.equal(canAccessSubOrganizerTask(database, 'task-b', 'sub-a'), false);
    assert.equal(canAccessSubOrganizerTask(database, 'task-a', 'participant'), false);
    assert.equal(canAccessSubOrganizerIncident(database, 'incident-a', 'sub-a'), true);
    assert.equal(canAccessSubOrganizerIncident(database, 'incident-a', 'sub-b'), false);
    assert.equal(canAccessSubOrganizerSupportTicket(database, 'ticket-a', 'sub-a'), true);
    assert.equal(canAccessSubOrganizerSupportTicket(database, 'ticket-a', 'sub-b'), false);
    assert.equal(canAccessSubOrganizerSupportTicket(database, 'ticket-a', 'participant'), false);

    database.prepare("UPDATE team_assignments SET status='inactive' WHERE id='assignment-a'").run();
    assert.equal(canAccessSubOrganizerTask(database, 'task-a', 'sub-a'), false);
    assert.equal(canAccessSubOrganizerIncident(database, 'incident-a', 'sub-a'), false);
    assert.equal(canAccessSubOrganizerSupportTicket(database, 'ticket-a', 'sub-a'), false);
    database.prepare("UPDATE team_assignments SET status='active' WHERE id='assignment-a'").run();
    database.prepare("UPDATE users SET status='inactive' WHERE id='sub-a'").run();
    assert.equal(canAccessSubOrganizerTask(database, 'task-a', 'sub-a'), false);
    assert.equal(canAccessSubOrganizerIncident(database, 'incident-a', 'sub-a'), false);
    assert.equal(canAccessSubOrganizerSupportTicket(database, 'ticket-a', 'sub-a'), false);
  } finally { database.close(); }
});

test('incident escalation activity request keys are idempotent and migration-safe', () => {
  const { database, now } = fixture();
  try {
    database.prepare(`INSERT INTO incidents(id,reference_number,event_id,reporter_id,category,title,description,urgency,status,assigned_responder_id,created_at,updated_at)
      VALUES('incident-idempotent','INC-IDEM','event-a','participant','other','Help','','medium','assigned','sub-a',?,?)`).run(now, now);
    const insert = database.prepare(`INSERT INTO incident_activities(id,incident_id,actor_id,action,details,request_key,created_at)
      VALUES(?,?,?,?,?,?,?) ON CONFLICT(incident_id,actor_id,request_key) WHERE request_key IS NOT NULL DO NOTHING`);
    assert.equal(insert.run('activity-first', 'incident-idempotent', 'sub-a', 'escalated', 'Needs organizer review', 'request-escalate-01', now).changes, 1);
    assert.equal(insert.run('activity-retry', 'incident-idempotent', 'sub-a', 'escalated', 'Retry of same request', 'request-escalate-01', now).changes, 0);
    assert.equal(database.prepare('SELECT COUNT(*) AS count FROM incident_activities WHERE incident_id=?').get('incident-idempotent').count, 1);
    assert.ok(database.prepare('PRAGMA table_info(incident_activities)').all().some(column => column.name === 'request_key'));
    initDbSchema(database);
    assert.equal(insert.run('activity-after-init', 'incident-idempotent', 'sub-a', 'escalated', 'Retry after schema initialization', 'request-escalate-01', now).changes, 0);
    assert.equal(database.prepare('SELECT COUNT(*) AS count FROM incident_activities WHERE incident_id=?').get('incident-idempotent').count, 1);
  } finally { database.close(); }
});

test('SQLite startup migrates legacy responder profiles idempotently, preserves records, and supports optional contacts', () => {
  const database = new DatabaseSync(':memory:');
  try {
    database.exec(`CREATE TABLE users(id TEXT PRIMARY KEY,name TEXT,email TEXT,password_hash TEXT,role TEXT,status TEXT,created_at TEXT,updated_at TEXT);
      INSERT INTO users VALUES('legacy-sub','Legacy','legacy@test.invalid','hash','sub_organizer','active','t','t');
      CREATE TABLE responder_profiles(user_id TEXT PRIMARY KEY,skills TEXT NOT NULL DEFAULT 'operations',zones TEXT NOT NULL DEFAULT 'all',availability TEXT NOT NULL DEFAULT 'available',updated_at TEXT NOT NULL);
      INSERT INTO responder_profiles VALUES('legacy-sub','first aid','Hall','busy','t');`);
    initDbSchema(database);
    migrateResponderProfileContactColumns(database);
    initDbSchema(database);
    const profile = database.prepare('SELECT skills,zones,availability,phone,preferred_contact_method FROM responder_profiles WHERE user_id=?').get('legacy-sub');
    assert.equal(profile.skills, 'first aid');
    assert.equal(profile.zones, 'Hall');
    assert.equal(profile.availability, 'busy');
    assert.equal(profile.phone, null);
    assert.equal(profile.preferred_contact_method, null);
    assert.equal(database.prepare('SELECT COUNT(*) AS count FROM responder_profiles').get().count, 1);

    const now = '2026-10-13T10:00:00.000Z';
    database.prepare(`INSERT INTO users VALUES('org','Organizer','org@test.invalid','hash','organizer','active',?,?)`).run(now, now);
    database.prepare(`INSERT INTO events(id,organizer_id,name,event_type,format,start_at,end_at,timezone,created_at,updated_at) VALUES('event-legacy','org','Legacy Event','conference','in-person',?,?, 'UTC',?,?)`).run(now, now, now, now);
    database.prepare(`INSERT INTO team_assignments(id,event_id,user_id,responsibility,status,created_at,updated_at) VALUES('legacy-assignment','event-legacy','legacy-sub','Operations','active',?,?)`).run(now, now);
    const members = listTeamMembers(database, 'event-legacy', now);
    assert.equal(members.length, 1);
    assert.equal(members[0].phone, null);
    assert.equal(members[0].preferred_contact_method, null);

    upsertResponderProfile(database, 'legacy-sub', 'first aid', 'Hall', 'busy', '+1 555 222 3333', 'phone', now);
    const withPhone = database.prepare('SELECT phone,preferred_contact_method FROM responder_profiles WHERE user_id=?').get('legacy-sub');
    assert.equal(withPhone.phone, '+1 555 222 3333');
    assert.equal(withPhone.preferred_contact_method, 'phone');

    database.prepare(`INSERT INTO users VALUES('new-sub','New Member','new@test.invalid','hash','sub_organizer','active',?,?)`).run(now, now);
    upsertResponderProfile(database, 'new-sub', 'operations', 'all', 'available', null, null, now);
    const withoutContact = database.prepare('SELECT phone,preferred_contact_method FROM responder_profiles WHERE user_id=?').get('new-sub');
    assert.equal(withoutContact.phone, null);
    assert.equal(withoutContact.preferred_contact_method, null);
    assert.ok(database.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='responder_capabilities'").get());
  } finally { database.close(); }
});
