import { db, nowIso } from './db';
import { hashPassword } from './auth';

export async function seedDemoData() {
  const now = nowIso();
  const passwordHash = await hashPassword('RunshowDemo2026!');

  // Clean existing tables in order
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
      db().exec(`DELETE FROM ${table};`);
    } catch {
      // Table might not exist or empty
    }
  }

  // 1. Seed Users
  // Organizer
  const organizerId = 'usr-organizer-1';
  db().prepare(`
    INSERT INTO users (id, name, email, password_hash, role, status, created_at, updated_at)
    VALUES (?, ?, ?, ?, 'organizer', 'active', ?, ?)
  `).run(organizerId, 'Sarah Jenkins (Lead Organizer)', 'organizer@runshow.ai', passwordHash, now, now);

  // Sub-organizers
  const subOrgTransportId = 'usr-suborg-transport';
  db().prepare(`
    INSERT INTO users (id, name, email, password_hash, role, status, created_at, updated_at)
    VALUES (?, ?, ?, ?, 'sub_organizer', 'active', ?, ?)
  `).run(subOrgTransportId, 'Marcus Chen (Transport & Logistics)', 'transport@runshow.ai', passwordHash, now, now);

  const subOrgVenueId = 'usr-suborg-venue';
  db().prepare(`
    INSERT INTO users (id, name, email, password_hash, role, status, created_at, updated_at)
    VALUES (?, ?, ?, ?, 'sub_organizer', 'active', ?, ?)
  `).run(subOrgVenueId, 'Elena Rostova (Gate & Venue Ops)', 'venue@runshow.ai', passwordHash, now, now);

  // Participants
  const participant1Id = 'usr-participant-1';
  db().prepare(`
    INSERT INTO users (id, name, email, password_hash, role, status, created_at, updated_at)
    VALUES (?, ?, ?, ?, 'participant', 'active', ?, ?)
  `).run(participant1Id, 'Alex Rivera (Hackathon Attendee)', 'alex@participant.com', passwordHash, now, now);

  const participant2Id = 'usr-participant-2';
  db().prepare(`
    INSERT INTO users (id, name, email, password_hash, role, status, created_at, updated_at)
    VALUES (?, ?, ?, ?, 'participant', 'active', ?, ?)
  `).run(participant2Id, 'Priya Sharma (Developer)', 'priya@participant.com', passwordHash, now, now);

  // Seed 48 other registered participant records to simulate realistic scale
  for (let i = 3; i <= 50; i++) {
    const pId = `usr-participant-${i}`;
    db().prepare(`
      INSERT INTO users (id, name, email, password_hash, role, status, created_at, updated_at)
      VALUES (?, ?, ?, ?, 'participant', 'active', ?, ?)
    `).run(pId, `Attendee ${i}`, `attendee${i}@eventpilot.test`, passwordHash, now, now);
  }

  // 2. Responder Profiles
  db().prepare(`
    INSERT INTO responder_profiles (user_id, skills, zones, availability, updated_at)
    VALUES (?, ?, ?, 'available', ?)
  `).run(subOrgTransportId, 'transport,operations,logistics', 'Gate 2,Zone B,Main Entrance', now);

  db().prepare(`
    INSERT INTO responder_profiles (user_id, skills, zones, availability, updated_at)
    VALUES (?, ?, ?, 'available', ?)
  `).run(subOrgVenueId, 'venue,registration,safety', 'Main Hall,Gate 1,Auditorium', now);

  // 3. Main Demonstration Event
  const eventId = 'event-techsprint-2026';
  db().prepare(`
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
  db().prepare(`
    INSERT INTO event_sessions (id, event_id, name, description, start_at, end_at, venue)
    VALUES (?, ?, 'Opening Ceremony & Keynote Address', 'Main stage kickoff presentation and challenge statement release', '2026-10-15T09:30:00', '2026-10-15T11:00:00', 'Auditorium Hall A')
  `).run(sessionId1, eventId);

  const sessionId2 = 'ses-hacking';
  db().prepare(`
    INSERT INTO event_sessions (id, event_id, name, description, start_at, end_at, venue)
    VALUES (?, ?, 'Sprint Round 1: Architecture & Prototyping', 'First intense sprint hacking block with mentor rotations', '2026-10-15T11:30:00', '2026-10-15T18:00:00', 'Hack Bay North & South')
  `).run(sessionId2, eventId);

  // 5. Team Assignments
  db().prepare(`
    INSERT INTO team_assignments (id, event_id, user_id, responsibility, status, created_at, updated_at)
    VALUES (?, ?, ?, 'operations', 'active', ?, ?)
  `).run('ta-transport', eventId, subOrgTransportId, now, now);

  db().prepare(`
    INSERT INTO team_assignments (id, event_id, user_id, responsibility, status, created_at, updated_at)
    VALUES (?, ?, ?, 'programme', 'active', ?, ?)
  `).run('ta-venue', eventId, subOrgVenueId, now, now);

  // 6. Registrations (50 registered participants to show gap against 500 target!)
  for (let i = 1; i <= 50; i++) {
    db().prepare(`
      INSERT INTO registrations (id, event_id, participant_id, status, created_at, updated_at)
      VALUES (?, ?, ?, 'registered', ?, ?)
    `).run(`reg-${i}`, eventId, `usr-participant-${i}`, now, now);
  }

  // 7. Partners (3 confirmed, 2 pending -> 5 total)
  db().prepare(`
    INSERT INTO partners (id, event_id, name, tier, status, contact, deadline, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run('part-1', eventId, 'CloudScale Global', 'Platinum', 'confirmed', 'Sarah Chen (Partner Lead)', '2026-10-13', now, now);

  db().prepare(`
    INSERT INTO partners (id, event_id, name, tier, status, contact, deadline, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run('part-2', eventId, 'DevForge Systems', 'Gold', 'confirmed', 'David Miller', '2026-10-13', now, now);

  db().prepare(`
    INSERT INTO partners (id, event_id, name, tier, status, contact, deadline, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run('part-3', eventId, 'NextAI Labs', 'Silver', 'confirmed', 'Aisha Khan', '2026-10-14', now, now);

  db().prepare(`
    INSERT INTO partners (id, event_id, name, tier, status, contact, deadline, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run('part-4', eventId, 'VenturePulse Media', 'Bronze', 'pending', 'Rachel Green', '2026-10-14', now, now);

  db().prepare(`
    INSERT INTO partners (id, event_id, name, tier, status, contact, deadline, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run('part-5', eventId, 'OmniTech Logistics', 'Bronze', 'pending', 'Tom Bradley', '2026-10-14', now, now);

  // 8. Risks
  const transportRiskId = 'risk-transport-contingency';
  db().prepare(`
    INSERT INTO risks (id, event_id, title, description, severity, status, evidence, created_at, updated_at)
    VALUES (?, ?, 'Participant Transit & Shuttle Congestion at Gate 2', 'Peak morning shuttle arrival may experience bottlenecks at Gate 2 security checkpoint.', 'high', 'open', 'Historical delay data from previous regional hackathons', ?, ?)
  `).run(transportRiskId, eventId, now, now);

  const regRiskId = 'risk-registration-gap';
  db().prepare(`
    INSERT INTO risks (id, event_id, title, description, severity, status, evidence, created_at, updated_at)
    VALUES (?, ?, 'Significant Target Registration Gap', 'Current confirmed count (50) is 90% below the 500 registration target with 3 days remaining.', 'critical', 'open', 'Registration pace tracking shows daily shortfall', ?, ?)
  `).run(regRiskId, eventId, now, now);

  const partnerRiskId = 'risk-partner-confirmations';
  db().prepare(`
    INSERT INTO risks (id, event_id, title, description, severity, status, evidence, created_at, updated_at)
    VALUES (?, ?, 'Pending Partner Activation Agreements', '2 of 5 partners have not signed booth agreements 48 hours before setup.', 'medium', 'open', 'Outstanding contracts for VenturePulse and OmniTech', ?, ?)
  `).run(partnerRiskId, eventId, now, now);

  // 9. Operational Tasks
  const taskTransportId = 'task-gate2-coordination';
  db().prepare(`
    INSERT INTO tasks (id, event_id, title, description, priority, status, due_at, owner_id, department, related_risk_id, created_at, updated_at)
    VALUES (?, ?, 'Coordinate Gate 2 Shuttle Staging and Traffic Flow', 'Confirm express lane access with venue traffic security for all delegate buses.', 'urgent', 'pending', '2026-10-15', ?, 'operations', ?, ?, ?)
  `).run(taskTransportId, eventId, subOrgTransportId, transportRiskId, now, now);

  db().prepare(`
    INSERT INTO tasks (id, event_id, title, description, priority, status, due_at, owner_id, department, related_risk_id, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run('task-partner-followup', eventId, 'Follow up with unconfirmed partner deliverables', 'Contact VenturePulse and OmniTech representatives to finalize display banners.', 'high', 'pending', '2026-10-14', null, 'partnerships', partnerRiskId, now, now);

  db().prepare(`
    INSERT INTO tasks (id, event_id, title, description, priority, status, due_at, owner_id, department, related_risk_id, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run('task-outreach-blast', eventId, 'Trigger targeted community outreach blast', 'Distribute invitations across university partner Slack and Discord communities.', 'urgent', 'pending', '2026-10-13', null, 'marketing', regRiskId, now, now);

  // 10. The Seeded Delayed-Bus Incident Demonstration
  const delayedBusIncidentId = 'inc-demo-delayed-bus';
  db().prepare(`
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
  db().prepare(`
    INSERT INTO incident_activities (id, incident_id, actor_id, action, details, created_at)
    VALUES (?, ?, ?, 'created', 'Incident INC-2026-BUS-DEMO submitted by Alex Rivera from Gate 2', ?)
  `).run('act-init-1', delayedBusIncidentId, participant1Id, now);

  // Notification to organizer
  db().prepare(`
    INSERT INTO in_app_notifications (id, user_id, event_id, incident_id, type, title, message, read, created_at)
    VALUES (?, ?, ?, ?, 'error', 'CRITICAL INCIDENT: INC-2026-BUS-DEMO', 'Delegate Shuttle Bus #4 Delayed at Gate 2 Checkpoint. Opening Ceremony at risk.', 0, ?)
  `).run('notif-init-org', organizerId, eventId, delayedBusIncidentId, now);

  return {
    success: true,
    eventId,
    delayedBusIncidentId,
    organizer: { email: 'organizer@runshow.ai', password: 'RunshowDemo2026!' },
    transportResponder: { email: 'transport@runshow.ai', password: 'RunshowDemo2026!' },
    participant: { email: 'alex@participant.com', password: 'RunshowDemo2026!' },
  };
}
