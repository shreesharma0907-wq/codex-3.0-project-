# Supabase adoption: audit and safe migration gate

## Current source of truth

Audit performed 2026-10-13. The repository has no Supabase SDK, CLI, or application data-access integration. `.env.local` is ignored by Git and currently has the established `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY`, `SUPABASE_SECRET_KEY`, and `SUPABASE_JWKS_URL` variables configured; their values are intentionally not documented or printed. There is no configured database connection URL or project reference available to migration tooling. The application APIs read/write Node `node:sqlite`; default path is `.data/runshow.sqlite`, overridden by `RUNSHOW_DB_PATH`. Authentication is a parallel SQLite `users`/`auth_sessions` implementation with locally stored password hashes. `NEXT_PUBLIC_USE_API=false` selects browser/demo state. Zustand/localStorage also persists app state and demo-auth account/assignment records.

The latest read-only inventory during this preparation reports 1 event, 56 user rows (1 organizer, 2 sub-organizers, 53 participants), 52 registrations (`confirmed` 2, `registered` 50), 4 invitations, 2 tickets, 3 incidents, 3 risks, 3 tasks, 5 partners, 2 event team assignments, 2 sessions, 1 metric snapshot and 15 in-app notifications; SQLite FK violations: 0. It reports one event with one distinct owner reference and no missing owner FK, but does not establish a verified Supabase Auth identity or event owner. A prior heuristic flagged emails matching common demo/test/example patterns; it is not a classification. Counts can change; rerun the inventory before any future migration. No row values or credentials are included here.

These rows remain in SQLite and are not copied, deleted, or relabelled. The legacy application remains on SQLite until the target project is verified and an explicit migration is performed. This avoids a split-brain period where APIs write different databases.

## Read-only preparation added

- `npm run db:inventory` summarizes the configured SQLite file without printing user emails, names, password hashes, tokens, or descriptions. It opens read-only and does not create a missing DB.
- `supabase/diagnostics/inspect-existing-project.sql` reports PostgreSQL schema/table/column/constraint/index/RLS/policy/function/trigger metadata. It does not query Auth users or other application rows. It is diagnostic SQL, not a migration.
- `.env.example` documents placeholder-only Supabase settings and keeps the service-role key server-only. `.env.local` remains ignored.

Run the local inventory with `npm run db:inventory`. In the SQL Editor of the EXISTING Supabase project, run the diagnostic SQL and review its complete schema/policy output. The local API credentials do not provide a verified database/migration connection, and the complete live diagnostic output has not been supplied; the target schema therefore remains unverified. No Supabase DDL was applied and no claim of live Supabase integration is made.

## Required migration procedure (after target-schema review)

1. Confirm the existing Supabase project URL and inspect its schema/RLS output before choosing additive migrations. Do not create another project or assume an empty public schema.
2. Back up the SQLite file to a separately named, access-controlled copy. Keep the original `.data/runshow.sqlite` unchanged until reconciliation and production cutover have been accepted.
3. Decide which legacy rows are genuine versus fixture/demo. The current counts are not enough to classify a row. Produce a reviewed mapping file of legacy user ID to an existing, verified Supabase Auth user ID. Do not match by unverified email. Users with SQLite password hashes must use Supabase Auth recovery/invitation; hashes are not passwords and are not portable credentials.
4. Produce an explicit event-owner mapping. Preserve event rows whose owner cannot be verified in a quarantined legacy-import set for reconciliation; never attach them to the first organizer who logs in.
5. Review the 50 `registered` registrations and invitation/approval settings to determine their actual semantics. Keep ambiguous states quarantined until product owners decide a mapping. Do not convert them into confirmed tickets.
6. Review the prepared versioned migration and full target diagnostic before applying it. It proposes `public` application tables, RLS, transactional RPCs, and private batch/mapping/checkpoint/quarantine ledger objects; no migration has been applied.
7. Run `npm run supabase:import:dry-run` for the read-only reconciliation preflight. The actual PostgreSQL writer is not implemented. Implement and test a checkpointed, chunk-transactional writer only after verified Auth/owner mapping, live schema review, and PostgreSQL testing.
8. Switch all server routes/repositories and session handling together to Supabase Auth/Postgres, verify each role and cross-event isolation against a non-production environment, then cut over reads/writes. Keep SQLite backup read-only for rollback until sign-off and define retention/deletion for its personal data.

## Security preflight changes (local draft only)

