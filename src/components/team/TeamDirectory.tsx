'use client';

import React, { useEffect, useState, useCallback } from 'react';
import {
  Users,
  Search,
  Plus,
  RefreshCw,
  X,
  CheckCircle2,
  AlertTriangle,
  ChevronRight,
  Mail,
  Briefcase,
  MapPin,
  Activity,
} from 'lucide-react';
import { api } from '@/lib/api';
import { useDashboardStore } from '@/lib/dashboard-state';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';

// ─── Types ────────────────────────────────────────────────────────────────────

interface TeamMember {
  id: string;
  name: string;
  email: string;
  role: string;
  responsibility: string;
  availability: 'available' | 'busy' | 'offline';
  skills: string;
  zones: string;
  active_incidents: number;
}

// ─── Availability Badge ───────────────────────────────────────────────────────

function AvailabilityDot({ availability }: { availability: string }) {
  const colors = {
    available: 'bg-green-500',
    busy: 'bg-yellow-500',
    offline: 'bg-[var(--text-muted)]',
  };
  return (
    <span
      className={`inline-block h-2.5 w-2.5 rounded-full shrink-0 ${colors[availability as keyof typeof colors] ?? 'bg-[var(--text-muted)]'}`}
      title={availability}
    />
  );
}

// ─── Member Card ──────────────────────────────────────────────────────────────

function MemberCard({ member, onSelect }: { member: TeamMember; onSelect: (m: TeamMember) => void }) {
  return (
    <button
      type="button"
      onClick={() => onSelect(member)}
      className="w-full text-left rounded-xl border border-[var(--divider)] bg-[var(--surface-elevated)] p-4 hover:border-[var(--action-primary)] hover:bg-[var(--action-primary-fill)] transition-all focus:outline-none focus:ring-2 focus:ring-[var(--focus)]"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-3 min-w-0">
          <div className="relative flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-[var(--action-primary)]/15 text-sm font-bold text-[var(--action-primary)] uppercase select-none">
            {member.name.charAt(0)}
            <AvailabilityDot availability={member.availability} />
          </div>
          <div className="min-w-0">
            <p className="font-semibold text-sm text-[var(--text-primary)] truncate">{member.name}</p>
            <p className="text-xs text-[var(--text-secondary)] truncate">{member.responsibility}</p>
          </div>
        </div>
        <ChevronRight className="h-4 w-4 shrink-0 text-[var(--text-muted)] mt-1" aria-hidden="true" />
      </div>

      <div className="mt-3 flex flex-wrap gap-2 text-xs text-[var(--text-muted)]">
        <span className="flex items-center gap-1">
          <Mail className="h-3 w-3" />{member.email}
        </span>
        {member.active_incidents > 0 && (
          <span className="flex items-center gap-1 rounded-full bg-orange-500/15 px-2 py-0.5 text-orange-400 font-medium">
            <Activity className="h-3 w-3" />
            {member.active_incidents} active
          </span>
        )}
      </div>

      <div className="mt-2 flex flex-wrap gap-1.5">
        {member.skills.split(',').filter(Boolean).slice(0, 3).map(s => (
          <span key={s.trim()} className="rounded-full bg-[var(--surface-base)] border border-[var(--divider)] px-2 py-0.5 text-[10px] text-[var(--text-secondary)] capitalize">
            {s.trim()}
          </span>
        ))}
        {member.zones !== 'all' && member.zones.split(',').filter(Boolean).slice(0, 2).map(z => (
          <span key={z.trim()} className="rounded-full bg-blue-500/10 border border-blue-500/20 px-2 py-0.5 text-[10px] text-blue-400 flex items-center gap-0.5">
            <MapPin className="h-2.5 w-2.5" />{z.trim()}
          </span>
        ))}
      </div>
    </button>
  );
}

// ─── Profile Slide-Over ───────────────────────────────────────────────────────

