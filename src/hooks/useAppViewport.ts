'use client';

import type { CSSProperties } from 'react';
import { useSyncExternalStore } from 'react';

type AppViewport = {
  top: number;
  left: number;
  height: number;
  width: number;
  keyboardOpen: boolean;
};

const EMPTY_VIEWPORT: AppViewport = { top: 0, left: 0, height: 0, width: 0, keyboardOpen: false };
const listeners = new Set<() => void>();
let snapshot = EMPTY_VIEWPORT;
let disconnect: (() => void) | undefined;

function readViewport(): AppViewport {
  const visual = window.visualViewport;
  const pageZoom = Number.parseFloat(getComputedStyle(document.documentElement).zoom) || 1;
  const bodyZoom = Number.parseFloat(getComputedStyle(document.body).zoom) || 1;
  // Let the browser pan a zoomed page; resizing its dialogs to the zoomed
  // viewport would make controls jump away from the user's fingers. Explicit
  // pixel bounds also scale twice under CSS zoom, so retain native insets.
  if (pageZoom !== 1 || bodyZoom !== 1 || (visual && Math.abs((visual.scale ?? 1) - 1) >= 0.01)) {
    return EMPTY_VIEWPORT;
  }
  const height = visual?.height || window.innerHeight;
  const active = document.activeElement;
  const editable = active instanceof HTMLInputElement || active instanceof HTMLTextAreaElement || (active instanceof HTMLElement && active.isContentEditable);
  return {
    top: Math.max(0, visual?.offsetTop ?? 0),
    left: Math.max(0, visual?.offsetLeft ?? 0),
    height,
    width: visual?.width || window.innerWidth,
    keyboardOpen: Boolean(visual && editable && height < window.innerHeight - 120),
  };
}

function update() {
  const next = readViewport();
  if (Object.keys(next).every(key => next[key as keyof AppViewport] === snapshot[key as keyof AppViewport])) {
    return;
  }
  snapshot = next;
  for (const listener of listeners) {
    listener();
  }
}

function observeViewport() {
  const visual = window.visualViewport;
  let timers: ReturnType<typeof setTimeout>[] = [];
  const clearTimers = () => {
    timers.forEach(clearTimeout);
    timers = [];
  };
  // iOS can finish dismissing the keyboard or restoring a tab after the
  // event fires, without sending another viewport resize. Remeasure after
  // those transitions, with bounded timers rather than permanent polling.
  const settle = () => {
    update();
    clearTimers();
    timers = [100, 350].map(delay => setTimeout(update, delay));
  };
  const onVisibility = () => {
    if (document.visibilityState === 'visible') {
      settle();
    }
  };
  visual?.addEventListener('resize', settle);
  visual?.addEventListener('scroll', update, { passive: true });
  window.addEventListener('resize', settle);
  window.addEventListener('orientationchange', settle);
  window.addEventListener('pageshow', settle);
  window.addEventListener('focus', settle);
  document.addEventListener('visibilitychange', onVisibility);
  document.addEventListener('focusin', settle);
  document.addEventListener('focusout', settle);
  settle();
  return () => {
    clearTimers();
    visual?.removeEventListener('resize', settle);
    visual?.removeEventListener('scroll', update);
    window.removeEventListener('resize', settle);
    window.removeEventListener('orientationchange', settle);
    window.removeEventListener('pageshow', settle);
    window.removeEventListener('focus', settle);
    document.removeEventListener('visibilitychange', onVisibility);
    document.removeEventListener('focusin', settle);
    document.removeEventListener('focusout', settle);
  };
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  disconnect ??= observeViewport();
  update();
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0) {
      disconnect?.();
      disconnect = undefined;
      snapshot = EMPTY_VIEWPORT;
    }
  };
}

const getSnapshot = () => snapshot;
const getServerSnapshot = () => EMPTY_VIEWPORT;
const subscribeInactive = () => () => {};

/** One set of viewport listeners shared by owner, staff and customer dialogs. */
export function useAppViewport(active = true): AppViewport {
  return useSyncExternalStore(
    active ? subscribe : subscribeInactive,
    active ? getSnapshot : getServerSnapshot,
    getServerSnapshot,
  );
}

export function appViewportStyle(viewport: AppViewport): CSSProperties | undefined {
  return viewport.height > 0
    ? {
        'top': viewport.top,
        'left': viewport.left,
        'width': viewport.width,
        'height': viewport.height,
        'bottom': 'auto',
        'right': 'auto',
        '--app-viewport-height': `${viewport.height}px`,
      } as CSSProperties
    : undefined;
}
