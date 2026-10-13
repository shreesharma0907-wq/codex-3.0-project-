import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/server/db';
import { currentUser } from '@/lib/server/auth';
import { jsonError, requireRole } from '@/lib/server/http';

export interface IncidentAnalyticsSummary {
  total: number;
  new: number;
  acknowledged: number;
  active: number;         // assigned + in_progress + waiting_external
  critical: number;       // priority_score >= 80
  high: number;           // priority_score 60-79
  resolved: number;
  closed: number;
  avgAckTimeMinutes: number | null;
  avgResolutionTimeMinutes: number | null;
  overdueCount: number;   // new/acknowledged > 60 min with no responder
}

export interface IncidentTimeSeries {
  bucket: string;         // ISO date string (hour or day depending on period)
  reported: number;
  resolved: number;
  unresolved: number;
}

export interface IncidentZoneStat {
  zone: string;
  total: number;
  critical: number;
  unresolved: number;
}

export interface IncidentCategoryStat {
  category: string;
  total: number;
  unresolved: number;
}

export interface IncidentRow {
  id: string;
  referenceNumber: string;
  reporterName: string;
  reporterId: string;
  eventId: string;
  category: string;
  title: string;
  zone: string | null;
  urgency: string;
  priorityScore: number;
  status: string;
  responderName: string | null;
  createdAt: string;
  updatedAt: string;
  acknowledgedAt: string | null;
  resolvedAt: string | null;
}

export interface IncidentAnalyticsResponse {
  summary: IncidentAnalyticsSummary;
  timeSeries: IncidentTimeSeries[];
  zoneStat: IncidentZoneStat[];
  categoryStat: IncidentCategoryStat[];
  recentIncidents: IncidentRow[];
  period: 'hourly' | 'daily' | 'weekly';
  generatedAt: string;
}

type Params = { params: Promise<{ eventId: string }> };

