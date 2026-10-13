import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { initDbSchema } from '../src/lib/server/db.ts';
import {
  createPersonalTodo,
  deletePersonalTodo,
  listPersonalTodos,
  PersonalTodoValidationError,
  setPersonalTodoCompletion,
} from '../src/lib/server/personal-todo-repository.ts';
import { filterPersonalTodos, personalTodoAccess } from '../src/lib/personal-todos.ts';

let directory;
let dbPath;
let database;
const stamp = '2026-10-13T00:00:00.000Z';

before(() => {
  directory = mkdtempSync(join(tmpdir(), 'runshow-personal-todos-'));
  dbPath = join(directory, 'todos.sqlite');
  database = new DatabaseSync(dbPath);
  initDbSchema(database);
  const addUser = database.prepare(`
    INSERT INTO users(id, name, email, password_hash, role, status, created_at, updated_at)
    VALUES (?, ?, ?, 'test-only-hash', ?, 'active', ?, ?)
  `);
  addUser.run('org-a', 'Organizer A', 'org-a@example.test', 'organizer', stamp, stamp);
  addUser.run('org-b', 'Organizer B', 'org-b@example.test', 'organizer', stamp, stamp);
  addUser.run('sub-a', 'Sub Organizer', 'sub@example.test', 'sub_organizer', stamp, stamp);
  addUser.run('participant-a', 'Participant', 'participant@example.test', 'participant', stamp, stamp);
});

after(() => {
  database?.close();
  if (directory) rmSync(directory, { recursive: true, force: true });
});

test('personal todo schema is indexed, idempotent, and separate from event tasks', () => {
  initDbSchema(database);
  const indexes = database.prepare('PRAGMA index_list(personal_todos)').all().map(row => row.name);
  assert.ok(indexes.includes('personal_todos_owner_sort_idx'));
  assert.equal(database.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='tasks'").get().name, 'tasks');
  assert.equal(database.prepare('SELECT COUNT(*) AS count FROM personal_todos').get().count, 0);
});

test('creates trimmed personal tasks and rejects empty or oversized titles', () => {
  const todo = createPersonalTodo(database, 'org-a', '  Prepare the briefing  ');
  assert.match(todo.id, /^todo_[0-9a-f-]{36}$/i);
  assert.equal(todo.title, 'Prepare the briefing');
  assert.equal(todo.isCompleted, false);
  assert.equal(todo.completedAt, null);
  assert.throws(() => createPersonalTodo(database, 'org-a', ' \n  '), PersonalTodoValidationError);
  assert.throws(() => createPersonalTodo(database, 'org-a', 'x'.repeat(241)), PersonalTodoValidationError);
});

test('completes and reopens only the owner task with consistent completion timestamps', () => {
  const todo = createPersonalTodo(database, 'org-a', 'Review registrations');
  const completed = setPersonalTodoCompletion(database, 'org-a', todo.id, true);
  assert.equal(completed.isCompleted, true);
  assert.ok(completed.completedAt);
  assert.equal(completed.updatedAt, completed.completedAt);

  const reopened = setPersonalTodoCompletion(database, 'org-a', todo.id, false);
  assert.equal(reopened.isCompleted, false);
  assert.equal(reopened.completedAt, null);
  assert.equal(setPersonalTodoCompletion(database, 'org-b', todo.id, true), null);
});

test('filters all, active, and completed tasks', () => {
  const active = createPersonalTodo(database, 'org-b', 'Active task');
  const completed = createPersonalTodo(database, 'org-b', 'Completed task');
  setPersonalTodoCompletion(database, 'org-b', completed.id, true);
  const todos = listPersonalTodos(database, 'org-b');
  assert.equal(filterPersonalTodos(todos, 'all').length, 2);
  assert.deepEqual(filterPersonalTodos(todos, 'active').map(todo => todo.id), [active.id]);
  assert.deepEqual(filterPersonalTodos(todos, 'completed').map(todo => todo.id), [completed.id]);
});

test('organizers cannot read, update, or delete another organizer’s task', () => {
  const todo = createPersonalTodo(database, 'org-a', 'Private task');
  assert.equal(listPersonalTodos(database, 'org-b').some(item => item.id === todo.id), false);
  assert.equal(setPersonalTodoCompletion(database, 'org-b', todo.id, true), null);
  assert.equal(deletePersonalTodo(database, 'org-b', todo.id), false);
  assert.equal(listPersonalTodos(database, 'org-a').some(item => item.id === todo.id), true);
  assert.equal(deletePersonalTodo(database, 'org-a', todo.id), true);
  assert.equal(deletePersonalTodo(database, 'org-a', todo.id), false);
});

test('personal tasks persist after closing and reopening SQLite', () => {
  const todo = createPersonalTodo(database, 'org-a', 'Persist across reload');
  database.close();
  database = new DatabaseSync(dbPath);
  initDbSchema(database);
  assert.equal(listPersonalTodos(database, 'org-a').find(item => item.id === todo.id)?.title, todo.title);
});

test('personal task access is limited to active organizer identities', () => {
  assert.equal(personalTodoAccess(null), 'unauthenticated');
  for (const role of ['sub_organizer', 'participant']) {
    assert.equal(personalTodoAccess({ role, status: 'active' }), 'forbidden');
  }
  assert.equal(personalTodoAccess({ role: 'organizer', status: 'inactive' }), 'forbidden');
  assert.equal(personalTodoAccess({ role: 'organizer', status: 'active' }), null);
});
