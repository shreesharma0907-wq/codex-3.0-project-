import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { join } from 'node:path';
import { unlinkSync } from 'node:fs';
import { initDbSchema } from '../src/lib/server/db.ts';

test('upgrades a legacy events table and persists eligibility and invitation settings', () => {
  const testDbPath = join(process.cwd(), '.data', 'test-legacy-event-schema.sqlite');
  try { unlinkSync(testDbPath); } catch { /* No prior test file. */ }
  const database = new DatabaseSync(testDbPath);

  try {
    database.exec(`
      PRAGMA foreign_keys = ON;
      CREATE TABLE users (
        id TEXT PRIMARY KEY, name TEXT NOT NULL, email TEXT NOT NULL UNIQUE,
        password_hash TEXT NOT NULL, role TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'active',
        created_at TEXT NOT NULL, updated_at TEXT NOT NULL
      );
      CREATE TABLE events (
        id TEXT PRIMARY KEY, organizer_id TEXT NOT NULL REFERENCES users(id),
        name TEXT NOT NULL, description TEXT NOT NULL DEFAULT '', event_type TEXT NOT NULL,
        format TEXT NOT NULL, start_at TEXT NOT NULL, end_at TEXT NOT NULL,
        timezone TEXT NOT NULL, venue TEXT, meeting_url TEXT, joining_instructions TEXT,
        audience TEXT NOT NULL DEFAULT '', expected_attendance INTEGER NOT NULL DEFAULT 0,
        registration_target INTEGER NOT NULL DEFAULT 0, capacity INTEGER,
        lifecycle TEXT NOT NULL DEFAULT 'upcoming', created_at TEXT NOT NULL, updated_at TEXT NOT NULL
      );
      INSERT INTO users(id,name,email,password_hash,role,created_at,updated_at)
        VALUES('legacy-org','Legacy Organizer','legacy@example.test','hash','organizer','2026-01-01','2026-01-01');
      INSERT INTO events(id,organizer_id,name,event_type,format,start_at,end_at,timezone,created_at,updated_at)
        VALUES('legacy-event','legacy-org','Existing Event','workshop','in-person','2027-01-01T10:00:00','2027-01-01T12:00:00','UTC','2026-01-01','2026-01-01');
    `);

    // The app bootstrap must upgrade existing tables, not just create new ones.
    initDbSchema(database);

    const columns = new Set(database.prepare('PRAGMA table_info(events)').all().map(column => column.name));
    for (const column of ['eligibility_requirements', 'joining_enabled', 'invitation_access_mode', 'require_approval']) {
      assert.ok(columns.has(column), `expected migrated events.${column}`);
    }

    const createdAt = new Date().toISOString();
    database.prepare(`
      INSERT INTO events(
        id,organizer_id,name,description,event_type,format,start_at,end_at,timezone,venue,
        meeting_url,joining_instructions,audience,expected_attendance,registration_target,
        capacity,lifecycle,joining_enabled,invitation_access_mode,require_approval,
        eligibility_requirements,registration_deadline,created_at,updated_at
      ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
    `).run(
      'new-event','legacy-org','New Event','Description','conference','in-person',
      '2027-02-01T09:00:00','2027-02-01T17:00:00','UTC','Main Hall',null,null,
      'Students',50,40,60,'upcoming',1,'code',1,'Current students only','2027-01-30',createdAt,createdAt
    );

    const existingEvent = database.prepare('SELECT name FROM events WHERE id=?').get('legacy-event');
    const newEvent = database.prepare('SELECT eligibility_requirements, joining_enabled, invitation_access_mode, require_approval FROM events WHERE id=?').get('new-event');
    assert.equal(existingEvent.name, 'Existing Event');
    assert.equal(newEvent.eligibility_requirements, 'Current students only');
    assert.equal(newEvent.joining_enabled, 1);
    assert.equal(newEvent.invitation_access_mode, 'code');
    assert.equal(newEvent.require_approval, 1);
  } finally {
    database.close();
    try { unlinkSync(testDbPath); } catch { /* Cleanup the isolated test database. */ }
  }
});
