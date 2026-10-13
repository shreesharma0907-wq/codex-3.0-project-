'use client';

import { useSyncExternalStore } from 'react';
import { AccountRole } from './types';

export type DemoRole = AccountRole;
export interface DemoSession { id: string; email: string; name: string; role: DemoRole; isDemo?: boolean }
export interface DemoAccount extends DemoSession { password: string }
export interface DemoAccountRecord extends DemoSession { active: boolean; createdAt: string }
interface StoredAccount extends DemoAccountRecord { passwordSalt?: string; passwordHash?: string }

export const DEMO_ACCOUNTS: readonly DemoAccount[] = [
  { id: 'demo-organizer', email: 'organizer@runshow.demo', password: 'RunShow2026!', name: 'Main Organizer', role: 'organizer' },
  { id: 'demo-suborganizer', email: 'suborganizer@runshow.demo', password: 'RunShow2026!', name: 'Sub-organizer', role: 'sub_organizer' },
  { id: 'demo-participant', email: 'participant@runshow.demo', password: 'RunShow2026!', name: 'Participant', role: 'participant' },
];

const SESSION_KEY = 'runshow-demo-session';
const ACCOUNTS_KEY = 'runshow-demo-account-records';
const USE_SERVER_AUTH = process.env.NEXT_PUBLIC_USE_API === 'true';
const listeners = new Set<() => void>();
let cachedSession: DemoSession | null | undefined;
let cachedAccounts: DemoAccountRecord[] | undefined;
let serverSession: DemoSession | null | undefined;
let serverSessionRequest: Promise<void> | undefined;
const EMPTY_ACCOUNTS: DemoAccountRecord[] = [];

function normalizeRole(value: unknown): DemoRole | null {
  if (value === 'sub-organizer' || value === 'sub_organizer') return 'sub_organizer';
  if (value === 'organizer' || value === 'participant') return value;
  return null;
}

function storedAccounts(): StoredAccount[] {
  try {
    const value: unknown = JSON.parse(window.localStorage.getItem(ACCOUNTS_KEY) || '[]');
    if (!Array.isArray(value)) return [];
    return value.filter((item): item is StoredAccount => !!item && typeof item === 'object' && typeof item.id === 'string' && typeof item.email === 'string' && typeof item.name === 'string' && normalizeRole(item.role) !== null && typeof item.active === 'boolean');
  } catch {
    return [];
  }
}

function allAccountRecords(): DemoAccountRecord[] {
  const stored = storedAccounts();
  const records = new Map<string, DemoAccountRecord>();
  for (const account of DEMO_ACCOUNTS) {
    const override = stored.find(record => record.id === account.id);
    records.set(account.id, {
      id: account.id, email: account.email, name: account.name, role: account.role,
      active: override?.active ?? true, createdAt: override?.createdAt ?? 'seeded',
    });
  }
  for (const account of stored) {
    if (!DEMO_ACCOUNTS.some(seed => seed.id === account.id)) records.set(account.id, {
      id: account.id, email: account.email, name: account.name, role: normalizeRole(account.role)!,
      active: account.active, createdAt: account.createdAt,
    });
  }
  return [...records.values()];
}

function invalidateAndNotify() {
  cachedSession = undefined;
  cachedAccounts = undefined;
  listeners.forEach(listener => listener());
}

function notifySessionListeners() { listeners.forEach(listener => listener()); }

export function isUsingServerAuth() { return USE_SERVER_AUTH; }

export async function refreshServerSession() {
  if (!USE_SERVER_AUTH || typeof window === 'undefined') return;
  if (!serverSessionRequest) {
    serverSessionRequest = fetch('/api/auth/session', { credentials: 'include' })
      .then(response => response.ok ? response.json() as Promise<{ user: DemoSession | null }> : { user: null })
      .then(payload => { serverSession = payload.user; notifySessionListeners(); })
      .catch(() => { serverSession = null; notifySessionListeners(); })
      .finally(() => { serverSessionRequest = undefined; });
  }
  await serverSessionRequest;
}