function MemberProfile({ member, onClose }: { member: TeamMember; onClose: () => void }) {
  const setSelectedView = useDashboardStore(s => s.setSelectedView);

  return (
    <div className="fixed inset-0 z-50 flex" aria-modal="true" role="dialog" aria-label="Team member profile">
      {/* Backdrop */}
      <button type="button" className="fixed inset-0 bg-[var(--metallic-black)]/60" onClick={onClose} aria-label="Close profile" />

      {/* Panel */}
      <div className="relative ml-auto flex h-full w-full max-w-md flex-col bg-[var(--sidebar-bg)] border-l border-[var(--divider)] shadow-2xl overflow-y-auto">
        <div className="flex items-center justify-between border-b border-[var(--divider)] px-6 py-4">
          <h2 className="text-base font-semibold text-[var(--text-primary)]">Team Member</h2>
          <button type="button" onClick={onClose} className="rounded-md p-1 text-[var(--text-muted)] hover:text-[var(--text-primary)] focus:outline-none focus:ring-2 focus:ring-[var(--focus)]" aria-label="Close">
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="flex-1 space-y-6 p-6">
          {/* Avatar + Name */}
          <div className="flex items-center gap-4">
            <div className="flex h-16 w-16 shrink-0 items-center justify-center rounded-full bg-[var(--action-primary)]/15 text-2xl font-bold text-[var(--action-primary)] uppercase select-none">
              {member.name.charAt(0)}
            </div>
            <div>
              <h3 className="text-lg font-bold text-[var(--text-primary)]">{member.name}</h3>
              <p className="text-sm text-[var(--text-secondary)] capitalize">{member.role.replace('_', ' ')}</p>
              <div className="mt-1 flex items-center gap-2">
                <AvailabilityDot availability={member.availability} />
                <span className="text-xs capitalize text-[var(--text-muted)]">{member.availability}</span>
              </div>
            </div>
          </div>

          {/* Details */}
          <div className="space-y-3 rounded-xl border border-[var(--divider)] p-4 text-sm">
            <div className="flex items-start gap-3">
              <Mail className="mt-0.5 h-4 w-4 shrink-0 text-[var(--text-muted)]" />
              <div>
                <p className="text-xs text-[var(--text-muted)]">Email</p>
                <p className="text-[var(--text-primary)]">{member.email}</p>
              </div>
            </div>
            <div className="flex items-start gap-3">
              <Briefcase className="mt-0.5 h-4 w-4 shrink-0 text-[var(--text-muted)]" />
              <div>
                <p className="text-xs text-[var(--text-muted)]">Responsibility</p>
                <p className="text-[var(--text-primary)]">{member.responsibility}</p>
              </div>
            </div>
            <div className="flex items-start gap-3">
              <Activity className="mt-0.5 h-4 w-4 shrink-0 text-[var(--text-muted)]" />
              <div>
                <p className="text-xs text-[var(--text-muted)]">Active Incidents</p>
                <p className={`font-semibold ${member.active_incidents > 0 ? 'text-orange-400' : 'text-green-400'}`}>
                  {member.active_incidents > 0 ? `${member.active_incidents} in progress` : 'None — available'}
                </p>
              </div>
            </div>
          </div>

          {/* Skills */}
          <div>
            <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-[var(--text-muted)]">Skills</p>
            <div className="flex flex-wrap gap-1.5">
              {member.skills.split(',').filter(Boolean).map(s => (
                <span key={s.trim()} className="rounded-full border border-[var(--divider)] bg-[var(--surface-elevated)] px-2.5 py-1 text-xs capitalize text-[var(--text-secondary)]">
                  {s.trim()}
                </span>
              ))}
            </div>
          </div>

          {/* Zones */}
          <div>
            <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-[var(--text-muted)]">Assigned Zones</p>
            <div className="flex flex-wrap gap-1.5">
              {member.zones === 'all' ? (
                <span className="rounded-full bg-blue-500/10 border border-blue-500/20 px-2.5 py-1 text-xs text-blue-400">All Zones</span>
              ) : member.zones.split(',').filter(Boolean).map(z => (
                <span key={z.trim()} className="rounded-full bg-blue-500/10 border border-blue-500/20 px-2.5 py-1 text-xs text-blue-400 flex items-center gap-1">
                  <MapPin className="h-3 w-3" />{z.trim()}
                </span>
              ))}
            </div>
          </div>

          <Button
            variant="secondary"
            className="w-full"
            onClick={() => { setSelectedView('incidents'); onClose(); }}
          >
            View Their Incident Assignments →
          </Button>
        </div>
      </div>
    </div>
  );
}

