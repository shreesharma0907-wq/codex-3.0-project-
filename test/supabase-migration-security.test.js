import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const sql = readFileSync(new URL('../supabase/migrations/202610130001_runshow_public_schema.sql', import.meta.url), 'utf8');
const functionBody = name => {
  const start = sql.indexOf(`CREATE FUNCTION public.${name}(`);
  assert.notEqual(start, -1, `missing function ${name}`);
  const end = sql.indexOf('$function$;', start);
  assert.notEqual(end, -1, `unterminated function ${name}`);
  return sql.slice(start, end);
};
const policyBody = name => {
  const start = sql.indexOf(`CREATE POLICY ${name} `);
  assert.notEqual(start, -1, `missing policy ${name}`);
  const end = sql.indexOf(';', start);
  return sql.slice(start, end);
};

test('participant access uses explicit confirmation and active event membership only', () => {
  const body = functionBody('runshow_is_event_participant');
  assert.match(body, /p\.account_status\s*=\s*'active'/);
  assert.match(body, /m\.status\s*=\s*'active'/);
  assert.match(body, /m\.role\s*=\s*'participant'/);
  assert.match(body, /r\.status\s*=\s*'confirmed'/);
  for (const nonApprovedStatus of ['registered', 'pending', 'waitlisted', 'invited', 'cancelled']) {
    assert.doesNotMatch(body, new RegExp(`r\\.status\\s*(?:=|IN)[^;]*'${nonApprovedStatus}'`));
  }
  assert.match(sql, /Legacy `registered` is intentionally not an approved state/);
});

test('participant and staff authorization policies remain scoped to the row event', () => {
  for (const policy of ['events_read_authorized', 'sessions_read_staff_or_participant',
    'incidents_insert_reporter_or_staff', 'support_tickets_insert_self']) {
    assert.match(policyBody(policy), /event_id|\(id\)/, `${policy} must scope to an event`);
  }
  const participant = functionBody('runshow_is_event_participant');
  assert.match(participant, /m\.event_id\s*=\s*p_event_id/);
  assert.match(participant, /r\.event_id\s*=\s*m\.event_id/);
});

test('incident and support assignees must be active responders in the same event', () => {
  const responder = functionBody('runshow_is_active_event_responder');
  assert.match(responder, /m\.event_id\s*=\s*p_event_id/);
  assert.match(responder, /m\.user_id\s*=\s*p_user_id/);
  assert.match(responder, /m\.status\s*=\s*'active'/);
  assert.match(responder, /p\.account_status\s*=\s*'active'/);
  assert.match(policyBody('incidents_update_staff'), /runshow_is_active_event_responder\(event_id, assigned_responder_id\)/);
  assert.match(policyBody('support_tickets_update_staff'), /runshow_is_active_event_responder\(event_id, assignee_id\)/);
  const assignment = policyBody('incident_assignments_manage_staff');
  assert.match(assignment, /assigned_by\s*=\s*\(SELECT auth\.uid\(\)\)/);
  assert.match(assignment, /runshow_is_active_event_responder\(i\.event_id, responder_id\)/);

  // Role matrix contract: staff authorization is event-bound, while a responder
  // must be active and either operational staff or an available responder.
  assert.match(responder, /runshow_is_event_staff\(p_event_id\)/); // owner/assigned organizer or sub-organizer
  assert.match(responder, /m\.event_id\s*=\s*p_event_id/); // unrelated/cross-event staff denied
  assert.match(responder, /m\.status\s*=\s*'active'/); // revoked/suspended member denied
  assert.match(responder, /m\.role IN \('organizer', 'sub_organizer'\)/);
  assert.match(responder, /rp\.availability <> 'offline'/); // participants need explicit responder profile
});

test('assignment policy contract distinguishes owners, assigned staff, outsiders, participants, and revoked members', () => {
  const staff = functionBody('runshow_is_event_staff');
  assert.match(staff, /runshow_is_event_owner\(p_event_id\)/); // authorized event owner
  assert.match(staff, /m\.event_id\s*=\s*p_event_id/); // sub-organizer only for their assigned event
  assert.match(staff, /m\.role IN \('organizer', 'sub_organizer'\)/);
  assert.match(staff, /m\.status\s*=\s*'active'/); // excludes revoked/suspended memberships
  assert.doesNotMatch(staff, /m\.role\s*=\s*'participant'/); // participants cannot assign

  const assignment = policyBody('incident_assignments_manage_staff');
  assert.match(assignment, /i\.id = incident_id AND public\.runshow_is_event_staff\(i\.event_id\)/);
  assert.match(assignment, /assigned_by = \(SELECT auth\.uid\(\)\)/);
  assert.match(assignment, /runshow_is_active_event_responder\(i\.event_id, responder_id\)/);
});