export async function authenticateServer(email: string, password: string): Promise<DemoSession | null> {
  const response = await fetch('/api/auth/login', { method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: email.trim().toLowerCase(), password }) });
  if (!response.ok) return null;
  const payload = await response.json() as { user?: DemoSession };
  serverSession = payload.user ?? null;
  notifySessionListeners();
  return serverSession;
}

export async function createServerParticipant(name: string, email: string, password: string): Promise<DemoSession> {
  const response = await fetch('/api/auth/signup', { method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name, email, password }) });
  const payload = await response.json().catch(() => null) as { user?: DemoSession; error?: { message?: string } } | null;
  if (!response.ok || !payload?.user) throw new Error(payload?.error?.message || 'Unable to create your participant account.');
  serverSession = payload.user;
  notifySessionListeners();
  return payload.user;
}

function discardStoredSession() {
  try { window.localStorage.removeItem(SESSION_KEY); } catch { /* Storage may be unavailable. */ }
}

function readSessionFromStorage(): DemoSession | null {
  try {
    const value: unknown = JSON.parse(window.localStorage.getItem(SESSION_KEY) || 'null');
    if (!value || typeof value !== 'object') return null;
    const session = value as Partial<DemoSession> & { role?: unknown };
    const role = normalizeRole(session.role);
    const account = allAccountRecords().find(candidate => candidate.email === session.email && candidate.role === role && (!session.id || candidate.id === session.id));
    if (!account?.active) {
      discardStoredSession();
      return null;
    }
    return { id: account.id, email: account.email, name: account.name, role: account.role, isDemo: account.isDemo };
  } catch {
    discardStoredSession();
    return null;
  }
}

function getSnapshot(): DemoSession | null {
  if (cachedSession === undefined) cachedSession = readSessionFromStorage();
  return cachedSession;
}

function getAccountsSnapshot(): DemoAccountRecord[] {
  if (cachedAccounts === undefined) cachedAccounts = allAccountRecords();
  return cachedAccounts;
}

function getServerSnapshot(): null { return null; }

function subscribe(listener: () => void) {
  listeners.add(listener);
  const handleStorage = (event: StorageEvent) => {
    if (event.key === SESSION_KEY || event.key === ACCOUNTS_KEY) invalidateAndNotify();
  };
  window.addEventListener('storage', handleStorage);
  if (USE_SERVER_AUTH) void refreshServerSession();
  return () => {
    listeners.delete(listener);
    window.removeEventListener('storage', handleStorage);
  };
}

export function useDemoSession() { return useSyncExternalStore(subscribe, () => USE_SERVER_AUTH ? (serverSession ?? null) : getSnapshot(), getServerSnapshot); }
export function useDemoAccounts() { return useSyncExternalStore(subscribe, getAccountsSnapshot, () => EMPTY_ACCOUNTS); }

function bytesToHex(bytes: Uint8Array) {
  return Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('');
}

async function passwordDigest(password: string, saltHex: string) {
  const salt = new Uint8Array(saltHex.match(/.{2}/g)?.map(byte => Number.parseInt(byte, 16)) ?? []);
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', salt, iterations: 120_000, hash: 'SHA-256' }, key, 256);
  return bytesToHex(new Uint8Array(bits));
}

function generatedPassword() {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789!@#$%';
  const bytes = crypto.getRandomValues(new Uint8Array(18));
  return Array.from(bytes, value => alphabet[value % alphabet.length]).join('');
}

function saveAccounts(records: StoredAccount[]) {
  window.localStorage.setItem(ACCOUNTS_KEY, JSON.stringify(records));
  invalidateAndNotify();
}

