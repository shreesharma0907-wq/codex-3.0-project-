import { createHash } from 'node:crypto';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { createSubOrganizerAccount, ExistingAccountError } from '../src/lib/server/account-repository.ts';
import { authenticateUser, createSession, hashPassword } from '../src/lib/server/auth-credentials.ts';
import { initDbSchema } from '../src/lib/server/db.ts';
import { canReadEventTeam } from '../src/lib/server/team-repository.ts';

function fixture() {
  const database = new DatabaseSync(':memory:');
  initDbSchema(database);
  const now = new Date().toISOString();
  const insertUser = database.prepare('INSERT INTO users(id,name,email,password_hash,role,status,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?)');
  return { database, now, insertUser };
}

function addEvent(database, now, id = 'event-auth') {
  database.prepare(`INSERT INTO events(id,organizer_id,name,event_type,format,start_at,end_at,timezone,created_at,updated_at)
    VALUES(?, 'organizer-auth', 'Auth Event', 'conference', 'in-person', ?, ?, 'UTC', ?, ?)`)
    .run(id, now, now, now, now);
}

const subOrganizerInput = {
  name: 'New Sub Organizer', email: '  New.SubOrganizer@GMAIL.COM  ', password: 'Strong-password-42',
  eventId: 'event-auth', responsibility: 'Transport coordination', skills: 'transport', zones: 'Gate 2',
  phone: null, preferredContactMethod: null,
};

test('organizer-created sub-organizer persists account and membership, authenticates, and gets a private session', async () => {
  const { database, now, insertUser } = fixture();
  try {
    insertUser.run('organizer-auth', 'Organizer', 'organizer@example.test', await hashPassword('organizer-password'), 'organizer', 'active', now, now);
    addEvent(database, now);

    const created = await createSubOrganizerAccount(database, subOrganizerInput);
    const stored = database.prepare('SELECT role,status,password_hash FROM users WHERE id=?').get(created.user.id);
    const membership = database.prepare('SELECT event_id,status,responsibility FROM team_assignments WHERE user_id=?').get(created.user.id);
    assert.deepEqual({ role: stored.role, status: stored.status }, { role: 'sub_organizer', status: 'active' });
    assert.equal(membership.event_id, 'event-auth');
    assert.equal(membership.status, 'active');
    assert.equal(membership.responsibility, subOrganizerInput.responsibility);
    assert.match(stored.password_hash, /^scrypt\$/);
    assert.equal(created.user.email, 'new.suborganizer@gmail.com');
    assert.equal(JSON.stringify(created).includes('password_hash'), false);
    assert.equal(canReadEventTeam(database, 'event-auth', created.user.id, created.user.role), true);
    assert.equal(canReadEventTeam(database, 'other-event', created.user.id, created.user.role), false);

    assert.equal(await authenticateUser(database, ' NEW.SUBORGANIZER@gmail.com ', subOrganizerInput.password).then(user => user?.role), 'sub_organizer');
    assert.equal(await authenticateUser(database, subOrganizerInput.email, 'incorrect-password'), null);
    const session = await createSession(created.user.id, database);
    const sessionDigest = createHash('sha256').update(session.token).digest('hex');
    assert.equal(database.prepare('SELECT user_id FROM auth_sessions WHERE id=?').get(sessionDigest).user_id, created.user.id);
    assert.equal(database.prepare('SELECT 1 FROM auth_sessions WHERE id=?').get(session.token), undefined);
    assert.equal(session.token.length > 30, true);
  } finally { database.close(); }
});

