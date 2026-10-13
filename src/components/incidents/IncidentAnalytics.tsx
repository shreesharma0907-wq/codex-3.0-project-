'use client';

import React, { useEffect, useState, useCallback } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  Clock,
  TrendingUp,
  MapPin,
  Users,
  RefreshCw,
  ChevronDown,
  ChevronUp,
  ExternalLink,
} from 'lucide-react';
import { api } from '@/lib/api';
import { useDashboardStore } from '@/lib/dashboard-state';
import type { IncidentAnalyticsResponse, IncidentRow } from '@/app/api/events/[eventId]/incidents/analytics/route';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function fmtDuration(minutes: number | null): string {
  if (minutes === null) return '—';
  if (minutes < 60) return `${minutes}m`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m > 0 ? `${h}h ${m}m` : `${h}h`;
}

function statusColor(status: string): string {
  switch (status) {
    case 'new': return 'bg-blue-500/15 text-blue-400';
    case 'acknowledged': return 'bg-yellow-500/15 text-yellow-400';
    case 'assigned':
    case 'in_progress': return 'bg-purple-500/15 text-purple-400';
    case 'waiting_external': return 'bg-orange-500/15 text-orange-400';
    case 'resolved': return 'bg-green-500/15 text-green-400';
    case 'closed': return 'bg-[var(--surface-elevated)] text-[var(--text-muted)]';
    case 'reopened': return 'bg-red-500/15 text-red-400';
    default: return 'bg-[var(--surface-elevated)] text-[var(--text-secondary)]';
  }
}

function priorityColor(score: number): string {
  if (score >= 80) return 'text-red-400';
  if (score >= 60) return 'text-orange-400';
  if (score >= 40) return 'text-yellow-400';
  return 'text-green-400';
}

function priorityLabel(score: number): string {
  if (score >= 80) return 'Critical';
  if (score >= 60) return 'High';
  if (score >= 40) return 'Medium';
  return 'Low';
}

// ─── Mini Bar Chart ───────────────────────────────────────────────────────────

interface MiniBarProps {
  data: { label: string; reported: number; resolved: number }[];
}

function MiniBarChart({ data }: MiniBarProps) {
  const maxVal = Math.max(...data.map(d => d.reported), 1);
  return (
    <div className="flex items-end gap-1 h-20" role="img" aria-label="Incident trend chart">
      {data.map((d, i) => (
        <div key={i} className="flex flex-col items-center gap-0.5 flex-1 min-w-0" title={`${d.label}: ${d.reported} reported, ${d.resolved} resolved`}>
          <div className="w-full flex flex-col-reverse gap-px">
            <div
              className="w-full rounded-t-sm bg-[var(--action-primary)] opacity-70 transition-all"
              style={{ height: `${Math.round((d.reported / maxVal) * 64)}px` }}
            />
          </div>
          <span className="text-[9px] text-[var(--text-muted)] truncate w-full text-center">{d.label}</span>
        </div>
      ))}
    </div>
  );
}

// ─── KPI Card ─────────────────────────────────────────────────────────────────

interface KpiProps {
  label: string;
  value: string | number;
  subtext?: string;
  icon: React.ReactNode;
  accent?: 'red' | 'orange' | 'green' | 'blue' | 'default';
  onClick?: () => void;
}

function KpiCard({ label, value, subtext, icon, accent = 'default', onClick }: KpiProps) {
  const accentClass = {
    red: 'border-red-500/30 bg-red-500/5',
    orange: 'border-orange-500/30 bg-orange-500/5',
    green: 'border-green-500/30 bg-green-500/5',
    blue: 'border-blue-500/30 bg-blue-500/5',
    default: 'border-[var(--divider)] bg-[var(--surface-elevated)]',
  }[accent];
  const valueClass = {
    red: 'text-red-400',
    orange: 'text-orange-400',
    green: 'text-green-400',
    blue: 'text-blue-400',
    default: 'text-[var(--text-primary)]',
  }[accent];

  return (
    <button
      type="button"
      onClick={onClick}
      className={`text-left rounded-xl border p-4 transition-all ${accentClass} ${onClick ? 'hover:scale-[1.01] cursor-pointer' : 'cursor-default'}`}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="text-xs font-medium text-[var(--text-secondary)] truncate">{label}</p>
          <p className={`mt-1 text-2xl font-bold tabular-nums ${valueClass}`}>{value}</p>
          {subtext && <p className="mt-0.5 text-xs text-[var(--text-muted)] truncate">{subtext}</p>}
        </div>
        <div className="shrink-0 text-[var(--text-muted)]">{icon}</div>
      </div>
    </button>
  );
}