// ─── Add Sub-Organizer Wizard ─────────────────────────────────────────────────

interface WizardProps {
  eventId: string;
  onClose: () => void;
  onCreated: () => void;
}

type WizardStep = 1 | 2 | 3 | 4;

function AddSubOrganizerWizard({ eventId, onClose, onCreated }: WizardProps) {
  const [step, setStep] = useState<WizardStep>(1);
  const [form, setForm] = useState({
    name: '', email: '', password: '', confirmPassword: '',
    responsibility: '', skills: '', zones: '',
  });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  function update(field: keyof typeof form, value: string) {
    setForm(f => ({ ...f, [field]: value }));
    setErrors(e => { const n = { ...e }; delete n[field]; return n; });
  }

  function validateStep1(): boolean {
    const errs: Record<string, string> = {};
    if (!form.name.trim()) errs.name = 'Name is required.';
    if (!form.email.trim() || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email)) errs.email = 'A valid email is required.';
    if (!form.password || form.password.length < 8) errs.password = 'Password must be at least 8 characters.';
    if (form.password !== form.confirmPassword) errs.confirmPassword = 'Passwords do not match.';
    setErrors(errs);
    return Object.keys(errs).length === 0;
  }

  function validateStep2(): boolean {
    const errs: Record<string, string> = {};
    if (!form.responsibility.trim()) errs.responsibility = 'Responsibility is required.';
    setErrors(errs);
    return Object.keys(errs).length === 0;
  }

  async function handleSubmit() {
    setSubmitting(true);
    setSubmitError(null);
    try {
      await api.createSubOrganizer({
        name: form.name.trim(),
        email: form.email.trim().toLowerCase(),
        password: form.password,
        responsibility: form.responsibility.trim(),
        eventId,
        skills: form.skills.trim() || 'operations',
        zones: form.zones.trim() || 'all',
      });
      setStep(4);
    } catch (e) {
      setSubmitError(e instanceof Error ? e.message : 'Failed to create sub-organizer.');
    } finally {
      setSubmitting(false);
    }
  }

  const fieldCls = (name: string) =>
    `w-full rounded-lg border px-3 py-2.5 text-sm bg-[var(--surface-elevated)] text-[var(--text-primary)] placeholder:text-[var(--text-muted)] focus:outline-none focus:ring-2 focus:ring-[var(--focus)] transition-colors ${errors[name] ? 'border-red-500' : 'border-[var(--divider)]'}`;

  const stepLabels = ['Account', 'Role & Skills', 'Review', 'Done'];

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto py-10 px-4" aria-modal="true" role="dialog" aria-label="Add sub-organizer">
      {/* Backdrop */}
      <button type="button" className="fixed inset-0 bg-[var(--metallic-black)]/60" onClick={onClose} aria-label="Close wizard" />

      <div className="relative w-full max-w-lg rounded-2xl border border-[var(--divider)] bg-[var(--sidebar-bg)] shadow-2xl">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-[var(--divider)] px-6 py-4">
          <div>
            <h2 className="text-base font-semibold text-[var(--text-primary)]">Add Sub-Organizer</h2>
            <p className="text-xs text-[var(--text-muted)]">Step {step} of {stepLabels.length}: {stepLabels[step - 1]}</p>
          </div>
          <button type="button" onClick={onClose} className="rounded-md p-1 text-[var(--text-muted)] hover:text-[var(--text-primary)] focus:outline-none focus:ring-2 focus:ring-[var(--focus)]" aria-label="Close">
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Progress bar */}
        <div className="flex h-1 bg-[var(--divider)]">
          <div
            className="h-full bg-[var(--action-primary)] transition-all duration-300"
            style={{ width: `${(step / stepLabels.length) * 100}%` }}
          />
        </div>

        <div className="p-6 space-y-5">
          {/* Step 1 — Account Details */}
          {step === 1 && (
            <>
              <p className="text-sm text-[var(--text-secondary)]">Create login credentials for the new team member.</p>
              <div className="space-y-4">
                <div>
                  <label className="mb-1 block text-xs font-medium text-[var(--text-secondary)]">Full Name *</label>
                  <input className={fieldCls('name')} value={form.name} onChange={e => update('name', e.target.value)} placeholder="e.g. Priya Sharma" autoFocus />
                  {errors.name && <p className="mt-1 text-xs text-red-400">{errors.name}</p>}
                </div>
                <div>
                  <label className="mb-1 block text-xs font-medium text-[var(--text-secondary)]">Email Address *</label>
                  <input className={fieldCls('email')} type="email" value={form.email} onChange={e => update('email', e.target.value)} placeholder="e.g. priya@college.edu" />
                  {errors.email && <p className="mt-1 text-xs text-red-400">{errors.email}</p>}
                </div>
                <div>
                  <label className="mb-1 block text-xs font-medium text-[var(--text-secondary)]">Password *</label>
                  <input className={fieldCls('password')} type="password" value={form.password} onChange={e => update('password', e.target.value)} placeholder="Min. 8 characters" />
                  {errors.password && <p className="mt-1 text-xs text-red-400">{errors.password}</p>}
                </div>
                <div>
                  <label className="mb-1 block text-xs font-medium text-[var(--text-secondary)]">Confirm Password *</label>
                  <input className={fieldCls('confirmPassword')} type="password" value={form.confirmPassword} onChange={e => update('confirmPassword', e.target.value)} placeholder="Repeat password" />
                  {errors.confirmPassword && <p className="mt-1 text-xs text-red-400">{errors.confirmPassword}</p>}
                </div>
              </div>
              <div className="flex justify-end">
                <Button onClick={() => { if (validateStep1()) setStep(2); }}>Next →</Button>
              </div>
            </>
          )}

          {/* Step 2 — Role & Skills */}
          {step === 2 && (
            <>
              <p className="text-sm text-[var(--text-secondary)]">Define their role, expertise, and assigned operational zones.</p>
              <div className="space-y-4">
                <div>
                  <label className="mb-1 block text-xs font-medium text-[var(--text-secondary)]">Event Responsibility *</label>
                  <input className={fieldCls('responsibility')} value={form.responsibility} onChange={e => update('responsibility', e.target.value)} placeholder="e.g. Transport Coordinator" autoFocus />
                  {errors.responsibility && <p className="mt-1 text-xs text-red-400">{errors.responsibility}</p>}
                </div>
                <div>
                  <label className="mb-1 block text-xs font-medium text-[var(--text-secondary)]">Skills <span className="text-[var(--text-muted)]">(comma-separated)</span></label>
                  <input className={fieldCls('skills')} value={form.skills} onChange={e => update('skills', e.target.value)} placeholder="e.g. transport, logistics, first-aid" />
                  <p className="mt-1 text-xs text-[var(--text-muted)]">Used for incident responder recommendations.</p>
                </div>
                <div>
                  <label className="mb-1 block text-xs font-medium text-[var(--text-secondary)]">Assigned Zones <span className="text-[var(--text-muted)]">(or leave blank for all)</span></label>
                  <input className={fieldCls('zones')} value={form.zones} onChange={e => update('zones', e.target.value)} placeholder="e.g. Gate A, Main Hall, Parking" />
                  <p className="mt-1 text-xs text-[var(--text-muted)]">Incidents in these zones will be prioritised for this responder.</p>
                </div>
              </div>
              <div className="flex justify-between">
                <Button variant="secondary" onClick={() => setStep(1)}>← Back</Button>
                <Button onClick={() => { if (validateStep2()) setStep(3); }}>Next →</Button>
              </div>
            </>
          )}

          {/* Step 3 — Review */}
          {step === 3 && (
            <>
              <p className="text-sm text-[var(--text-secondary)]">Review the details before creating the account.</p>
              <div className="rounded-xl border border-[var(--divider)] divide-y divide-[var(--divider)] text-sm">
                {[
                  { label: 'Name', value: form.name },
                  { label: 'Email', value: form.email },
                  { label: 'Password', value: '••••••••' },
                  { label: 'Responsibility', value: form.responsibility },
                  { label: 'Skills', value: form.skills || 'operations' },
                  { label: 'Zones', value: form.zones || 'All zones' },
                ].map(({ label, value }) => (
                  <div key={label} className="flex items-start gap-3 px-4 py-3">
                    <span className="w-32 shrink-0 text-xs text-[var(--text-muted)]">{label}</span>
                    <span className="text-[var(--text-primary)]">{value}</span>
                  </div>
                ))}
              </div>
              {submitError && (
                <div className="rounded-lg border border-red-500/30 bg-red-500/5 px-4 py-3 text-sm text-red-400">
                  {submitError}
                </div>
              )}
              <div className="flex justify-between">
                <Button variant="secondary" onClick={() => setStep(2)}>← Back</Button>
                <Button onClick={handleSubmit} disabled={submitting}>
                  {submitting ? <><RefreshCw className="h-4 w-4 animate-spin" /> Creating…</> : 'Create Account'}
                </Button>
              </div>
            </>
          )}

          {/* Step 4 — Done */}
          {step === 4 && (
            <div className="py-4 text-center space-y-4">
              <CheckCircle2 className="mx-auto h-12 w-12 text-green-400" />
              <div>
                <h3 className="text-base font-semibold text-[var(--text-primary)]">Account Created!</h3>
                <p className="mt-1 text-sm text-[var(--text-secondary)]">
                  <strong>{form.name}</strong> has been added as a sub-organizer and assigned to this event.
                </p>
                <p className="mt-1 text-xs text-[var(--text-muted)]">They can log in with their email and password immediately.</p>
              </div>
              <Button onClick={() => { onCreated(); onClose(); }}>
                Done
              </Button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Main TeamDirectory Component ─────────────────────────────────────────────

export function TeamDirectory() {
  const { event } = useDashboardStore();
  const isUsingApi = useDashboardStore(s => s.isUsingApi);

  const [members, setMembers] = useState<TeamMember[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [availFilter, setAvailFilter] = useState<'all' | 'available' | 'busy' | 'offline'>('all');
  const [selectedMember, setSelectedMember] = useState<TeamMember | null>(null);
  const [showWizard, setShowWizard] = useState(false);

  const load = useCallback(async () => {
    if (!event?.id) return;
    setLoading(true);
    setError(null);
    try {
      const data = await api.listTeamMembers(event.id);
      setMembers(data as unknown as TeamMember[]);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load team members');
    } finally {
      setLoading(false);
    }
  }, [event?.id]);

  useEffect(() => { void load(); }, [load]);

  const filtered = members.filter(m => {
    const matchSearch = !search || m.name.toLowerCase().includes(search.toLowerCase()) || m.email.toLowerCase().includes(search.toLowerCase()) || m.responsibility.toLowerCase().includes(search.toLowerCase());
    const matchAvail = availFilter === 'all' || m.availability === availFilter;
    return matchSearch && matchAvail;
  });

  const summary = {
    total: members.length,
    available: members.filter(m => m.availability === 'available').length,
    busy: members.filter(m => m.availability === 'busy').length,
    totalActiveIncidents: members.reduce((acc, m) => acc + (m.active_incidents ?? 0), 0),
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-2">
          <Users className="h-5 w-5 text-[var(--action-primary)]" />
          <h2 className="text-base font-semibold text-[var(--text-primary)]">Team & Responders</h2>
          {loading && <RefreshCw className="h-4 w-4 animate-spin text-[var(--text-muted)]" />}
        </div>
        <div className="flex items-center gap-2">
          <Button variant="ghost" size="sm" onClick={load} aria-label="Refresh team">
            <RefreshCw className="h-3.5 w-3.5" />
          </Button>
          {isUsingApi && (
            <Button size="sm" onClick={() => setShowWizard(true)}>
              <Plus className="h-4 w-4" />
              Add Sub-Organizer
            </Button>
          )}
        </div>
      </div>

      {/* Summary KPIs */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {[
          { label: 'Total Members', value: summary.total, color: 'default' },
          { label: 'Available', value: summary.available, color: 'green' },
          { label: 'Busy', value: summary.busy, color: 'orange' },
          { label: 'Active Incidents', value: summary.totalActiveIncidents, color: summary.totalActiveIncidents > 0 ? 'orange' : 'default' },
        ].map(({ label, value, color }) => (
          <div key={label} className={`rounded-xl border p-3 ${color === 'green' ? 'border-green-500/30 bg-green-500/5' : color === 'orange' ? 'border-orange-500/30 bg-orange-500/5' : 'border-[var(--divider)] bg-[var(--surface-elevated)]'}`}>
            <p className="text-xs text-[var(--text-muted)]">{label}</p>
            <p className={`text-2xl font-bold tabular-nums mt-0.5 ${color === 'green' ? 'text-green-400' : color === 'orange' ? 'text-orange-400' : 'text-[var(--text-primary)]'}`}>{value}</p>
          </div>
        ))}
      </div>

      {/* Search + Filter */}
      <div className="flex flex-col gap-3 sm:flex-row">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-[var(--text-muted)]" />
          <input
            type="search"
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search by name, email, or role…"
            className="w-full rounded-lg border border-[var(--divider)] bg-[var(--surface-elevated)] py-2.5 pl-9 pr-3 text-sm text-[var(--text-primary)] placeholder:text-[var(--text-muted)] focus:outline-none focus:ring-2 focus:ring-[var(--focus)]"
          />
        </div>
        <select
          value={availFilter}
          onChange={e => setAvailFilter(e.target.value as typeof availFilter)}
          className="rounded-lg border border-[var(--divider)] bg-[var(--surface-elevated)] px-3 py-2.5 text-sm text-[var(--text-secondary)] focus:outline-none focus:ring-2 focus:ring-[var(--focus)]"
          aria-label="Filter by availability"
        >
          <option value="all">All availability</option>
          <option value="available">Available</option>
          <option value="busy">Busy</option>
          <option value="offline">Offline</option>
        </select>
      </div>

      {error && (
        <div className="rounded-lg border border-red-500/30 bg-red-500/5 px-4 py-3 text-sm text-red-400 flex items-center gap-2">
          <AlertTriangle className="h-4 w-4 shrink-0" />
          {error}
        </div>
      )}

      {/* Team Grid */}
      {!loading && filtered.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center">
            <Users className="mx-auto h-10 w-10 text-[var(--text-muted)]" />
            <p className="mt-3 text-sm font-medium text-[var(--text-secondary)]">
              {members.length === 0 ? 'No team members assigned to this event yet.' : 'No members match your search.'}
            </p>
            {members.length === 0 && isUsingApi && (
              <Button className="mt-4" onClick={() => setShowWizard(true)}>
                <Plus className="h-4 w-4" />
                Add First Sub-Organizer
              </Button>
            )}
          </CardContent>
        </Card>
      ) : (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {filtered.map(m => (
            <MemberCard key={m.id} member={m} onSelect={setSelectedMember} />
          ))}
        </div>
      )}

      {/* Profile Slide-Over */}
      {selectedMember && (
        <MemberProfile member={selectedMember} onClose={() => setSelectedMember(null)} />
      )}

      {/* Add Sub-Organizer Wizard */}
      {showWizard && event?.id && (
        <AddSubOrganizerWizard
          eventId={event.id}
          onClose={() => setShowWizard(false)}
          onCreated={() => { void load(); }}
        />
      )}
    </div>
  );
}
