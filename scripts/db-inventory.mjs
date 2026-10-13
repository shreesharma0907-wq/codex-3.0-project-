import { existsSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

const file = resolve(process.env.RUNSHOW_DB_PATH || join(process.cwd(), '.data', 'runshow.sqlite'));
if (!existsSync(file)) {
  console.log(JSON.stringify({ databaseExists: false, path: file }));
  process.exit(0);
}

const database = new DatabaseSync(file, { readOnly: true });
try {
  database.exec('PRAGMA query_only = ON');
  const tables = database.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all().map(row => String(row.name));
  const counts = {};
  for (const name of tables) {
    const identifier = `"${name.replaceAll('"', '""')}"`;
    counts[name] = Number(database.prepare(`SELECT COUNT(*) AS count FROM ${identifier}`).get().count);
  }
  const has = name => tables.includes(name);
  const userRoles = has('users') ? database.prepare('SELECT role, COUNT(*) AS count FROM users GROUP BY role ORDER BY role').all() : [];
  const registrationStatuses = has('registrations') ? database.prepare('SELECT status, COUNT(*) AS count FROM registrations GROUP BY status ORDER BY status').all() : [];
  const eventOwnership = has('events') && has('users')
    ? database.prepare('SELECT COUNT(*) AS events, COUNT(DISTINCT organizer_id) AS distinctOwners, SUM(CASE WHEN u.id IS NULL THEN 1 ELSE 0 END) AS missingOwners FROM events e LEFT JOIN users u ON u.id=e.organizer_id').get()
    : null;
  const foreignKeyViolations = Number(database.prepare('SELECT COUNT(*) AS count FROM pragma_foreign_key_check').get().count);
  console.log(JSON.stringify({ databaseExists: true, path: file, tableCounts: counts, userRoles, registrationStatuses, eventOwnership, foreignKeyViolations }, null, 2));
} finally {
  database.close();
}
