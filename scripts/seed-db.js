const { DatabaseSync } = require('node:sqlite');
const { randomBytes, scryptSync } = require('node:crypto');
const { join, dirname } = require('node:path');
const { mkdirSync } = require('node:fs');

const databasePath = process.env.RUNSHOW_DB_PATH || join(process.cwd(), '.data', 'runshow.sqlite');
mkdirSync(dirname(databasePath), { recursive: true });
const db = new DatabaseSync(databasePath);
db.exec('PRAGMA foreign_keys = ON;');

db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    email TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    role TEXT NOT NULL CHECK (role IN ('organizer', 'sub_organizer', 'participant')),
    status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive')),
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS auth_sessions (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    expires_at TEXT NOT NULL,
    created_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS events (
    id TEXT PRIMARY KEY,
    organizer_id TEXT NOT NULL REFERENCES users(id),
    name TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    event_type TEXT NOT NULL,
    format TEXT NOT NULL CHECK (format IN ('in-person', 'virtual', 'hybrid')),
    start_at TEXT NOT NULL,
    end_at TEXT NOT NULL,
    timezone TEXT NOT NULL,
    venue TEXT,
    meeting_url TEXT,
    joining_instructions TEXT,
    audience TEXT NOT NULL DEFAULT '',
    expected_attendance INTEGER NOT NULL DEFAULT 0,
    registration_target INTEGER NOT NULL DEFAULT 0,
    capacity INTEGER,
    lifecycle TEXT NOT NULL DEFAULT 'upcoming',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS event_sessions (
    id TEXT PRIMARY KEY,
    event_id TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    start_at TEXT NOT NULL,
    end_at TEXT NOT NULL,
    venue TEXT,
    meeting_url TEXT
  );
  CREATE TABLE IF NOT EXISTS tasks (
    id TEXT PRIMARY KEY,
    event_id TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
    title TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    priority TEXT NOT NULL CHECK (priority IN ('urgent', 'high', 'medium', 'low')),
    status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'in-progress', 'completed', 'blocked')),
    due_at TEXT NOT NULL,
    owner_id TEXT REFERENCES users(id),
    department TEXT,
    related_risk_id TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS team_assignments (
    id TEXT PRIMARY KEY,
    event_id TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    responsibility TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive')),
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    UNIQUE(event_id, user_id, responsibility)
  );
  CREATE TABLE IF NOT EXISTS registrations (
    id TEXT PRIMARY KEY,
    event_id TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
    participant_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    status TEXT NOT NULL CHECK (status IN ('invited', 'registered', 'cancelled')),
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    UNIQUE(event_id, participant_id)
  );
  CREATE TABLE IF NOT EXISTS partners (
    id TEXT PRIMARY KEY,
    event_id TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    tier TEXT NOT NULL CHECK (tier IN ('Platinum', 'Gold', 'Silver', 'Bronze')),
    status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('confirmed', 'pending')),
    contact TEXT NOT NULL DEFAULT '',
    deadline TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS risks (
    id TEXT PRIMARY KEY,
    event_id TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
    title TEXT NOT NULL,
    description TEXT NOT NULL,
    severity TEXT NOT NULL CHECK (severity IN ('critical', 'high', 'medium', 'low')),
    status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'in-progress', 'mitigated', 'closed')),
    evidence TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS recommendations (
    id TEXT PRIMARY KEY,
    event_id TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
    action TEXT NOT NULL,
    reason TEXT NOT NULL,
    priority TEXT NOT NULL CHECK (priority IN ('urgent', 'high', 'medium', 'low')),
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS responder_profiles (
    user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    skills TEXT NOT NULL DEFAULT 'operations',
    zones TEXT NOT NULL DEFAULT 'all',
    availability TEXT NOT NULL DEFAULT 'available' CHECK (availability IN ('available', 'busy', 'offline')),
    updated_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS incidents (
    id TEXT PRIMARY KEY,
    reference_number TEXT NOT NULL UNIQUE,
    event_id TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
    reporter_id TEXT NOT NULL REFERENCES users(id),
    category TEXT NOT NULL,
    title TEXT NOT NULL,
    description TEXT NOT NULL,
    zone TEXT,
    affected_session_id TEXT REFERENCES event_sessions(id) ON DELETE SET NULL,
    urgency TEXT NOT NULL CHECK (urgency IN ('critical', 'high', 'medium', 'low')),
    contact_preference TEXT,
    priority_score INTEGER NOT NULL DEFAULT 50,
    priority_reason TEXT NOT NULL DEFAULT '',
    status TEXT NOT NULL DEFAULT 'new' CHECK (status IN ('new', 'acknowledged', 'assigned', 'in_progress', 'waiting_external', 'resolved', 'reopened', 'closed')),
    assigned_responder_id TEXT REFERENCES users(id),
    assigned_at TEXT,
    acknowledged_at TEXT,
    resolution_notes TEXT,
    resolved_at TEXT,
    closed_at TEXT,
    related_risk_id TEXT REFERENCES risks(id) ON DELETE SET NULL,
    related_task_id TEXT REFERENCES tasks(id) ON DELETE SET NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS incident_messages (
    id TEXT PRIMARY KEY,
    incident_id TEXT NOT NULL REFERENCES incidents(id) ON DELETE CASCADE,
    sender_id TEXT NOT NULL REFERENCES users(id),
    message TEXT NOT NULL,
    is_internal INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS incident_activities (
    id TEXT PRIMARY KEY,
    incident_id TEXT NOT NULL REFERENCES incidents(id) ON DELETE CASCADE,
    actor_id TEXT NOT NULL REFERENCES users(id),
    action TEXT NOT NULL,
    details TEXT NOT NULL,
    created_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS incident_assignments (
    id TEXT PRIMARY KEY,
    incident_id TEXT NOT NULL REFERENCES incidents(id) ON DELETE CASCADE,
    responder_id TEXT NOT NULL REFERENCES users(id),
    assigned_by TEXT NOT NULL REFERENCES users(id),
    reason TEXT NOT NULL DEFAULT '',
    status TEXT NOT NULL DEFAULT 'assigned' CHECK (status IN ('assigned', 'acknowledged', 'reassigned', 'released')),
    assigned_at TEXT NOT NULL,
    acknowledged_at TEXT
  );
  CREATE TABLE IF NOT EXISTS in_app_notifications (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    event_id TEXT REFERENCES events(id) ON DELETE CASCADE,
    incident_id TEXT REFERENCES incidents(id) ON DELETE CASCADE,
    task_id TEXT REFERENCES tasks(id) ON DELETE CASCADE,
    risk_id TEXT REFERENCES risks(id) ON DELETE CASCADE,
    type TEXT NOT NULL CHECK (type IN ('info', 'success', 'warning', 'error')),
    title TEXT NOT NULL,
    message TEXT NOT NULL,
    read INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS task_comments (
    id TEXT PRIMARY KEY,
    task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    content TEXT NOT NULL,
    created_at TEXT NOT NULL
  );
`);

function hashPassword(password) {
  const salt = randomBytes(16);
  const derived = scryptSync(password, salt, 64);
  return `scrypt$${salt.toString('hex')}$${derived.toString('hex')}`;
}

const now = new Date().toISOString();
const passwordHash = hashPassword('RunshowDemo2026!');

console.log('Seeding EventPilot AI / Runshow SQLite database directly...');

const tables = [
  'task_comments',
  'in_app_notifications',
  'incident_assignments',
  'incident_activities',
  'incident_messages',
  'incidents',
  'responder_profiles',
  'recommendations',
  'risks',
  'partners',
  'registrations',
  'team_assignments',
  'tasks',
  'event_sessions',
  'events',
  'auth_sessions',
  'users',
];

for (const table of tables) {
  try {
    db.exec(`DELETE FROM ${table};`);
  } catch (e) {
    // skip if missing
  }
}

// 1. Seed Users
const organizerId = 'usr-organizer-1';
db.prepare(`
  INSERT INTO users (id, name, email, password_hash, role, status, created_at, updated_at)
  VALUES (?, ?, ?, ?, 'organizer', 'active', ?, ?)
`).run(organizerId, 'Sarah Jenkins (Lead Organizer)', 'organizer@runshow.ai', passwordHash, now, now);

const subOrgTransportId = 'usr-suborg-transport';
db.prepare(`
  INSERT INTO users (id, name, email, password_hash, role, status, created_at, updated_at)
  VALUES (?, ?, ?, ?, 'sub_organizer', 'active', ?, ?)
`).run(subOrgTransportId, 'Marcus Chen (Transport & Logistics)', 'transport@runshow.ai', passwordHash, now, now);

const subOrgVenueId = 'usr-suborg-venue';
db.prepare(`
  INSERT INTO users (id, name, email, password_hash, role, status, created_at, updated_at)
  VALUES (?, ?, ?, ?, 'sub_organizer', 'active', ?, ?)
`).run(subOrgVenueId, 'Elena Rostova (Gate & Venue Ops)', 'venue@runshow.ai', passwordHash, now, now);

const participant1Id = 'usr-participant-1';
db.prepare(`
  INSERT INTO users (id, name, email, password_hash, role, status, created_at, updated_at)
  VALUES (?, ?, ?, ?, 'participant', 'active', ?, ?)
`).run(participant1Id, 'Alex Rivera (Hackathon Attendee)', 'alex@participant.com', passwordHash, now, now);

for (let i = 2; i <= 50; i++) {
  const pId = `usr-participant-${i}`;
  db.prepare(`
    INSERT INTO users (id, name, email, password_hash, role, status, created_at, updated_at)
    VALUES (?, ?, ?, ?, 'participant', 'active', ?, ?)
  `).run(pId, `Attendee ${i}`, `attendee${i}@eventpilot.test`, passwordHash, now, now);
}

// 2. Responder Profiles
db.prepare(`
  INSERT INTO responder_profiles (user_id, skills, zones, availability, updated_at)
  VALUES (?, ?, ?, 'available', ?)
`).run(subOrgTransportId, 'transport,operations,logistics', 'Gate 2,Zone B,Main Entrance', now);

db.prepare(`
  INSERT INTO responder_profiles (user_id, skills, zones, availability, updated_at)
  VALUES (?, ?, ?, 'available', ?)
`).run(subOrgVenueId, 'venue,registration,safety', 'Main Hall,Gate 1,Auditorium', now);

// 3. Main Demonstration Event
const eventId = 'event-techsprint-2026';
db.prepare(`
  INSERT INTO events (
    id, organizer_id, name, description, event_type, format,
    start_at, end_at, timezone, venue, meeting_url, audience,
    expected_attendance, registration_target, capacity, lifecycle,
    created_at, updated_at
  ) VALUES (
    ?, ?, 'TechSprint Global Hackathon 2026', 'Premier 48-hour innovation challenge bringing together developers, designers, and founders.',
    'hackathon', 'in-person', '2026-10-15T09:00:00', '2026-10-17T18:00:00', 'Asia/Kolkata',
    'Innovation Hub Convention Centre, Gate 2 Campus', NULL, 'Developers, Designers, and Tech Leaders',
    450, 500, 600, 'upcoming', ?, ?
  )
`).run(eventId, organizerId, now, now);

// 4. Event Sessions
const sessionId1 = 'ses-keynote';
db.prepare(`
  INSERT INTO event_sessions (id, event_id, name, description, start_at, end_at, venue)
  VALUES (?, ?, 'Opening Ceremony & Keynote Address', 'Main stage kickoff presentation and challenge statement release', '2026-10-15T09:30:00', '2026-10-15T11:00:00', 'Auditorium Hall A')
`).run(sessionId1, eventId);

const sessionId2 = 'ses-hacking';
db.prepare(`
  INSERT INTO event_sessions (id, event_id, name, description, start_at, end_at, venue)
  VALUES (?, ?, 'Sprint Round 1: Architecture & Prototyping', 'First intense sprint hacking block with mentor rotations', '2026-10-15T11:30:00', '2026-10-15T18:00:00', 'Hack Bay North & South')
`).run(sessionId2, eventId);

// 5. Team Assignments
db.prepare(`
  INSERT INTO team_assignments (id, event_id, user_id, responsibility, status, created_at, updated_at)
  VALUES (?, ?, ?, 'operations', 'active', ?, ?)
`).run('ta-transport', eventId, subOrgTransportId, now, now);

db.prepare(`
  INSERT INTO team_assignments (id, event_id, user_id, responsibility, status, created_at, updated_at)
  VALUES (?, ?, ?, 'programme', 'active', ?, ?)
`).run('ta-venue', eventId, subOrgVenueId, now, now);

// 6. Registrations (50 attendees -> 90% gap to 500 target)
for (let i = 1; i <= 50; i++) {
  db.prepare(`
    INSERT INTO registrations (id, event_id, participant_id, status, created_at, updated_at)
    VALUES (?, ?, ?, 'registered', ?, ?)
  `).run(`reg-${i}`, eventId, `usr-participant-${i}`, now, now);
}

// 7. Partners (3 confirmed, 2 pending -> 5 total)
db.prepare(`
  INSERT INTO partners (id, event_id, name, tier, status, contact, deadline, created_at, updated_at)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
`).run('part-1', eventId, 'CloudScale Global', 'Platinum', 'confirmed', 'Sarah Chen (Partner Lead)', '2026-10-13', now, now);

db.prepare(`
  INSERT INTO partners (id, event_id, name, tier, status, contact, deadline, created_at, updated_at)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
`).run('part-2', eventId, 'DevForge Systems', 'Gold', 'confirmed', 'David Miller', '2026-10-13', now, now);

db.prepare(`
  INSERT INTO partners (id, event_id, name, tier, status, contact, deadline, created_at, updated_at)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
`).run('part-3', eventId, 'NextAI Labs', 'Silver', 'confirmed', 'Aisha Khan', '2026-10-14', now, now);

db.prepare(`
  INSERT INTO partners (id, event_id, name, tier, status, contact, deadline, created_at, updated_at)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
`).run('part-4', eventId, 'VenturePulse Media', 'Bronze', 'pending', 'Rachel Green', '2026-10-14', now, now);

db.prepare(`
  INSERT INTO partners (id, event_id, name, tier, status, contact, deadline, created_at, updated_at)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
`).run('part-5', eventId, 'OmniTech Logistics', 'Bronze', 'pending', 'Tom Bradley', '2026-10-14', now, now);

// 8. Risks
const transportRiskId = 'risk-transport-contingency';
db.prepare(`
  INSERT INTO risks (id, event_id, title, description, severity, status, evidence, created_at, updated_at)
  VALUES (?, ?, 'Participant Transit & Shuttle Congestion at Gate 2', 'Peak morning shuttle arrival may experience bottlenecks at Gate 2 security checkpoint.', 'high', 'open', 'Historical delay data from previous regional hackathons', ?, ?)
`).run(transportRiskId, eventId, now, now);

const regRiskId = 'risk-registration-gap';
db.prepare(`
  INSERT INTO risks (id, event_id, title, description, severity, status, evidence, created_at, updated_at)
  VALUES (?, ?, 'Significant Target Registration Gap', 'Current confirmed count (50) is 90% below the 500 registration target with 3 days remaining.', 'critical', 'open', 'Registration pace tracking shows daily shortfall', ?, ?)
`).run(regRiskId, eventId, now, now);

const partnerRiskId = 'risk-partner-confirmations';
db.prepare(`
  INSERT INTO risks (id, event_id, title, description, severity, status, evidence, created_at, updated_at)
  VALUES (?, ?, 'Pending Partner Activation Agreements', '2 of 5 partners have not signed booth agreements 48 hours before setup.', 'medium', 'open', 'Outstanding contracts for VenturePulse and OmniTech', ?, ?)
`).run(partnerRiskId, eventId, now, now);

// 9. Operational Tasks
const taskTransportId = 'task-gate2-coordination';
db.prepare(`
  INSERT INTO tasks (id, event_id, title, description, priority, status, due_at, owner_id, department, related_risk_id, created_at, updated_at)
  VALUES (?, ?, 'Coordinate Gate 2 Shuttle Staging and Traffic Flow', 'Confirm express lane access with venue traffic security for all delegate buses.', 'urgent', 'pending', '2026-10-15', ?, 'operations', ?, ?, ?)
`).run(taskTransportId, eventId, subOrgTransportId, transportRiskId, now, now);

db.prepare(`
  INSERT INTO tasks (id, event_id, title, description, priority, status, due_at, owner_id, department, related_risk_id, created_at, updated_at)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
`).run('task-partner-followup', eventId, 'Follow up with unconfirmed partner deliverables', 'Contact VenturePulse and OmniTech representatives to finalize display banners.', 'high', 'pending', '2026-10-14', null, 'partnerships', partnerRiskId, now, now);

db.prepare(`
  INSERT INTO tasks (id, event_id, title, description, priority, status, due_at, owner_id, department, related_risk_id, created_at, updated_at)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
`).run('task-outreach-blast', eventId, 'Trigger targeted community outreach blast', 'Distribute invitations across university partner Slack and Discord communities.', 'urgent', 'pending', '2026-10-13', null, 'marketing', regRiskId, now, now);

// 10. The Seeded Delayed-Bus Incident Demonstration
const delayedBusIncidentId = 'inc-demo-delayed-bus';
db.prepare(`
  INSERT INTO incidents (
    id, reference_number, event_id, reporter_id, category, title, description,
    zone, affected_session_id, urgency, contact_preference, priority_score, priority_reason,
    status, related_risk_id, related_task_id, created_at, updated_at
  ) VALUES (
    ?, 'INC-2026-BUS-DEMO', ?, ?, 'transport',
    'Delegate Shuttle Bus #4 Delayed at Gate 2 Checkpoint',
    'Bus carrying 35 registered university hackathon delegates is held at Gate 2 access point due to security checkpoint queue. The Opening Ceremony begins in 30 minutes!',
    'Gate 2', ?, 'critical', 'Phone / WhatsApp: +1-555-0199', 95,
    'Critical urgency; Transport disruption; Directly impacts Opening Ceremony starting in 30 minutes',
    'new', ?, ?, ?, ?
  )
`).run(delayedBusIncidentId, eventId, participant1Id, sessionId1, transportRiskId, taskTransportId, now, now);

// Incident initial activity
db.prepare(`
  INSERT INTO incident_activities (id, incident_id, actor_id, action, details, created_at)
  VALUES (?, ?, ?, 'created', 'Incident INC-2026-BUS-DEMO submitted by Alex Rivera from Gate 2', ?)
`).run('act-init-1', delayedBusIncidentId, participant1Id, now);

// Notification to organizer
db.prepare(`
  INSERT INTO in_app_notifications (id, user_id, event_id, incident_id, type, title, message, read, created_at)
  VALUES (?, ?, ?, ?, 'error', 'CRITICAL INCIDENT: INC-2026-BUS-DEMO', 'Delegate Shuttle Bus #4 Delayed at Gate 2 Checkpoint. Opening Ceremony at risk.', 0, ?)
`).run('notif-init-org', organizerId, eventId, delayedBusIncidentId, now);

console.log('Database successfully seeded!');
console.log('Event ID:', eventId);
console.log('Delayed Bus Incident ID:', delayedBusIncidentId);
console.log('Accounts:');
console.log('  Organizer:          organizer@runshow.ai / RunshowDemo2026!');
console.log('  Transport Responder: transport@runshow.ai / RunshowDemo2026!');
console.log('  Participant:        alex@participant.com / RunshowDemo2026!');
