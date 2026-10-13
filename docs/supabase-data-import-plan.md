# RUNSHOW SQLite → Supabase import plan (prepared, not executed)

## Status and safety boundary

This is a proposal based on the repository's SQLite schema, `npm run db:inventory`, and the supplied preliminary Supabase findings. The live Supabase project has **not** been queried by this work. The reported 27 `auth` base tables, zero `public` base tables, and zero `public` policies are preliminary only. The complete schema/policy output and the remaining non-system schemas must be reviewed before applying any DDL. The migration file is not applied and this plan does not connect RUNSHOW to Supabase.

The source remains `.data/runshow.sqlite` (or `RUNSHOW_DB_PATH`). The latest `npm run db:inventory` run during this preparation opened it read-only and reported zero SQLite foreign-key violations. No data was changed, copied, or exported.

## Proposed migration files

- `supabase/migrations/202610130001_runshow_public_schema.sql` — proposed `public` schema, foreign keys, checks, indexes, timestamp triggers, RLS helpers/policies, limited public event view, and private legacy-import batch/mapping/checkpoint/quarantine tables. It references `auth.users` but creates/alters nothing in `auth`.
- `docs/supabase-data-import-plan.md` — this mapping, import/reconciliation strategy, and verification gate.
- `scripts/supabase-import-preflight.mjs` — executable, read-only dry-run inventory/reconciliation preflight; it does not connect to Supabase or import rows. `--apply` intentionally exits without writing because the PostgreSQL adapter and verified identity mapping are not implemented.

The migration defines 27 domain tables plus four private import-ledger tables (31 public tables total). It uses UUID primary keys for application entities. The intended importer uses stable UUIDv5 IDs with the fixed namespace emitted by the dry-run tool for non-Auth entities; every mapping is recorded in `legacy_id_mappings`. Auth IDs must come only from an independently verified mapping. This is a versioned, one-time migration file: the migration runner's version history makes deployment repeatable; object-name conflicts intentionally fail rather than being hidden by `IF NOT EXISTS`. Do not paste/replay the file manually. No migration has been applied. Do not run it until preflight conditions below are met.

## Table-by-table mapping

| SQLite source | Proposed Supabase target | Import/reconciliation rule |
|---|---|---|
| `users` (56; point-in-time inventory) | `auth.users` identity reference + `profiles` + event-specific `event_memberships` | Never import `password_hash`. Map only to an existing Auth identity with a verified identity match, or let that person complete Supabase sign-up/recovery first. Do not translate the SQLite global `role` directly into a global Supabase role. Create memberships only from reviewed event relationships. Quarantine unverified/demo/questionable accounts. |
| `auth_sessions` (8) | None | Do not import. Invalidate legacy sessions and require a fresh Supabase Auth login. Never copy session IDs or tokens. |
| `events` (1) | `events` | Preserve event fields and status; map owner through an explicit verified `users.id → auth.users.id` decision. Do not select an arbitrary organizer. Existing SQLite event has an owner FK, but the external identity match is unresolved. |
| `event_sessions` (2) | `event_sessions` | Map `event_id`; preserve schedule and nullable venue/join URL. |
| `team_assignments` (2) | `team_assignments` and `event_memberships` | Map user/event; create membership only after account and role review. The target membership table can retain `department`/`team_label`. SQLite has assignments, not a standalone `teams` entity; do not invent team rows. |
| `invitations` (4; point-in-time inventory) | `invitations` | Preserve code/limits/status/source fields only after review. Never copy plaintext bearer `token`; calculate a one-way token hash only if a supported migration procedure exists, otherwise revoke/reissue links. Resolve whether current `token_hash` exists for each record without logging tokens. |
| `registrations` (52; point-in-time inventory) | `registrations` | Preserve unique event/participant relation, invitation/ticket option references, payment/check-in timestamps. Keep all 50 `registered` states as `registered`; do not infer confirmed or pending. The two `confirmed` rows remain confirmed only if their participant identity mappings and ticket relationships validate. |
| `ticket_options` (0) | `ticket_options` | Empty in current inventory; preserve schema for future use. |
| `tickets` (2; point-in-time inventory) | `tickets` | Import only after its registration, event, participant, and ticket number are reconciled. Composite target FK ensures those references agree. Never synthesize a ticket. |
| `tasks` (3) | `tasks` | Map event, optional owner, risk, recommendation; unresolved cross-references go to quarantine, not null/guessed links. |
| `task_comments` (0) | `task_comments` | Empty in inventory; schema retained. |
| `incidents` (3) | `incidents` | Preserve reporter/status and links to session/risk/task only after user mapping. Validate reporter identities and all optional references. |
| `incident_assignments` (3) | `incident_assignments` | Map incident, responder, assigning user. Quarantine rows until both users are verified. |
| `incident_messages` (0) | `incident_messages` | Empty in inventory; schema retained. Review internal-message visibility before any future import. |
| `incident_activities` (16) | `incident_activities` | Map incident and actor. Preserve timestamps/actions; do not log `details` in importer output. |
| `risks` (3) | `risks` | Map event; preserve severity/status/evidence. Review potentially personal or sensitive text before inclusion. |
| `partners` (5) | `partners` | Map event. `contact` may contain personal information; include only under an approved data purpose/retention policy. |
| `recommendations` (0) | `recommendations` | Preserve as the existing deterministic recommendation model; do not conflate it with AI recommendations. |
| `event_metric_snapshots` (1) | `event_metric_snapshots` | Validate JSON before conversion to JSONB; retain source timestamp/day and definitions. |
| `event_intelligence_analyses` (0) | `event_intelligence_analyses` | Empty in inventory; schema retained. Do not fabricate historical analyses. |
| `event_intelligence_recommendations` (0) | `event_intelligence_recommendations` | Empty in inventory; schema retained. |
| `event_recommendation_history` (0) | `event_recommendation_history` | Empty in inventory; schema retained. |
| `responder_profiles` (2) | `responder_profiles` | Map only verified Auth users. Skills/zones may reveal sensitive operational details; apply retention and access review. |
| `in_app_notifications` (14) | `in_app_notifications` | Import only if still useful and recipient identity is verified; otherwise omit as transient. Each imported record remains recipient-only. |
| `notifications` (0) | `notifications` | Empty in inventory; legacy equivalent retained. |
| `support_tickets` (0) | `support_tickets` | Empty in inventory; schema retained. Future import needs privacy/retention review. |
| `support_messages` (0) | `support_messages` | Empty in inventory; schema retained. Message content/attachments need privacy review if records later exist. |

