#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { createReadStream, existsSync, writeFileSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

const argv = process.argv.slice(2);
const reportIndex = argv.indexOf('--quarantine-report');
const quarantineReportPath = reportIndex >= 0 ? argv[reportIndex + 1] : undefined;
const args = new Set(argv.filter((arg, index) =>
  arg !== '--quarantine-report' && !(reportIndex >= 0 && index === reportIndex + 1)));
if (args.has('--help')) {
  console.log('Usage: npm run supabase:import:dry-run [-- --dry-run] [--quarantine-report <new-private-file>]\nRead-only inventory and reconciliation preflight. It never writes to SQLite or Supabase.');
  process.exit(0);
}
if (args.has('--apply')) {
  console.error('Refusing --apply: the authenticated PostgreSQL importer is not implemented or verified. No database was changed.');
  process.exit(2);
}
for (const arg of args) {
  if (arg !== '--dry-run') {
    console.error(`Unknown option: ${arg}`);
    process.exit(2);
  }
}
if (reportIndex >= 0 && (!quarantineReportPath || quarantineReportPath.startsWith('--'))) {
  console.error('--quarantine-report requires a new output file path.');
  process.exit(2);
}

const dbPath = resolve(process.env.RUNSHOW_DB_PATH || join(process.cwd(), '.data', 'runshow.sqlite'));
if (!existsSync(dbPath)) {
  console.error('SQLite source database not found. Set RUNSHOW_DB_PATH to the existing source. No database was created.');
  process.exit(2);
}

const importMap = {
  users: 'profiles + event_memberships (verified existing Auth UUID only)',
  auth_sessions: 'omit (never import credentials or sessions)',
  events: 'events', event_sessions: 'event_sessions', ticket_options: 'ticket_options',
  invitations: 'invitations (token/owner reconciliation required)', registrations: 'registrations',
  tickets: 'tickets (validate registration and ownership)', team_assignments: 'team_assignments',
  tasks: 'tasks', task_comments: 'task_comments', partners: 'partners', risks: 'risks',
  recommendations: 'recommendations', incidents: 'incidents', responder_profiles: 'responder_profiles',
  incident_assignments: 'incident_assignments', incident_messages: 'incident_messages',
  incident_activities: 'incident_activities', in_app_notifications: 'in_app_notifications',
  notifications: 'notifications', support_tickets: 'support_tickets', support_messages: 'support_messages',
  event_metric_snapshots: 'event_metric_snapshots', event_intelligence_analyses: 'event_intelligence_analyses',
  event_intelligence_recommendations: 'event_intelligence_recommendations',
  event_recommendation_history: 'event_recommendation_history',
};
const stableIdNamespace = 'd8d44a6d-f4ae-5ea2-8e95-d8ab9f806b58';
async function fingerprintSource(path) {
  const digest = createHash('sha256');
  for (const suffix of ['', '-wal', '-journal']) {
    const part = `${path}${suffix}`;
    if (!existsSync(part)) continue;
    digest.update(`source-part:${suffix || 'main'}\0`);
    for await (const chunk of createReadStream(part)) digest.update(chunk);
  }
  return digest.digest('hex');
}
const quote = value => `"${String(value).replaceAll('"', '""')}"`;
const database = new DatabaseSync(dbPath, { readOnly: true });
const tableNames = database.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name")
  .all().map(row => String(row.name));
const tables = new Set(tableNames);
const columnsByTable = new Map(tableNames.map(name => [name,
  new Set(database.prepare(`PRAGMA table_info(${quote(name)})`).all().map(column => String(column.name)))]));
const count = name => tables.has(name)
  ? Number(database.prepare(`SELECT COUNT(*) AS count FROM ${quote(name)}`).get().count) : 0;
const groupCounts = (table, column) => tables.has(table) && columnsByTable.get(table)?.has(column)
  ? database.prepare(`SELECT ${quote(column)} AS value, COUNT(*) AS count FROM ${quote(table)} GROUP BY ${quote(column)} ORDER BY ${quote(column)}`)
      .all().map(row => ({ value: String(row.value ?? 'NULL'), count: Number(row.count) }))
  : [];
const duplicateGroups = (table, columns) => {
  if (!tables.has(table) || !columns.every(column => columnsByTable.get(table)?.has(column))) return 0;
  const fields = columns.map(quote).join(', ');
  return Number(database.prepare(`SELECT COUNT(*) AS count FROM (
    SELECT 1 FROM ${quote(table)} GROUP BY ${fields} HAVING COUNT(*) > 1
  )`).get().count);
};
const ids = (table, where = '') => {
  if (!tables.has(table) || !columnsByTable.get(table)?.has('id')) return [];
  return database.prepare(`SELECT id FROM ${quote(table)} ${where}`).all().map(row => String(row.id));
};

