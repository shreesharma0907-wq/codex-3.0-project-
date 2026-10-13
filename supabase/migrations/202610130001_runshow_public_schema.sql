-- RUNSHOW application schema for the existing Supabase project.
-- PREPARED ONLY: do not apply until all Supabase diagnostic output is reviewed.
-- Creates objects only in public; Supabase-managed auth.* is never modified.
-- SQLite TEXT IDs are mapped to UUIDs by the separate importer. Password hashes,
-- auth_sessions, plaintext invitation tokens, and raw participant data are not
-- copied by this DDL. See docs/supabase-data-import-plan.md.

BEGIN;

CREATE TABLE public.profiles (
  id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  display_name text NOT NULL DEFAULT '', contact_phone text, avatar_url text,
  account_status text NOT NULL DEFAULT 'active'
    CHECK (account_status IN ('active', 'suspended', 'disabled')),
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  name text NOT NULL, description text NOT NULL DEFAULT '', event_type text NOT NULL,
  format text NOT NULL CHECK (format IN ('in-person', 'virtual', 'hybrid')),
  start_at timestamptz NOT NULL, end_at timestamptz NOT NULL, timezone text NOT NULL,
  venue text, meeting_url text, joining_instructions text,
  audience text NOT NULL DEFAULT '',
  expected_attendance integer NOT NULL DEFAULT 0 CHECK (expected_attendance >= 0),
  registration_target integer NOT NULL DEFAULT 0 CHECK (registration_target >= 0),
  capacity integer CHECK (capacity IS NULL OR capacity >= 0),
  lifecycle text NOT NULL DEFAULT 'upcoming'
    CHECK (lifecycle IN ('draft', 'upcoming', 'in-progress', 'completed', 'cancelled')),
  visibility text NOT NULL DEFAULT 'private' CHECK (visibility IN ('public', 'private')),
  ticket_type text CHECK (ticket_type IS NULL OR ticket_type IN ('free', 'paid')),
  ticket_price numeric(12,2) CHECK (ticket_price IS NULL OR ticket_price >= 0),
  ticket_currency text NOT NULL DEFAULT 'USD', registration_deadline timestamptz,
  cancellation_policy text, eligibility_requirements text, banner_image_url text,
  organizer_institution text, tags text,
  joining_enabled boolean NOT NULL DEFAULT true,
  invitation_access_mode text NOT NULL DEFAULT 'both'
    CHECK (invitation_access_mode IN ('link', 'code', 'both')),
  require_approval boolean NOT NULL DEFAULT false,
  current_registrations integer NOT NULL DEFAULT 0 CHECK (current_registrations >= 0),
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (end_at >= start_at)
);

-- Persist only a hash of a link bearer token; return raw tokens once from a future API.
CREATE TABLE public.invitations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id uuid NOT NULL REFERENCES public.events(id) ON DELETE CASCADE,
  code text NOT NULL UNIQUE, token_hash text NOT NULL UNIQUE,
  access_mode text NOT NULL DEFAULT 'both' CHECK (access_mode IN ('link', 'code', 'both')),
  require_approval boolean NOT NULL DEFAULT false,
  created_by uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(), expires_at timestamptz,
  max_uses integer CHECK (max_uses IS NULL OR max_uses > 0),
  used_count integer NOT NULL DEFAULT 0 CHECK (used_count >= 0),
  status text NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'expired', 'revoked', 'exhausted')),
  revoked_at timestamptz, revoked_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  outreach_source text, campaign_name text,
  CHECK (max_uses IS NULL OR used_count <= max_uses)
);

CREATE TABLE public.event_memberships (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id uuid NOT NULL REFERENCES public.events(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role text NOT NULL CHECK (role IN ('organizer', 'sub_organizer', 'participant')),
  status text NOT NULL DEFAULT 'active'
    CHECK (status IN ('invited', 'active', 'suspended', 'revoked')),
  department text, team_label text,
  invited_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  invitation_id uuid REFERENCES public.invitations(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (event_id, user_id)
);

CREATE TABLE public.event_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id uuid NOT NULL REFERENCES public.events(id) ON DELETE CASCADE,
  name text NOT NULL, description text NOT NULL DEFAULT '',
  start_at timestamptz NOT NULL, end_at timestamptz NOT NULL, venue text, meeting_url text,
  CHECK (end_at >= start_at)
);

CREATE TABLE public.ticket_options (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id uuid NOT NULL REFERENCES public.events(id) ON DELETE CASCADE,
  name text NOT NULL, description text NOT NULL DEFAULT '',
  type text NOT NULL CHECK (type IN ('free', 'paid')),
  price numeric(12,2) NOT NULL DEFAULT 0 CHECK (price >= 0),
  currency text NOT NULL DEFAULT 'USD', capacity integer CHECK (capacity IS NULL OR capacity >= 0),
  sold_count integer NOT NULL DEFAULT 0 CHECK (sold_count >= 0),
  sales_start timestamptz, sales_end timestamptz, is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (sales_end IS NULL OR sales_start IS NULL OR sales_end >= sales_start)
);

CREATE TABLE public.registrations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id uuid NOT NULL REFERENCES public.events(id) ON DELETE CASCADE,
  participant_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  status text NOT NULL CHECK (status IN ('registered', 'confirmed', 'pending', 'waitlisted', 'cancelled', 'invited')),
  ticket_option_id uuid REFERENCES public.ticket_options(id) ON DELETE RESTRICT,
  invitation_id uuid REFERENCES public.invitations(id) ON DELETE SET NULL,
  invitation_code text,
  payment_status text NOT NULL DEFAULT 'not_applicable'
    CHECK (payment_status IN ('pending', 'paid', 'failed', 'refunded', 'not_applicable')),
  reference_number text UNIQUE, cancelled_at timestamptz, checked_in_at timestamptz,
  approved_at timestamptz, approved_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (event_id, participant_id), UNIQUE (id, event_id, participant_id)
);

CREATE TABLE public.tickets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), registration_id uuid NOT NULL UNIQUE,
  event_id uuid NOT NULL REFERENCES public.events(id) ON DELETE CASCADE,
  participant_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  ticket_number text NOT NULL UNIQUE,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'cancelled')),
  issued_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (registration_id, event_id, participant_id)
    REFERENCES public.registrations(id, event_id, participant_id) ON DELETE CASCADE
);

CREATE TABLE public.team_assignments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id uuid NOT NULL REFERENCES public.events(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  responsibility text NOT NULL,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive')),
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (event_id, user_id, responsibility),
  FOREIGN KEY (event_id, user_id) REFERENCES public.event_memberships(event_id, user_id) ON DELETE CASCADE
);