The current SQLite inventory contains 27 tables, including `users` and `auth_sessions`; the target intentionally replaces those with Supabase Auth plus profiles/memberships and does not migrate session credentials. Target import-ledger tables are new and do not represent SQLite business records.

### Registration status policy (explicit; no source rewrite)

| Source/target status | Import treatment | Participant event/portal access | Ticket treatment |
|---|---|---|---|
| `confirmed` | Preserve only after verified Auth identity, event ownership, and registration relationship checks | Allowed only with an active `participant` membership and active profile | Preserve an existing valid ticket; never synthesize one during import |
| `registered` | Preserve verbatim in the protected/quarantined staging outcome; do not reinterpret it | **Denied**; the RLS helper requires `confirmed` plus active membership | No ticket issued by import; reconcile individually |
| `pending` | Preserve as pending if explicitly represented by the source; otherwise never infer it | Denied | No ticket until authorized approval operation |
| `waitlisted`, `invited` | Preserve only if source explicitly has that state | Denied | No ticket |
| `cancelled` or any unknown/ineligible state | Preserve source value in reconciliation; map only to an explicitly supported target state after review | Denied | No active ticket |

The registration enum accepts `registered` for faithful legacy storage, but that status is not approval. Only the exact `confirmed` state, together with an active participant membership and active profile, grants event participant access. Revoked/suspended membership and suspended/disabled profiles deny access even if an old registration says `confirmed`.

### Semantics not represented by current SQLite tables

- There is no normalized `teams` table; the current data is `team_assignments` plus free-form department/assignment fields. The proposed schema stores a team label on membership but does not fabricate a team hierarchy.
- No campaign-delivery, exposure, email-open, or click table is present. Invitation creation/use data must not be reported as delivered/opened/clicked analytics.
- Attendance is represented by `registrations.checked_in_at`; no separate check-in/audit model exists in this inventory.
- `event_intelligence_recommendations.related_task_id` / `related_incident_id` and SQLite task related IDs are not all protected by source foreign keys. The target migration adds referential constraints; importer must quarantine invalid references before inserts.
- SQLite `registered` is distinct from `confirmed`, `pending`, `waitlisted`, and `invited`; current counts alone do not explain its business meaning.
- `events.current_registrations` and `ticket_options.sold_count` are denormalized counters; compare them with eligible registration/ticket rows and recompute/verify after import rather than blindly trusting stale values.

## Dry-run preflight and future importer design (the PostgreSQL writer is not implemented)