// ─── Incident Table Row ───────────────────────────────────────────────────────

function IncidentTableRow({ inc }: { inc: IncidentRow }) {
  const setSelectedView = useDashboardStore(state => state.setSelectedView);
  return (
    <tr
      className="border-b border-[var(--divider)] hover:bg-[var(--surface-elevated)] cursor-pointer transition-colors"
      onClick={() => setSelectedView('incidents')}
      title="Open in Incident Desk"
    >
      <td className="py-2.5 px-3 font-mono text-xs text-[var(--action-primary)] whitespace-nowrap">
        {inc.referenceNumber}
      </td>
      <td className="py-2.5 px-3 text-xs text-[var(--text-primary)] max-w-[200px]">
        <div className="truncate font-medium">{inc.title}</div>
        <div className="truncate text-[var(--text-muted)]">{inc.reporterName}</div>
      </td>
      <td className="py-2.5 px-3 text-xs text-[var(--text-secondary)] hidden sm:table-cell capitalize">{inc.category}</td>
      <td className="py-2.5 px-3 text-xs hidden md:table-cell">
        <span className={`font-semibold ${priorityColor(inc.priorityScore)}`}>
          {priorityLabel(inc.priorityScore)}
        </span>
      </td>
      <td className="py-2.5 px-3 text-xs hidden lg:table-cell text-[var(--text-muted)]">
        {inc.zone ?? '—'}
      </td>
      <td className="py-2.5 px-3">
        <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-semibold ${statusColor(inc.status)}`}>
          {inc.status.replace('_', ' ')}
        </span>
      </td>
      <td className="py-2.5 px-3 text-xs text-[var(--text-muted)] hidden xl:table-cell">
        {inc.responderName ?? <span className="text-[var(--text-muted)] italic">unassigned</span>}
      </td>
      <td className="py-2.5 px-3 text-xs text-[var(--text-muted)] whitespace-nowrap hidden lg:table-cell">
        {new Date(inc.createdAt).toLocaleString(undefined, { dateStyle: 'short', timeStyle: 'short' })}
      </td>
      <td className="py-2.5 px-3">
        <ExternalLink className="h-3.5 w-3.5 text-[var(--text-muted)]" />
      </td>
    </tr>
  );
}

// ─── Main Component ───────────────────────────────────────────────────────────

export function IncidentAnalytics() {
  const { event } = useDashboardStore();
  const setSelectedView = useDashboardStore(state => state.setSelectedView);
  const isUsingApi = useDashboardStore(state => state.isUsingApi);

  const [analytics, setAnalytics] = useState<IncidentAnalyticsResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [period, setPeriod] = useState<'hourly' | 'daily' | 'weekly'>('daily');
  const [tableExpanded, setTableExpanded] = useState(false);
  const [page, setPage] = useState(1);

  const load = useCallback(async () => {
    if (!event?.id) return;
    setLoading(true);
    setError(null);
    try {
      const data = await api.listIncidentAnalytics(event.id, { period, page, limit: 10 });
      setAnalytics(data);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load analytics');
    } finally {
      setLoading(false);
    }
  }, [event?.id, period, page]);

  useEffect(() => { void load(); }, [load]);

  // Don't render if no event or not in API mode
  if (!event?.id || !isUsingApi) return null;

  const s = analytics?.summary;
  const hasData = s && s.total > 0;

  // Build time-series display data — last 14 data points for readability
  const tsBuckets = (analytics?.timeSeries ?? []).slice(-14).map(b => ({
    label: b.bucket.slice(5), // trim year for brevity
    reported: b.reported,
    resolved: b.resolved,
  }));

  return (
    <div className="space-y-4">
      {/* ── Section Header ── */}
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <AlertTriangle className="h-5 w-5 text-[var(--action-primary)]" aria-hidden="true" />
          <h2 className="text-base font-semibold text-[var(--text-primary)]">Incident Intelligence</h2>
          {loading && <RefreshCw className="h-4 w-4 animate-spin text-[var(--text-muted)]" />}
        </div>
        <div className="flex items-center gap-2">
          <select
            value={period}
            onChange={e => { setPeriod(e.target.value as typeof period); setPage(1); }}
            className="rounded-lg border border-[var(--divider)] bg-[var(--surface-elevated)] px-2 py-1 text-xs text-[var(--text-secondary)] focus:outline-none focus:ring-2 focus:ring-[var(--focus)]"
            aria-label="Select time period"
          >
            <option value="hourly">Hourly (today)</option>
            <option value="daily">Daily</option>
            <option value="weekly">Weekly</option>
          </select>
          <Button variant="ghost" size="sm" onClick={load} aria-label="Refresh analytics">
            <RefreshCw className="h-3.5 w-3.5" />
          </Button>
          <Button variant="ghost" size="sm" onClick={() => setSelectedView('incidents')}>
            Open Incident Desk
          </Button>
        </div>
      </div>

      {error && (
        <div className="rounded-lg border border-red-500/30 bg-red-500/5 px-4 py-3 text-sm text-red-400">
          {error}
        </div>
      )}

      {/* ── KPI Grid ── */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
        <KpiCard
          label="Total Incidents"
          value={s?.total ?? '—'}
          icon={<AlertTriangle className="h-5 w-5" />}
          accent="default"
          onClick={() => setSelectedView('incidents')}
        />
        <KpiCard
          label="New / Unacknowledged"
          value={s ? s.new + s.acknowledged : '—'}
          subtext={s?.overdueCount ? `${s.overdueCount} overdue` : undefined}
          icon={<Clock className="h-5 w-5" />}
          accent={s && (s.new + s.acknowledged) > 0 ? 'orange' : 'default'}
          onClick={() => setSelectedView('incidents')}
        />
        <KpiCard
          label="Critical / High"
          value={s ? `${s.critical} / ${s.high}` : '—'}
          icon={<TrendingUp className="h-5 w-5" />}
          accent={s && s.critical > 0 ? 'red' : s && s.high > 0 ? 'orange' : 'default'}
          onClick={() => setSelectedView('incidents')}
        />
        <KpiCard
          label="Active (In Progress)"
          value={s?.active ?? '—'}
          icon={<Users className="h-5 w-5" />}
          accent={s && s.active > 3 ? 'orange' : 'default'}
        />
        <KpiCard
          label="Resolved / Closed"
          value={s ? `${s.resolved} / ${s.closed}` : '—'}
          subtext={s?.avgResolutionTimeMinutes != null ? `Avg ${fmtDuration(s.avgResolutionTimeMinutes)}` : undefined}
          icon={<CheckCircle2 className="h-5 w-5" />}
          accent={s && s.resolved > 0 ? 'green' : 'default'}
        />
      </div>

      {/* ── Acknowledgement time KPI ── */}
      {s && s.avgAckTimeMinutes != null && (
        <div className="flex items-center gap-3 rounded-lg border border-[var(--divider)] bg-[var(--surface-elevated)] px-4 py-2 text-sm">
          <Clock className="h-4 w-4 shrink-0 text-[var(--text-muted)]" />
          <span className="text-[var(--text-secondary)]">Avg acknowledgement time:</span>
          <span className="font-semibold text-[var(--text-primary)]">{fmtDuration(s.avgAckTimeMinutes)}</span>
          {s.overdueCount > 0 && (
            <>
              <span className="mx-2 text-[var(--divider)]">·</span>
              <span className="text-orange-400 font-semibold">{s.overdueCount} overdue</span>
              <span className="text-[var(--text-muted)] text-xs">(unassigned &gt;60 min)</span>
            </>
          )}
        </div>
      )}

      {hasData ? (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
          {/* ── Trend Chart ── */}
          <Card className="lg:col-span-2">
            <CardHeader>
              <CardTitle className="text-sm">Incident Trend</CardTitle>
            </CardHeader>
            <CardContent>
              {tsBuckets.length > 0 ? (
                <MiniBarChart data={tsBuckets} />
              ) : (
                <div className="flex h-20 items-center justify-center text-xs text-[var(--text-muted)]">
                  No time-series data for this period.
                </div>
              )}
            </CardContent>
          </Card>

          {/* ── Zone Breakdown ── */}
          <Card>
            <CardHeader>
              <CardTitle className="text-sm flex items-center gap-1.5">
                <MapPin className="h-4 w-4" /> Zone Breakdown
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              {analytics?.zoneStat.length === 0 && (
                <p className="text-xs text-[var(--text-muted)]">No zone data available.</p>
              )}
              {analytics?.zoneStat.slice(0, 6).map(z => (
                <div key={z.zone} className="flex items-center gap-2 text-xs">
                  <span className="flex-1 truncate text-[var(--text-secondary)]">{z.zone}</span>
                  <span className="font-semibold tabular-nums text-[var(--text-primary)]">{z.total}</span>
                  {z.critical > 0 && (
                    <span className="rounded-full bg-red-500/15 px-1.5 py-0.5 text-[10px] font-semibold text-red-400">
                      {z.critical}✕crit
                    </span>
                  )}
                  {z.unresolved > 0 && (
                    <span className="rounded-full bg-orange-500/15 px-1.5 py-0.5 text-[10px] text-orange-400">
                      {z.unresolved} open
                    </span>
                  )}
                </div>
              ))}
            </CardContent>
          </Card>
        </div>
      ) : !loading ? (
        <Card>
          <CardContent className="py-8 text-center">
            <AlertTriangle className="mx-auto h-8 w-8 text-[var(--text-muted)]" />
            <p className="mt-2 text-sm text-[var(--text-secondary)]">No incidents reported for this event yet.</p>
            <p className="text-xs text-[var(--text-muted)]">Incidents reported by participants will appear here.</p>
          </CardContent>
        </Card>
      ) : null}

      {/* ── Category Summary ── */}
      {(analytics?.categoryStat ?? []).length > 0 && (
        <div className="flex flex-wrap gap-2">
          {analytics!.categoryStat.map(c => (
            <div key={c.category} className="flex items-center gap-1.5 rounded-full border border-[var(--divider)] bg-[var(--surface-elevated)] px-3 py-1 text-xs">
              <span className="capitalize font-medium text-[var(--text-primary)]">{c.category}</span>
              <span className="text-[var(--text-muted)]">{c.total}</span>
              {c.unresolved > 0 && (
                <span className="rounded-full bg-orange-500/15 px-1 text-[10px] text-orange-400">{c.unresolved} open</span>
              )}
            </div>
          ))}
        </div>
      )}

      {/* ── Recent Incidents Table ── */}
      {(analytics?.recentIncidents ?? []).length > 0 && (
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <CardTitle className="text-sm">Recent Incidents</CardTitle>
              <button
                type="button"
                onClick={() => setTableExpanded(!tableExpanded)}
                className="flex items-center gap-1 text-xs text-[var(--text-secondary)] hover:text-[var(--action-primary)] focus:outline-none"
              >
                {tableExpanded ? 'Collapse' : 'Expand'}
                {tableExpanded ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
              </button>
            </div>
          </CardHeader>
          {tableExpanded && (
            <CardContent className="p-0">
              <div className="overflow-x-auto">
                <table className="w-full text-left">
                  <thead>
                    <tr className="border-b border-[var(--divider)] bg-[var(--surface-elevated)]">
                      <th className="py-2 px-3 text-[10px] font-semibold uppercase tracking-wide text-[var(--text-muted)]">Ref #</th>
                      <th className="py-2 px-3 text-[10px] font-semibold uppercase tracking-wide text-[var(--text-muted)]">Title / Reporter</th>
                      <th className="py-2 px-3 text-[10px] font-semibold uppercase tracking-wide text-[var(--text-muted)] hidden sm:table-cell">Category</th>
                      <th className="py-2 px-3 text-[10px] font-semibold uppercase tracking-wide text-[var(--text-muted)] hidden md:table-cell">Priority</th>
                      <th className="py-2 px-3 text-[10px] font-semibold uppercase tracking-wide text-[var(--text-muted)] hidden lg:table-cell">Zone</th>
                      <th className="py-2 px-3 text-[10px] font-semibold uppercase tracking-wide text-[var(--text-muted)]">Status</th>
                      <th className="py-2 px-3 text-[10px] font-semibold uppercase tracking-wide text-[var(--text-muted)] hidden xl:table-cell">Responder</th>
                      <th className="py-2 px-3 text-[10px] font-semibold uppercase tracking-wide text-[var(--text-muted)] hidden lg:table-cell">Reported</th>
                      <th className="py-2 px-3 w-8" />
                    </tr>
                  </thead>
                  <tbody>
                    {analytics!.recentIncidents.map(inc => (
                      <IncidentTableRow key={inc.id} inc={inc} />
                    ))}
                  </tbody>
                </table>
              </div>
              {/* Pagination */}
              <div className="flex items-center justify-between border-t border-[var(--divider)] px-4 py-3">
                <span className="text-xs text-[var(--text-muted)]">Page {page}</span>
                <div className="flex gap-2">
                  <Button variant="ghost" size="sm" disabled={page <= 1} onClick={() => setPage(p => Math.max(1, p - 1))}>
                    Previous
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    disabled={(analytics?.recentIncidents.length ?? 0) < 10}
                    onClick={() => setPage(p => p + 1)}
                  >
                    Next
                  </Button>
                </div>
              </div>
            </CardContent>
          )}
          {!tableExpanded && (
            <CardContent className="pt-0">
              <button
                type="button"
                onClick={() => setTableExpanded(true)}
                className="text-xs text-[var(--action-primary)] hover:underline focus:outline-none"
              >
                Show {analytics!.recentIncidents.length} incidents →
              </button>
            </CardContent>
          )}
        </Card>
      )}
    </div>
  );
}
