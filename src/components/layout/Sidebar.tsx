'use client';

import { useEffect, useRef, useSyncExternalStore } from 'react';
import { AlertTriangle, CalendarDays, CheckSquare, ChevronLeft, ChevronRight, HeartPulse, Home, LayoutDashboard, Settings, Users, X } from 'lucide-react';
import { useDashboardStore } from '@/lib/dashboard-state';
import { LogoutButton } from '@/components/auth/LogoutButton';
import { BrandNavigation } from './BrandNavigation';
import { Tooltip } from '@/components/ui/Tooltip';

interface SidebarProps {
  isOpen: boolean;
  onClose: () => void;
}

const STORAGE_KEY = 'runshow-sidebar-collapsed';
const PREFERENCE_EVENT = 'runshow:sidebar-preference';
const NAV_ITEMS = [
  { id: 'home', label: 'Home', icon: Home },
  { id: 'overview', label: 'Dashboard', icon: LayoutDashboard },
  { id: 'incidents', label: 'Incident Desk', icon: AlertTriangle },
  { id: 'team', label: 'Team & Responders', icon: Users },
  { id: 'tasks', label: 'Tasks', icon: CheckSquare },
  { id: 'calendar', label: 'Calendar', icon: CalendarDays },
  { id: 'event-health', label: 'Event Health', icon: HeartPulse },
  { id: 'settings', label: 'Settings', icon: Settings },
] as const;

function readCollapsedPreference() {
  try { return window.localStorage.getItem(STORAGE_KEY) === 'true'; } catch { return false; }
}

function subscribeToCollapsedPreference(listener: () => void) {
  const handleStorage = (event: StorageEvent) => {
    if (event.key === STORAGE_KEY) listener();
  };
  window.addEventListener('storage', handleStorage);
  window.addEventListener(PREFERENCE_EVENT, listener);
  return () => {
    window.removeEventListener('storage', handleStorage);
    window.removeEventListener(PREFERENCE_EVENT, listener);
  };
}

function getServerCollapsedPreference() { return false; }