CREATE TABLE public.tasks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id uuid NOT NULL REFERENCES public.events(id) ON DELETE CASCADE,
  title text NOT NULL, description text NOT NULL DEFAULT '',
  priority text NOT NULL CHECK (priority IN ('urgent', 'high', 'medium', 'low')),
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'in-progress', 'completed', 'blocked')),
  due_at timestamptz NOT NULL, owner_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  department text, related_risk_id uuid, related_recommendation_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.partners (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id uuid NOT NULL REFERENCES public.events(id) ON DELETE CASCADE,
  name text NOT NULL, tier text NOT NULL CHECK (tier IN ('Platinum', 'Gold', 'Silver', 'Bronze')),
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('confirmed', 'pending')),
  contact text NOT NULL DEFAULT '', deadline timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.risks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id uuid NOT NULL REFERENCES public.events(id) ON DELETE CASCADE,
  title text NOT NULL, description text NOT NULL,
  severity text NOT NULL CHECK (severity IN ('critical', 'high', 'medium', 'low')),
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'in-progress', 'mitigated', 'closed')),
  evidence text, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.recommendations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id uuid NOT NULL REFERENCES public.events(id) ON DELETE CASCADE,
  action text NOT NULL, reason text NOT NULL,
  priority text NOT NULL CHECK (priority IN ('urgent', 'high', 'medium', 'low')),
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.incidents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), reference_number text NOT NULL UNIQUE,
  event_id uuid NOT NULL REFERENCES public.events(id) ON DELETE CASCADE,
  reporter_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  category text NOT NULL, title text NOT NULL, description text NOT NULL, zone text,
  affected_session_id uuid REFERENCES public.event_sessions(id) ON DELETE SET NULL,
  urgency text NOT NULL CHECK (urgency IN ('critical', 'high', 'medium', 'low')),
  contact_preference text, priority_score integer NOT NULL DEFAULT 50 CHECK (priority_score BETWEEN 0 AND 100),
  priority_reason text NOT NULL DEFAULT '',
  status text NOT NULL DEFAULT 'new'
    CHECK (status IN ('new', 'acknowledged', 'assigned', 'in_progress', 'waiting_external', 'resolved', 'reopened', 'closed')),
  assigned_responder_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  assigned_at timestamptz, acknowledged_at timestamptz, resolution_notes text,
  resolved_at timestamptz, closed_at timestamptz,
  related_risk_id uuid REFERENCES public.risks(id) ON DELETE SET NULL,
  related_task_id uuid REFERENCES public.tasks(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.tasks ADD CONSTRAINT tasks_related_risk_fk
  FOREIGN KEY (related_risk_id) REFERENCES public.risks(id) ON DELETE SET NULL;

CREATE TABLE public.responder_profiles (
  user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  skills text NOT NULL DEFAULT 'operations', zones text NOT NULL DEFAULT 'all',
  availability text NOT NULL DEFAULT 'available' CHECK (availability IN ('available', 'busy', 'offline')),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.incident_assignments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  incident_id uuid NOT NULL REFERENCES public.incidents(id) ON DELETE CASCADE,
  responder_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  assigned_by uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  reason text NOT NULL DEFAULT '',
  status text NOT NULL DEFAULT 'assigned' CHECK (status IN ('assigned', 'acknowledged', 'reassigned', 'released')),
  assigned_at timestamptz NOT NULL DEFAULT now(), acknowledged_at timestamptz
);

CREATE TABLE public.incident_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  incident_id uuid NOT NULL REFERENCES public.incidents(id) ON DELETE CASCADE,
  sender_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  message text NOT NULL, is_internal boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE public.incident_activities (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  incident_id uuid NOT NULL REFERENCES public.incidents(id) ON DELETE CASCADE,
  actor_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  action text NOT NULL, details text NOT NULL, created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.in_app_notifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  event_id uuid REFERENCES public.events(id) ON DELETE CASCADE,
  incident_id uuid REFERENCES public.incidents(id) ON DELETE CASCADE,
  task_id uuid REFERENCES public.tasks(id) ON DELETE CASCADE,
  risk_id uuid REFERENCES public.risks(id) ON DELETE CASCADE,
  type text NOT NULL CHECK (type IN ('info', 'success', 'warning', 'error')),
  title text NOT NULL, message text NOT NULL, read boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE public.task_comments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id uuid NOT NULL REFERENCES public.tasks(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  content text NOT NULL, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE public.notifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  message text NOT NULL, type text NOT NULL CHECK (type IN ('info', 'success', 'warning', 'error')),
  read boolean NOT NULL DEFAULT false, created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.support_tickets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id uuid NOT NULL REFERENCES public.events(id) ON DELETE CASCADE,
  participant_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  title text NOT NULL, description text NOT NULL,
  category text NOT NULL CHECK (category IN ('registration', 'payment', 'schedule', 'checkin', 'technical', 'communication', 'other')),
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'acknowledged', 'in_progress', 'waiting_for_participant', 'resolved', 'closed')),
  priority text NOT NULL DEFAULT 'normal' CHECK (priority IN ('low', 'normal', 'high', 'critical')),
  assignee_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  reference_number text NOT NULL UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(), resolved_at timestamptz
);
CREATE TABLE public.support_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ticket_id uuid NOT NULL REFERENCES public.support_tickets(id) ON DELETE CASCADE,
  sender_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  sender_role text NOT NULL CHECK (sender_role IN ('participant', 'organizer', 'sub_organizer', 'system')),
  content text NOT NULL, is_internal boolean NOT NULL DEFAULT false, attachments text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.event_metric_snapshots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id uuid NOT NULL REFERENCES public.events(id) ON DELETE CASCADE,
  snapshot_day date NOT NULL, taken_at timestamptz NOT NULL DEFAULT now(), metrics_json jsonb NOT NULL,
  UNIQUE (event_id, snapshot_day)
);
CREATE TABLE public.event_intelligence_analyses (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id uuid NOT NULL REFERENCES public.events(id) ON DELETE CASCADE,
  generated_at timestamptz NOT NULL DEFAULT now(), expires_at timestamptz NOT NULL,
  model text NOT NULL, analysis_json jsonb NOT NULL
);
CREATE TABLE public.event_intelligence_recommendations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id uuid NOT NULL REFERENCES public.events(id) ON DELETE CASCADE,
  category text NOT NULL, priority text NOT NULL CHECK (priority IN ('urgent', 'high', 'medium', 'low')),
  evidence_json jsonb NOT NULL, explanation text NOT NULL, action text NOT NULL, expected_outcome text NOT NULL,
  related_task_id uuid REFERENCES public.tasks(id) ON DELETE SET NULL,
  related_incident_id uuid REFERENCES public.incidents(id) ON DELETE SET NULL,
  source text NOT NULL CHECK (source IN ('gemini', 'rules', 'organizer')),
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'accepted', 'in_progress', 'completed', 'dismissed')),
  created_at timestamptz NOT NULL DEFAULT now(), valid_until timestamptz
);
ALTER TABLE public.tasks ADD CONSTRAINT tasks_related_recommendation_fk
  FOREIGN KEY (related_recommendation_id)
  REFERENCES public.event_intelligence_recommendations(id) ON DELETE SET NULL;
CREATE UNIQUE INDEX tasks_related_recommendation_unique
  ON public.tasks(related_recommendation_id) WHERE related_recommendation_id IS NOT NULL;

-- Composite event-scoped references prevent accidentally joining records across events.
ALTER TABLE public.invitations ADD CONSTRAINT invitations_id_event_unique UNIQUE (id, event_id);
ALTER TABLE public.event_sessions ADD CONSTRAINT sessions_id_event_unique UNIQUE (id, event_id);
ALTER TABLE public.ticket_options ADD CONSTRAINT ticket_options_id_event_unique UNIQUE (id, event_id);
ALTER TABLE public.risks ADD CONSTRAINT risks_id_event_unique UNIQUE (id, event_id);
ALTER TABLE public.tasks ADD CONSTRAINT tasks_id_event_unique UNIQUE (id, event_id);
ALTER TABLE public.recommendations ADD CONSTRAINT recommendations_id_event_unique UNIQUE (id, event_id);
ALTER TABLE public.incidents ADD CONSTRAINT incidents_id_event_unique UNIQUE (id, event_id);
ALTER TABLE public.event_intelligence_recommendations
  ADD CONSTRAINT intelligence_recommendations_id_event_unique UNIQUE (id, event_id);
ALTER TABLE public.event_memberships ADD CONSTRAINT membership_invitation_same_event_fk
  FOREIGN KEY (invitation_id, event_id) REFERENCES public.invitations(id, event_id);
ALTER TABLE public.registrations ADD CONSTRAINT registration_ticket_option_same_event_fk
  FOREIGN KEY (ticket_option_id, event_id) REFERENCES public.ticket_options(id, event_id);
ALTER TABLE public.registrations ADD CONSTRAINT registration_invitation_same_event_fk
  FOREIGN KEY (invitation_id, event_id) REFERENCES public.invitations(id, event_id);