1. Make a permission-restricted, verified backup of the SQLite file. Keep the original untouched and immutable during import/cutover. Pause all application/API writers before fingerprinting, or run against an immutable backup: hashing the main database and WAL/journal sidecars cannot guarantee a consistent snapshot while a writer is active. Record a source fingerprint without publishing it if it could reveal file contents.
2. Run `npm run supabase:import:dry-run` against the exact `RUNSHOW_DB_PATH` (or set that variable for the command). The latest read-only inventory reports 27 tables, 56 users (1 organizer, 2 sub-organizers, 53 participants), 1 event, 52 registrations (`2 confirmed`, `50 registered`), 4 invitations, 2 tickets, 3 incidents, 3 risks, 3 tasks, 5 partners, 2 team assignments, 2 event sessions, 1 metric snapshot, 2 responder profiles, 16 incident activities, 3 incident assignments, and 15 in-app notifications; SQLite FK violations: 0. Counts are a point-in-time report, are not proof that records are genuine, and can change; rerun before any future import. To produce an optional private review queue with opaque IDs/reason codes and no row payloads, use `npm run supabase:import:dry-run -- --quarantine-report /secure/path/new-review.json`; it creates a new mode-0600 file and refuses to overwrite an existing file. Keep the report outside Git and share only through an approved secure process.
3. Create a private, access-controlled reconciliation file mapping each accepted legacy user ID to a specific verified Supabase Auth UUID. Do not put emails, names, tokens, password hashes, or contact data in ordinary logs or this repository. No automatic linking by unverified email.
4. Resolve event ownership explicitly. If the owner cannot be verified, quarantine the event and all dependent rows; never assign it to the first/only organizer. Review every account flagged as demo/test/example using authorized human context; pattern matching is not enough to classify it.
5. Dry run in an isolated, non-production PostgreSQL test environment matching target Postgres/Supabase roles only after the same schema review. Do not create/select a different Supabase project without explicit authorization. Produce aggregate counts by source/target/status, unresolved FK counts, UUID-map coverage, duplicate-key counts, JSON parse failures, invitation-token omissions/reissues, and quarantine counts. Do not include row values in logs.
6. Stage mappings and data in dependency order: verified identity/profile map; events; event memberships; sessions/ticket options/invitations; team assignments/tasks/partners/risks/recommendations; registrations; tickets; incidents and incident children; notifications/support; metric/AI history. Respect the target FK ordering and cycles (tasks↔risks↔incidents↔recommendations) by inserting parent rows first, then updating optional cross-links in the same controlled transaction or a second validated pass.
7. Use deterministic per-row UUID mapping keyed by `(source fingerprint, entity type, legacy ID)` and record it in `legacy_id_mappings`; never infer an Auth UUID from that generated mapping. Create one `legacy_import_batches` row per immutable source fingerprint. Track per-table/chunk checkpoints in the batch summary (source range/key, attempted, accepted, rejected, checksum/count); commit each dependency-safe chunk with its mapping rows in the same transaction. On restart, skip only a checkpoint whose target counts and relationship checks still match. Never use blind `ON CONFLICT DO UPDATE` for identity/ownership fields. A conflict is quarantined for review.
8. Emit a privacy-safe quarantine report containing table, opaque legacy ID, reason code, and batch ID—not row contents, emails, tokens, hashes, descriptions, or contact data. Reconcile ambiguous owner/account/registration rows with a separate access-controlled signed decision record; record reviewer, timestamp, evidence reference, and disposition. Do not import `auth_sessions`, password hashes, unverified users, questionable fixtures, invalid/ambiguous relationships, or invitation plaintext tokens. A token hash is not recoverable from a plaintext-token hash mismatch; revoke/reissue links only after event-owner approval. Preserve rejected records in the untouched SQLite source and protected reconciliation report, not by deleting or weakening constraints.
9. After staging import, compare source eligible counts to imported + quarantined + intentionally omitted counts; verify every FK, unique constraint, capacity/status semantics, ticket-registration ownership, role memberships, RLS tests, and key aggregate analytics. Require organizer/product-owner sign-off before any production import or app cutover.

The current `scripts/supabase-import-preflight.mjs` tool is preflight-only; it does not import rows. Run `npm run supabase:import:dry-run` for aggregate counts and unresolved-record categories. To create an optional private review queue of opaque legacy IDs and reason codes (no row payloads), use `npm run supabase:import:dry-run -- --quarantine-report /secure/path/new-review.json`; it creates a new mode-0600 file and refuses to overwrite an existing file. Keep that report outside Git and restrict access. `--apply` is intentionally refused. A future writer must require a separate explicit mode, verified target project identity, backup/source fingerprint, reviewed mappings, and a final confirmation. The migration adds `legacy_import_checkpoints` keyed by batch/entity/chunk and `legacy_import_quarantine` keyed by batch/entity/opaque source ID/reason; checkpoint rows and target rows/mappings must commit in one chunk transaction. The ledger makes a future writer restartable, not automatically reversible: recovery requires restoring the verified pre-import Supabase backup or removing only batch-owned rows after a dependency/count audit. Never delete shared rows or Auth identities as rollback. Keep SQLite immutable until sign-off. After any app cutover writes to Supabase, rollback must first reconcile those writes; pointing the app back at SQLite alone would lose them.