test('join and approval RPCs are transactional, idempotent, and fail closed', () => {
  const join = functionBody('runshow_join_event');
  assert.ok(join.indexOf('FROM public.events e WHERE e.id = p_event_id FOR UPDATE') < join.indexOf('FROM public.invitations i'));
  assert.match(join, /FROM public\.invitations i[\s\S]*?FOR UPDATE/);
  assert.match(join, /v_inv\.used_count >= v_inv\.max_uses/);
  assert.match(join, /r\.status IN \('registered', 'pending', 'confirmed'\)/);
  assert.match(join, /ticket_option_id = p_ticket_option_id[\s\S]*?>= v_option\.capacity/);
  assert.match(join, /v_option\.type <> 'free'/);
  assert.match(join, /ticket_option_id, status, reference_number\)[\s\S]*?v_inv\.id, v_inv\.code, p_ticket_option_id, v_status/);
  assert.match(join, /eligibility_requirements[\s\S]*?automated eligibility is not configured/);
  assert.match(join, /SELECT \* INTO v_reg[\s\S]*?replayed', true/);
  assert.match(join, /IF v_status = 'confirmed' THEN[\s\S]*?INSERT INTO public\.tickets/);
  assert.match(join, /status = CASE WHEN max_uses IS NOT NULL AND used_count \+ 1 >= max_uses/);

  const approval = functionBody('runshow_approve_registration');
  assert.match(approval, /runshow_is_event_staff\(v_reg\.event_id\)/);
  assert.match(approval, /status <> 'pending'/);
  assert.match(approval, /status = 'active'/);
  assert.match(approval, /approved_by = auth\.uid\(\)/);
  assert.match(approval, /ON CONFLICT \(registration_id\) DO NOTHING/);
});

test('browser roles cannot write registration or ticket rows directly', () => {
  assert.doesNotMatch(sql, /GRANT\s+(?:INSERT|UPDATE|DELETE|ALL)[^;]*public\.registrations\b/i);
  assert.doesNotMatch(sql, /GRANT\s+(?:INSERT|UPDATE|DELETE|ALL)[^;]*public\.tickets\b/i);
  assert.match(sql, /GRANT EXECUTE ON FUNCTION public\.runshow_join_event\(uuid, text, text, uuid\) TO authenticated/);
  assert.match(sql, /GRANT EXECUTE ON FUNCTION public\.runshow_approve_registration\(uuid\) TO authenticated/);
});

test('event staff cannot read invitation bearer-token hashes', () => {
  const authenticatedGrant = sql.match(/GRANT SELECT ON public\.profiles[\s\S]*?TO authenticated;/)?.[0] || '';
  assert.doesNotMatch(authenticatedGrant, /public\.invitations/);
  const invitationColumns = sql.match(/GRANT SELECT \(([^)]*)\) ON public\.invitations TO authenticated/)?.[1] || '';
  assert.ok(invitationColumns.length > 0);
  assert.doesNotMatch(invitationColumns, /\btoken_hash\b/);
  assert.match(sql, /public\.invitations, public\.event_sessions[\s\S]*TO service_role/);
});

test('import ledger checkpoints and quarantine are RLS-protected and service-role-only', () => {
  for (const table of ['legacy_import_batches', 'legacy_id_mappings',
    'legacy_import_checkpoints', 'legacy_import_quarantine']) {
    assert.match(sql, new RegExp(`ALTER TABLE public\\.${table} ENABLE ROW LEVEL SECURITY`));
    assert.match(sql, new RegExp(`public\\.${table}`));
  }
  assert.match(sql, /public\.legacy_import_checkpoints,[\s\S]*?public\.legacy_import_quarantine TO service_role/);
  assert.doesNotMatch(sql, /GRANT\s+(?:SELECT|INSERT|UPDATE|DELETE|ALL)[^;]*legacy_import_(?:batches|mappings|checkpoints|quarantine)[^;]*TO authenticated/i);
});

test('anonymous event catalog is a narrow public allowlist with publication filters', () => {
  const viewStart = sql.indexOf('CREATE VIEW public.public_event_catalog');
  const viewEnd = sql.indexOf(';', viewStart);
  const view = sql.slice(viewStart, viewEnd);
  assert.match(view, /security_barrier\s*=\s*true/);
  assert.match(view, /visibility\s*=\s*'public'/);
  assert.match(view, /lifecycle IN \('upcoming', 'in-progress'\)/);
  assert.match(view, /joining_enabled/);
  for (const privateField of ['owner_user_id', 'organizer_institution', 'meeting_url',
    'joining_instructions', 'eligibility_requirements', 'current_registrations']) {
    assert.doesNotMatch(view, new RegExp(`\\b${privateField}\\b`));
  }
  assert.match(sql, /GRANT SELECT ON public\.public_event_catalog TO anon, authenticated/);
});

test('prepared migration is additive in public and diagnostic SQL remains read-only', () => {
  const applicationTables = [...sql.matchAll(/CREATE TABLE public\./g)];
  assert.equal(applicationTables.length, 31);
  assert.doesNotMatch(sql, /CREATE\s+(?:TABLE|FUNCTION|TRIGGER)\s+auth\./i);

  const diagnostic = readFileSync(new URL('../supabase/diagnostics/inspect-existing-project.sql', import.meta.url), 'utf8')
    .replace(/--[^\n]*/g, '');
  assert.doesNotMatch(diagnostic, /\b(?:CREATE|ALTER|DROP|INSERT|UPDATE|DELETE|TRUNCATE|GRANT|REVOKE)\b/i);
  assert.match(diagnostic, /column_privileges/);
  assert.match(diagnostic, /routine_privileges/);
  assert.match(diagnostic, /table_privileges/);
  assert.match(diagnostic, /pg_default_acl/);
  assert.match(diagnostic, /pg_get_viewdef/);
});
