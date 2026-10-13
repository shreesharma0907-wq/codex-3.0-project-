'use client';

import React from 'react';
import { ParticipantSidebar } from '@/components/layout/ParticipantSidebar';
import { useDemoSession } from '@/lib/demo-auth';
import { ThemeToggle } from '@/components/layout/ThemeToggle';
import { LogoutButton } from '@/components/auth/LogoutButton';
import { RadioTower } from 'lucide-react';

const VIEW_COMPONENTS = {
  events: () => <ParticipantEventsView />,
  explore: () => <ExploreEventsView />,
  schedule: () => <ParticipantScheduleView />,
  venue: () => <ParticipantVenueView />,
  announcements: () => <ParticipantAnnouncementsView />,
  join: () => <JoinInvitationView />,
  support: () => <SupportCentreView />,
  'help-centre': () => <ParticipantHelpCentre />,
  profile: () => <ParticipantProfileView />,
  settings: () => <ParticipantSettingsView />,
  eventDetails: () => <EventDetailsPage />,
} as const;

type ParticipantView = keyof typeof VIEW_COMPONENTS;

const VIEW_TITLES: Record<ParticipantView, string> = {
  events: 'My Events',
  explore: 'Explore Events',
  schedule: 'Schedule',
  venue: 'Venue & Details',
  announcements: 'Announcements',
  join: 'Join with Invitation',
  support: 'Help & Support',
  'help-centre': 'Incident Desk',
  profile: 'Profile',
  settings: 'Settings',
  eventDetails: 'Event Details',
};

export function ParticipantLayout() {
  const session = useDemoSession();
  const [sidebarOpen, setSidebarOpen] = React.useState(false);
  const [selectedView, setSelectedView] = React.useState<ParticipantView>('events');
  const shellRef = React.useRef<HTMLDivElement>(null);
  const contentRef = React.useRef<HTMLElement>(null);
  const closeSidebar = React.useCallback(() => setSidebarOpen(false), []);
  const ViewComponent = VIEW_COMPONENTS[selectedView];
  const title = VIEW_TITLES[selectedView];

  React.useEffect(() => {
    const handleTabEvent = (event: Event) => {
      const tab = (event as CustomEvent<{ tab?: string }>).detail?.tab;
      if (tab && Object.keys(VIEW_COMPONENTS).includes(tab)) {
        setSelectedView(tab as ParticipantView);
      }
    };
    window.addEventListener('runshow:workspace-tab', handleTabEvent);
    return () => window.removeEventListener('runshow:workspace-tab', handleTabEvent);
  }, []);

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
      <ParticipantSidebar isOpen={sidebarOpen} onClose={closeSidebar} />

      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        <header className="border-b border-[var(--divider)] bg-[var(--surface-card)]">
          <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-4 px-4 py-4 sm:px-6">
            <div className="flex min-w-0 items-center gap-3">
              <button
                type="button"
                id="participant-nav-trigger"
                onClick={() => setSidebarOpen(true)}
                className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-md text-[var(--text-secondary)] hover:bg-[var(--surface-elevated)] hover:text-[var(--text-primary)] focus:outline-none focus:ring-2 focus:ring-[var(--focus)] md:hidden"
                aria-label="Open navigation menu"
              >
                <RadioTower className="h-5 w-5" aria-hidden="true" />
              </button>
              <span className="hidden md:flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-[var(--action-primary-fill)] text-[var(--action-primary-foreground)]"><RadioTower className="h-5 w-5" aria-hidden="true" /></span>
              <div className="min-w-0">
                <p className="text-sm font-bold">RUNSHOW</p>
                <p className="truncate text-xs text-[var(--text-secondary)]">{title} · {session?.name}</p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <ThemeToggle />
              <LogoutButton />
            </div>
          </div>
        </header>

        <main ref={contentRef} className="min-h-0 flex-1 overflow-x-hidden overflow-y-auto overscroll-contain p-4 pb-24 sm:p-6 sm:pb-28 lg:p-8 lg:pb-28" role="main">
          <div key={selectedView} className="space-y-6">
            <div className="mb-6">
              <p className="text-xs font-semibold uppercase text-[var(--action-primary)]">Participant portal</p>
              <h1 className="runshow-scroll-heading mt-1 text-3xl font-semibold text-[var(--text-primary)]">{title}</h1>
              <p className="mt-1 text-sm text-[var(--text-secondary)]">Schedules and event details shared for your account.</p>
            </div>
            <ViewComponent />
          </div>
        </main>
      </div>
    </div>
  );
}

// Import the view components at the bottom to avoid circular dependencies
import { ParticipantEventsView } from './participant/ParticipantEventsView';
import { ExploreEventsView } from './participant/ExploreEventsView';
import { ParticipantScheduleView } from './participant/ParticipantScheduleView';
import { ParticipantVenueView } from './participant/ParticipantVenueView';
import { ParticipantAnnouncementsView } from './participant/ParticipantAnnouncementsView';
import { JoinInvitationView } from './participant/JoinInvitationView';
import { SupportCentreView } from './participant/SupportCentreView';
import { ParticipantHelpCentre } from '@/components/participant/ParticipantHelpCentre';
import { ParticipantProfileView } from './participant/ParticipantProfileView';
import { ParticipantSettingsView } from './participant/ParticipantSettingsView';
import { EventDetailsPage } from './participant/EventDetailsPage';