ALTER TABLE public.tasks ADD CONSTRAINT task_owner_event_membership_fk
  FOREIGN KEY (event_id, owner_id) REFERENCES public.event_memberships(event_id, user_id);
ALTER TABLE public.tasks ADD CONSTRAINT task_risk_same_event_fk
  FOREIGN KEY (related_risk_id, event_id) REFERENCES public.risks(id, event_id);
ALTER TABLE public.tasks ADD CONSTRAINT task_recommendation_same_event_fk
  FOREIGN KEY (related_recommendation_id, event_id)
  REFERENCES public.event_intelligence_recommendations(id, event_id);
ALTER TABLE public.incidents ADD CONSTRAINT incident_session_same_event_fk
  FOREIGN KEY (affected_session_id, event_id) REFERENCES public.event_sessions(id, event_id);
ALTER TABLE public.incidents ADD CONSTRAINT incident_risk_same_event_fk
  FOREIGN KEY (related_risk_id, event_id) REFERENCES public.risks(id, event_id);
ALTER TABLE public.incidents ADD CONSTRAINT incident_task_same_event_fk
  FOREIGN KEY (related_task_id, event_id) REFERENCES public.tasks(id, event_id);
ALTER TABLE public.event_intelligence_recommendations ADD CONSTRAINT intelligence_task_same_event_fk
  FOREIGN KEY (related_task_id, event_id) REFERENCES public.tasks(id, event_id);
ALTER TABLE public.event_intelligence_recommendations ADD CONSTRAINT intelligence_incident_same_event_fk
  FOREIGN KEY (related_incident_id, event_id) REFERENCES public.incidents(id, event_id);
CREATE TABLE public.event_recommendation_history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  recommendation_id uuid NOT NULL REFERENCES public.event_intelligence_recommendations(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  from_status text NOT NULL,
  to_status text NOT NULL CHECK (to_status IN ('open', 'accepted', 'in_progress', 'completed', 'dismissed')),
  outcome text, created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.legacy_import_batches (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), source_name text NOT NULL, source_fingerprint text NOT NULL,
  status text NOT NULL CHECK (status IN ('planned', 'dry_run', 'importing', 'completed', 'needs_review', 'failed')),
  started_at timestamptz, completed_at timestamptz, summary_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(), UNIQUE (source_name, source_fingerprint)
);
CREATE TABLE public.legacy_id_mappings (
  entity_type text NOT NULL, legacy_id text NOT NULL, target_id uuid NOT NULL,
  import_batch_id uuid NOT NULL REFERENCES public.legacy_import_batches(id) ON DELETE RESTRICT,
  resolution text NOT NULL CHECK (resolution IN ('verified', 'generated', 'quarantined')),
  created_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY (entity_type, legacy_id),
  UNIQUE (entity_type, target_id)
);
-- Restart checkpoints and rejects contain opaque IDs/reason codes only, never
-- source payloads, contact details, credentials, descriptions, or bearer tokens.
CREATE TABLE public.legacy_import_checkpoints (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  import_batch_id uuid NOT NULL REFERENCES public.legacy_import_batches(id) ON DELETE RESTRICT,
  entity_type text NOT NULL, chunk_number integer NOT NULL CHECK (chunk_number >= 0),
  source_cursor text, attempted_count integer NOT NULL DEFAULT 0 CHECK (attempted_count >= 0),
  imported_count integer NOT NULL DEFAULT 0 CHECK (imported_count >= 0),
  rejected_count integer NOT NULL DEFAULT 0 CHECK (rejected_count >= 0),
  chunk_fingerprint text NOT NULL,
  status text NOT NULL CHECK (status IN ('planned', 'committed', 'needs_review', 'failed')),
  committed_at timestamptz, created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (import_batch_id, entity_type, chunk_number),
  CHECK (imported_count + rejected_count <= attempted_count)
);
CREATE TABLE public.legacy_import_quarantine (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  import_batch_id uuid NOT NULL REFERENCES public.legacy_import_batches(id) ON DELETE RESTRICT,
  entity_type text NOT NULL, legacy_id text NOT NULL, reason_code text NOT NULL,
  reviewer_reference text, disposition text NOT NULL DEFAULT 'unresolved'
    CHECK (disposition IN ('unresolved', 'approved', 'omitted', 'rejected')),
  reviewed_at timestamptz, created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (import_batch_id, entity_type, legacy_id, reason_code)
);

-- Event and relationship indexes. Unique constraints above also index identity keys.
CREATE INDEX events_owner_start_idx ON public.events(owner_user_id, start_at);
CREATE INDEX events_visibility_lifecycle_idx ON public.events(visibility, lifecycle);
CREATE INDEX memberships_user_status_idx ON public.event_memberships(user_id, status);
CREATE INDEX memberships_event_role_status_idx ON public.event_memberships(event_id, role, status);
CREATE INDEX sessions_event_start_idx ON public.event_sessions(event_id, start_at);
CREATE INDEX ticket_options_event_idx ON public.ticket_options(event_id);
CREATE INDEX invitations_event_status_idx ON public.invitations(event_id, status, created_at DESC);
CREATE INDEX registrations_event_status_created_idx ON public.registrations(event_id, status, created_at);
CREATE INDEX registrations_participant_created_idx ON public.registrations(participant_id, created_at DESC);
CREATE INDEX registrations_invitation_idx ON public.registrations(invitation_id);
CREATE INDEX tickets_participant_event_idx ON public.tickets(participant_id, event_id);
CREATE INDEX team_assignments_user_status_idx ON public.team_assignments(user_id, status);
CREATE INDEX tasks_event_status_due_idx ON public.tasks(event_id, status, due_at);
CREATE INDEX tasks_owner_status_due_idx ON public.tasks(owner_id, status, due_at);
CREATE INDEX partners_event_status_idx ON public.partners(event_id, status);
CREATE INDEX risks_event_status_severity_idx ON public.risks(event_id, status, severity);
CREATE INDEX recommendations_event_created_idx ON public.recommendations(event_id, created_at DESC);
CREATE INDEX incidents_event_status_created_idx ON public.incidents(event_id, status, created_at DESC);
CREATE INDEX incidents_responder_status_idx ON public.incidents(assigned_responder_id, status);
CREATE INDEX incidents_reporter_created_idx ON public.incidents(reporter_id, created_at DESC);
CREATE INDEX incident_assignments_incident_time_idx ON public.incident_assignments(incident_id, assigned_at);
CREATE INDEX incident_messages_incident_time_idx ON public.incident_messages(incident_id, created_at);
CREATE INDEX incident_activities_incident_time_idx ON public.incident_activities(incident_id, created_at);
CREATE INDEX notifications_user_read_time_idx ON public.in_app_notifications(user_id, read, created_at DESC);
CREATE INDEX task_comments_task_time_idx ON public.task_comments(task_id, created_at);
CREATE INDEX support_tickets_event_status_idx ON public.support_tickets(event_id, status);
CREATE INDEX support_tickets_participant_time_idx ON public.support_tickets(participant_id, created_at DESC);
CREATE INDEX support_tickets_assignee_idx ON public.support_tickets(assignee_id);
CREATE INDEX support_messages_ticket_time_idx ON public.support_messages(ticket_id, created_at);
CREATE INDEX event_snapshots_event_day_idx ON public.event_metric_snapshots(event_id, snapshot_day DESC);
CREATE INDEX event_analyses_latest_idx ON public.event_intelligence_analyses(event_id, generated_at DESC);
CREATE INDEX intelligence_recs_status_time_idx
  ON public.event_intelligence_recommendations(event_id, status, created_at DESC);
CREATE INDEX recommendation_history_rec_time_idx
  ON public.event_recommendation_history(recommendation_id, created_at);
