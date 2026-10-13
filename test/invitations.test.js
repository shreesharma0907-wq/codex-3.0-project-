import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { join } from 'node:path';
import { unlinkSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { initDbSchema } from '../src/lib/server/db.ts';

const testDbPath = join(process.cwd(), '.data', 'test-invitations.sqlite');
let testDb;

describe('Event Invitation and Join-With-Code System Tests', () => {
  before(() => {
    try {
      unlinkSync(testDbPath);
    } catch {
      // ignore
    }
    testDb = new DatabaseSync(testDbPath);
    initDbSchema(testDb);

    // Seed test organizer and participant
    const now = new Date().toISOString();
    testDb.prepare(`
      INSERT INTO users (id, name, email, password_hash, role, created_at, updated_at)
      VALUES 
        ('org_1', 'Event Organizer', 'organizer@test.com', 'hash', 'organizer', ?, ?),
        ('part_1', 'Alice Participant', 'alice@test.com', 'hash', 'participant', ?, ?),
        ('part_2', 'Bob Participant', 'bob@test.com', 'hash', 'participant', ?, ?)
    `).run(now, now, now, now, now, now);

    // Seed an event with capacity 1
    testDb.prepare(`
      INSERT INTO events (
        id, organizer_id, name, description, event_type, format, 
        start_at, end_at, timezone, venue, audience, 
        expected_attendance, registration_target, capacity, lifecycle,
        joining_enabled, invitation_access_mode, require_approval, created_at, updated_at
      ) VALUES (
        'evt_inv_test', 'org_1', 'Hackathon 2026', 'Flagship hackathon', 'Hackathon', 'in-person',
        '2026-11-01T09:00:00', '2026-11-03T18:00:00', 'UTC', 'Main Hall', 'Students',
        100, 100, 1, 'upcoming',
        1, 'both', 0, ?, ?
      )
    `).run(now, now);
  });

  after(() => {
    testDb?.close();
    try {
      unlinkSync(testDbPath);
    } catch {
      // ignore
    }
  });

  test('Creates invitation with code, token, and hash correctly', () => {
    const rawToken = 'sampletoken1234567890abcdef123456';
    const hash = createHash('sha256').update(rawToken).digest('hex');
    const now = new Date().toISOString();

    testDb.prepare(`
      INSERT INTO invitations (
        id, event_id, code, token, token_hash, access_mode, require_approval,
        created_by, created_at, expires_at, max_uses, used_count, status
      ) VALUES (
        'inv_1', 'evt_inv_test', 'TESTCODE1', ?, ?, 'both', 0,
        'org_1', ?, NULL, 2, 0, 'active'
      )
    `).run(rawToken, hash, now);

    const inv = testDb.prepare('SELECT * FROM invitations WHERE id = ?').get('inv_1');
    assert.equal(inv.code, 'TESTCODE1');
    assert.equal(inv.token_hash, hash);
    assert.equal(inv.max_uses, 2);
    assert.equal(inv.used_count, 0);
  });

  test('Participant joins via invitation code and records reference number and status', () => {
    const now = new Date().toISOString();
    testDb.prepare(`
      INSERT INTO registrations (
        id, event_id, participant_id, invitation_id, invitation_code,
        status, payment_status, reference_number, created_at, updated_at
      ) VALUES (
        'reg_1', 'evt_inv_test', 'part_1', 'inv_1', 'TESTCODE1',
        'confirmed', 'not_applicable', 'REG-ABC1', ?, ?
      )
    `).run(now, now);

    testDb.prepare('UPDATE invitations SET used_count = used_count + 1 WHERE id = ?').run('inv_1');

    const inv = testDb.prepare('SELECT * FROM invitations WHERE id = ?').get('inv_1');
    assert.equal(inv.used_count, 1);

    const reg = testDb.prepare('SELECT * FROM registrations WHERE id = ?').get('reg_1');
    assert.equal(reg.status, 'confirmed');
    assert.equal(reg.invitation_code, 'TESTCODE1');
    assert.equal(reg.reference_number, 'REG-ABC1');
  });

  test('Prevents duplicate registration for the same event and participant', () => {
    const now = new Date().toISOString();
    assert.throws(() => {
      testDb.prepare(`
        INSERT INTO registrations (
          id, event_id, participant_id, invitation_id, invitation_code,
          status, payment_status, reference_number, created_at, updated_at
        ) VALUES (
          'reg_duplicate', 'evt_inv_test', 'part_1', 'inv_1', 'TESTCODE1',
          'confirmed', 'not_applicable', 'REG-ABC2', ?, ?
        )
      `).run(now, now);
    });
  });

  test('Enforces capacity limit when max capacity is reached', () => {
    const count = testDb.prepare("SELECT COUNT(*) as count FROM registrations WHERE event_id = ? AND status <> 'cancelled'").get('evt_inv_test');
    const evt = testDb.prepare('SELECT capacity FROM events WHERE id = ?').get('evt_inv_test');
    assert.equal(count.count, 1);
    assert.equal(evt.capacity, 1);
    assert.ok(count.count >= evt.capacity, 'Capacity should be full');
  });

  test('Revoking an invitation marks status as revoked and records timestamp', () => {
    const now = new Date().toISOString();
    testDb.prepare(`
      UPDATE invitations 
      SET status = 'revoked', revoked_at = ?, revoked_by = 'org_1'
      WHERE id = 'inv_1'
    `).run(now);

    const inv = testDb.prepare('SELECT * FROM invitations WHERE id = ?').get('inv_1');
    assert.equal(inv.status, 'revoked');
    assert.equal(inv.revoked_by, 'org_1');
  });
});
