'use client';

import React, { useEffect, useState, useCallback } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import {
  AlertTriangle,
  Send,
  UserCheck,
  CheckCircle2,
  Lock,
  RefreshCw,
  Search,
  MessageSquare,
  History,
  Info,
  Clock,
  Sparkles,
  MapPin,
  XCircle,
} from 'lucide-react';
import { api } from '@/lib/api';
import { useDashboardStore } from '@/lib/dashboard-state';
import { useDemoSession } from '@/lib/demo-auth';
import type { Incident, IncidentStatus, ResponderRecommendation } from '@/lib/types';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';

export function IncidentDesk() {
  const { event } = useDashboardStore();
  const session = useDemoSession();
  const [incidents, setIncidents] = useState<Incident[]>([]);
  const [selectedIncident, setSelectedIncident] = useState<Incident | null>(null);
  const [loading, setLoading] = useState(false);
  const [categoryFilter, setCategoryFilter] = useState<string>('all');
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [searchQuery, setSearchQuery] = useState('');

  // Dispatch Recommendation state
  const [recommendations, setRecommendations] = useState<ResponderRecommendation[]>([]);
  const [loadingRecs, setLoadingRecs] = useState(false);
  const [assignReason, setAssignReason] = useState('');
  const [selectedResponderId, setSelectedResponderId] = useState('');

  // Resolution state
  const [resolutionNotes, setResolutionNotes] = useState('');
  const [isResolving, setIsResolving] = useState(false);

  // Message & Internal Notes state
  const [messageText, setMessageText] = useState('');
  const [isInternalNote, setIsInternalNote] = useState(false);
  const [isPostingMessage, setIsPostingMessage] = useState(false);

  // Action status message
  const [actionFeedback, setActionFeedback] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  const loadIncidents = useCallback(async () => {
    if (!event?.id) return;
    setLoading(true);
    try {
      const data = await api.listIncidents(event.id);
      setIncidents(data);
      if (selectedIncident) {
        const refreshed = await api.getIncident(selectedIncident.id);
        setSelectedIncident(refreshed);
      } else if (data.length > 0) {
        const full = await api.getIncident(data[0].id);
        setSelectedIncident(full);
      }
    } catch (e) {
      console.error('Failed to load incidents:', e);
    } finally {
      setLoading(false);
    }
  }, [event?.id, selectedIncident?.id]);

  useEffect(() => {
    loadIncidents();
    const interval = setInterval(loadIncidents, 10000); // Polling for operational room
    return () => clearInterval(interval);
  }, [loadIncidents]);

  const selectIncident = async (inc: Incident) => {
    try {
      const full = await api.getIncident(inc.id);
      setSelectedIncident(full);
      setRecommendations([]);
      setSelectedResponderId('');
      setAssignReason('');
      setResolutionNotes('');
      setActionFeedback(null);
    } catch (e) {
      console.error('Failed to fetch incident details:', e);
    }
  };

  const fetchRecommendations = async () => {
    if (!selectedIncident) return;
    setLoadingRecs(true);
    try {
      const recs = await api.getResponderRecommendations(selectedIncident.id);
      setRecommendations(recs);
      if (recs.length > 0) {
        setSelectedResponderId(recs[0].responderId);
        setAssignReason(recs[0].reason);
      }
    } catch (e) {
      console.error('Failed to get responder recommendations:', e);
    } finally {
      setLoadingRecs(false);
    }
  };

  const handleAssign = async () => {
    if (!selectedIncident || !selectedResponderId) return;
    try {
      await api.assignResponder(selectedIncident.id, selectedResponderId, assignReason || 'Assigned via Incident Desk');
      setActionFeedback({ type: 'success', text: 'Responder dispatched and notified successfully!' });
      await selectIncident(selectedIncident);
      await loadIncidents();
    } catch (err: unknown) {
      setActionFeedback({ type: 'error', text: err instanceof Error ? err.message : 'Assignment failed' });
    }
  };

  const handleStatusChange = async (newStatus: IncidentStatus) => {
    if (!selectedIncident) return;
    try {
      await api.updateIncidentStatus(
        selectedIncident.id,
        newStatus,
        newStatus === 'resolved' ? resolutionNotes : undefined
      );
      setActionFeedback({ type: 'success', text: `Incident status updated to ${newStatus.toUpperCase()}` });
      setIsResolving(false);
      await selectIncident(selectedIncident);
      await loadIncidents();
    } catch (err: unknown) {
      setActionFeedback({ type: 'error', text: err instanceof Error ? err.message : 'Status update failed' });
    }
  };

  const handleSendMessage = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedIncident || !messageText.trim() || isPostingMessage) return;
    setIsPostingMessage(true);
    try {
      await api.postIncidentMessage(selectedIncident.id, messageText.trim(), isInternalNote);
      setMessageText('');
      await selectIncident(selectedIncident);
    } catch (err: unknown) {
      setActionFeedback({ type: 'error', text: err instanceof Error ? err.message : 'Failed to send message' });
    } finally {
      setIsPostingMessage(false);
    }
  };

  const filteredIncidents = incidents.filter(inc => {
    const matchCat = categoryFilter === 'all' || inc.category === categoryFilter;
    const matchStatus = statusFilter === 'all' || inc.status === statusFilter;
    const matchQuery =
      searchQuery === '' ||
      inc.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
      inc.referenceNumber.toLowerCase().includes(searchQuery.toLowerCase()) ||
      inc.description.toLowerCase().includes(searchQuery.toLowerCase());
    return matchCat && matchStatus && matchQuery;
  });

  const criticalCount = incidents.filter(i => i.urgency === 'critical' && i.status !== 'closed').length;
  const activeCount = incidents.filter(i => !['resolved', 'closed'].includes(i.status)).length;

  return (
    <div className="space-y-6">
      {/* Top Banner / Metrics */}
      <div className="flex flex-wrap items-center justify-between gap-4 rounded-xl border border-[var(--border)] bg-[var(--surface-elevated)] p-4 sm:p-6">
        <div>
          <div className="flex items-center gap-2">
            <span className="flex h-3 w-3 rounded-full bg-[var(--danger)] animate-pulse" />
            <h2 className="text-xl font-bold text-[var(--text-primary)]">Incident Command Desk</h2>
          </div>
          <p className="mt-1 text-sm text-[var(--text-secondary)]">
            Triage, recommend responders, dispatch assignments, and manage end-to-end incident recovery.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <div className="rounded-lg border border-[var(--danger)]/30 bg-[var(--danger-surface)] px-3 py-1.5 text-center">
            <span className="block text-lg font-bold text-[var(--danger)]">{criticalCount}</span>
            <span className="text-[10px] font-medium uppercase text-[var(--danger)]">Critical</span>
          </div>
          <div className="rounded-lg border border-[var(--border)] bg-[var(--surface-card)] px-3 py-1.5 text-center">
            <span className="block text-lg font-bold text-[var(--text-primary)]">{activeCount}</span>
            <span className="text-[10px] font-medium uppercase text-[var(--text-secondary)]">Active Issues</span>
          </div>
          <Button variant="secondary" size="sm" onClick={loadIncidents} disabled={loading}>
            <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
            Refresh
          </Button>
        </div>
      </div>

      {actionFeedback && (
        <div
          className={`rounded-lg border p-3 text-sm ${
            actionFeedback.type === 'success'
              ? 'border-[var(--action-primary)]/40 bg-[var(--success-surface)] text-[var(--action-primary)]'
              : 'border-[var(--danger)]/40 bg-[var(--danger-surface)] text-[var(--danger)]'
          }`}
        >
          {actionFeedback.text}
        </div>
      )}

      {/* Main Grid: Left Queue, Right Details */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
        {/* Left Column: Filterable Incident List */}
        <div className="space-y-4 lg:col-span-5 xl:col-span-4">
          <Card padding="md">
            <div className="space-y-3">
              <div className="relative">
                <Search className="absolute left-3 top-2.5 h-4 w-4 text-[var(--text-muted)]" />
                <input
                  type="text"
                  placeholder="Search ref, title, keyword..."
                  value={searchQuery}
                  onChange={e => setSearchQuery(e.target.value)}
                  className="w-full rounded-lg border border-[var(--border)] bg-[var(--surface-card)] pl-9 pr-3 py-2 text-sm text-[var(--text-primary)] focus:outline-none focus:ring-2 focus:ring-[var(--focus)]"
                />
              </div>

              <div className="grid grid-cols-2 gap-2">
                <select
                  value={categoryFilter}
                  onChange={e => setCategoryFilter(e.target.value)}
                  className="rounded-md border border-[var(--border)] bg-[var(--surface-card)] px-2 py-1.5 text-xs text-[var(--text-primary)]"
                >
                  <option value="all">All Categories</option>
                  <option value="transport">Transport</option>
                  <option value="venue">Venue</option>
                  <option value="safety">Safety</option>
                  <option value="registration">Registration</option>
                  <option value="technical issue">Technical</option>
                  <option value="food">Food</option>
                </select>

                <select
                  value={statusFilter}
                  onChange={e => setStatusFilter(e.target.value)}
                  className="rounded-md border border-[var(--border)] bg-[var(--surface-card)] px-2 py-1.5 text-xs text-[var(--text-primary)]"
                >
                  <option value="all">All Statuses</option>
                  <option value="new">New</option>
                  <option value="assigned">Assigned</option>
                  <option value="in_progress">In Progress</option>
                  <option value="resolved">Resolved</option>
                  <option value="closed">Closed</option>
                </select>
              </div>
            </div>

            <div className="mt-4 max-h-[620px] space-y-2 overflow-y-auto pr-1">
              {filteredIncidents.length === 0 ? (
                <div className="rounded-lg border border-dashed border-[var(--border)] p-6 text-center text-sm text-[var(--text-muted)]">
                  No incidents match the filters.
                </div>
              ) : (
                filteredIncidents.map(inc => {
                  const isSelected = selectedIncident?.id === inc.id;
                  return (
                    <button
                      key={inc.id}
                      onClick={() => selectIncident(inc)}
                      className={`w-full rounded-xl border p-3.5 text-left transition-all ${
                        isSelected
                          ? 'border-[var(--action-primary)] bg-[var(--success-surface)]/60 shadow-sm'
                          : 'border-[var(--border)] bg-[var(--surface-card)] hover:bg-[var(--surface-elevated)]'
                      }`}
                    >
                      <div className="flex items-start justify-between gap-2">
                        <span className="font-mono text-xs font-bold text-[var(--action-primary)]">
                          {inc.referenceNumber}
                        </span>
                        <div className="flex items-center gap-1.5">
                          <span
                            className={`rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase ${
                              inc.urgency === 'critical'
                                ? 'bg-[var(--danger-surface)] text-[var(--danger)] border border-[var(--danger)]/30'
                                : inc.urgency === 'high'
                                ? 'bg-[var(--accent-muted)] text-[var(--accent)] border border-[var(--accent)]/30'
                                : 'bg-[var(--surface-elevated)] text-[var(--text-secondary)]'
                            }`}
                          >
                            {inc.urgency}
                          </span>
                          <span className="rounded bg-[var(--surface-elevated)] px-1.5 py-0.5 text-[10px] font-medium text-[var(--text-secondary)]">
                            {inc.status.replace('_', ' ')}
                          </span>
                        </div>
                      </div>

                      <h4 className="mt-1.5 font-semibold text-sm text-[var(--text-primary)] line-clamp-1">
                        {inc.title}
                      </h4>
                      <p className="mt-1 text-xs text-[var(--text-secondary)] line-clamp-2">
                        {inc.description}
                      </p>

                      <div className="mt-3 flex items-center justify-between text-[11px] text-[var(--text-muted)]">
                        <span className="flex items-center gap-1">
                          <MapPin className="h-3 w-3" />
                          {inc.zone || 'General Venue'}
                        </span>
                        <span className="font-medium text-[var(--text-primary)]">
                          Score: {inc.priorityScore}/100
                        </span>
                      </div>
                    </button>
                  );
                })
              )}
            </div>
          </Card>
        </div>

        {/* Right Column: Active Incident Details & Workflow */}
        <div className="space-y-6 lg:col-span-7 xl:col-span-8">
          {!selectedIncident ? (
            <Card padding="lg" className="flex h-96 items-center justify-center text-center">
              <div>
                <AlertTriangle className="mx-auto h-8 w-8 text-[var(--text-muted)]" />
                <p className="mt-2 text-base font-semibold text-[var(--text-primary)]">Select an incident</p>
                <p className="text-sm text-[var(--text-secondary)]">Choose an issue from the queue to dispatch or review.</p>
              </div>
            </Card>
          ) : (
            <div className="space-y-6">
              {/* Header Card */}
              <Card padding="md">
                <div className="flex flex-wrap items-start justify-between gap-3 border-b border-[var(--divider)] pb-4">
                  <div>
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-mono text-sm font-bold text-[var(--action-primary)]">
                        {selectedIncident.referenceNumber}
                      </span>
                      <Badge variant="neutral" size="sm" className="capitalize">
                        {selectedIncident.category}
                      </Badge>
                      <span
                        className={`rounded-full px-2.5 py-0.5 text-xs font-semibold uppercase ${
                          selectedIncident.urgency === 'critical'
                            ? 'bg-[var(--danger-surface)] text-[var(--danger)]'
                            : 'bg-[var(--accent-muted)] text-[var(--accent)]'
                        }`}
                      >
                        {selectedIncident.urgency} Urgency
                      </span>
                    </div>
                    <h2 className="mt-2 text-xl font-bold text-[var(--text-primary)]">
                      {selectedIncident.title}
                    </h2>
                    <p className="mt-1 text-xs text-[var(--text-muted)]">
                      Reported by {selectedIncident.reporterName} · {new Date(selectedIncident.createdAt).toLocaleString()}
                    </p>
                  </div>

                  {/* Status Action Controls */}
                  <div className="flex flex-wrap items-center gap-2">
                    {selectedIncident.status === 'new' && (
                      <Button size="sm" onClick={() => handleStatusChange('acknowledged')}>
                        Acknowledge
                      </Button>
                    )}
                    {['assigned', 'acknowledged'].includes(selectedIncident.status) && (
                      <Button size="sm" onClick={() => handleStatusChange('in_progress')}>
                        Mark In Progress
                      </Button>
                    )}
                    {['in_progress', 'waiting_external'].includes(selectedIncident.status) && (
                      <Button size="sm" variant="primary" onClick={() => setIsResolving(true)}>
                        Resolve Incident
                      </Button>
                    )}
                    {selectedIncident.status === 'resolved' && (
                      <>
                        <Button size="sm" variant="secondary" onClick={() => handleStatusChange('reopened')}>
                          Reopen
                        </Button>
                        <Button size="sm" variant="primary" onClick={() => handleStatusChange('closed')}>
                          Close Incident
                        </Button>
                      </>
                    )}
                  </div>
                </div>

                <div className="mt-4 space-y-3">
                  <div>
                    <h4 className="text-xs font-semibold uppercase text-[var(--text-secondary)]">Description</h4>
                    <p className="mt-1 text-sm text-[var(--text-primary)] leading-relaxed">
                      {selectedIncident.description}
                    </p>
                  </div>

                  <div className="grid grid-cols-2 gap-4 rounded-lg bg-[var(--surface-elevated)] p-3 text-xs sm:grid-cols-4">
                    <div>
                      <span className="text-[var(--text-muted)]">Location / Zone:</span>
                      <p className="font-semibold text-[var(--text-primary)]">{selectedIncident.zone || 'Not specified'}</p>
                    </div>
                    <div>
                      <span className="text-[var(--text-muted)]">Priority Score:</span>
                      <p className="font-semibold text-[var(--action-primary)]">{selectedIncident.priorityScore} / 100</p>
                    </div>
                    <div>
                      <span className="text-[var(--text-muted)]">Status:</span>
                      <p className="font-semibold capitalize text-[var(--text-primary)]">{selectedIncident.status.replace('_', ' ')}</p>
                    </div>
                    <div>
                      <span className="text-[var(--text-muted)]">Assigned Responder:</span>
                      <p className="font-semibold text-[var(--text-primary)]">{selectedIncident.assignedResponderName || 'Unassigned'}</p>
                    </div>
                  </div>

                  {/* Explainable AI / Priority Reasoning */}
                  <div className="rounded-lg border border-[var(--accent)]/30 bg-[var(--accent-muted)]/40 p-3">
                    <div className="flex items-center gap-1.5 text-xs font-semibold text-[var(--text-primary)]">
                      <Sparkles className="h-4 w-4 text-[var(--accent)]" />
                      Priority Engine Rationale:
                    </div>
                    <p className="mt-1 text-xs text-[var(--text-secondary)]">
                      {selectedIncident.priorityReason}
                    </p>
                  </div>

                  {selectedIncident.resolutionNotes && (
                    <div className="rounded-lg border border-[var(--action-primary)]/40 bg-[var(--success-surface)] p-3">
                      <div className="flex items-center gap-1.5 text-xs font-semibold text-[var(--action-primary)]">
                        <CheckCircle2 className="h-4 w-4" />
                        Resolution Summary:
                      </div>
                      <p className="mt-1 text-xs text-[var(--text-primary)]">
                        {selectedIncident.resolutionNotes}
                      </p>
                    </div>
                  )}
                </div>
              </Card>

              {/* Resolution Modal/Prompt */}
              {isResolving && (
                <Card padding="md" className="border-[var(--action-primary)]">
                  <h3 className="font-bold text-base text-[var(--text-primary)]">Complete Incident Resolution</h3>
                  <p className="mt-1 text-xs text-[var(--text-secondary)]">
                    Describe actions taken to fix the problem before marking resolved. This will notify the participant.
                  </p>
                  <textarea
                    rows={3}
                    placeholder="e.g., Contacted transport lead Marcus; Gate 2 express lane opened; bus admitted and delegates seated."
                    value={resolutionNotes}
                    onChange={e => setResolutionNotes(e.target.value)}
                    className="mt-3 w-full rounded-lg border border-[var(--border)] bg-[var(--surface-card)] p-3 text-sm text-[var(--text-primary)] focus:ring-2 focus:ring-[var(--focus)]"
                  />
                  <div className="mt-3 flex justify-end gap-2">
                    <Button size="sm" variant="secondary" onClick={() => setIsResolving(false)}>
                      Cancel
                    </Button>
                    <Button
                      size="sm"
                      variant="primary"
                      disabled={!resolutionNotes.trim()}
                      onClick={() => handleStatusChange('resolved')}
                    >
                      Confirm Resolution
                    </Button>
                  </div>
                </Card>
              )}

              {/* Responder Dispatch & Recommendations Card */}
              <Card padding="md">
                <div className="flex items-center justify-between">
                  <div>
                    <h3 className="font-bold text-base text-[var(--text-primary)]">Responder Dispatch & Assignment</h3>
                    <p className="text-xs text-[var(--text-secondary)]">
                      Intelligent assignment recommendations matched to skill, zone, and current active workload.
                    </p>
                  </div>
                  <Button size="sm" variant="secondary" onClick={fetchRecommendations} disabled={loadingRecs}>
                    <Sparkles className="h-3.5 w-3.5 text-[var(--accent)]" />
                    {loadingRecs ? 'Analyzing...' : 'Find Best Responders'}
                  </Button>
                </div>

                {recommendations.length > 0 && (
                  <div className="mt-4 space-y-3">
                    <p className="text-xs font-semibold uppercase text-[var(--text-secondary)]">
                      Recommended Matches:
                    </p>
                    <div className="grid gap-2 sm:grid-cols-2">
                      {recommendations.map(rec => (
                        <div
                          key={rec.responderId}
                          onClick={() => {
                            setSelectedResponderId(rec.responderId);
                            setAssignReason(rec.reason);
                          }}
                          className={`cursor-pointer rounded-xl border p-3 transition-colors ${
                            selectedResponderId === rec.responderId
                              ? 'border-[var(--action-primary)] bg-[var(--success-surface)]/60 ring-2 ring-[var(--action-primary)]'
                              : 'border-[var(--border)] bg-[var(--surface-card)] hover:bg-[var(--surface-elevated)]'
                          }`}
                        >
                          <div className="flex items-center justify-between">
                            <span className="font-semibold text-sm text-[var(--text-primary)]">{rec.name}</span>
                            <span className="rounded bg-[var(--surface-elevated)] px-1.5 py-0.5 font-mono text-[10px] font-bold text-[var(--action-primary)]">
                              Score: {rec.score}
                            </span>
                          </div>
                          <p className="mt-1 text-xs text-[var(--text-secondary)]">
                            Skills: {rec.skills.join(', ')} · Zones: {rec.zones.join(', ')}
                          </p>
                          <p className="mt-2 text-[11px] font-medium text-[var(--text-primary)] bg-[var(--surface-elevated)]/60 rounded p-1.5">
                            💡 {rec.reason}
                          </p>
                        </div>
                      ))}
                    </div>

                    <div className="mt-4 flex flex-col gap-2 sm:flex-row sm:items-center">
                      <input
                        type="text"
                        placeholder="Dispatch justification or override note..."
                        value={assignReason}
                        onChange={e => setAssignReason(e.target.value)}
                        className="flex-1 rounded-lg border border-[var(--border)] bg-[var(--surface-card)] px-3 py-2 text-xs text-[var(--text-primary)]"
                      />
                      <Button size="sm" onClick={handleAssign} disabled={!selectedResponderId}>
                        <UserCheck className="h-4 w-4" />
                        Dispatch Assignment
                      </Button>
                    </div>
                  </div>
                )}
              </Card>

              {/* Messages & Activity Audit Trail */}
              <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
                {/* Communications / Chat */}
                <Card padding="md" className="flex flex-col h-[400px]">
                  <div className="flex items-center justify-between border-b border-[var(--divider)] pb-2">
                    <span className="font-semibold text-sm text-[var(--text-primary)] flex items-center gap-1.5">
                      <MessageSquare className="h-4 w-4" /> Incident Comms
                    </span>
                    <span className="text-[10px] text-[var(--text-muted)]">Includes internal notes & participant updates</span>
                  </div>

                  <div className="flex-1 space-y-2.5 overflow-y-auto py-3 pr-1 text-xs">
                    {(selectedIncident.messages ?? []).length === 0 ? (
                      <p className="py-8 text-center text-[var(--text-muted)]">No messages yet.</p>
                    ) : (
                      selectedIncident.messages?.map(msg => (
                        <div
                          key={msg.id}
                          className={`rounded-lg p-2.5 ${
                            msg.isInternal
                              ? 'border border-[var(--accent)]/30 bg-[var(--accent-muted)]/50'
                              : 'border border-[var(--border)] bg-[var(--surface-elevated)]'
                          }`}
                        >
                          <div className="flex items-center justify-between text-[10px] text-[var(--text-muted)]">
                            <span className="font-semibold text-[var(--text-primary)]">
                              {msg.senderName} ({msg.senderRole})
                            </span>
                            <div className="flex items-center gap-1">
                              {msg.isInternal && (
                                <span className="flex items-center gap-0.5 font-bold text-[var(--accent)]">
                                  <Lock className="h-2.5 w-2.5" /> INTERNAL ONLY
                                </span>
                              )}
                              <span>{new Date(msg.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                            </div>
                          </div>
                          <p className="mt-1 text-[var(--text-primary)] leading-normal">{msg.message}</p>
                        </div>
                      ))
                    )}
                  </div>

                  <form onSubmit={handleSendMessage} className="border-t border-[var(--divider)] pt-2 space-y-2">
                    <div className="flex items-center gap-2">
                      <input
                        type="text"
                        placeholder={isInternalNote ? 'Add internal team note (hidden from attendee)...' : 'Update participant & responder...'}
                        value={messageText}
                        onChange={e => setMessageText(e.target.value)}
                        className="flex-1 rounded-lg border border-[var(--border)] bg-[var(--surface-card)] px-3 py-1.5 text-xs text-[var(--text-primary)] focus:outline-none focus:ring-1 focus:ring-[var(--focus)]"
                      />
                      <Button size="sm" type="submit" disabled={!messageText.trim() || isPostingMessage}>
                        <Send className="h-3 w-3" />
                      </Button>
                    </div>
                    <label className="flex items-center gap-1.5 text-[11px] text-[var(--text-secondary)] cursor-pointer">
                      <input
                        type="checkbox"
                        checked={isInternalNote}
                        onChange={e => setIsInternalNote(e.target.checked)}
                        className="rounded"
                      />
                      <span>Mark as internal-only note (hidden from participant)</span>
                    </label>
                  </form>
                </Card>

                {/* Audit / Activity Trail */}
                <Card padding="md" className="h-[400px] flex flex-col">
                  <div className="border-b border-[var(--divider)] pb-2 flex items-center justify-between">
                    <span className="font-semibold text-sm text-[var(--text-primary)] flex items-center gap-1.5">
                      <History className="h-4 w-4" /> Activity & Audit Log
                    </span>
                    <span className="text-[10px] text-[var(--text-muted)]">Immutable timestamped trail</span>
                  </div>

                  <div className="flex-1 space-y-2 overflow-y-auto py-3 pr-1 text-xs">
                    {(selectedIncident.activities ?? []).length === 0 ? (
                      <p className="py-8 text-center text-[var(--text-muted)]">No activity logged.</p>
                    ) : (
                      selectedIncident.activities?.map(act => (
                        <div key={act.id} className="border-l-2 border-[var(--action-primary)] pl-2.5 py-1">
                          <p className="font-semibold text-[var(--text-primary)]">{act.details}</p>
                          <p className="text-[10px] text-[var(--text-muted)]">
                            {act.actorName} · {new Date(act.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                          </p>
                        </div>
                      ))
                    )}
                  </div>
                </Card>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