try {
  database.exec('PRAGMA query_only = ON');
  const tableCounts = Object.fromEntries(tableNames.map(name => [name, count(name)]));
  const roles = groupCounts('users', 'role');
  const statuses = groupCounts('registrations', 'status');
  const ownership = tables.has('events') && tables.has('users')
    ? database.prepare(`SELECT COUNT(*) AS eventCount,
        SUM(CASE WHEN u.id IS NULL THEN 1 ELSE 0 END) AS missingOwnerReferences
      FROM events e LEFT JOIN users u ON u.id = e.organizer_id`).get()
    : { eventCount: 0, missingOwnerReferences: 0 };
  const duplicateKeys = {
    userEmails: duplicateGroups('users', ['email']),
    eventParticipants: duplicateGroups('registrations', ['event_id', 'participant_id']),
    invitationCodes: duplicateGroups('invitations', ['code']),
    ticketNumbers: duplicateGroups('tickets', ['ticket_number']),
  };
  const invitationRowsNeedingSecretReview = count('invitations');
  const fkViolations = Number(database.prepare('SELECT COUNT(*) AS count FROM pragma_foreign_key_check').get().count);
  const fingerprint = await fingerprintSource(dbPath);
  const walPresent = existsSync(`${dbPath}-wal`);
  const unmatchedTables = tableNames.filter(name => !Object.hasOwn(importMap, name));
  const quarantineRows = [
    ...ids('users').map(legacyId => ({ entityType: 'users', legacyId, reasonCode: 'AUTH_IDENTITY_UNVERIFIED' })),
    ...ids('events').map(legacyId => ({ entityType: 'events', legacyId, reasonCode: 'EVENT_OWNER_RECONCILIATION_REQUIRED' })),
    ...ids('registrations', "WHERE status = 'registered'").map(legacyId => ({ entityType: 'registrations', legacyId, reasonCode: 'LEGACY_STATUS_AMBIGUOUS' })),
    ...ids('invitations').map(legacyId => ({ entityType: 'invitations', legacyId, reasonCode: 'INVITATION_SECRET_REVIEW_REQUIRED' })),
    ...ids('tickets').map(legacyId => ({ entityType: 'tickets', legacyId, reasonCode: 'TICKET_OWNERSHIP_REVIEW_REQUIRED' })),
  ];
  if (quarantineReportPath) {
    const report = JSON.stringify({
      format: 'runshow-quarantine-review-v1', sourceFingerprint: fingerprint,
      generatedAt: new Date().toISOString(), rows: quarantineRows,
    }, null, 2);
    // Exclusive create prevents overwriting an earlier reviewer artifact.
    writeFileSync(resolve(quarantineReportPath), report, { encoding: 'utf8', flag: 'wx', mode: 0o600 });
  }

  console.log(JSON.stringify({
    mode: 'dry-run-only',
    source: { file: basename(dbPath), sha256: fingerprint, walPresent },
    sqlite: { tableCount: tableNames.length, tableCounts, foreignKeyViolations: fkViolations },
    mappings: importMap,
    sourceTablesNotMapped: unmatchedTables,
    aggregateChecks: {
      userRoles: roles,
      registrationStatuses: statuses,
      eventOwnershipReferences: {
        eventCount: Number(ownership.eventCount || 0),
        missingOwnerReferences: Number(ownership.missingOwnerReferences || 0),
        requireHumanAuthIdentityAndOwnershipReview: Number(ownership.eventCount || 0),
      },
      duplicateNaturalKeyGroups: duplicateKeys,
      unresolvedReviews: {
        existingUsersRequiringVerifiedAuthMapping: count('users'),
        invitationsRequiringOwnerAndSecretDisposition: invitationRowsNeedingSecretReview,
        legacyRegisteredStatusesRequiringHumanDisposition: statuses.find(row => row.value === 'registered')?.count || 0,
        ticketsRequiringRegistrationAndOwnerValidation: count('tickets'),
      },
      quarantineReviewRowsPrepared: quarantineRows.length,
    },
    execution: {
      writesPerformed: false,
      prerequisite: 'For a definitive import, pause SQLite writers and rerun against the verified immutable backup.',
      quarantineReportWritten: Boolean(quarantineReportPath),
      authUsersCreated: false,
      passwordsOrTokensReadIntoOutput: false,
      stableBusinessIdStrategy: 'UUIDv5(namespace, entity_type + legacy_id); Auth UUIDs must come from an independently verified mapping',
      stableIdNamespace,
      batchResumeStrategy: 'legacy_import_batches + per-table/chunk legacy_import_checkpoints; commit target rows, mappings and checkpoint atomically',
      applyStatus: 'not-implemented-until-PostgreSQL-adapter, identity map, live target preflight and integration tests exist',
    },
  }, null, 2));
} catch (error) {
  console.error(`Preflight failed without writing data: ${error instanceof Error ? error.message : 'unknown error'}`);
  process.exitCode = 1;
} finally {
  database.close();
}