export async function GET(request: NextRequest, { params }: Params) {
  const user = await currentUser();
  const authError = requireRole(user, ['organizer', 'sub_organizer']);
  if (authError) return authError;

  const { eventId } = await params;

  // Verify event exists and user is organizer of it (or a sub_organizer)
  if (user!.role === 'organizer') {
    const event = db().prepare('SELECT id FROM events WHERE id=? AND organizer_id=?').get(eventId, user!.id);
    if (!event) return jsonError('Event not found.', 404, 'EVENT_NOT_FOUND');
  }

  const url = new URL(request.url);
  // period defaults to 'daily', can be 'hourly' or 'weekly'
  const period = (url.searchParams.get('period') ?? 'daily') as 'hourly' | 'daily' | 'weekly';
  // from/to allow custom date range filtering for time-series (ISO date strings)
  const fromParam = url.searchParams.get('from');
  const toParam = url.searchParams.get('to');
  const pageParam = parseInt(url.searchParams.get('page') ?? '1', 10);
  const limitParam = Math.min(parseInt(url.searchParams.get('limit') ?? '20', 10), 100);
  const offset = (pageParam - 1) * limitParam;

  // ── Summary Metrics ──────────────────────────────────────────────────────────
  type CountRow = { cnt: number | bigint };
  type AvgRow = { avg_minutes: number | null };
  type OverdueRow = { cnt: number | bigint };

  const total = Number((db().prepare(
    'SELECT COUNT(*) as cnt FROM incidents WHERE event_id=?'
  ).get(eventId) as CountRow).cnt);

  const newCount = Number((db().prepare(
    "SELECT COUNT(*) as cnt FROM incidents WHERE event_id=? AND status='new'"
  ).get(eventId) as CountRow).cnt);

  const ackCount = Number((db().prepare(
    "SELECT COUNT(*) as cnt FROM incidents WHERE event_id=? AND status='acknowledged'"
  ).get(eventId) as CountRow).cnt);

  const activeCount = Number((db().prepare(
    "SELECT COUNT(*) as cnt FROM incidents WHERE event_id=? AND status IN ('assigned','in_progress','waiting_external')"
  ).get(eventId) as CountRow).cnt);

  const criticalCount = Number((db().prepare(
    'SELECT COUNT(*) as cnt FROM incidents WHERE event_id=? AND priority_score >= 80'
  ).get(eventId) as CountRow).cnt);

  const highCount = Number((db().prepare(
    'SELECT COUNT(*) as cnt FROM incidents WHERE event_id=? AND priority_score >= 60 AND priority_score < 80'
  ).get(eventId) as CountRow).cnt);

  const resolvedCount = Number((db().prepare(
    "SELECT COUNT(*) as cnt FROM incidents WHERE event_id=? AND status='resolved'"
  ).get(eventId) as CountRow).cnt);

  const closedCount = Number((db().prepare(
    "SELECT COUNT(*) as cnt FROM incidents WHERE event_id=? AND status='closed'"
  ).get(eventId) as CountRow).cnt);

  // Average acknowledgement time (minutes) — only from incidents that have been acknowledged
  const avgAckRow = db().prepare(`
    SELECT AVG(
      (julianday(acknowledged_at) - julianday(created_at)) * 1440
    ) as avg_minutes
    FROM incidents
    WHERE event_id=? AND acknowledged_at IS NOT NULL
  `).get(eventId) as AvgRow;
  const avgAckTimeMinutes = avgAckRow.avg_minutes != null
    ? Math.round(avgAckRow.avg_minutes)
    : null;

  // Average resolution time (minutes) — only from resolved/closed incidents
  const avgResRow = db().prepare(`
    SELECT AVG(
      (julianday(resolved_at) - julianday(created_at)) * 1440
    ) as avg_minutes
    FROM incidents
    WHERE event_id=? AND resolved_at IS NOT NULL
  `).get(eventId) as AvgRow;
  const avgResolutionTimeMinutes = avgResRow.avg_minutes != null
    ? Math.round(avgResRow.avg_minutes)
    : null;

  // Overdue: new or acknowledged with no responder, reported > 60 min ago
  const overdueRow = db().prepare(`
    SELECT COUNT(*) as cnt FROM incidents
    WHERE event_id=?
      AND status IN ('new','acknowledged')
      AND assigned_responder_id IS NULL
      AND (julianday('now') - julianday(created_at)) * 1440 > 60
  `).get(eventId) as OverdueRow;
  const overdueCount = Number(overdueRow.cnt);

  const summary: IncidentAnalyticsSummary = {
    total, new: newCount, acknowledged: ackCount, active: activeCount,
    critical: criticalCount, high: highCount, resolved: resolvedCount,
    closed: closedCount, avgAckTimeMinutes, avgResolutionTimeMinutes, overdueCount,
  };

  // ── Time Series ──────────────────────────────────────────────────────────────
  // SQLite strftime format for each period
  const fmtMap = { hourly: '%Y-%m-%dT%H:00', daily: '%Y-%m-%d', weekly: '%Y-W%W' };
  const fmt = fmtMap[period];

  // Build WHERE clause for date filtering
  let dateWhereClause = 'WHERE event_id=?';
  const dateArgs: unknown[] = [eventId];
  if (fromParam) { dateWhereClause += ' AND created_at >= ?'; dateArgs.push(fromParam); }
  if (toParam)   { dateWhereClause += ' AND created_at <= ?'; dateArgs.push(toParam + 'T23:59:59'); }

  type TsBucket = { bucket: string; cnt: number | bigint };
  const reportedRows = db().prepare(`
    SELECT strftime('${fmt}', created_at) as bucket, COUNT(*) as cnt
    FROM incidents ${dateWhereClause}
    GROUP BY bucket ORDER BY bucket
  `).all(...dateArgs) as TsBucket[];

  const resolvedRows = db().prepare(`
    SELECT strftime('${fmt}', resolved_at) as bucket, COUNT(*) as cnt
    FROM incidents ${dateWhereClause} AND resolved_at IS NOT NULL
    GROUP BY bucket ORDER BY bucket
  `).all(...dateArgs) as TsBucket[];

  // Merge into a single time-series with reported + resolved + unresolved
  const bucketMap = new Map<string, { reported: number; resolved: number }>();
  for (const r of reportedRows) bucketMap.set(r.bucket, { reported: Number(r.cnt), resolved: 0 });
  for (const r of resolvedRows) {
    const existing = bucketMap.get(r.bucket);
    if (existing) existing.resolved = Number(r.cnt);
    else bucketMap.set(r.bucket, { reported: 0, resolved: Number(r.cnt) });
  }
  const timeSeries: IncidentTimeSeries[] = Array.from(bucketMap.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([bucket, { reported, resolved }]) => ({
      bucket,
      reported,
      resolved,
      unresolved: Math.max(0, reported - resolved),
    }));

  // ── Zone Breakdown ───────────────────────────────────────────────────────────
  type ZoneRow = { zone: string | null; total: number | bigint; critical: number | bigint; unresolved: number | bigint };
  const zoneRows = db().prepare(`
    SELECT
      COALESCE(zone, 'Unknown') as zone,
      COUNT(*) as total,
      SUM(CASE WHEN priority_score >= 80 THEN 1 ELSE 0 END) as critical,
      SUM(CASE WHEN status NOT IN ('resolved','closed') THEN 1 ELSE 0 END) as unresolved
    FROM incidents
    WHERE event_id=?
    GROUP BY zone
    ORDER BY total DESC
    LIMIT 15
  `).all(eventId) as ZoneRow[];

  const zoneStat: IncidentZoneStat[] = zoneRows.map(r => ({
    zone: r.zone ?? 'Unknown',
    total: Number(r.total),
    critical: Number(r.critical),
    unresolved: Number(r.unresolved),
  }));

  // ── Category Breakdown ───────────────────────────────────────────────────────
  type CatRow = { category: string; total: number | bigint; unresolved: number | bigint };
  const catRows = db().prepare(`
    SELECT
      category,
      COUNT(*) as total,
      SUM(CASE WHEN status NOT IN ('resolved','closed') THEN 1 ELSE 0 END) as unresolved
    FROM incidents
    WHERE event_id=?
    GROUP BY category
    ORDER BY total DESC
  `).all(eventId) as CatRow[];

  const categoryStat: IncidentCategoryStat[] = catRows.map(r => ({
    category: r.category,
    total: Number(r.total),
    unresolved: Number(r.unresolved),
  }));

  // ── Recent Incidents Table ───────────────────────────────────────────────────
  type RawIncidentRow = {
    id: string; reference_number: string; reporter_name: string; reporter_id: string;
    event_id: string; category: string; title: string; zone: string | null;
    urgency: string; priority_score: number; status: string;
    responder_name: string | null; created_at: string; updated_at: string;
    acknowledged_at: string | null; resolved_at: string | null;
  };

  const rawIncidents = db().prepare(`
    SELECT
      i.id, i.reference_number, u.name as reporter_name, i.reporter_id,
      i.event_id, i.category, i.title, i.zone, i.urgency, i.priority_score,
      i.status, r.name as responder_name, i.created_at, i.updated_at,
      i.acknowledged_at, i.resolved_at
    FROM incidents i
    JOIN users u ON u.id = i.reporter_id
    LEFT JOIN users r ON r.id = i.assigned_responder_id
    WHERE i.event_id=?
    ORDER BY i.created_at DESC
    LIMIT ? OFFSET ?
  `).all(eventId, limitParam, offset) as RawIncidentRow[];

  const recentIncidents: IncidentRow[] = rawIncidents.map(r => ({
    id: r.id,
    referenceNumber: r.reference_number,
    reporterName: r.reporter_name,
    reporterId: r.reporter_id,
    eventId: r.event_id,
    category: r.category,
    title: r.title,
    zone: r.zone,
    urgency: r.urgency,
    priorityScore: r.priority_score,
    status: r.status,
    responderName: r.responder_name,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
    acknowledgedAt: r.acknowledged_at,
    resolvedAt: r.resolved_at,
  }));

  const response: IncidentAnalyticsResponse = {
    summary,
    timeSeries,
    zoneStat,
    categoryStat,
    recentIncidents,
    period,
    generatedAt: new Date().toISOString(),
  };

  return NextResponse.json(response);
}
