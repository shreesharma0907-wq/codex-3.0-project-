import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { DatabaseSync } from 'node:sqlite';

test('import preflight is read-only, aggregates without exposing values, and refuses apply', () => {
  const temp = mkdtempSync(join(tmpdir(), 'runshow-import-preflight-'));
  const source = join(temp, 'legacy.sqlite');
  const database = new DatabaseSync(source);
  database.exec(`
    CREATE TABLE users (id TEXT PRIMARY KEY, name TEXT, email TEXT, role TEXT);
    CREATE TABLE events (id TEXT PRIMARY KEY, organizer_id TEXT);
    CREATE TABLE invitations (id TEXT PRIMARY KEY, code TEXT, token TEXT);
    CREATE TABLE registrations (id TEXT PRIMARY KEY, event_id TEXT, participant_id TEXT, status TEXT);
    CREATE TABLE tickets (id TEXT PRIMARY KEY, registration_id TEXT, ticket_number TEXT);
    INSERT INTO users VALUES ('u1', 'PRIVATE NAME', 'private@example.test', 'participant');
    INSERT INTO events VALUES ('e1', 'u1');
    INSERT INTO invitations VALUES ('i1', 'PRIVATE-CODE', 'PRIVATE-TOKEN');
    INSERT INTO registrations VALUES ('r1', 'e1', 'u1', 'registered');
    INSERT INTO tickets VALUES ('t1', 'r1', 'PRIVATE-TICKET');
  `);
  database.close();

  const digest = () => createHash('sha256').update(readFileSync(source)).digest('hex');
  const before = digest();
  const script = resolve(process.cwd(), 'scripts/supabase-import-preflight.mjs');
  const quarantinePath = join(temp, 'review-only.json');
  const first = spawnSync(process.execPath, [script], { encoding: 'utf8', env: { ...process.env, RUNSHOW_DB_PATH: source } });
  const second = spawnSync(process.execPath, [script, '--dry-run'], { encoding: 'utf8', env: { ...process.env, RUNSHOW_DB_PATH: source } });
  const withReport = spawnSync(process.execPath, [script, '--quarantine-report', quarantinePath], { encoding: 'utf8', env: { ...process.env, RUNSHOW_DB_PATH: source } });
  const refused = spawnSync(process.execPath, [script, '--apply'], { encoding: 'utf8', env: { ...process.env, RUNSHOW_DB_PATH: source } });
  try {
    assert.equal(first.status, 0, first.stderr);
    assert.equal(second.status, 0, second.stderr);
    assert.equal(withReport.status, 0, withReport.stderr);
    const report = JSON.parse(first.stdout);
    assert.equal(report.mode, 'dry-run-only');
    assert.equal(report.sqlite.tableCounts.users, 1);
    assert.equal(report.aggregateChecks.unresolvedReviews.legacyRegisteredStatusesRequiringHumanDisposition, 1);
    assert.equal(report.aggregateChecks.unresolvedReviews.existingUsersRequiringVerifiedAuthMapping, 1);
    assert.equal(report.execution.writesPerformed, false);
    assert.equal(first.stdout, second.stdout);
    const quarantine = JSON.parse(readFileSync(quarantinePath, 'utf8'));
    assert.equal(quarantine.format, 'runshow-quarantine-review-v1');
    assert.ok(quarantine.rows.some(row => row.reasonCode === 'AUTH_IDENTITY_UNVERIFIED'));
    assert.ok(quarantine.rows.some(row => row.reasonCode === 'LEGACY_STATUS_AMBIGUOUS'));
    assert.equal(statSync(quarantinePath).mode & 0o777, 0o600);
    assert.equal(JSON.parse(withReport.stdout).execution.quarantineReportWritten, true);
    assert.ok(!readFileSync(quarantinePath, 'utf8').includes('PRIVATE-TOKEN'));
    for (const privateValue of ['PRIVATE NAME', 'private@example.test', 'PRIVATE-CODE', 'PRIVATE-TOKEN', 'PRIVATE-TICKET']) {
      assert.ok(!first.stdout.includes(privateValue), `report leaked ${privateValue}`);
    }
    assert.equal(refused.status, 2);
    assert.match(refused.stderr, /not implemented or verified/);
    const overwrite = spawnSync(process.execPath, [script, '--quarantine-report', quarantinePath], { encoding: 'utf8', env: { ...process.env, RUNSHOW_DB_PATH: source } });
    assert.notEqual(overwrite.status, 0, 'existing quarantine report must never be overwritten');
    assert.equal(digest(), before, 'source SQLite bytes changed');
  } finally {
    rmSync(temp, { recursive: true, force: true });
  }
});