CREATE INDEX legacy_mappings_batch_idx ON public.legacy_id_mappings(import_batch_id);
CREATE INDEX legacy_checkpoints_batch_idx ON public.legacy_import_checkpoints(import_batch_id, entity_type, chunk_number);
CREATE INDEX legacy_quarantine_batch_idx ON public.legacy_import_quarantine(import_batch_id, disposition, entity_type);

-- Boolean-only authorization helpers. SECURITY DEFINER is required to avoid
-- recursive membership/event RLS checks; fixed search_path and auth.uid() scope them.
CREATE FUNCTION public.runshow_is_event_owner(p_event_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = pg_catalog, public
AS $function$
  SELECT auth.uid() IS NOT NULL AND EXISTS (
    SELECT 1 FROM public.events e
    JOIN public.profiles p ON p.id = auth.uid() AND p.account_status = 'active'
    WHERE e.id = p_event_id AND e.owner_user_id = auth.uid()
  );
$function$;

CREATE FUNCTION public.runshow_is_event_staff(p_event_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = pg_catalog, public
AS $function$
  SELECT auth.uid() IS NOT NULL AND (
    public.runshow_is_event_owner(p_event_id)
    OR EXISTS (SELECT 1 FROM public.event_memberships m
      JOIN public.profiles p ON p.id = m.user_id AND p.account_status = 'active'
      WHERE m.event_id = p_event_id AND m.user_id = auth.uid()
        AND m.status = 'active' AND m.role IN ('organizer', 'sub_organizer'))
  );
$function$;

CREATE FUNCTION public.runshow_can_manage_event(p_event_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = pg_catalog, public
AS $function$
  SELECT auth.uid() IS NOT NULL AND (
    public.runshow_is_event_owner(p_event_id)
    OR EXISTS (SELECT 1 FROM public.event_memberships m
      JOIN public.profiles p ON p.id = m.user_id AND p.account_status = 'active'
      WHERE m.event_id = p_event_id AND m.user_id = auth.uid()
        AND m.status = 'active' AND m.role = 'organizer')
  );
$function$;

CREATE FUNCTION public.runshow_is_event_participant(p_event_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = pg_catalog, public
AS $function$
  -- Portal/event access requires both explicit approval and an active participant
  -- membership. Legacy `registered` is intentionally not an approved state.
  SELECT auth.uid() IS NOT NULL AND EXISTS (
    SELECT 1 FROM public.profiles p
    JOIN public.event_memberships m ON m.user_id = p.id
    JOIN public.registrations r ON r.participant_id = p.id AND r.event_id = m.event_id
    WHERE p.id = auth.uid() AND p.account_status = 'active'
      AND m.event_id = p_event_id AND m.status = 'active' AND m.role = 'participant'
      AND r.status = 'confirmed'
  );
$function$;

CREATE FUNCTION public.runshow_is_active_event_responder(p_event_id uuid, p_user_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = pg_catalog, public
AS $function$
  SELECT auth.uid() IS NOT NULL AND public.runshow_is_event_staff(p_event_id) AND EXISTS (
    SELECT 1 FROM public.event_memberships m
    JOIN public.profiles p ON p.id = m.user_id AND p.account_status = 'active'
    WHERE m.event_id = p_event_id AND m.user_id = p_user_id AND m.status = 'active'
      AND (m.role IN ('organizer', 'sub_organizer')
        OR EXISTS (SELECT 1 FROM public.responder_profiles rp
          WHERE rp.user_id = p_user_id AND rp.availability <> 'offline'))
  );
$function$;

CREATE FUNCTION public.runshow_can_view_profile(p_profile_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = pg_catalog, public
AS $function$
  SELECT auth.uid() IS NOT NULL AND EXISTS (
    SELECT 1 FROM public.event_memberships target_m
    WHERE target_m.user_id = p_profile_id AND target_m.status = 'active'
      AND public.runshow_is_event_staff(target_m.event_id)
  );
$function$;

REVOKE ALL ON FUNCTION public.runshow_is_event_owner(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.runshow_is_event_staff(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.runshow_can_manage_event(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.runshow_is_event_participant(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.runshow_is_active_event_responder(uuid, uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.runshow_can_view_profile(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.runshow_is_event_owner(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.runshow_is_event_staff(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.runshow_can_manage_event(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.runshow_is_event_participant(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.runshow_is_active_event_responder(uuid, uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.runshow_can_view_profile(uuid) TO authenticated, service_role;

CREATE FUNCTION public.runshow_touch_updated_at()
RETURNS trigger LANGUAGE plpgsql SET search_path = pg_catalog, public
AS $function$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$function$;
REVOKE ALL ON FUNCTION public.runshow_touch_updated_at() FROM PUBLIC, anon, authenticated;

-- Atomic participant join. Call only through this RPC; direct registration/ticket
-- table writes remain unavailable to authenticated clients. p_token_hash is the
-- server-computed SHA-256 digest of the link token, never the raw bearer token.
CREATE FUNCTION public.runshow_join_event(
  p_event_id uuid,
  p_invitation_code text DEFAULT NULL,
  p_token_hash text DEFAULT NULL,
  p_ticket_option_id uuid DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, public, auth
AS $function$
DECLARE
  v_user uuid := auth.uid();
  v_event public.events%ROWTYPE;
  v_inv public.invitations%ROWTYPE;
  v_reg public.registrations%ROWTYPE;
  v_member public.event_memberships%ROWTYPE;
  v_ticket public.tickets%ROWTYPE;
  v_option public.ticket_options%ROWTYPE;
  v_status text;
  v_now timestamptz := now();
BEGIN
  IF v_user IS NULL THEN RAISE EXCEPTION 'Sign in is required' USING ERRCODE = 'P0001'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.profiles p
      WHERE p.id = v_user AND p.account_status = 'active') THEN
    RAISE EXCEPTION 'Account is not active' USING ERRCODE = 'P0001';
  END IF;

  -- Serialize all joins for this event, including different invitations, so
  -- capacity checks cannot race. Lock order is always event then invitation.
  SELECT * INTO v_event FROM public.events e WHERE e.id = p_event_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Event not found' USING ERRCODE = 'P0001'; END IF;

  SELECT * INTO v_member FROM public.event_memberships m
    WHERE m.event_id = p_event_id AND m.user_id = v_user FOR UPDATE;
  IF FOUND AND v_member.status <> 'active' THEN
    RAISE EXCEPTION 'Event membership is inactive; contact the organizer' USING ERRCODE = 'P0001';
  END IF;

  -- Idempotent retry: return the already persisted outcome without consuming
  -- another invitation use, capacity slot, or ticket.
  SELECT * INTO v_reg FROM public.registrations r
    WHERE r.event_id = p_event_id AND r.participant_id = v_user;
  IF FOUND THEN
    SELECT * INTO v_ticket FROM public.tickets t WHERE t.registration_id = v_reg.id;
    RETURN jsonb_build_object('registration_id', v_reg.id, 'status', v_reg.status,
      'reference_number', v_reg.reference_number, 'ticket_id', v_ticket.id,
      'ticket_number', v_ticket.ticket_number, 'replayed', true);
  END IF;

  IF NOT v_event.joining_enabled OR v_event.lifecycle NOT IN ('upcoming', 'in-progress') THEN
    RAISE EXCEPTION 'Event is not accepting registrations' USING ERRCODE = 'P0001';
  END IF;
  IF v_event.registration_deadline IS NOT NULL AND v_event.registration_deadline <= v_now THEN
    RAISE EXCEPTION 'Registration deadline has passed' USING ERRCODE = 'P0001';
  END IF;
  -- eligibility_requirements is legacy free text, not an executable policy.
  -- Fail closed until a reviewed structured eligibility evaluator exists.
  IF NULLIF(btrim(v_event.eligibility_requirements), '') IS NOT NULL THEN
    RAISE EXCEPTION 'Organizer eligibility review is required; automated eligibility is not configured' USING ERRCODE = 'P0001';
  END IF;
  IF v_event.ticket_type = 'paid' OR COALESCE(v_event.ticket_price, 0) > 0 THEN
    RAISE EXCEPTION 'Paid registration is not enabled in this join operation' USING ERRCODE = 'P0001';
  END IF;
  IF p_ticket_option_id IS NULL AND EXISTS (
      SELECT 1 FROM public.ticket_options o WHERE o.event_id = p_event_id AND o.is_active) THEN
    RAISE EXCEPTION 'Select an active ticket option' USING ERRCODE = 'P0001';
  END IF;
  IF p_ticket_option_id IS NOT NULL THEN
    SELECT * INTO v_option FROM public.ticket_options o
      WHERE o.id = p_ticket_option_id AND o.event_id = p_event_id FOR UPDATE;
    IF NOT FOUND OR NOT v_option.is_active THEN
      RAISE EXCEPTION 'Ticket option is not active for this event' USING ERRCODE = 'P0001';
    END IF;
    IF v_option.type <> 'free' OR v_option.price > 0 THEN
      RAISE EXCEPTION 'Paid ticket option requires a verified payment workflow' USING ERRCODE = 'P0001';
    END IF;
    IF (v_option.sales_start IS NOT NULL AND v_option.sales_start > v_now)
        OR (v_option.sales_end IS NOT NULL AND v_option.sales_end < v_now) THEN
      RAISE EXCEPTION 'Ticket option is outside its sales window' USING ERRCODE = 'P0001';
    END IF;
    IF v_option.capacity IS NOT NULL AND (
        SELECT count(*) FROM public.registrations r WHERE r.ticket_option_id = p_ticket_option_id
          AND r.status IN ('registered', 'pending', 'confirmed')) >= v_option.capacity THEN
      RAISE EXCEPTION 'Ticket option capacity has been reached' USING ERRCODE = 'P0001';
    END IF;
  END IF;
  IF (p_invitation_code IS NULL) = (p_token_hash IS NULL) THEN
    RAISE EXCEPTION 'Provide exactly one invitation code or link token' USING ERRCODE = 'P0001';
  END IF;

  SELECT * INTO v_inv FROM public.invitations i
    WHERE i.event_id = p_event_id
      AND ((p_invitation_code IS NOT NULL AND i.code = p_invitation_code)
        OR (p_token_hash IS NOT NULL AND i.token_hash = p_token_hash))
    FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Invitation is invalid' USING ERRCODE = 'P0001'; END IF;
  IF v_inv.status <> 'active' OR (v_inv.expires_at IS NOT NULL AND v_inv.expires_at <= v_now)
      OR (v_inv.max_uses IS NOT NULL AND v_inv.used_count >= v_inv.max_uses) THEN
    RAISE EXCEPTION 'Invitation is expired, revoked, or exhausted' USING ERRCODE = 'P0001';
  END IF;
  IF v_inv.access_mode NOT IN ('both',
      CASE WHEN p_invitation_code IS NOT NULL THEN 'code' ELSE 'link' END)
      OR v_event.invitation_access_mode NOT IN ('both',
      CASE WHEN p_invitation_code IS NOT NULL THEN 'code' ELSE 'link' END) THEN
    RAISE EXCEPTION 'Invitation access mode does not permit this method' USING ERRCODE = 'P0001';
  END IF;
  IF v_event.capacity IS NOT NULL AND (
      SELECT count(*) FROM public.registrations r WHERE r.event_id = p_event_id
        AND r.status IN ('registered', 'pending', 'confirmed')) >= v_event.capacity THEN
    RAISE EXCEPTION 'Event capacity has been reached' USING ERRCODE = 'P0001';
  END IF;

  v_status := CASE WHEN v_inv.require_approval OR v_event.require_approval
    THEN 'pending' ELSE 'confirmed' END;
  INSERT INTO public.registrations
    (event_id, participant_id, invitation_id, invitation_code, ticket_option_id, status, reference_number)
    VALUES (p_event_id, v_user, v_inv.id, v_inv.code, p_ticket_option_id, v_status,
      'RSR-' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 12)))
    RETURNING * INTO v_reg;

  IF v_member.id IS NULL THEN
    INSERT INTO public.event_memberships (event_id, user_id, role, status)
      VALUES (p_event_id, v_user, 'participant',
        CASE WHEN v_status = 'confirmed' THEN 'active' ELSE 'invited' END);
  END IF;

  UPDATE public.invitations SET used_count = used_count + 1,
    status = CASE WHEN max_uses IS NOT NULL AND used_count + 1 >= max_uses
      THEN 'exhausted' ELSE status END
    WHERE id = v_inv.id;
  UPDATE public.events SET current_registrations = current_registrations + 1 WHERE id = p_event_id;

  IF v_status = 'confirmed' THEN
    IF p_ticket_option_id IS NOT NULL THEN
      UPDATE public.ticket_options SET sold_count = sold_count + 1 WHERE id = p_ticket_option_id;
    END IF;
    INSERT INTO public.tickets (registration_id, event_id, participant_id, ticket_number)
      VALUES (v_reg.id, p_event_id, v_user,
        'RST-' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 12)))
      RETURNING * INTO v_ticket;
  END IF;

  RETURN jsonb_build_object('registration_id', v_reg.id, 'status', v_reg.status,
    'reference_number', v_reg.reference_number, 'ticket_id', v_ticket.id,
    'ticket_number', v_ticket.ticket_number, 'replayed', false);
END;
$function$;

-- Organizer approval is a separate atomic transition; it alone activates the
-- participant membership and issues the confirmed ticket.
CREATE FUNCTION public.runshow_approve_registration(p_registration_id uuid)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, public, auth
AS $function$
DECLARE
  v_reg public.registrations%ROWTYPE;
  v_member public.event_memberships%ROWTYPE;
  v_event public.events%ROWTYPE;
  v_option public.ticket_options%ROWTYPE;
  v_ticket public.tickets%ROWTYPE;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Sign in is required' USING ERRCODE = 'P0001'; END IF;
  SELECT * INTO v_reg FROM public.registrations r WHERE r.id = p_registration_id;
  IF NOT FOUND OR NOT public.runshow_is_event_staff(v_reg.event_id) THEN
    RAISE EXCEPTION 'Registration not found or not authorized' USING ERRCODE = 'P0001';
  END IF;
  SELECT * INTO v_event FROM public.events e WHERE e.id = v_reg.event_id FOR UPDATE;
  SELECT * INTO v_reg FROM public.registrations r WHERE r.id = p_registration_id FOR UPDATE;
  IF v_reg.status = 'confirmed' THEN
    SELECT * INTO v_ticket FROM public.tickets t WHERE t.registration_id = v_reg.id;
    RETURN jsonb_build_object('registration_id', v_reg.id, 'status', v_reg.status,
      'ticket_id', v_ticket.id, 'ticket_number', v_ticket.ticket_number, 'replayed', true);
  END IF;
  IF v_reg.status <> 'pending' THEN
    RAISE EXCEPTION 'Only pending registrations can be approved' USING ERRCODE = 'P0001';
  END IF;
  SELECT * INTO v_member FROM public.event_memberships m
    WHERE m.event_id = v_reg.event_id AND m.user_id = v_reg.participant_id FOR UPDATE;
  IF NOT FOUND OR v_member.role <> 'participant' OR v_member.status NOT IN ('invited', 'active') THEN
    RAISE EXCEPTION 'Participant membership is not eligible for approval' USING ERRCODE = 'P0001';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.profiles p
      WHERE p.id = v_reg.participant_id AND p.account_status = 'active') THEN
    RAISE EXCEPTION 'Participant account is not active' USING ERRCODE = 'P0001';
  END IF;
  IF v_event.capacity IS NOT NULL AND (
      SELECT count(*) FROM public.registrations r WHERE r.event_id = v_reg.event_id
        AND r.status IN ('registered', 'pending', 'confirmed')) > v_event.capacity THEN
    RAISE EXCEPTION 'Event capacity changed; registration cannot be approved yet' USING ERRCODE = 'P0001';
  END IF;
  IF v_reg.ticket_option_id IS NOT NULL THEN
    SELECT * INTO v_option FROM public.ticket_options o
      WHERE o.id = v_reg.ticket_option_id AND o.event_id = v_reg.event_id FOR UPDATE;
    IF NOT FOUND OR NOT v_option.is_active OR v_option.type <> 'free' OR v_option.price > 0 THEN
      RAISE EXCEPTION 'Ticket option is no longer eligible for approval' USING ERRCODE = 'P0001';
    END IF;
    IF v_option.capacity IS NOT NULL AND (
        SELECT count(*) FROM public.registrations r WHERE r.ticket_option_id = v_option.id
          AND r.status IN ('registered', 'pending', 'confirmed')) > v_option.capacity THEN
      RAISE EXCEPTION 'Ticket option capacity changed; registration cannot be approved yet' USING ERRCODE = 'P0001';
    END IF;
    UPDATE public.ticket_options SET sold_count = sold_count + 1 WHERE id = v_option.id;
  END IF;
  IF v_event.ticket_type = 'paid' OR COALESCE(v_event.ticket_price, 0) > 0 THEN
    RAISE EXCEPTION 'Paid registration requires a separate verified payment workflow' USING ERRCODE = 'P0001';
  END IF;
  UPDATE public.event_memberships SET status = 'active'
    WHERE id = v_member.id AND status = 'invited';
  UPDATE public.registrations SET status = 'confirmed', approved_at = now(), approved_by = auth.uid()
    WHERE id = v_reg.id RETURNING * INTO v_reg;
  INSERT INTO public.tickets (registration_id, event_id, participant_id, ticket_number)
    VALUES (v_reg.id, v_reg.event_id, v_reg.participant_id,
      'RST-' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 12)))
    ON CONFLICT (registration_id) DO NOTHING;
  SELECT * INTO v_ticket FROM public.tickets t WHERE t.registration_id = v_reg.id;
  RETURN jsonb_build_object('registration_id', v_reg.id, 'status', v_reg.status,
    'ticket_id', v_ticket.id, 'ticket_number', v_ticket.ticket_number, 'replayed', false);
END;
$function$;
REVOKE ALL ON FUNCTION public.runshow_join_event(uuid, text, text, uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.runshow_approve_registration(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.runshow_join_event(uuid, text, text, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.runshow_approve_registration(uuid) TO authenticated;

CREATE TRIGGER profiles_touch_updated_at BEFORE UPDATE ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.runshow_touch_updated_at();
CREATE TRIGGER events_touch_updated_at BEFORE UPDATE ON public.events
  FOR EACH ROW EXECUTE FUNCTION public.runshow_touch_updated_at();
CREATE TRIGGER memberships_touch_updated_at BEFORE UPDATE ON public.event_memberships
  FOR EACH ROW EXECUTE FUNCTION public.runshow_touch_updated_at();
CREATE TRIGGER ticket_options_touch_updated_at BEFORE UPDATE ON public.ticket_options
  FOR EACH ROW EXECUTE FUNCTION public.runshow_touch_updated_at();
CREATE TRIGGER registrations_touch_updated_at BEFORE UPDATE ON public.registrations
  FOR EACH ROW EXECUTE FUNCTION public.runshow_touch_updated_at();
CREATE TRIGGER team_assignments_touch_updated_at BEFORE UPDATE ON public.team_assignments
  FOR EACH ROW EXECUTE FUNCTION public.runshow_touch_updated_at();
CREATE TRIGGER tasks_touch_updated_at BEFORE UPDATE ON public.tasks
  FOR EACH ROW EXECUTE FUNCTION public.runshow_touch_updated_at();
CREATE TRIGGER partners_touch_updated_at BEFORE UPDATE ON public.partners
  FOR EACH ROW EXECUTE FUNCTION public.runshow_touch_updated_at();
CREATE TRIGGER risks_touch_updated_at BEFORE UPDATE ON public.risks
  FOR EACH ROW EXECUTE FUNCTION public.runshow_touch_updated_at();
CREATE TRIGGER recommendations_touch_updated_at BEFORE UPDATE ON public.recommendations
  FOR EACH ROW EXECUTE FUNCTION public.runshow_touch_updated_at();
CREATE TRIGGER incidents_touch_updated_at BEFORE UPDATE ON public.incidents
  FOR EACH ROW EXECUTE FUNCTION public.runshow_touch_updated_at();
CREATE TRIGGER support_tickets_touch_updated_at BEFORE UPDATE ON public.support_tickets
  FOR EACH ROW EXECUTE FUNCTION public.runshow_touch_updated_at();

-- RLS is enabled on every application and import-ledger table.
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.invitations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.event_memberships ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.event_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ticket_options ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.registrations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tickets ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.team_assignments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tasks ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.partners ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.risks ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.recommendations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.incidents ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.responder_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.incident_assignments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.incident_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.incident_activities ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.in_app_notifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.task_comments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.support_tickets ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.support_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.event_metric_snapshots ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.event_intelligence_analyses ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.event_intelligence_recommendations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.event_recommendation_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.legacy_import_batches ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.legacy_id_mappings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.legacy_import_checkpoints ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.legacy_import_quarantine ENABLE ROW LEVEL SECURITY;

CREATE POLICY profiles_read_self_or_staff ON public.profiles FOR SELECT TO authenticated
  USING (id = (SELECT auth.uid()) OR public.runshow_can_view_profile(id));
CREATE POLICY profiles_insert_self ON public.profiles FOR INSERT TO authenticated
  WITH CHECK (id = (SELECT auth.uid()));
CREATE POLICY profiles_update_self ON public.profiles FOR UPDATE TO authenticated
  USING (id = (SELECT auth.uid())) WITH CHECK (id = (SELECT auth.uid()));

CREATE POLICY events_read_authorized ON public.events FOR SELECT TO authenticated
  USING (public.runshow_is_event_staff(id)
    OR public.runshow_is_event_participant(id));
CREATE POLICY events_insert_owner ON public.events FOR INSERT TO authenticated
  WITH CHECK (owner_user_id = (SELECT auth.uid()));
CREATE POLICY events_update_manager ON public.events FOR UPDATE TO authenticated
  USING (public.runshow_can_manage_event(id)) WITH CHECK (public.runshow_can_manage_event(id));

CREATE POLICY memberships_read_self_or_staff ON public.event_memberships FOR SELECT TO authenticated
  USING (user_id = (SELECT auth.uid()) OR public.runshow_is_event_staff(event_id));
-- Only the event owner can assign/revoke event roles; a role string from a client is not authority.
CREATE POLICY memberships_insert_owner ON public.event_memberships FOR INSERT TO authenticated
  WITH CHECK (public.runshow_is_event_owner(event_id));
CREATE POLICY memberships_update_owner ON public.event_memberships FOR UPDATE TO authenticated
  USING (public.runshow_is_event_owner(event_id)) WITH CHECK (public.runshow_is_event_owner(event_id));
CREATE POLICY memberships_delete_owner ON public.event_memberships FOR DELETE TO authenticated
  USING (public.runshow_is_event_owner(event_id));

CREATE POLICY invitations_manage_event ON public.invitations FOR ALL TO authenticated
  USING (public.runshow_can_manage_event(event_id))
  WITH CHECK (public.runshow_can_manage_event(event_id));

CREATE POLICY sessions_read_staff_or_participant ON public.event_sessions FOR SELECT TO authenticated
  USING (public.runshow_is_event_staff(event_id)
    OR public.runshow_is_event_participant(event_id));
CREATE POLICY sessions_manage_staff ON public.event_sessions FOR ALL TO authenticated
  USING (public.runshow_is_event_staff(event_id)) WITH CHECK (public.runshow_is_event_staff(event_id));
CREATE POLICY ticket_options_manage_staff ON public.ticket_options FOR ALL TO authenticated
  USING (public.runshow_is_event_staff(event_id)) WITH CHECK (public.runshow_is_event_staff(event_id));

CREATE POLICY registrations_read_self_or_staff ON public.registrations FOR SELECT TO authenticated
  USING (participant_id = (SELECT auth.uid()) OR public.runshow_is_event_staff(event_id));
CREATE POLICY tickets_read_self_or_staff ON public.tickets FOR SELECT TO authenticated
  USING (participant_id = (SELECT auth.uid()) OR public.runshow_is_event_staff(event_id));

CREATE POLICY team_assignments_read_staff_or_assignee ON public.team_assignments FOR SELECT TO authenticated
  USING (public.runshow_is_event_staff(event_id) OR user_id = (SELECT auth.uid()));
CREATE POLICY team_assignments_manage_staff ON public.team_assignments FOR ALL TO authenticated
  USING (public.runshow_is_event_staff(event_id)) WITH CHECK (public.runshow_is_event_staff(event_id));
CREATE POLICY tasks_read_staff_or_owner ON public.tasks FOR SELECT TO authenticated
  USING (public.runshow_is_event_staff(event_id) OR owner_id = (SELECT auth.uid()));
CREATE POLICY tasks_manage_staff ON public.tasks FOR ALL TO authenticated
  USING (public.runshow_is_event_staff(event_id)) WITH CHECK (public.runshow_is_event_staff(event_id));
CREATE POLICY partners_manage_staff ON public.partners FOR ALL TO authenticated
  USING (public.runshow_is_event_staff(event_id)) WITH CHECK (public.runshow_is_event_staff(event_id));
CREATE POLICY risks_manage_staff ON public.risks FOR ALL TO authenticated
  USING (public.runshow_is_event_staff(event_id)) WITH CHECK (public.runshow_is_event_staff(event_id));
CREATE POLICY recommendations_manage_staff ON public.recommendations FOR ALL TO authenticated
  USING (public.runshow_is_event_staff(event_id)) WITH CHECK (public.runshow_is_event_staff(event_id));

CREATE POLICY incidents_read_reporter_or_staff ON public.incidents FOR SELECT TO authenticated
  USING (reporter_id = (SELECT auth.uid()) OR public.runshow_is_event_staff(event_id));
CREATE POLICY incidents_insert_reporter_or_staff ON public.incidents FOR INSERT TO authenticated
  WITH CHECK (reporter_id = (SELECT auth.uid()) AND
    (public.runshow_is_event_participant(event_id)
      OR public.runshow_is_event_staff(event_id)));
CREATE POLICY incidents_update_staff ON public.incidents FOR UPDATE TO authenticated
  USING (public.runshow_is_event_staff(event_id)) WITH CHECK (
    public.runshow_is_event_staff(event_id) AND
    (assigned_responder_id IS NULL OR
      public.runshow_is_active_event_responder(event_id, assigned_responder_id)));

CREATE POLICY responder_profiles_read_self_or_event_staff ON public.responder_profiles FOR SELECT TO authenticated
  USING (user_id = (SELECT auth.uid()) OR public.runshow_can_view_profile(user_id));
CREATE POLICY responder_profiles_insert_self ON public.responder_profiles FOR INSERT TO authenticated
  WITH CHECK (user_id = (SELECT auth.uid()));
CREATE POLICY responder_profiles_update_self ON public.responder_profiles FOR UPDATE TO authenticated
  USING (user_id = (SELECT auth.uid())) WITH CHECK (user_id = (SELECT auth.uid()));

CREATE POLICY incident_assignments_manage_staff ON public.incident_assignments FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM public.incidents i
    WHERE i.id = incident_id AND public.runshow_is_event_staff(i.event_id)))
  WITH CHECK (EXISTS (SELECT 1 FROM public.incidents i
    WHERE i.id = incident_id AND public.runshow_is_event_staff(i.event_id)
      AND assigned_by = (SELECT auth.uid())
      AND public.runshow_is_active_event_responder(i.event_id, responder_id)));
CREATE POLICY incident_messages_read_authorized ON public.incident_messages FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.incidents i WHERE i.id = incident_id AND
    (public.runshow_is_event_staff(i.event_id)
      OR (i.reporter_id = (SELECT auth.uid()) AND is_internal = false))));
CREATE POLICY incident_messages_insert_authorized ON public.incident_messages FOR INSERT TO authenticated
  WITH CHECK (sender_id = (SELECT auth.uid()) AND EXISTS (
    SELECT 1 FROM public.incidents i WHERE i.id = incident_id AND
      (public.runshow_is_event_staff(i.event_id)
        OR (i.reporter_id = (SELECT auth.uid()) AND is_internal = false))));
CREATE POLICY incident_activities_read_staff ON public.incident_activities FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.incidents i
    WHERE i.id = incident_id AND public.runshow_is_event_staff(i.event_id)));
CREATE POLICY incident_activities_insert_staff ON public.incident_activities FOR INSERT TO authenticated
  WITH CHECK (actor_id = (SELECT auth.uid()) AND EXISTS (
    SELECT 1 FROM public.incidents i
    WHERE i.id = incident_id AND public.runshow_is_event_staff(i.event_id)));

CREATE POLICY in_app_notifications_read_self ON public.in_app_notifications FOR SELECT TO authenticated
  USING (user_id = (SELECT auth.uid()));
CREATE POLICY in_app_notifications_update_self ON public.in_app_notifications FOR UPDATE TO authenticated
  USING (user_id = (SELECT auth.uid())) WITH CHECK (user_id = (SELECT auth.uid()));
CREATE POLICY notifications_read_self ON public.notifications FOR SELECT TO authenticated
  USING (user_id = (SELECT auth.uid()));
CREATE POLICY notifications_update_self ON public.notifications FOR UPDATE TO authenticated
  USING (user_id = (SELECT auth.uid())) WITH CHECK (user_id = (SELECT auth.uid()));

CREATE POLICY task_comments_read_staff ON public.task_comments FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.tasks t
    WHERE t.id = task_id AND public.runshow_is_event_staff(t.event_id)));
CREATE POLICY task_comments_insert_staff ON public.task_comments FOR INSERT TO authenticated
  WITH CHECK (user_id = (SELECT auth.uid()) AND EXISTS (
    SELECT 1 FROM public.tasks t WHERE t.id = task_id AND public.runshow_is_event_staff(t.event_id)));

CREATE POLICY support_tickets_read_self_or_staff ON public.support_tickets FOR SELECT TO authenticated
  USING (participant_id = (SELECT auth.uid()) OR public.runshow_is_event_staff(event_id));
CREATE POLICY support_tickets_insert_self ON public.support_tickets FOR INSERT TO authenticated
  WITH CHECK (participant_id = (SELECT auth.uid())
    AND public.runshow_is_event_participant(event_id));
CREATE POLICY support_tickets_update_staff ON public.support_tickets FOR UPDATE TO authenticated
  USING (public.runshow_is_event_staff(event_id)) WITH CHECK (
    public.runshow_is_event_staff(event_id) AND
    (assignee_id IS NULL OR public.runshow_is_active_event_responder(event_id, assignee_id)));
CREATE POLICY support_messages_read_self_or_staff ON public.support_messages FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.support_tickets st WHERE st.id = ticket_id
    AND (st.participant_id = (SELECT auth.uid()) OR public.runshow_is_event_staff(st.event_id))));
CREATE POLICY support_messages_insert_self_or_staff ON public.support_messages FOR INSERT TO authenticated
  WITH CHECK (sender_id = (SELECT auth.uid()) AND EXISTS (
    SELECT 1 FROM public.support_tickets st WHERE st.id = ticket_id AND
      (public.runshow_is_event_staff(st.event_id)
        OR (st.participant_id = (SELECT auth.uid()) AND is_internal = false
          AND sender_role = 'participant'))));

CREATE POLICY snapshots_read_staff ON public.event_metric_snapshots FOR SELECT TO authenticated
  USING (public.runshow_is_event_staff(event_id));
CREATE POLICY analyses_read_staff ON public.event_intelligence_analyses FOR SELECT TO authenticated
  USING (public.runshow_is_event_staff(event_id));
CREATE POLICY intelligence_recs_read_staff ON public.event_intelligence_recommendations FOR SELECT TO authenticated
  USING (public.runshow_is_event_staff(event_id));
CREATE POLICY recommendation_history_read_staff ON public.event_recommendation_history FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.event_intelligence_recommendations r
    WHERE r.id = recommendation_id AND public.runshow_is_event_staff(r.event_id)));
CREATE POLICY recommendation_history_insert_staff ON public.event_recommendation_history FOR INSERT TO authenticated
  WITH CHECK (user_id = (SELECT auth.uid()) AND EXISTS (
    SELECT 1 FROM public.event_intelligence_recommendations r
    WHERE r.id = recommendation_id AND public.runshow_is_event_staff(r.event_id)));

-- Import ledger/mapping tables intentionally have RLS enabled and no client policies/grants.

CREATE VIEW public.public_event_catalog WITH (security_barrier = true) AS
SELECT id, name, description, event_type, format, start_at, end_at, timezone,
       venue, audience, registration_target, capacity,
       registration_deadline, banner_image_url, tags
FROM public.events
WHERE visibility = 'public' AND lifecycle IN ('upcoming', 'in-progress') AND joining_enabled;

-- Direct browser access is intentionally read-focused for registration/ticket and AI records.
-- Remove inherited/default PUBLIC grants before applying the narrow privileges below.
REVOKE ALL ON TABLE public.profiles, public.events, public.invitations, public.event_memberships,
  public.event_sessions, public.ticket_options, public.registrations, public.tickets,
  public.team_assignments, public.tasks, public.partners, public.risks, public.recommendations,
  public.incidents, public.responder_profiles, public.incident_assignments, public.incident_messages,
  public.incident_activities, public.in_app_notifications, public.task_comments, public.notifications,
  public.support_tickets, public.support_messages, public.event_metric_snapshots,
  public.event_intelligence_analyses, public.event_intelligence_recommendations,
  public.event_recommendation_history, public.legacy_import_batches, public.legacy_id_mappings,
  public.legacy_import_checkpoints, public.legacy_import_quarantine
FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.public_event_catalog FROM PUBLIC, anon, authenticated;

GRANT SELECT ON public.profiles, public.events, public.event_memberships, public.event_sessions,
  public.ticket_options, public.registrations, public.tickets,
  public.team_assignments, public.tasks, public.partners, public.risks, public.recommendations,
  public.incidents, public.responder_profiles, public.incident_assignments, public.incident_messages,
  public.incident_activities, public.in_app_notifications, public.task_comments, public.notifications,
  public.support_tickets, public.support_messages, public.event_metric_snapshots,
  public.event_intelligence_analyses, public.event_intelligence_recommendations,
  public.event_recommendation_history TO authenticated;
-- Invitation hashes are bearer-equivalent input to the join RPC. Organizers may
-- copy codes and metadata but cannot read token_hash through PostgREST.
GRANT SELECT (id, event_id, code, access_mode, require_approval, created_by, created_at,
  expires_at, max_uses, used_count, status, revoked_at, revoked_by, outreach_source,
  campaign_name) ON public.invitations TO authenticated;
GRANT INSERT (id, display_name, contact_phone, avatar_url) ON public.profiles TO authenticated;
GRANT UPDATE (display_name, contact_phone, avatar_url) ON public.profiles TO authenticated;
REVOKE INSERT, UPDATE, DELETE ON public.events FROM authenticated;
GRANT INSERT (owner_user_id, name, description, event_type, format, start_at, end_at,
  timezone, venue, meeting_url, joining_instructions, audience, expected_attendance,
  registration_target, capacity, lifecycle, visibility, ticket_type, ticket_price,
  ticket_currency, registration_deadline, cancellation_policy, eligibility_requirements,
  banner_image_url, organizer_institution, tags, joining_enabled, invitation_access_mode,
  require_approval) ON public.events TO authenticated;
GRANT INSERT, UPDATE ON public.event_memberships TO authenticated;
REVOKE DELETE ON public.event_memberships FROM authenticated;
GRANT INSERT, UPDATE, DELETE ON public.event_sessions, public.team_assignments, public.tasks,
  public.partners, public.risks, public.recommendations,
  public.incident_assignments TO authenticated;
GRANT UPDATE ON public.incidents, public.support_tickets TO authenticated;
REVOKE DELETE ON public.incidents, public.support_tickets FROM authenticated;
GRANT INSERT (reference_number, event_id, reporter_id, category, title, description,
  zone, affected_session_id, urgency, contact_preference) ON public.incidents TO authenticated;
GRANT INSERT (event_id, participant_id, title, description, category, reference_number)
  ON public.support_tickets TO authenticated;
GRANT INSERT (event_id, name, description, type, price, currency, capacity,
  sales_start, sales_end, is_active) ON public.ticket_options TO authenticated;
GRANT UPDATE (name, description, type, price, currency, capacity, sales_start,
  sales_end, is_active) ON public.ticket_options TO authenticated;
REVOKE UPDATE, DELETE ON public.ticket_options FROM authenticated;
REVOKE INSERT, UPDATE, DELETE ON public.invitations FROM authenticated;
GRANT UPDATE (name, description, event_type, format, start_at, end_at, timezone, venue,
  meeting_url, joining_instructions, audience, expected_attendance, registration_target,
  capacity, lifecycle, visibility, ticket_type, ticket_price, ticket_currency,
  registration_deadline, cancellation_policy, eligibility_requirements, banner_image_url,
  organizer_institution, tags, joining_enabled, invitation_access_mode, require_approval)
ON public.events TO authenticated;
GRANT INSERT ON public.incident_messages, public.incident_activities, public.task_comments,
  public.support_messages, public.event_recommendation_history TO authenticated;
GRANT UPDATE (read) ON public.in_app_notifications, public.notifications TO authenticated;
GRANT INSERT ON public.responder_profiles TO authenticated;
GRANT UPDATE (skills, zones, availability) ON public.responder_profiles TO authenticated;
GRANT SELECT ON public.public_event_catalog TO anon, authenticated;

-- Server-only importer/API role; never put its key in a browser bundle.
GRANT SELECT, INSERT, UPDATE, DELETE ON public.profiles, public.events, public.event_memberships,
  public.invitations, public.event_sessions, public.ticket_options, public.registrations,
  public.tickets, public.team_assignments, public.tasks, public.partners, public.risks,
  public.recommendations, public.incidents, public.responder_profiles, public.incident_assignments,
  public.incident_messages, public.incident_activities, public.in_app_notifications,
  public.task_comments, public.notifications, public.support_tickets, public.support_messages,
  public.event_metric_snapshots, public.event_intelligence_analyses,
  public.event_intelligence_recommendations, public.event_recommendation_history,
  public.legacy_import_batches, public.legacy_id_mappings, public.legacy_import_checkpoints,
  public.legacy_import_quarantine TO service_role;

COMMIT;