export async function createDemoSubOrganizer(name: string, email: string) {
  const cleanName = name.trim();
  const cleanEmail = email.trim().toLowerCase();
  if (cleanName.length < 2) throw new Error('Enter a name with at least two characters.');
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleanEmail)) throw new Error('Enter a valid email address.');
  if (allAccountRecords().some(account => account.email === cleanEmail)) throw new Error('An account with this email already exists.');
  if (!globalThis.crypto?.subtle) throw new Error('Secure browser crypto is unavailable. Use localhost or HTTPS to create demo accounts.');

  const password = generatedPassword();
  const salt = bytesToHex(crypto.getRandomValues(new Uint8Array(16)));
  const account: StoredAccount = {
    id: `demo-sub-${crypto.randomUUID()}`,
    email: cleanEmail,
    name: cleanName,
    role: 'sub_organizer',
    active: true,
    createdAt: new Date().toISOString(),
    passwordSalt: salt,
    passwordHash: await passwordDigest(password, salt),
  };
  saveAccounts([...storedAccounts(), account]);
  const safeAccount: DemoAccountRecord = {
    id: account.id, email: account.email, name: account.name, role: account.role,
    active: account.active, createdAt: account.createdAt,
  };
  return { account: safeAccount, password };
}

export async function createDemoParticipant(name: string, email: string, password: string) {
  const cleanName = name.trim();
  const cleanEmail = email.trim().toLowerCase();
  if (cleanName.length < 2) throw new Error('Enter a name with at least two characters.');
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleanEmail)) throw new Error('Enter a valid email address.');
  if (password.length < 8) throw new Error('Choose a password with at least 8 characters.');
  if (allAccountRecords().some(account => account.email === cleanEmail)) throw new Error('An account with this email already exists.');
  if (!globalThis.crypto?.subtle) throw new Error('Secure browser crypto is unavailable. Use localhost or HTTPS to create demo accounts.');

  const salt = bytesToHex(crypto.getRandomValues(new Uint8Array(16)));
  const account: StoredAccount = {
    id: `demo-participant-${crypto.randomUUID()}`,
    email: cleanEmail,
    name: cleanName,
    role: 'participant',
    active: true,
    createdAt: new Date().toISOString(),
    passwordSalt: salt,
    passwordHash: await passwordDigest(password, salt),
  };
  saveAccounts([...storedAccounts(), account]);
  return { id: account.id, email: account.email, name: account.name, role: account.role } satisfies DemoSession;
}

export function setDemoAccountActive(accountId: string, active: boolean) {
  const account = allAccountRecords().find(candidate => candidate.id === accountId);
  if (!account || account.role !== 'sub_organizer') throw new Error('Only sub-organizer demo accounts can be deactivated here.');
  const records = storedAccounts();
  const existing = records.find(record => record.id === accountId);
  if (existing) existing.active = active;
  else records.push({ ...account, active });
  saveAccounts(records);
}

export async function authenticateDemo(email: string, password: string): Promise<DemoSession | null> {
  const normalizedEmail = email.trim().toLowerCase();
  const account = allAccountRecords().find(candidate => candidate.email === normalizedEmail && candidate.active);
  if (!account) return null;
  const seed = DEMO_ACCOUNTS.find(candidate => candidate.id === account.id);
  if (seed) return seed.password === password ? { id: seed.id, email: seed.email, name: seed.name, role: seed.role } : null;
  const stored = storedAccounts().find(candidate => candidate.id === account.id);
  if (!stored?.passwordSalt || !stored.passwordHash || !globalThis.crypto?.subtle) return null;
  const actual = await passwordDigest(password, stored.passwordSalt);
  return actual === stored.passwordHash ? { id: account.id, email: account.email, name: account.name, role: account.role } : null;
}

export function saveDemoSession(session: DemoSession) {
  if (USE_SERVER_AUTH) {
    serverSession = session;
    notifySessionListeners();
    return;
  }
  window.localStorage.setItem(SESSION_KEY, JSON.stringify(session));
  invalidateAndNotify();
}

export function clearDemoSession() {
  if (USE_SERVER_AUTH) {
    serverSession = null;
    void fetch('/api/auth/logout', { method: 'POST', credentials: 'include' }).finally(notifySessionListeners);
    return;
  }
  discardStoredSession();
  invalidateAndNotify();
}

export function destinationForRole(role: DemoRole) {
  switch (normalizeRole(role)) {
    case 'organizer': return '/organizer/dashboard';
    case 'sub_organizer': return '/sub-organizer/dashboard';
    case 'participant': return '/participant/dashboard';
    default: return '/login';
  }
}