### Backup, recovery, and reconciliation gate

- Before any live DDL/import, make and verify a Supabase backup/snapshot using the project’s supported recovery mechanism and record its timestamp/restore test. Preserve the original SQLite file and a separate access-controlled backup; do not rename, truncate, or overwrite either source.
- For a stable SQLite fingerprint, pause application/API writers and run the preflight against an immutable backup. The tool includes the main file plus WAL/journal sidecars when present, but cannot guarantee a consistent snapshot while another process is writing.
- Apply schema only through the reviewed versioned migration mechanism after a matching isolated PostgreSQL test. A failed transactional DDL run should be rolled back as one unit; inspect migration history and catalog state before any retry. Do not replay the SQL Editor script blindly.
- For data, each chunk commits target rows, ID mappings, and checkpoint atomically. On a failed chunk, roll back that chunk; resume only after the previous checkpoint’s row counts, IDs, and FKs reconcile. A partial batch is marked `needs_review` or `failed`, never silently marked complete.
- Reconciliation decisions for ambiguous identities/ownership/statuses and invitation reissue are human approvals. The importer cannot create Auth users or decide an owner. No real-vs-demo classification is inferred from email patterns.

## Preflight and post-migration verification gates

Before this migration is even considered:

1. Review all result sets from `supabase/diagnostics/inspect-existing-project.sql`: schemas, full table/view list, columns/defaults, constraints, indexes, RLS state, policies, relevant functions and triggers. The screenshot of eight `realtime`/`storage` triggers is not the complete report. Confirm the current project/database identity and inspect all non-system schemas, not only `public`.
2. Confirm the `public` zero-table/zero-policy results with the full listing and verify there are no conflicting views, functions, types, or other objects named by the proposed migration. Check default privileges/roles and the actual Postgres version.
3. Validate the prepared SQL in an isolated, non-production PostgreSQL test environment that matches the target Postgres version and Supabase roles/Auth interface. Do not create or select a different Supabase project without explicit authorization. Inspect every policy and test anonymous, owner organizer, assigned sub-organizer, unrelated organizer, registered participant, pending participant, and cross-event access.
   The migration does not attach a trigger to `auth.users`; the future sign-up/session integration must create or upsert the matching `profiles` row server-side and handle missing profiles safely.
4. Confirm policy coverage for every RLS-enabled table; verify no table is exposed through a view/RPC bypass. Test participant ticket isolation and disallow direct invitation/registration/ticket writes that bypass server-side capacity and usage checks.
5. The draft migration now includes `runshow_join_event` and `runshow_approve_registration` transactional RPCs. They are still unverified against PostgreSQL; test their concurrency, lock order, errors, eligibility fail-closed behavior, ticket issuance, retry semantics, and RLS interaction in PostgreSQL-compatible infrastructure before production. The current free-text eligibility field cannot be evaluated automatically; non-empty requirements fail closed until a reviewed structured evaluator exists. Paid registration is also rejected pending a payment workflow.
6. Run the dry-run importer; reconcile every reject; perform staged writes only after approval. Verify exact counts, relationship integrity, and behavior after app API integration. Keep SQLite and backup unchanged until sign-off and rollback window completion.

## Unresolved decisions (must be answered before live import)

- Full live Supabase diagnostic output, including the other schemas and all relevant sections; confirm the project/database identity. Current shared `auth`/`public` counts are preliminary.
- Which of the 56 SQLite accounts are genuine versus fixtures/demo, and the verified Auth UUID for every imported account. Do not send secrets or raw personal data in chat.
- Verified event owner identity and whether the two sub-organizer users have authorized event memberships. SQLite has one event/one owner reference, but does not prove a matching Supabase identity.
- Meaning of the 50 `registered` rows; whether approval was required; eligibility, capacity, and any waitlist behavior at the time. Until individually reconciled, keep `registered` unchanged and deny participant portal access.
- Whether the one existing ticket is valid for a confirmed registration and whether any legacy invitation bearer links must be invalidated/reissued.
- Whether contact fields, responder data, support content, notifications, and old analytics should be migrated or omitted under privacy/retention rules.
- How legacy timestamp strings without explicit offsets should be interpreted using each event's timezone; preserve the original source value in protected reconciliation during dry run where needed.
- Product definition for formal teams/departments, global profile/account status, account deletion/retention, public event data, and event-owner transfer.
- No event/campaign exposure tracking exists in SQLite; new campaign delivery/click tracking requires a separate product decision and consent/privacy review.

Until these questions and the live schema review are resolved, do not apply the migration, import records, reset Supabase, or switch application authentication/data access.
