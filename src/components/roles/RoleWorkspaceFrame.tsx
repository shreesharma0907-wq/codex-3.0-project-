'use client';

import { ReactNode, useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { ChevronLeft, ChevronRight, Menu, X } from 'lucide-react';
import { DemoSession } from '@/lib/demo-auth';
import { LogoutButton } from '@/components/auth/LogoutButton';
import { ThemeToggle } from '@/components/layout/ThemeToggle';
import { RunshowAssistant } from '@/components/assistant/RunshowAssistant';
import { BrandNavigation } from '@/components/layout/BrandNavigation';
import { Tooltip } from '@/components/ui/Tooltip';
import type { LucideIcon } from 'lucide-react';

export interface WorkspaceTab { id: string; label: string; icon?: LucideIcon }

const STORAGE_KEY = 'runshow-sidebar-collapsed';
const PREFERENCE_EVENT = 'runshow:sidebar-preference';

function readCollapsedPreference() { try { return window.localStorage.getItem(STORAGE_KEY) === 'true'; } catch { return false; } }
function getServerCollapsedPreference() { return false; }
function subscribeToCollapsedPreference(listener: () => void) {
  const handleStorage = (event: StorageEvent) => { if (event.key === STORAGE_KEY) listener(); };
  window.addEventListener('storage', handleStorage);
  window.addEventListener(PREFERENCE_EVENT, listener);
  return () => { window.removeEventListener('storage', handleStorage); window.removeEventListener(PREFERENCE_EVENT, listener); };
}

export function RoleWorkspaceFrame({ title, session, tabs, activeTab, onTabChange, children, sidebar = false }: {
  title: string; session: DemoSession | null; tabs: WorkspaceTab[]; activeTab: string; onTabChange: (id: string) => void; children: ReactNode; sidebar?: boolean;
}) {
  const mainRef = useRef<HTMLElement>(null);
  const sidebarRef = useRef<HTMLElement>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const mobileTriggerRef = useRef<HTMLButtonElement>(null);
  const collapsed = useSyncExternalStore(subscribeToCollapsedPreference, readCollapsedPreference, getServerCollapsedPreference);
  const [mobileOpen, setMobileOpen] = useState(false);

  useEffect(() => {
    const handleGuidedNavigation = (event: Event) => {
      const tab = (event as CustomEvent<{ tab?: string }>).detail?.tab;
      if (tab && tabs.some(item => item.id === tab)) onTabChange(tab);
    };
    window.addEventListener('runshow:workspace-tab', handleGuidedNavigation);
    return () => window.removeEventListener('runshow:workspace-tab', handleGuidedNavigation);
  }, [onTabChange, tabs]);

  useEffect(() => {
    if (!mobileOpen) return;
    const previousOverflow = document.body.style.overflow;
    const mobileTrigger = mobileTriggerRef.current;
    document.body.style.overflow = 'hidden';
    closeButtonRef.current?.focus();
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { setMobileOpen(false); return; }
      if (event.key !== 'Tab') return;
      const focusable = Array.from(sidebarRef.current?.querySelectorAll<HTMLElement>('button:not([disabled]), a[href], input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])') ?? []).filter(element => element.getClientRects().length > 0);
      const first = focusable[0]; const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => { document.body.style.overflow = previousOverflow; window.removeEventListener('keydown', handleKeyDown); mobileTrigger?.focus(); };
  }, [mobileOpen]);

  useEffect(() => {
    const main = mainRef.current;
    if (!main) return;
    main.scrollTop = 0;
    main.dataset.headingCompact = 'false';
  }, [activeTab]);

  const closeMobile = useCallback(() => setMobileOpen(false), []);
  const toggleCollapsed = () => {
    const next = !collapsed;
    try { window.localStorage.setItem(STORAGE_KEY, String(next)); window.dispatchEvent(new Event(PREFERENCE_EVENT)); } catch { /* Preference is optional. */ }
  };

  const navigation = <ul className="space-y-1">{tabs.map(tab => {
    const Icon = tab.icon;
    const active = activeTab === tab.id;
    return <li key={tab.id}><Tooltip label={tab.label} enabled={collapsed} side="right" className="block w-full"><button type="button" onClick={() => { onTabChange(tab.id); closeMobile(); }} aria-current={active ? 'page' : undefined} aria-label={tab.label} className={`group flex min-h-11 w-full items-center gap-3 rounded-full border-l-2 px-3 py-2.5 text-left text-sm font-medium transition-[background-color,color,border-color] duration-150 hover:backdrop-blur-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus)] ${collapsed ? 'md:justify-center md:px-2' : ''} ${active ? 'border-l-[var(--accent)] bg-[var(--action-primary-fill)] text-[var(--action-primary-foreground)]' : 'border-l-transparent text-[var(--text-secondary)] hover:border-l-[var(--action-primary)] hover:bg-[var(--surface-elevated)] hover:text-[var(--action-primary)]'}`}>{Icon && <Icon className="h-5 w-5 shrink-0 transition-transform duration-150 group-hover:translate-x-0.5 group-focus-visible:translate-x-0.5" aria-hidden="true"/>}<span className={collapsed ? 'md:hidden' : ''}>{tab.label}</span></button></Tooltip></li>;
  })}</ul>;

  if (!sidebar) return <main className="min-h-dvh overflow-x-hidden bg-[var(--page-bg)] text-[var(--text-primary)]">
    <header className="border-b border-[var(--divider)] bg-[var(--surface-card)]"><div className="mx-auto flex max-w-7xl items-center justify-between gap-4 px-4 py-4 sm:px-6"><div className="flex min-w-0 items-center gap-3"><BrandNavigation className="shrink-0"/><p className="truncate text-xs text-[var(--text-secondary)]">{title} · {session?.name || 'Account'}</p></div><div className="flex items-center gap-2"><ThemeToggle/><LogoutButton/></div></div><nav aria-label={`${title} navigation`} className="mx-auto flex max-w-7xl gap-1 overflow-x-auto px-4 sm:px-6">{tabs.map(tab => { const Icon=tab.icon;return <button key={tab.id} type="button" onClick={()=>onTabChange(tab.id)} aria-current={activeTab===tab.id?'page':undefined} className={`shrink-0 border-b-2 px-3 py-3 text-sm font-medium transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus)] ${activeTab===tab.id?'border-[var(--action-primary)] bg-[var(--surface-elevated)] text-[var(--action-primary)]':'border-transparent text-[var(--text-secondary)] hover:bg-[var(--surface-elevated)] hover:text-[var(--text-primary)]'}`}>{Icon&&<Icon className="mr-1 inline h-4 w-4" aria-hidden="true"/>}{tab.label}</button>;})}</nav></header>
    <div className="mx-auto w-full max-w-7xl px-4 py-6 pb-28 sm:px-6 sm:py-8">{children}</div><RunshowAssistant/>
  </main>;

  return <div className="flex h-dvh min-h-0 w-full overflow-hidden bg-[var(--page-bg)] text-[var(--text-primary)]">
    {mobileOpen && <button type="button" className="fixed inset-0 z-30 bg-[var(--metallic-black)]/50 md:hidden" onClick={closeMobile} aria-label="Close navigation overlay"/>}
    <aside ref={sidebarRef} id="sub-organizer-sidebar" role={mobileOpen?'dialog':undefined} aria-modal={mobileOpen||undefined} aria-label="Sub-organizer navigation" className={`fixed inset-y-0 left-0 z-40 flex h-dvh min-h-0 w-[min(18rem,calc(100vw-2rem))] max-w-full shrink-0 flex-col border-r border-[var(--divider)] bg-[var(--sidebar-bg)] transition-[width,transform,background-color] duration-200 motion-reduce:transition-none md:relative md:translate-x-0 ${collapsed?'md:w-20':'md:w-64'} ${mobileOpen?'translate-x-0':'-translate-x-full'}`}>
      <div className={`flex h-20 shrink-0 items-center justify-between gap-3 border-b border-[var(--divider)] px-4 md:h-24 ${collapsed?'md:flex-col md:justify-center md:gap-3 md:px-0':''}`}><Tooltip label="RUNSHOW home" enabled={collapsed} className={`min-w-0 ${collapsed?'md:block md:w-full':''}`}><BrandNavigation compact={collapsed} className={`min-w-0 ${collapsed?'md:w-full md:justify-center':''}`}/></Tooltip><button ref={closeButtonRef} type="button" onClick={closeMobile} aria-label="Close navigation" className="inline-flex h-9 w-9 items-center justify-center rounded-md text-[var(--text-secondary)] hover:bg-[var(--surface-elevated)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus)] md:hidden"><X className="h-5 w-5" aria-hidden="true"/></button><Tooltip label={collapsed?'Expand sidebar':'Collapse sidebar'} side={collapsed?'right':'bottom'} className="hidden shrink-0 md:block"><button type="button" onClick={toggleCollapsed} aria-label={collapsed?'Expand sidebar':'Collapse sidebar'} aria-expanded={!collapsed} className="hidden h-9 w-9 items-center justify-center rounded-md text-[var(--text-secondary)] transition-colors hover:bg-[var(--surface-elevated)] hover:text-[var(--action-primary)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus)] md:inline-flex">{collapsed?<ChevronRight className="h-5 w-5"/>:<ChevronLeft className="h-5 w-5"/>}</button></Tooltip></div>
      <nav className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-3 py-4" aria-label="Sub-organizer workspace">{navigation}</nav>
      <div className={`shrink-0 border-t border-[var(--divider)] p-3 ${collapsed?'md:flex md:justify-center md:px-2':''}`}><LogoutButton compact={collapsed}/></div>
    </aside>
    <div className="flex min-h-0 min-w-0 flex-1 flex-col"><header className="z-20 flex min-h-20 shrink-0 items-center justify-between gap-3 border-b border-[var(--divider)] bg-[var(--page-bg)] px-4 py-3 sm:px-6"><div className="flex min-w-0 items-center gap-3"><button ref={mobileTriggerRef} type="button" className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-md text-[var(--text-secondary)] hover:bg-[var(--surface-elevated)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus)] md:hidden" aria-controls="sub-organizer-sidebar" aria-expanded={mobileOpen} onClick={()=>setMobileOpen(true)} aria-label="Open navigation"><Menu className="h-5 w-5" aria-hidden="true"/></button><div className="min-w-0"><h1 className="runshow-scroll-heading truncate text-2xl font-bold text-[var(--text-primary)]">{title}</h1><p className="hidden max-w-[min(38vw,32rem)] truncate text-xs text-[var(--text-secondary)] sm:block">Sub-organizer workspace · {session?.name || 'Account'}</p></div></div><ThemeToggle/></header><main ref={mainRef} data-heading-compact="false" className="min-h-0 flex-1 overflow-x-hidden overflow-y-auto overscroll-contain p-4 pb-24 sm:p-6 lg:p-8"><div className="mx-auto w-full max-w-6xl">{children}</div></main></div>
    <RunshowAssistant/>
  </div>;
}
