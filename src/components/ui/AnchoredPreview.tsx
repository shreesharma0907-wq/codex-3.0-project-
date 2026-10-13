'use client';

import { cloneElement, isValidElement, ReactElement, ReactNode, useCallback, useEffect, useId, useLayoutEffect, useRef, useState, useSyncExternalStore } from 'react';
import { createPortal } from 'react-dom';
import { FloatingPoint, FloatingSide, getFloatingPosition } from '@/lib/floating-position';

const PREVIEW_EVENT = 'runshow:tooltip-open';
const subscribeToMount = () => () => {};
const getClientMounted = () => true;
const getServerMounted = () => false;

export function AnchoredPreview({ label, side = 'top', children, content, className = '', previewClassName = '', onActivate, previewOnTouch = false }: {
  label: string;
  side?: FloatingSide;
  children: ReactNode;
  content: ReactNode;
  className?: string;
  previewClassName?: string;
  onActivate?: () => void;
  previewOnTouch?: boolean;
}) {
  const id = `runshow-preview-${useId().replace(/:/g, '')}`;
  const mounted = useSyncExternalStore(subscribeToMount, getClientMounted, getServerMounted);
  const [open, setOpen] = useState(false);
  const [point, setPoint] = useState<FloatingPoint | null>(null);
  const triggerRef = useRef<HTMLSpanElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const leaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const openTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const requested = open && mounted;

  const clearLeave = useCallback(() => {
    if (leaveTimer.current) clearTimeout(leaveTimer.current);
    leaveTimer.current = null;
  }, []);
  const clearOpen = useCallback(() => {
    if (openTimer.current) clearTimeout(openTimer.current);
    openTimer.current = null;
  }, []);
  const close = useCallback(() => {
    clearLeave();
    clearOpen();
    setOpen(false);
    setPoint(null);
  }, [clearLeave, clearOpen]);
  const updatePosition = useCallback(() => {
    const trigger = triggerRef.current?.firstElementChild?.getBoundingClientRect() ?? triggerRef.current?.getBoundingClientRect();
    const panel = panelRef.current?.getBoundingClientRect();
    if (!trigger || !panel) return;
    const next = getFloatingPosition(trigger, panel, side, 8);
    setPoint(current => current && current.left === next.left && current.top === next.top && current.side === next.side ? current : next);
  }, [side]);

  useLayoutEffect(() => {
    if (!requested) return;
    updatePosition();
    window.dispatchEvent(new CustomEvent(PREVIEW_EVENT, { detail: id }));
    let frame = 0;
    const schedule = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(updatePosition);
    };
    window.addEventListener('resize', schedule);
    window.addEventListener('scroll', schedule, true);
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(schedule);
    if (triggerRef.current) observer?.observe(triggerRef.current);
    if (panelRef.current) observer?.observe(panelRef.current);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener('resize', schedule);
      window.removeEventListener('scroll', schedule, true);
      observer?.disconnect();
    };
  }, [id, requested, updatePosition]);

  useEffect(() => {
    if (!requested) return;
    const dismissOutside = (event: PointerEvent) => {
      const target = event.target;
      if (target instanceof Node && !triggerRef.current?.contains(target) && !panelRef.current?.contains(target)) close();
    };
    const dismissEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        close();
        triggerRef.current?.querySelector<HTMLElement>('button,a,[tabindex="0"]')?.focus();
      }
    };
    document.addEventListener('pointerdown', dismissOutside);
    document.addEventListener('keydown', dismissEscape);
    return () => {
      document.removeEventListener('pointerdown', dismissOutside);
      document.removeEventListener('keydown', dismissEscape);
    };
  }, [close, requested]);

  useEffect(() => {
    const closeOther = (event: Event) => {
      if ((event as CustomEvent<string>).detail !== id) close();
    };
    window.addEventListener(PREVIEW_EVENT, closeOther);
    return () => window.removeEventListener(PREVIEW_EVENT, closeOther);
  }, [close, id]);

  useEffect(() => () => { clearLeave(); clearOpen(); }, [clearLeave, clearOpen]);

  const describedBy = isValidElement(children)
    ? (children.props as { 'aria-describedby'?: string })['aria-describedby']
    : undefined;
  const trigger = isValidElement(children)
    ? cloneElement(children as ReactElement<{ 'aria-controls'?: string; 'aria-expanded'?: boolean; 'aria-describedby'?: string }>, {
      'aria-controls': id,
      'aria-expanded': open,
      'aria-describedby': [describedBy, id].filter(Boolean).join(' '),
    })
    : children;

  return <>
    <span
      ref={triggerRef}
      className={className || 'inline-flex'}
      onPointerEnter={event => { if (event.pointerType !== 'touch') { clearLeave(); clearOpen(); openTimer.current = setTimeout(() => setOpen(true), 160); } }}
      onPointerLeave={() => { clearOpen(); clearLeave(); leaveTimer.current = setTimeout(close, 180); }}
      onFocus={() => { clearLeave(); clearOpen(); setOpen(true); }}
      onBlur={event => {
        const next = event.relatedTarget;
        if (next instanceof Node && panelRef.current?.contains(next)) return;
        leaveTimer.current = setTimeout(() => {
          if (!panelRef.current?.contains(document.activeElement)) close();
        }, 120);
      }}
      onClick={() => {
        clearLeave();
        clearOpen();
        if (previewOnTouch && window.matchMedia('(hover: none)').matches) setOpen(true);
        else if (onActivate) { onActivate(); close(); }
        else setOpen(true);
      }}
    >{trigger}</span>
    {mounted && requested && createPortal(
      <div
        ref={panelRef}
        id={id}
        role="group"
        aria-label={label}
        onPointerEnter={() => { clearLeave(); clearOpen(); }}
        onPointerLeave={() => { clearOpen(); clearLeave(); leaveTimer.current = setTimeout(close, 180); }}
        onClick={event => {
          if ((event.target as HTMLElement).closest('button,a')) close();
        }}
        className={`fixed z-[90] w-[min(19rem,calc(100vw-1rem))] rounded-lg border border-[var(--border)] bg-[var(--surface-card)] p-3 text-[var(--text-primary)] shadow-lg shadow-[var(--shadow-color)] transition-[opacity,transform] duration-150 motion-reduce:transition-none ${previewClassName} ${requested && point ? 'visible translate-y-0 opacity-100' : 'invisible translate-y-1 opacity-0'}`}
        style={{ left: point?.left ?? 0, top: point?.top ?? 0 }}
      >{content}</div>,
      document.body,
    )}
  </>;
}
