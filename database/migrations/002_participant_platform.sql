-- RUNSHOW Participant Event Platform Migration
-- Adds tables for public events, invitations, ticket options, registrations, and support tickets

-- Extend events table with new columns
ALTER TABLE events ADD COLUMN visibility TEXT NOT NULL DEFAULT 'private';
ALTER TABLE events ADD COLUMN ticket_type TEXT;
ALTER TABLE events ADD COLUMN ticket_price REAL;
ALTER TABLE events ADD COLUMN ticket_currency TEXT DEFAULT 'USD';
ALTER TABLE events ADD COLUMN registration_deadline TEXT;
ALTER TABLE events ADD COLUMN cancellation_policy TEXT;
ALTER TABLE events ADD COLUMN eligibility_requirements TEXT;
ALTER TABLE events ADD COLUMN banner_image_url TEXT;
ALTER TABLE events ADD COLUMN organizer_institution TEXT;
ALTER TABLE events ADD COLUMN tags TEXT;

-- Ticket options table
CREATE TABLE IF NOT EXISTS ticket_options (
  id TEXT PRIMARY KEY,
  event_id TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  description TEXT DEFAULT '',
  type TEXT NOT NULL CHECK (type IN ('free', 'paid')),
  price REAL NOT NULL DEFAULT 0,
  currency TEXT NOT NULL DEFAULT 'USD',
  capacity INTEGER,
  sold_count INTEGER NOT NULL DEFAULT 0,
  sales_start TEXT,
  sales_end TEXT,
  is_active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

-- Invitations table
CREATE TABLE IF NOT EXISTS invitations (
  id TEXT PRIMARY KEY,
  event_id TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  code TEXT NOT NULL UNIQUE,
  token TEXT NOT NULL UNIQUE,
  created_by TEXT NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL,
  expires_at TEXT,
  max_uses INTEGER,
  used_count INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'expired', 'revoked', 'exhausted')),
  revoked_at TEXT,
  revoked_by TEXT REFERENCES users(id)
);

-- Registrations table (extend existing)
-- The existing registrations table already has: id, event_id, participant_id, status, created_at, updated_at
-- Add new columns:
ALTER TABLE registrations ADD COLUMN ticket_option_id TEXT REFERENCES ticket_options(id);
ALTER TABLE registrations ADD COLUMN invitation_code TEXT;
ALTER TABLE registrations ADD COLUMN payment_status TEXT NOT NULL DEFAULT 'not_applicable' CHECK (payment_status IN ('pending', 'paid', 'failed', 'refunded', 'not_applicable'));
ALTER TABLE registrations ADD COLUMN reference_number TEXT;
ALTER TABLE registrations ADD COLUMN cancelled_at TEXT;
ALTER TABLE registrations ADD COLUMN checked_in_at TEXT;

-- Support tickets table
CREATE TABLE IF NOT EXISTS support_tickets (
  id TEXT PRIMARY KEY,
  event_id TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  participant_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  description TEXT NOT NULL,
  category TEXT NOT NULL CHECK (category IN ('registration', 'payment', 'schedule', 'checkin', 'technical', 'communication', 'other')),
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'acknowledged', 'in_progress', 'waiting_for_participant', 'resolved', 'closed')),
  priority TEXT NOT NULL DEFAULT 'normal' CHECK (priority IN ('low', 'normal', 'high', 'critical')),
  assignee_id TEXT REFERENCES users(id),
  reference_number TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  resolved_at TEXT
);

-- Support messages table
CREATE TABLE IF NOT EXISTS support_messages (
  id TEXT PRIMARY KEY,
  ticket_id TEXT NOT NULL REFERENCES support_tickets(id) ON DELETE CASCADE,
  sender_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  sender_role TEXT NOT NULL CHECK (sender_role IN ('participant', 'organizer', 'sub_organizer', 'system')),
  content TEXT NOT NULL,
  is_internal INTEGER NOT NULL DEFAULT 0,
  attachments TEXT, -- JSON array of attachment URLs
  created_at TEXT NOT NULL
);

-- Notifications table (if not exists)
CREATE TABLE IF NOT EXISTS notifications (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  message TEXT NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('info', 'success', 'warning', 'error')),
  read INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_events_visibility ON events(visibility);
CREATE INDEX IF NOT EXISTS idx_events_lifecycle ON events(lifecycle);
CREATE INDEX IF NOT EXISTS idx_events_start_at ON events(start_at);
CREATE INDEX IF NOT EXISTS idx_ticket_options_event ON ticket_options(event_id);
CREATE TABLE IF NOT EXISTS tickets (
  id TEXT PRIMARY KEY,
  registration_id TEXT NOT NULL UNIQUE REFERENCES registrations(id) ON DELETE CASCADE,
  event_id TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  participant_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  ticket_number TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'cancelled')),
  issued_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_tickets_participant_event ON tickets(participant_id, event_id);
CREATE INDEX IF NOT EXISTS idx_invitations_event ON invitations(event_id);
CREATE INDEX IF NOT EXISTS idx_invitations_code ON invitations(code);
CREATE INDEX IF NOT EXISTS idx_invitations_token ON invitations(token);
CREATE INDEX IF NOT EXISTS idx_registrations_event_participant ON registrations(event_id, participant_id);
CREATE INDEX IF NOT EXISTS idx_support_tickets_event ON support_tickets(event_id);
CREATE INDEX IF NOT EXISTS idx_support_tickets_participant ON support_tickets(participant_id);
CREATE INDEX IF NOT EXISTS idx_support_tickets_status ON support_tickets(status);
CREATE INDEX IF NOT EXISTS idx_support_tickets_assignee ON support_tickets(assignee_id);
CREATE INDEX IF NOT EXISTS idx_support_messages_ticket ON support_messages(ticket_id);
