'use client';

import React from 'react';
import { Sidebar } from '@/components/layout/Sidebar';
import { Header } from '@/components/layout/Header';
import { KPICards, EventReadinessIndicator } from '@/components/dashboard/KPICards';
import { CriticalRisksSummary } from '@/components/dashboard/CriticalRisksSummary';
import { PartnerOverview } from '@/components/dashboard/PartnerOverview';
import { RegistrationTrendChart, OutreachConversionChart } from '@/components/charts/RegistrationChart';
import { RiskCentre } from '@/components/risks/RiskCentre';
import { Recommendations } from '@/components/recommendations/Recommendations';
import { Tasks } from '@/components/tasks/Tasks';
import { TaskDrawerContent } from '@/components/tasks/TaskDrawer';
import { EventSetupWizard } from '@/components/event-setup/EventSetupWizard';
import { useDashboardStore } from '@/lib/dashboard-state';
import { CalendarView } from '@/components/calendar/CalendarView';
import { EventHealthView } from '@/components/dashboard/EventHealthView';
import { DashboardOverviewSummary } from '@/components/dashboard/DashboardOverviewSummary';
import { SettingsView } from '@/components/settings/SettingsView';
import { RunshowAssistant } from '@/components/assistant/RunshowAssistant';
import { HomeView } from '@/components/dashboard/HomeView';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Plus } from 'lucide-react';

import { IncidentDesk } from '@/components/incidents/IncidentDesk';
import { ParticipantHelpCentre } from '@/components/participant/ParticipantHelpCentre';
import { IncidentAnalytics } from '@/components/incidents/IncidentAnalytics';
import { TeamDirectory } from '@/components/team/TeamDirectory';

// Views that are only appropriate for participant context and should never be
// the default landing view for the organizer dashboard.
const PARTICIPANT_ONLY_VIEWS = new Set(['help-centre']);

const VIEW_COMPONENTS = {
  home: () => <HomeView onCreateEvent={() => useDashboardStore.getState().setSelectedView('setup')} />,
  setup: () => <EventSetupWizard />,
  overview: () => <DashboardOverview />,
  calendar: () => <CalendarView />,
  'event-health': () => <EventHealthView />,
  tasks: () => <Tasks />,
  settings: () => <SettingsView />,
  recommendations: () => <Recommendations />,
  partners: () => <PartnerOverview />,
  incidents: () => <IncidentDesk />,
  'help-centre': () => <ParticipantHelpCentre />,
  team: () => <TeamDirectory />,
  operations: () => (
    <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
      <RiskCentre />
      <Tasks />
    </div>
  ),
};

function DashboardOverview() {
  const events = useDashboardStore(state => state.events);
  const setSelectedView = useDashboardStore(state => state.setSelectedView);
  if (events.length === 0) return <Card padding="lg" className="mx-auto max-w-2xl text-center">
    <h2 className="text-xl font-semibold text-[var(--text-primary)]">No events yet</h2>
    <p className="mt-2 text-sm text-[var(--text-secondary)]">Create an event to see its registrations, schedule, tasks and operational status here.</p>
    <Button className="mt-5" onClick={() => setSelectedView('setup')}><Plus className="h-4 w-4" aria-hidden="true" />Create Event</Button>
  </Card>;

  return (
    <div className="space-y-6">
      <DashboardOverviewSummary />
      {/* Incident Intelligence — real-time analytics from persisted incidents */}
      <IncidentAnalytics />
      <div className="grid grid-cols-1 gap-6 xl:grid-cols-3">
        <div className="space-y-6 xl:col-span-2">
          <RegistrationTrendChart />
          <OutreachConversionChart />
        </div>
        <div className="space-y-6">
          <CriticalRisksSummary />
          <EventReadinessIndicator />
        </div>
      </div>
      <PartnerOverview />
      <Recommendations />
    </div>
  );
}

