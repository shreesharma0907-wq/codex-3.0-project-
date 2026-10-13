'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { ArrowLeft, Bell, ChevronDown, LogOut, Menu, Plus, UserRound } from 'lucide-react';
import { useDashboardStore } from '@/lib/dashboard-state';
import { clearDemoSession, useDemoSession } from '@/lib/demo-auth';
import { Button } from '@/components/ui/Button';
import { ThemeToggle } from './ThemeToggle';
import { useDismissableLayer } from '@/components/ui/useDismissableLayer';
import { Tooltip } from '@/components/ui/Tooltip';
import { api } from '@/lib/api';
import type { InAppNotification } from '@/lib/types';

interface HeaderProps {
  title: string;
  onCreateEvent: () => void;
  onBackToDashboard: () => void;
  onOpenSidebar: () => void;
  sidebarOpen: boolean;
}

export function Header({ title, onCreateEvent, onBackToDashboard, onOpenSidebar, sidebarOpen }: HeaderProps) {
  const router = useRouter();
  const event = useDashboardStore(state => state.event);
  const eventIsAvailable = useDashboardStore(state => state.events.some(item => item.id === state.event.id));
  const notifications = useDashboardStore(state => state.notifications);
  const markNotificationRead = useDashboardStore(state => state.markNotificationRead);
  const session = useDemoSession();
  const reduceMotion = useReducedMotion();
  const [notificationsOpen, setNotificationsOpen] = useState(false);
  const [userMenuOpen, setUserMenuOpen] = useState(false);
  const notificationsRef = useRef<HTMLDivElement>(null);
  const userMenuRef = useRef<HTMLDivElement>(null);
  const closeNotifications = useCallback(() => setNotificationsOpen(false), []);
  const closeUserMenu = useCallback(() => setUserMenuOpen(false), []);
  useDismissableLayer(notificationsOpen, closeNotifications, notificationsRef);
  useDismissableLayer(userMenuOpen, closeUserMenu, userMenuRef);

  // Poll in-app notifications from backend API
  useEffect(() => {
    let active = true;
    const fetchNotifs = async () => {
      try {
        const res = await api.getInAppNotifications();
        if (active && res.notifications.length > 0) {
          useDashboardStore.setState({
            notifications: res.notifications.map((n: InAppNotification) => ({
              id: n.id,
              message: `${n.title}: ${n.message}`,
              type: n.type,
              timestamp: n.createdAt,
              read: n.read,
            })),
          });
        }
      } catch {
        // Mock fallback remains
      }
    };
    fetchNotifs();
    const interval = setInterval(fetchNotifs, 8000);
    return () => {
      active = false;
      clearInterval(interval);
    };
  }, []);
  const unreadCount = notifications.filter(notification => !notification.read).length;
  const displayName = typeof session?.name === 'string' && session.name.trim() ? session.name.trim() : 'Organizer';
  const displayEmail = typeof session?.email === 'string' && session.email.trim() ? session.email.trim() : 'Account details unavailable';
  const roleLabel = session?.role === 'sub_organizer' ? 'Sub-organizer' : session?.role === 'participant' ? 'Participant' : 'Organizer';
  const eventName = eventIsAvailable && typeof event?.name === 'string' && event.name.trim() ? event.name.trim() : '';
  const eventStart = [event?.startDate, event?.date].find(value => typeof value === 'string' && value.trim());
  const eventEnd = [event?.endDate, event?.startDate, event?.date].find(value => typeof value === 'string' && value.trim());
  const formatDate = (value: string | undefined) => {
    if (!value) return '';
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? '' : parsed.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
  };
  const startDate = formatDate(eventStart);
  const endDate = formatDate(eventEnd);
  const eventDateSummary = startDate ? (endDate && endDate !== startDate ? `${startDate} – ${endDate}` : startDate) : '';

  const logout = () => {
    clearDemoSession();
    router.replace('/login');
  };

  // Coordinate popups: opening one closes the other
  const openNotifications = () => {
    setUserMenuOpen(false);
    setNotificationsOpen(true);
  };

  const toggleNotifications = () => {
    if (notificationsOpen) {
      closeNotifications();
    } else {
      openNotifications();
    }
  };

  const openUserMenu = () => {
    setNotificationsOpen(false);
    setUserMenuOpen(true);
  };

  const toggleUserMenu = () => {
    if (userMenuOpen) {
      closeUserMenu();
    } else {
      openUserMenu();
    }
  };

  const handleNotificationClick = (notificationId: string) => {
    markNotificationRead(notificationId);
    closeNotifications();
  };

  const handleMarkAllRead = () => {
    notifications.forEach(notification => markNotificationRead(notification.id));
    closeNotifications();
  };

  return (
    <header className="z-20 shrink-0 border-b border-[var(--divider)] bg-[var(--page-bg)]">
      <div className="flex min-h-20 flex-wrap items-center justify-between gap-x-4 gap-y-3 px-4 py-3 sm:px-6">
        <div className="flex min-w-0 items-center gap-3">
          <button
            type="button"
            id="main-navigation-trigger"
            aria-controls="main-sidebar"
            aria-expanded={sidebarOpen}
            className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-md text-[var(--text-secondary)] hover:bg-[var(--surface-elevated)] hover:text-[var(--text-primary)] focus:outline-none focus:ring-2 focus:ring-[var(--focus)] md:hidden"
            onClick={onOpenSidebar}
            aria-label="Open main navigation"
          >
            <Menu className="h-5 w-5" aria-hidden="true" />
          </button>
          <div className="min-w-0">
            <h1 className="runshow-scroll-heading truncate text-2xl font-bold text-[var(--text-primary)]">{title}</h1>
            {eventName && (
              <p className="hidden max-w-[min(38vw,32rem)] truncate text-xs text-[var(--text-secondary)] lg:block">
                {eventName}{eventDateSummary ? ` | ${eventDateSummary}` : ''}
              </p>
            )}
          </div>
        </div>

        <div className="flex shrink-0 flex-wrap items-center justify-end gap-2 sm:gap-3">
          {title === 'Dashboard' && (
            <Button type="button" size="sm" onClick={onCreateEvent}>
              <Plus className="h-4 w-4" aria-hidden="true" />
              <span>Create Event</span>
            </Button>
          )}
          {title === 'Create Event' && (
            <Button type="button" variant="secondary" size="sm" onClick={onBackToDashboard}>
              <ArrowLeft className="h-4 w-4" aria-hidden="true" />
              <span>Back to Dashboard</span>
            </Button>
          )}

          <div ref={notificationsRef} className="relative">
            <Tooltip label={unreadCount ? `Notifications, ${unreadCount} unread` : 'Notifications'} side="bottom" enabled={!notificationsOpen}>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="relative h-10 w-10 p-0"
                onClick={toggleNotifications}
                aria-label={unreadCount ? `Notifications, ${unreadCount} unread` : 'Notifications'}
                aria-expanded={notificationsOpen}
                aria-haspopup="menu"
              >
                <Bell className="h-5 w-5" aria-hidden="true" />
                {unreadCount > 0 && (
                  <span className="absolute -right-1 -top-1 flex h-5 min-w-5 items-center justify-center rounded-full bg-[var(--accent)] px-1 text-xs font-semibold text-[var(--accent-foreground)]">
                    {unreadCount > 9 ? '9+' : unreadCount}
                  </span>
                )}
              </Button>
            </Tooltip>
            <AnimatePresence>
            {notificationsOpen && notifications.length > 0 && (
              <motion.div initial={reduceMotion ? false : { opacity: 0, y: -5 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -3 }} transition={{ duration: reduceMotion ? 0 : 0.16 }} className="absolute right-0 top-full mt-2 w-72 max-w-[calc(100vw-2rem)] rounded-lg border border-[var(--border)] bg-[var(--surface-elevated)] p-2 shadow-xl shadow-[var(--shadow-color)] sm:w-80" role="menu" aria-label="Notifications">
                <div className="flex items-center justify-between border-b border-[var(--divider)] px-3 py-2">
                  <h2 className="font-semibold text-[var(--text-primary)]">Notifications</h2>
                  {unreadCount > 0 && (
                    <Button type="button" variant="ghost" size="sm" onClick={handleMarkAllRead}>
                      Mark all read
                    </Button>
                  )}
                </div>
                <div className="max-h-60 overflow-y-auto">
                  {notifications.slice(0, 5).map(notification => (
                    <button
                      key={notification.id}
                      type="button"
                      onClick={() => handleNotificationClick(notification.id)}
                      className="w-full rounded-md px-3 py-3 text-left hover:bg-[var(--neutral-surface)] focus:outline-none focus:ring-2 focus:ring-[var(--focus)]"
                      role="menuitem"
                    >
                      <span className="flex items-start gap-2">
                        <span className={`mt-1 h-2 w-2 shrink-0 rounded-full ${notification.read ? 'bg-[var(--text-secondary)]' : 'bg-[var(--accent)]'}`} />
                        <span className="text-sm text-[var(--text-primary)]">{notification.message}</span>
                      </span>
                      <span className="mt-1 block pl-4 text-xs text-[var(--text-secondary)]">
                        {new Date(notification.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                      </span>
                    </button>
                  ))}
                </div>
                {notifications.length > 5 && <p className="px-3 py-2 text-center text-sm text-[var(--text-secondary)]">{notifications.length} total notifications</p>}
              </motion.div>
            )}
            </AnimatePresence>
          </div>

          <ThemeToggle />
          <div ref={userMenuRef} className="relative hidden sm:block">
            <button
              type="button"
              className="flex max-w-52 items-center gap-2 rounded-lg border border-[var(--border)] bg-[var(--surface-card)] px-3 py-2 text-[var(--text-secondary)] hover:bg-[var(--surface-elevated)] focus:outline-none focus:ring-2 focus:ring-[var(--focus)]"
              onClick={toggleUserMenu}
              aria-expanded={userMenuOpen}
              aria-haspopup="menu"
              aria-label={`Account menu for ${displayName}`}
            >
              <UserRound className="h-4 w-4 shrink-0" aria-hidden="true" />
              <span className="max-w-32 truncate text-sm font-medium">{displayName}</span>
              <ChevronDown className="h-4 w-4 shrink-0" aria-hidden="true" />
            </button>
            <AnimatePresence>
            {userMenuOpen && (
              <motion.div initial={reduceMotion ? false : { opacity: 0, y: -5 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -3 }} transition={{ duration: reduceMotion ? 0 : 0.16 }} className="absolute right-0 top-full z-30 mt-2 w-64 rounded-lg border border-[var(--border)] bg-[var(--surface-elevated)] p-2 shadow-xl shadow-[var(--shadow-color)]" role="menu" aria-label="Account">
                <div className="border-b border-[var(--divider)] px-3 py-2">
                  <p className="truncate text-sm font-medium text-[var(--text-primary)]">{displayEmail}</p>
                  <p className="text-xs text-[var(--text-secondary)]">{roleLabel}</p>
                </div>
                <button type="button" role="menuitem" onClick={logout} className="mt-1 flex w-full items-center gap-2 rounded-md px-3 py-2 text-left text-sm text-[var(--text-primary)] hover:bg-[var(--neutral-surface)] focus:outline-none focus:ring-2 focus:ring-[var(--focus)]">
                  <LogOut className="h-4 w-4" aria-hidden="true" />
                  Sign out
                </button>
              </motion.div>
            )}
            </AnimatePresence>
          </div>
        </div>
      </div>
    </header>
  );
}