test('legacy organizer-created SHA-256 credentials upgrade to scrypt only after a correct login', async () => {
  const { database, now, insertUser } = fixture();
  const password = 'legacy-suborganizer-password';
  const legacyDigest = createHash('sha256').update(password).digest('hex');
  try {
    insertUser.run('organizer-auth', 'Organizer', 'organizer@example.test', await hashPassword('organizer-password'), 'organizer', 'active', now, now);
    insertUser.run('legacy-sub', 'Legacy Sub', 'legacy-sub@example.test', legacyDigest, 'sub_organizer', 'active', now, now);
    addEvent(database, now);
    database.prepare("INSERT INTO team_assignments(id,event_id,user_id,responsibility,status,created_at,updated_at) VALUES('legacy-assignment','event-auth','legacy-sub','Operations','active',?,?)").run(now, now);

    assert.equal(await authenticateUser(database, 'legacy-sub@example.test', 'wrong-password'), null);
    assert.equal(database.prepare('SELECT password_hash FROM users WHERE id=?').get('legacy-sub').password_hash, legacyDigest);

    const user = await authenticateUser(database, 'legacy-sub@example.test', password);
    assert.equal(user.role, 'sub_organizer');
    const upgradedHash = database.prepare('SELECT password_hash FROM users WHERE id=?').get('legacy-sub').password_hash;
    assert.match(upgradedHash, /^scrypt\$/);
    assert.notEqual(upgradedHash, legacyDigest);
    assert.equal(await authenticateUser(database, 'legacy-sub@example.test', password).then(result => result?.id), 'legacy-sub');
  } finally { database.close(); }
});

test('duplicate emails are rejected case-insensitively without resetting existing credentials', async () => {
  const { database, now, insertUser } = fixture();
  try {
    insertUser.run('organizer-auth', 'Organizer', 'organizer@example.test', await hashPassword('organizer-password'), 'organizer', 'active', now, now);
    addEvent(database, now);
    const originalHash = await hashPassword('existing-password');
    insertUser.run('existing-sub', 'Existing Sub', 'new.suborganizer@gmail.com', originalHash, 'sub_organizer', 'active', now, now);
    await assert.rejects(createSubOrganizerAccount(database, subOrganizerInput), ExistingAccountError);
    assert.equal(database.prepare('SELECT COUNT(*) AS count FROM users WHERE email=?').get('new.suborganizer@gmail.com').count, 1);
    assert.equal(database.prepare('SELECT password_hash FROM users WHERE id=?').get('existing-sub').password_hash, originalHash);
  } finally { database.close(); }
});

test('membership failure rolls back the new account and responder profile', async () => {
  const { database, now, insertUser } = fixture();
  try {
    insertUser.run('organizer-auth', 'Organizer', 'organizer@example.test', await hashPassword('organizer-password'), 'organizer', 'active', now, now);
    addEvent(database, now);
    database.exec(`CREATE TRIGGER reject_team_assignment BEFORE INSERT ON team_assignments
      BEGIN SELECT RAISE(ABORT, 'assignment rejected'); END;`);
    await assert.rejects(createSubOrganizerAccount(database, subOrganizerInput));
    assert.equal(database.prepare('SELECT COUNT(*) AS count FROM users WHERE email=?').get('new.suborganizer@gmail.com').count, 0);
    assert.equal(database.prepare('SELECT COUNT(*) AS count FROM responder_profiles').get().count, 0);
  } finally { database.close(); }
});

test('organizer and participant credentials still authenticate; inactive users do not', async () => {
  const { database, now, insertUser } = fixture();
  try {
    insertUser.run('organizer-auth', 'Organizer', 'organizer@example.test', await hashPassword('organizer-password'), 'organizer', 'active', now, now);
    insertUser.run('participant-auth', 'Participant', 'participant@example.test', await hashPassword('participant-password'), 'participant', 'active', now, now);
    insertUser.run('inactive-auth', 'Inactive', 'inactive@example.test', await hashPassword('inactive-password'), 'sub_organizer', 'inactive', now, now);
    assert.equal((await authenticateUser(database, 'ORGANIZER@example.test', 'organizer-password')).role, 'organizer');
    assert.equal((await authenticateUser(database, 'participant@example.test', 'participant-password')).role, 'participant');
    assert.equal(await authenticateUser(database, 'inactive@example.test', 'inactive-password'), null);
    assert.equal(JSON.stringify(await authenticateUser(database, 'organizer@example.test', 'organizer-password')).includes('password_hash'), false);
  } finally { database.close(); }
});
