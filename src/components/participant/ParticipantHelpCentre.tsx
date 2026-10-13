'use client';

import React, { useEffect, useState, useCallback } from 'react';
import {
  LifeBuoy,
  Plus,
  Send,
  Bus,
  MapPin,
  Clock,
  CheckCircle2,
  AlertCircle,
  HelpCircle,
  ShieldAlert,
  Wifi,
  Coffee,
} from 'lucide-react';
import { api } from '@/lib/api';
import { useDashboardStore } from '@/lib/dashboard-state';
import { useDemoSession } from '@/lib/demo-auth';
import type { Incident, IncidentCategory, IncidentUrgency } from '@/lib/types';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';

const QUICK_ACTIONS = [
  {
    category: 'transport' as IncidentCategory,
    urgency: 'critical' as IncidentUrgency,
    title: 'Delegate Bus / Shuttle Delay at Gate 2',
    description: 'Our bus is stuck or delayed at the entrance checkpoint and our session is about to begin!',
    zone: 'Gate 2',
    icon: Bus,
  },
  {
    category: 'venue' as IncidentCategory,
    urgency: 'medium' as IncidentUrgency,
    title: 'Need Help Finding Room / Zone',
    description: 'I cannot locate my designated workshop room or presentation auditorium.',
    zone: 'Main Building',
    icon: MapPin,
  },
  {
    category: 'registration' as IncidentCategory,
    urgency: 'high' as IncidentUrgency,
    title: 'Badge or Check-in Issue',
    description: 'My attendee badge is missing or the QR code at registration did not scan properly.',
    zone: 'Registration Desk',
    icon: HelpCircle,
  },
  {
    category: 'technical issue' as IncidentCategory,
    urgency: 'high' as IncidentUrgency,
    title: 'Wi-Fi / Power Strip Access Issue',
    description: 'No power outlet at our hackathon table or Wi-Fi connectivity dropped.',
    zone: 'Hack Bay',
    icon: Wifi,
  },
];

