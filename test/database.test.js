import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { join } from 'node:path';
import { unlinkSync } from 'node:fs';
import { initDbSchema } from '../src/lib/server/db.ts';

const testDbPath = join(process.cwd(), '.data', 'test-runshow.sqlite');
let testDb;

describe('Database and Schema Integrity Tests', () => {
  before(() => {
    try {
      unlinkSync(testDbPath);
    } catch {
      // ignore
    }
    testDb = new DatabaseSync(testDbPath);
    initDbSchema(testDb);
  });

  after(() => {
    testDb?.close();
    try {
      unlinkSync(testDbPath);
    } catch {
      // ignore
    }
  });

  test('Creates all required tables successfully', () => {
    const tables = testDb
      .prepare("SELECT name FROM sqlite_master WHERE type='table'")
      .all()
      .map(r => r.name);

    assert.ok(tables.includes('users'));
    assert.ok(tables.includes('events'));
    assert.ok(tables.includes('tasks'));
    assert.ok(tables.includes('risks'));
    assert.ok(tables.includes('partners'));
    assert.ok(tables.includes('registrations'));
    assert.ok(tables.includes('incidents'));
    assert.ok(tables.includes('incident_messages'));
    assert.ok(tables.includes('incident_activities'));
    assert.ok(tables.includes('incident_assignments'));
    assert.ok(tables.includes('in_app_notifications'));
    assert.ok(tables.includes('responder_profiles'));
    assert.ok(tables.includes('event_metric_snapshots'));
    assert.ok(tables.includes('event_intelligence_analyses'));
    assert.ok(tables.includes('event_intelligence_recommendations'));
    assert.ok(tables.includes('event_recommendation_history'));
  });

  test('Creates persistent snapshot and recommendation history schema idempotently', () => {
    const now = new Date().toISOString();
    testDb.prepare("INSERT INTO users(id,name,email,password_hash,role,status,created_at,updated_at) VALUES('intel_org','Organizer','intel@test.com','hash','organizer','active',?,?)").run(now,now);
    testDb.prepare("INSERT INTO events(id,organizer_id,name,event_type,format,start_at,end_at,timezone,created_at,updated_at) VALUES('intel_event','intel_org','Intelligence event','workshop','virtual',?,?, 'UTC',?,?)").run(now,now,now,now);
    testDb.prepare("INSERT INTO event_metric_snapshots(id,event_id,snapshot_day,taken_at,metrics_json) VALUES('snap1','intel_event','2026-10-13',?,'{}')").run(now);
    testDb.prepare("INSERT INTO event_intelligence_recommendations(id,event_id,category,priority,evidence_json,explanation,action,expected_outcome,source,status,created_at) VALUES('rec1','intel_event','operations','high','[]','reason','action','outcome','test','open',?)").run(now);
    testDb.prepare("INSERT INTO event_recommendation_history(id,recommendation_id,user_id,from_status,to_status,created_at) VALUES('hist1','rec1','intel_org','open','accepted',?)").run(now);
    initDbSchema(testDb);
    assert.equal(testDb.prepare("SELECT COUNT(*) count FROM event_metric_snapshots WHERE event_id='intel_event'").get().count,1);
    assert.equal(testDb.prepare("SELECT to_status FROM event_recommendation_history WHERE id='hist1'").get().to_status,'accepted');
  });

  test('Enforces foreign key relationships and cascade deletes', () => {
    const now = new Date().toISOString();
    testDb
      .prepare(
        "INSERT INTO users (id, name, email, password_hash, role, status, created_at, updated_at) VALUES ('u1', 'Org', 'org@test.com', 'hash', 'organizer', 'active', ?, ?)"
      )
      .run(now, now);

    testDb
      .prepare(
        "INSERT INTO events (id, organizer_id, name, event_type, format, start_at, end_at, timezone, created_at, updated_at) VALUES ('e1', 'u1', 'Test Event', 'hackathon', 'in-person', ?, ?, 'UTC', ?, ?)"
      )
      .run(now, now, now, now);

    testDb
      .prepare(
        "INSERT INTO incidents (id, reference_number, event_id, reporter_id, category, title, description, urgency, created_at, updated_at) VALUES ('inc1', 'INC-TEST', 'e1', 'u1', 'transport', 'Bus late', 'Bus late at gate', 'critical', ?, ?)"
      )
      .run(now, now);

    const inc = testDb.prepare("SELECT * FROM incidents WHERE id='inc1'").get();
    assert.equal(inc.title, 'Bus late');

    // Deleting event should cascade delete incident
    testDb.prepare("DELETE FROM events WHERE id='e1'").run();
    const checkInc = testDb.prepare("SELECT * FROM incidents WHERE id='inc1'").get();
    assert.equal(checkInc, undefined);
  });
});