export function Sidebar({ isOpen, onClose }: SidebarProps) {
  const selectedView = useDashboardStore(state => state.selectedView);
  const setSelectedView = useDashboardStore(state => state.setSelectedView);
  const collapsed = useSyncExternalStore(subscribeToCollapsedPreference, readCollapsedPreference, getServerCollapsedPreference);
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const sidebarRef = useRef<HTMLElement>(null);
  const wasOpen = useRef(false);

  useEffect(() => {
    if (isOpen) {
      wasOpen.current = true;
      const previousOverflow = document.body.style.overflow;
      document.body.style.overflow = 'hidden';
      closeButtonRef.current?.focus();
      const handleKeyDown = (event: KeyboardEvent) => {
        if (event.key === 'Escape') {
          onClose();
          return;
        }
        if (event.key === 'Tab') {
          const focusable = Array.from(sidebarRef.current?.querySelectorAll<HTMLElement>('button:not([disabled]), a[href], input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])') ?? []).filter(element => element.getClientRects().length > 0);
          const first = focusable[0];
          const last = focusable[focusable.length - 1];
          if (event.shiftKey && document.activeElement === first) {
            event.preventDefault();
            last?.focus();
          } else if (!event.shiftKey && document.activeElement === last) {
            event.preventDefault();
            first?.focus();
          }
        }
      };
      window.addEventListener('keydown', handleKeyDown);
      return () => {
        document.body.style.overflow = previousOverflow;
        window.removeEventListener('keydown', handleKeyDown);
        if (wasOpen.current) {
          wasOpen.current = false;
          document.getElementById('main-navigation-trigger')?.focus();
        }
      };
    }
  }, [isOpen, onClose]);

  function toggleCollapsed() {
    try {
      window.localStorage.setItem(STORAGE_KEY, String(!collapsed));
      window.dispatchEvent(new Event(PREFERENCE_EVENT));
    } catch { /* Storage may be unavailable. */ }
  }

  return <>
    {isOpen && <button type="button" className="fixed inset-0 z-30 bg-[var(--metallic-black)]/50 md:hidden" onClick={onClose} aria-label="Close navigation overlay" />}
    <aside
      ref={sidebarRef}
      id="main-sidebar"
      role={isOpen ? 'dialog' : undefined}
      aria-modal={isOpen || undefined}
      className={`fixed inset-y-0 left-0 z-40 flex h-dvh min-h-0 w-[min(18rem,calc(100vw-2rem))] max-w-full shrink-0 flex-col border-r border-[var(--divider)] bg-[var(--sidebar-bg)] transition-[width,transform,background-color] duration-200 motion-reduce:transition-none md:relative md:translate-x-0 ${collapsed ? 'md:w-20' : 'md:w-64'} ${isOpen ? 'translate-x-0' : '-translate-x-full'}`}
      aria-label="Main navigation"
    >
      <div className={`flex h-20 shrink-0 items-center justify-between gap-3 border-b border-[var(--divider)] px-4 md:h-24 ${collapsed ? 'md:flex-col md:justify-center md:gap-3 md:px-0' : ''}`}>
        <Tooltip label="RUNSHOW home" enabled={collapsed} className={`min-w-0 ${collapsed ? 'md:block md:w-full' : ''}`}>
          <BrandNavigation compact={collapsed} onNavigate={onClose} className={`min-w-0 ${collapsed ? 'md:w-full md:justify-center' : ''}`} />
        </Tooltip>
        <button ref={closeButtonRef} type="button" className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-md text-[var(--text-secondary)] hover:bg-[var(--surface-elevated)] hover:text-[var(--text-primary)] focus:outline-none focus:ring-2 focus:ring-[var(--focus)] md:hidden" onClick={onClose} aria-label="Close navigation"><X className="h-5 w-5" aria-hidden="true" /></button>
        <Tooltip label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'} side={collapsed ? 'right' : 'bottom'} className="hidden shrink-0 md:block">
          <button type="button" className="hidden h-9 w-9 shrink-0 items-center justify-center rounded-md text-[var(--text-secondary)] transition-colors hover:bg-[var(--surface-elevated)] hover:text-[var(--action-primary)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--sidebar-bg)] md:inline-flex" onClick={toggleCollapsed} aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'} aria-expanded={!collapsed}>
            {collapsed ? <ChevronRight className="h-5 w-5" aria-hidden="true" /> : <ChevronLeft className="h-5 w-5" aria-hidden="true" />}
          </button>
        </Tooltip>
      </div>

      <nav className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-3 py-4" aria-label="Organizer navigation">
        <ul className="space-y-1">
          {NAV_ITEMS.map(item => {
            const Icon = item.icon;
            const isActive = selectedView === item.id || (selectedView === 'setup' && item.id === 'overview');
            return <li key={item.id}>
              <Tooltip label={item.label} enabled={collapsed} className="block w-full">
                <button type="button" onClick={() => { setSelectedView(item.id); onClose(); }} aria-label={item.label} aria-current={isActive ? 'page' : undefined} className={`group flex min-h-11 w-full items-center gap-3 rounded-full border-l-2 px-3 py-2.5 text-left font-medium transition-[background-color,color,border-color] duration-150 focus:outline-none focus:ring-2 focus:ring-[var(--focus)] ${collapsed ? 'md:justify-center md:px-2' : ''} ${isActive ? 'border-l-[var(--accent)] bg-[var(--action-primary-fill)] text-[var(--action-primary-foreground)]' : 'border-l-transparent text-[var(--text-secondary)] hover:border-l-[var(--action-primary)] hover:bg-[var(--surface-elevated)] hover:text-[var(--action-primary)]'}`}>
                  <Icon className="h-5 w-5 shrink-0 transition-transform duration-150 group-hover:translate-x-0.5 group-focus-visible:translate-x-0.5" aria-hidden="true" />
                  <span className={collapsed ? 'md:hidden' : ''}>{item.label}</span>
                </button>
              </Tooltip>
            </li>;
          })}
        </ul>
      </nav>

      <div className={`shrink-0 border-t border-[var(--divider)] p-3 ${collapsed ? 'md:flex md:justify-center md:px-2' : ''}`}>
        <LogoutButton compact={collapsed} />
      </div>
    </aside>
  </>;
}