export function ParticipantHelpCentre() {
  const { event } = useDashboardStore();
  const session = useDemoSession();
  const [incidents, setIncidents] = useState<Incident[]>([]);
  const [selectedIncident, setSelectedIncident] = useState<Incident | null>(null);
  const [loading, setLoading] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [showNewForm, setShowNewForm] = useState(false);

  // Form fields
  const [category, setCategory] = useState<IncidentCategory>('transport');
  const [urgency, setUrgency] = useState<IncidentUrgency>('medium');
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [zone, setZone] = useState('');
  const [contactPreference, setContactPreference] = useState('');
  const [formFeedback, setFormFeedback] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  // Message reply
  const [replyText, setReplyText] = useState('');
  const [sendingReply, setSendingReply] = useState(false);

  const loadMyIncidents = useCallback(async () => {
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
      console.error('Failed to load participant incidents:', e);
    } finally {
      setLoading(false);
    }
  }, [event?.id, selectedIncident?.id]);

  useEffect(() => {
    loadMyIncidents();
    const interval = setInterval(loadMyIncidents, 10000);
    return () => clearInterval(interval);
  }, [loadMyIncidents]);

  const handleQuickReport = (action: (typeof QUICK_ACTIONS)[0]) => {
    setCategory(action.category);
    setUrgency(action.urgency);
    setTitle(action.title);
    setDescription(action.description);
    setZone(action.zone);
    setShowNewForm(true);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!event?.id || !title.trim() || !description.trim() || isSubmitting) return;
    setIsSubmitting(true);
    setFormFeedback(null);
    try {
      const created = await api.createIncident(event.id, {
        category,
        urgency,
        title: title.trim(),
        description: description.trim(),
        zone: zone.trim() || undefined,
        contactPreference: contactPreference.trim() || undefined,
      });

      setFormFeedback({
        type: 'success',
        text: `Request submitted! Reference code: ${created.referenceNumber}. An organizer has been notified.`,
      });
      setTitle('');
      setDescription('');
      setZone('');
      setContactPreference('');
      setShowNewForm(false);
      await loadMyIncidents();
      const full = await api.getIncident(created.id);
      setSelectedIncident(full);
    } catch (err: unknown) {
      setFormFeedback({ type: 'error', text: err instanceof Error ? err.message : 'Submission failed' });
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleSendReply = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedIncident || !replyText.trim() || sendingReply) return;
    setSendingReply(true);
    try {
      await api.postIncidentMessage(selectedIncident.id, replyText.trim(), false);
      setReplyText('');
      const full = await api.getIncident(selectedIncident.id);
      setSelectedIncident(full);
    } catch (e) {
      console.error('Failed to send reply:', e);
    } finally {
      setSendingReply(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Banner */}
      <div className="rounded-xl border border-[var(--border)] bg-[var(--surface-elevated)] p-6">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-[var(--success-surface)] text-[var(--action-primary)]">
              <LifeBuoy className="h-5 w-5" />
            </span>
            <div>
              <h2 className="text-xl font-bold text-[var(--text-primary)]">Participant Help Centre</h2>
              <p className="text-sm text-[var(--text-secondary)]">
                Have an on-site issue, transit delay, or need assistance? Submit a request and our ops team will respond.
              </p>
            </div>
          </div>
          <Button onClick={() => setShowNewForm(!showNewForm)}>
            <Plus className="h-4 w-4" />
            {showNewForm ? 'View My Requests' : 'Report New Issue'}
          </Button>
        </div>
      </div>

      {formFeedback && (
        <div
          className={`rounded-lg border p-3.5 text-sm ${
            formFeedback.type === 'success'
              ? 'border-[var(--action-primary)]/40 bg-[var(--success-surface)] text-[var(--action-primary)]'
              : 'border-[var(--danger)]/40 bg-[var(--danger-surface)] text-[var(--danger)]'
          }`}
        >
          {formFeedback.text}
        </div>
      )}

      {/* Quick Actions Row */}
      {!showNewForm && (
        <div>
          <p className="text-xs font-semibold uppercase text-[var(--text-secondary)] mb-3">
            Frequent Quick Assistance Requests
          </p>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {QUICK_ACTIONS.map((action, idx) => {
              const Icon = action.icon;
              return (
                <button
                  key={idx}
                  onClick={() => handleQuickReport(action)}
                  className="rounded-xl border border-[var(--border)] bg-[var(--surface-card)] p-4 text-left transition-all hover:border-[var(--action-primary)] hover:bg-[var(--surface-elevated)] focus:outline-none focus:ring-2 focus:ring-[var(--focus)]"
                >
                  <div className="flex items-center gap-2 text-sm font-semibold text-[var(--text-primary)]">
                    <Icon className="h-4 w-4 text-[var(--action-primary)]" />
                    <span className="line-clamp-1">{action.title}</span>
                  </div>
                  <p className="mt-1.5 text-xs text-[var(--text-secondary)] line-clamp-2">
                    {action.description}
                  </p>
                  <div className="mt-3 flex items-center justify-between text-[10px] text-[var(--text-muted)]">
                    <span>{action.zone}</span>
                    <span className="font-semibold text-[var(--accent)]">{action.urgency.toUpperCase()}</span>
                  </div>
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* New Incident Submission Form */}
      {showNewForm && (
        <Card padding="md">
          <h3 className="text-lg font-bold text-[var(--text-primary)] mb-1">Submit Help Request</h3>
          <p className="text-xs text-[var(--text-secondary)] mb-4">
            Please be descriptive so event dispatch can assign the nearest team member.
          </p>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <label className="block text-xs font-semibold text-[var(--text-secondary)] mb-1">Problem Category</label>
                <select
                  value={category}
                  onChange={e => setCategory(e.target.value as IncidentCategory)}
                  className="w-full rounded-lg border border-[var(--border)] bg-[var(--surface-card)] p-2.5 text-sm text-[var(--text-primary)]"
                >
                  <option value="transport">Transport / Shuttle</option>
                  <option value="venue">Venue / Room Access</option>
                  <option value="registration">Registration / Badging</option>
                  <option value="safety">Safety / Medical</option>
                  <option value="technical issue">Technical / Wi-Fi</option>
                  <option value="food">Food / Dietary</option>
                  <option value="accessibility">Accessibility Support</option>
                  <option value="programme">Schedule / Programme</option>
                  <option value="other">Other</option>
                </select>
              </div>

              <div>
                <label className="block text-xs font-semibold text-[var(--text-secondary)] mb-1">Urgency Level</label>
                <select
                  value={urgency}
                  onChange={e => setUrgency(e.target.value as IncidentUrgency)}
                  className="w-full rounded-lg border border-[var(--border)] bg-[var(--surface-card)] p-2.5 text-sm text-[var(--text-primary)]"
                >
                  <option value="low">Low (General inquiry)</option>
                  <option value="medium">Medium (Needs attention soon)</option>
                  <option value="high">High (Impacting session participation)</option>
                  <option value="critical">Critical (Immediate blocker / Safety)</option>
                </select>
              </div>
            </div>

            <div>
              <label className="block text-xs font-semibold text-[var(--text-secondary)] mb-1">Short Title</label>
              <input
                type="text"
                placeholder="Brief summary of the issue (e.g. Bus #4 delayed at Gate 2)"
                value={title}
                onChange={e => setTitle(e.target.value)}
                required
                className="w-full rounded-lg border border-[var(--border)] bg-[var(--surface-card)] p-2.5 text-sm text-[var(--text-primary)]"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-[var(--text-secondary)] mb-1">Detailed Description</label>
              <textarea
                rows={3}
                placeholder="Give details such as how many people are affected or what assistance is required..."
                value={description}
                onChange={e => setDescription(e.target.value)}
                required
                className="w-full rounded-lg border border-[var(--border)] bg-[var(--surface-card)] p-2.5 text-sm text-[var(--text-primary)]"
              />
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <label className="block text-xs font-semibold text-[var(--text-secondary)] mb-1">Current Location / Gate / Zone</label>
                <input
                  type="text"
                  placeholder="e.g. Gate 2, Auditorium Lobby, Hack Bay B"
                  value={zone}
                  onChange={e => setZone(e.target.value)}
                  className="w-full rounded-lg border border-[var(--border)] bg-[var(--surface-card)] p-2.5 text-sm text-[var(--text-primary)]"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-[var(--text-secondary)] mb-1">Contact Preference (Optional)</label>
                <input
                  type="text"
                  placeholder="e.g. Phone/WhatsApp: +1-555-0199"
                  value={contactPreference}
                  onChange={e => setContactPreference(e.target.value)}
                  className="w-full rounded-lg border border-[var(--border)] bg-[var(--surface-card)] p-2.5 text-sm text-[var(--text-primary)]"
                />
              </div>
            </div>

            <div className="flex justify-end gap-2 pt-2">
              <Button type="button" variant="secondary" onClick={() => setShowNewForm(false)}>
                Cancel
              </Button>
              <Button type="submit" disabled={isSubmitting || !title.trim() || !description.trim()}>
                {isSubmitting ? 'Submitting...' : 'Send Help Request'}
              </Button>
            </div>
          </form>
        </Card>
      )}

      {/* Requests History & Live Chat */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
        {/* Left: Submitted list */}
        <div className="space-y-3 lg:col-span-5">
          <h3 className="text-sm font-bold text-[var(--text-primary)]">My Submitted Requests</h3>
          {incidents.length === 0 ? (
            <Card padding="md" className="text-center py-8">
              <p className="text-sm text-[var(--text-secondary)]">You haven&apos;t submitted any help requests.</p>
            </Card>
          ) : (
            <div className="space-y-2">
              {incidents.map(inc => (
                <button
                  key={inc.id}
                  onClick={async () => {
                    const full = await api.getIncident(inc.id);
                    setSelectedIncident(full);
                  }}
                  className={`w-full rounded-xl border p-3.5 text-left transition-all ${
                    selectedIncident?.id === inc.id
                      ? 'border-[var(--action-primary)] bg-[var(--success-surface)]'
                      : 'border-[var(--border)] bg-[var(--surface-card)] hover:bg-[var(--surface-elevated)]'
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <span className="font-mono text-xs font-bold text-[var(--action-primary)]">
                      {inc.referenceNumber}
                    </span>
                    <span className="rounded bg-[var(--surface-elevated)] px-2 py-0.5 text-[10px] font-semibold capitalize text-[var(--text-secondary)]">
                      {inc.status.replace('_', ' ')}
                    </span>
                  </div>
                  <h4 className="mt-1 font-semibold text-sm text-[var(--text-primary)]">{inc.title}</h4>
                  <p className="mt-1 text-xs text-[var(--text-muted)]">
                    Reported {new Date(inc.createdAt).toLocaleDateString()}
                  </p>
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Right: Selected Request Details & Updates */}
        <div className="lg:col-span-7">
          {!selectedIncident ? (
            <Card padding="md" className="py-12 text-center text-[var(--text-muted)] text-sm">
              Select one of your requests to view updates or message the ops team.
            </Card>
          ) : (
            <Card padding="md" className="space-y-4">
              <div className="border-b border-[var(--divider)] pb-3">
                <div className="flex items-center justify-between">
                  <span className="font-mono text-sm font-bold text-[var(--action-primary)]">
                    {selectedIncident.referenceNumber}
                  </span>
                  <Badge variant="neutral" size="sm" className="capitalize">
                    Status: {selectedIncident.status.replace('_', ' ')}
                  </Badge>
                </div>
                <h3 className="mt-1.5 text-lg font-bold text-[var(--text-primary)]">{selectedIncident.title}</h3>
                <p className="mt-1 text-xs text-[var(--text-secondary)]">{selectedIncident.description}</p>
                {selectedIncident.zone && (
                  <p className="mt-2 text-xs text-[var(--text-muted)] flex items-center gap-1">
                    <MapPin className="h-3 w-3" /> Location: {selectedIncident.zone}
                  </p>
                )}
              </div>

              {/* Resolution banner if resolved */}
              {selectedIncident.status === 'resolved' && (
                <div className="rounded-lg border border-[var(--action-primary)]/40 bg-[var(--success-surface)] p-3">
                  <p className="text-xs font-bold text-[var(--action-primary)] flex items-center gap-1">
                    <CheckCircle2 className="h-4 w-4" /> Issue Resolved by Staff:
                  </p>
                  <p className="mt-1 text-xs text-[var(--text-primary)]">
                    {selectedIncident.resolutionNotes || 'Operational resolution confirmed.'}
                  </p>
                </div>
              )}

              {/* Messages from organizers/responders */}
              <div className="space-y-3">
                <h4 className="text-xs font-semibold uppercase text-[var(--text-secondary)]">Staff Updates & Messages</h4>
                <div className="max-h-56 space-y-2 overflow-y-auto pr-1">
                  {(selectedIncident.messages ?? []).length === 0 ? (
                    <p className="py-4 text-center text-xs text-[var(--text-muted)]">No messages yet.</p>
                  ) : (
                    selectedIncident.messages?.map(msg => (
                      <div
                        key={msg.id}
                        className={`rounded-lg p-2.5 text-xs ${
                          msg.senderRole === 'participant'
                            ? 'border border-[var(--border)] bg-[var(--surface-elevated)]'
                            : 'border border-[var(--action-primary)]/30 bg-[var(--success-surface)]'
                        }`}
                      >
                        <div className="flex items-center justify-between text-[10px] text-[var(--text-muted)]">
                          <span className="font-semibold text-[var(--text-primary)]">
                            {msg.senderName} ({msg.senderRole})
                          </span>
                          <span>{new Date(msg.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                        </div>
                        <p className="mt-1 text-[var(--text-primary)]">{msg.message}</p>
                      </div>
                    ))
                  )}
                </div>

                {/* Reply Form */}
                <form onSubmit={handleSendReply} className="flex gap-2 pt-2">
                  <input
                    type="text"
                    placeholder="Provide additional details or reply to responder..."
                    value={replyText}
                    onChange={e => setReplyText(e.target.value)}
                    className="flex-1 rounded-lg border border-[var(--border)] bg-[var(--surface-card)] px-3 py-2 text-xs text-[var(--text-primary)]"
                  />
                  <Button size="sm" type="submit" disabled={!replyText.trim() || sendingReply}>
                    <Send className="h-3 w-3" />
                  </Button>
                </form>
              </div>
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}