const VIEW_TITLES: Record<keyof typeof VIEW_COMPONENTS, string> = {
  home: 'Home',
  setup: 'Create Event',
  overview: 'Command Centre',
  calendar: 'Calendar',
  'event-health': 'Event Health',
  tasks: 'Tasks',
  settings: 'Settings',
  recommendations: 'Recommendations',
  partners: 'Partners',
  incidents: 'Incident Desk',
  'help-centre': 'Help Centre',
  team: 'Team & Responders',
  operations: 'Operations',
};

function TaskDrawerHost() {
  const drawer = useDashboardStore(state => state.drawer);
  return <TaskDrawerContent state={drawer} onClose={() => useDashboardStore.getState().closeDrawer()} />;
}

export function DashboardLayout() {
  const selectedView = useDashboardStore(state => state.selectedView);
  const hasEvents = useDashboardStore(state => state.events.length > 0);
  const setSelectedView = useDashboardStore(state => state.setSelectedView);
  const [sidebarOpen, setSidebarOpen] = React.useState(false);
  const shellRef = React.useRef<HTMLDivElement>(null);
  const contentRef = React.useRef<HTMLElement>(null);
  const closeSidebar = React.useCallback(() => setSidebarOpen(false), []);
  const ViewComponent = VIEW_COMPONENTS[selectedView] || VIEW_COMPONENTS.overview;
  const title = VIEW_TITLES[selectedView] ?? 'Command Centre';
  const isUsingApi = useDashboardStore(state => state.isUsingApi);
  const loadEventsFromApi = useDashboardStore(state => state.loadEventsFromApi);

  // Guard: if the persisted selectedView is participant-only (e.g. 'help-centre'),
  // reset to 'overview' immediately so organizers never see the participant portal.
  React.useEffect(() => {
    if (PARTICIPANT_ONLY_VIEWS.has(selectedView)) {
      setSelectedView('overview');
    }
  }, []); // run once on mount

  React.useEffect(() => {
    if (isUsingApi) void loadEventsFromApi();
  }, [isUsingApi, loadEventsFromApi]);

  React.useEffect(() => {
    const content = contentRef.current;
    const shell = shellRef.current;
    if (!content || !shell) return;
    const updateHeading = () => {
      const compact = content.scrollTop > 24;
      if ((shell.dataset.headingCompact === 'true') !== compact) {
        shell.dataset.headingCompact = String(compact);
      }
    };
    updateHeading();
    content.addEventListener('scroll', updateHeading, { passive: true });
    return () => content.removeEventListener('scroll', updateHeading);
  }, []);

  React.useLayoutEffect(() => {
    const content = contentRef.current;
    const shell = shellRef.current;
    if (!content || !shell) return;
    content.scrollTop = 0;
    shell.dataset.headingCompact = 'false';
  }, [selectedView]);

  return (
    <div ref={shellRef} data-heading-compact="false" className="flex h-dvh min-h-0 w-full overflow-hidden bg-[var(--page-bg)] text-[var(--text-primary)]">
      <Sidebar isOpen={sidebarOpen} onClose={closeSidebar} />

      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        <Header
          title={title}
          onCreateEvent={() => setSelectedView('setup')}
          onBackToDashboard={() => setSelectedView('overview')}
          onOpenSidebar={() => setSidebarOpen(true)}
          sidebarOpen={sidebarOpen}
        />

        <main ref={contentRef} className="min-h-0 flex-1 overflow-x-hidden overflow-y-auto overscroll-contain p-4 pb-24 sm:p-6 sm:pb-28 lg:p-8 lg:pb-28" role="main">
          <div key={selectedView} className="space-y-6">
            {hasEvents && (selectedView === 'overview' || selectedView === 'calendar') && <KPICards />}
            <ViewComponent />
          </div>
        </main>
      </div>

      <TaskDrawerHost />
      <RunshowAssistant />
    </div>
  );
}