The draft SQL now treats only `registrations.status = 'confirmed'` plus an active participant membership and active profile as participant event access. Legacy `registered`, pending, waitlisted, invited, cancelled, unknown states, and inactive memberships do not satisfy that rule. No source status is rewritten. Incident assignment checks require the responder to be an active same-event organizer/sub-organizer or an active same-event responder profile; ordinary assignment requires `assigned_by = auth.uid()`. Incident and support-ticket assignee updates also use the same-event helper.

The migration defines transactional `runshow_join_event` and `runshow_approve_registration` functions. The join function serializes on the event and invitation rows, validates mode/expiry/revocation/use limit/capacity/deadline/account, treats retries idempotently, creates pending versus confirmed registration, and issues a ticket only on confirmation. Pending approval is a separate organizer-authorized transition. Since eligibility is currently free text, non-empty requirements fail closed; paid registration also fails closed pending payment integration. These SQL routines are a prepared design, not PostgreSQL-validated or production-ready.

The anonymous `public_event_catalog` view remains a deliberately narrow allowlist of public event fields and filters out private visibility, drafts, completed/cancelled events, and events not accepting joins. It excludes owner IDs, organizer institution/contact fields, invitation data, and operational/participant data. It still requires actual anonymous-role tests because view ownership can bypass underlying RLS; `security_barrier` alone is not authorization.

Before deployment, use a PostgreSQL-compatible test environment to exercise role matrices (anonymous, event owner, assigned and unrelated sub-organizers, participant, revoked/suspended user), cross-event assignment attempts, pending/legacy status access, public-view column and row exposure, and concurrent join/use/capacity retries. The local Node contract tests only guard important SQL shape; they do not execute SQL or prove RLS/locking behavior.

## Blocking prerequisite

Preliminary Supabase findings subsequently shared by the project owner: 27 base tables under `auth`, zero rows from a query for base tables in `public`, and zero rows from a query for `public` RLS policies. These are not yet a complete schema audit: the remaining schemas, complete table/view listing, columns, constraints, indexes, functions, and relevant policy/trigger sections still need review. Eight triggers reported in `realtime`/`storage` do not establish whether the application schema is empty. Treat all of these counts as provisional until the complete diagnostic output is available.

An un-applied draft migration is now at `supabase/migrations/202610130001_runshow_public_schema.sql`; the separate, table-by-table import and dry-run plan is `docs/supabase-data-import-plan.md`. Neither artifact connects the application to Supabase, applies DDL, or imports any data. Review the import plan's unresolved identity, ownership, registration-status, and privacy questions before a production migration.

## Supabase configuration and setup

`.env.example` documents placeholders only and follows the established names present in `.env.local`. Never copy secret values into source control:

- `SUPABASE_URL`: existing project URL.
- `SUPABASE_PUBLISHABLE_KEY`: publishable key. Keep it server-side until a browser client is deliberately implemented and its exposed data has verified RLS/grants.
- `SUPABASE_SECRET_KEY`: privileged server-only key; never expose with `NEXT_PUBLIC_` or to browser code.
- `SUPABASE_JWKS_URL`: configured authentication verification endpoint; auth integration is not implemented.
- `SUPABASE_DB_URL`: optional server/tooling-only PostgreSQL connection string for a future importer or migration tooling; contains a database password and must remain secret.
- `SUPABASE_PROJECT_REF`: optional non-secret project reference used to verify the intended target before future writes.

Current application APIs still use SQLite and local authentication. Setting these variables alone does not connect RUNSHOW to Supabase. The available `NEXT_PUBLIC_USE_API` flag selects the existing SQLite API versus demo state; it is not a Supabase switch. No Supabase SDK/CLI or PostgreSQL driver is installed/configured in this repository. Before future DDL, inspect the existing project with `supabase/diagnostics/inspect-existing-project.sql`; then use the Supabase CLI linked to that same project and the versioned migration history, after a verified backup and PostgreSQL test. Do not paste/replay the migration manually or create a new project.

After the full diagnostic, ownership/identity decisions, backup, and isolated PostgreSQL tests are complete, the eventual CLI sequence from the repository root is:

```sh
npx supabase init                 # only if supabase/config.toml is absent; review generated config
npx supabase login
npx supabase link --project-ref "$SUPABASE_PROJECT_REF"  # existing RUNSHOW project only
npx supabase migration list --linked
npx supabase db push --linked     # applies pending versioned migrations; do not run before approval
```

These are future instructions, not commands run during this preparation. `db push` must remain last and wait for live-schema review and explicit deployment approval.

Never send service-role/database credentials in chat. Until the complete live schema results, verified identity/ownership decisions, PostgreSQL testing, and application integration exist, do not apply DDL, migrate any of the 56 accounts, or switch production workflows.
