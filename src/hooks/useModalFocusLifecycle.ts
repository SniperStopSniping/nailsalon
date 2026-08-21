'use client';

import type { RefObject } from 'react';
import { useEffect, useRef } from 'react';

const FOCUSABLE_SELECTOR = [
  'a[href]',
  'area[href]',
  'button:not([disabled])',
  'input:not([disabled]):not([type="hidden"])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  'iframe',
  'object',
  'embed',
  '[contenteditable="true"]',
  '[tabindex]:not([tabindex="-1"])',
].join(',');
const FOCUS_HISTORY_LIMIT = 20;
const POINTER_OPENER_MAX_AGE_MS = 2_000;
const RETURN_FOCUS_KEY_ATTRIBUTE = 'data-dialog-return-focus-key';

type FocusSurface = {
  root: HTMLElement;
  content: HTMLElement;
  closeOnEscapeRef: RefObject<boolean>;
  onCloseRef: RefObject<() => void>;
};

type ModalFocusLifecycleOptions = {
  isOpen: boolean;
  onClose: () => void;
  rootRef: RefObject<HTMLElement | null>;
  contentRef: RefObject<HTMLElement | null>;
  initialFocusRef?: RefObject<HTMLElement | null>;
  closeOnEscape?: boolean;
};

let focusTrackerSubscribers = 0;
let focusHistory: HTMLElement[] = [];
let recentPointerOpener: { element: HTMLElement; recordedAt: number } | null = null;
let activeSurfaces: FocusSurface[] = [];
let keyboardListenerActive = false;

function recordFocusedElement(event?: FocusEvent): void {
  const target = event?.target ?? document.activeElement;
  if (!(target instanceof HTMLElement) || target === document.body) {
    return;
  }

  focusHistory = [
    ...focusHistory.filter(element => element !== target && element.isConnected),
    target,
  ].slice(-FOCUS_HISTORY_LIMIT);
}

function recordPointerOpener(event: PointerEvent): void {
  const target = event.target;
  if (!(target instanceof Element)) {
    return;
  }

  const candidate = target.closest<HTMLElement>(FOCUSABLE_SELECTOR);
  if (candidate) {
    recentPointerOpener = { element: candidate, recordedAt: Date.now() };
  }
}

function subscribeToFocusHistory(): () => void {
  if (focusTrackerSubscribers === 0) {
    recordFocusedElement();
    document.addEventListener('focusin', recordFocusedElement, true);
    document.addEventListener('pointerdown', recordPointerOpener, true);
  }
  focusTrackerSubscribers += 1;

  return () => {
    focusTrackerSubscribers -= 1;
    if (focusTrackerSubscribers === 0) {
      document.removeEventListener('focusin', recordFocusedElement, true);
      document.removeEventListener('pointerdown', recordPointerOpener, true);
      focusHistory = [];
      recentPointerOpener = null;
    }
  };
}

function isVisibleAndEnabled(element: HTMLElement): boolean {
  if (
    !element.isConnected
    || element.matches(':disabled')
    || element.getAttribute('aria-disabled') === 'true'
    || element.closest('[hidden], [inert], [aria-hidden="true"]')
  ) {
    return false;
  }

  let current: HTMLElement | null = element;
  while (current) {
    const style = window.getComputedStyle(current);
    if (style.display === 'none' || style.visibility === 'hidden') {
      return false;
    }
    current = current.parentElement;
  }
  return true;
}

function getFocusableElements(container: HTMLElement): HTMLElement[] {
  return Array.from(container.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR))
    .filter(isVisibleAndEnabled);
}

function focusWithoutScrolling(element: HTMLElement): void {
  try {
    element.focus({ preventScroll: true });
  } catch {
    element.focus();
  }
}

function focusInsideSurface(
  root: HTMLElement,
  content: HTMLElement,
  initialFocusElement?: HTMLElement | null,
): void {
  const requestedTarget = initialFocusElement
    ?? content.querySelector<HTMLElement>('[autofocus], [data-dialog-initial-focus="true"]');

  if (requestedTarget && content.contains(requestedTarget) && isVisibleAndEnabled(requestedTarget)) {
    focusWithoutScrolling(requestedTarget);
    return;
  }

  const activeElement = document.activeElement;
  if (
    activeElement instanceof HTMLElement
    && root.contains(activeElement)
    && isVisibleAndEnabled(activeElement)
  ) {
    return;
  }

  focusWithoutScrolling(getFocusableElements(content)[0] ?? content);
}

function getTopmostSurface(): FocusSurface | null {
  activeSurfaces = activeSurfaces.filter(surface => surface.root.isConnected);
  return activeSurfaces.at(-1) ?? null;
}

function handleSurfaceKeyDown(event: KeyboardEvent): void {
  const surface = getTopmostSurface();
  if (!surface) {
    return;
  }

  if (event.key === 'Escape' && surface.closeOnEscapeRef.current) {
    event.preventDefault();
    surface.onCloseRef.current?.();
    return;
  }
  if (event.key !== 'Tab') {
    return;
  }

  const focusableElements = getFocusableElements(surface.content);
  if (focusableElements.length === 0) {
    event.preventDefault();
    focusWithoutScrolling(surface.content);
    return;
  }

  const firstFocusable = focusableElements[0]!;
  const lastFocusable = focusableElements.at(-1)!;
  const focusedIndex = document.activeElement instanceof HTMLElement
    ? focusableElements.indexOf(document.activeElement)
    : -1;

  if (event.shiftKey && focusedIndex <= 0) {
    event.preventDefault();
    focusWithoutScrolling(lastFocusable);
  } else if (!event.shiftKey && (focusedIndex === -1 || document.activeElement === lastFocusable)) {
    event.preventDefault();
    focusWithoutScrolling(firstFocusable);
  }
}

function syncKeyboardListener(): void {
  if (activeSurfaces.length > 0 && !keyboardListenerActive) {
    window.addEventListener('keydown', handleSurfaceKeyDown);
    keyboardListenerActive = true;
  } else if (activeSurfaces.length === 0 && keyboardListenerActive) {
    window.removeEventListener('keydown', handleSurfaceKeyDown);
    keyboardListenerActive = false;
  }
}

function registerSurface(surface: FocusSurface): () => void {
  activeSurfaces.push(surface);
  syncKeyboardListener();
  let disposed = false;
  return () => {
    if (disposed) {
      return;
    }
    disposed = true;
    activeSurfaces = activeSurfaces.filter(candidate => candidate !== surface);
    syncKeyboardListener();
  };
}

function getLatestExternalFocus(root: HTMLElement, fallback: HTMLElement | null): HTMLElement | null {
  const pointerOpener = recentPointerOpener;
  recentPointerOpener = null;
  if (
    pointerOpener
    && Date.now() - pointerOpener.recordedAt <= POINTER_OPENER_MAX_AGE_MS
    && !root.contains(pointerOpener.element)
    && (isVisibleAndEnabled(pointerOpener.element) || pointerOpener.element.hasAttribute(RETURN_FOCUS_KEY_ATTRIBUTE))
  ) {
    return pointerOpener.element;
  }

  const activeElement = document.activeElement;
  if (
    activeElement instanceof HTMLElement
    && activeElement !== document.body
    && !root.contains(activeElement)
  ) {
    return activeElement;
  }

  for (let index = focusHistory.length - 1; index >= 0; index -= 1) {
    const candidate = focusHistory[index];
    if (candidate?.isConnected && !root.contains(candidate)) {
      return candidate;
    }
  }
  return fallback?.isConnected ? fallback : null;
}

function findReplacementOpener(opener: HTMLElement | null): HTMLElement | null {
  const returnFocusKey = opener?.getAttribute(RETURN_FOCUS_KEY_ATTRIBUTE);
  if (!returnFocusKey) {
    return null;
  }

  const candidates = Array.from(
    document.querySelectorAll<HTMLElement>(`[${RETURN_FOCUS_KEY_ATTRIBUTE}]`),
  ).filter(candidate => (
    candidate.getAttribute(RETURN_FOCUS_KEY_ATTRIBUTE) === returnFocusKey
    && isVisibleAndEnabled(candidate)
  ));
  return candidates.length === 1 ? candidates[0]! : null;
}

function restoreFocusAfterClose(opener: HTMLElement | null, closingRoot: HTMLElement): void {
  const activeElement = document.activeElement;
  const connectedOpener = opener && isVisibleAndEnabled(opener)
    ? opener
    : findReplacementOpener(opener);
  const parentSurface = getTopmostSurface();

  // A parent surface can remount and place its own initial focus during the
  // same commit that removes a nested surface. In that one bounded case, the
  // unique keyed opener is still the more precise restoration target.
  if (
    connectedOpener
    && parentSurface?.root.contains(connectedOpener)
    && activeElement instanceof HTMLElement
    && parentSurface.root.contains(activeElement)
  ) {
    focusWithoutScrolling(connectedOpener);
    return;
  }

  const focusMovedElsewhere = activeElement instanceof HTMLElement
    && activeElement !== document.body
    && !closingRoot.contains(activeElement);
  if (focusMovedElsewhere) {
    return;
  }

  if (connectedOpener) {
    focusWithoutScrolling(connectedOpener);
    return;
  }

  if (parentSurface) {
    focusInsideSurface(parentSurface.root, parentSurface.content);
  }
}

function afterRootDisconnect(
  root: HTMLElement,
  onDisconnect: () => void,
  onTimeout: () => void,
): void {
  queueMicrotask(() => {
    if (!root.isConnected) {
      onDisconnect();
      return;
    }

    let timeoutId: number;
    const observer = new MutationObserver(() => {
      if (!root.isConnected) {
        observer.disconnect();
        window.clearTimeout(timeoutId);
        onDisconnect();
      }
    });
    observer.observe(document.body, { childList: true, subtree: true });
    timeoutId = window.setTimeout(() => {
      observer.disconnect();
      onTimeout();
    }, 2_000);
  });
}

/** Shared modal/sheet focus lifecycle with one topmost keyboard owner. */
export function useModalFocusLifecycle({
  isOpen,
  onClose,
  rootRef,
  contentRef,
  initialFocusRef,
  closeOnEscape = true,
}: ModalFocusLifecycleOptions): void {
  const openerRef = useRef<HTMLElement | null>(null);
  const initialExternalFocusRef = useRef<HTMLElement | null>(
    typeof document !== 'undefined' && document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null,
  );
  const lifecycleTokenRef = useRef<symbol | null>(null);
  const onCloseRef = useRef(onClose);
  const closeOnEscapeRef = useRef(closeOnEscape);

  useEffect(() => {
    onCloseRef.current = onClose;
    closeOnEscapeRef.current = closeOnEscape;
  }, [closeOnEscape, onClose]);
  useEffect(() => subscribeToFocusHistory(), []);

  useEffect(() => {
    if (!isOpen) {
      return undefined;
    }
    const root = rootRef.current;
    const content = contentRef.current;
    if (!root || !content) {
      return undefined;
    }

    const lifecycleToken = Symbol('modal-focus-open-cycle');
    lifecycleTokenRef.current = lifecycleToken;
    openerRef.current = getLatestExternalFocus(root, initialExternalFocusRef.current);
    const unregister = registerSurface({ root, content, closeOnEscapeRef, onCloseRef });
    focusInsideSurface(root, content, initialFocusRef?.current);

    return () => {
      const opener = openerRef.current;
      unregister();
      afterRootDisconnect(
        root,
        () => {
          if (lifecycleTokenRef.current !== lifecycleToken) {
            return;
          }
          restoreFocusAfterClose(opener, root);
          lifecycleTokenRef.current = null;
          openerRef.current = null;
        },
        () => {
          if (lifecycleTokenRef.current !== lifecycleToken) {
            return;
          }
          lifecycleTokenRef.current = null;
          openerRef.current = null;
        },
      );
    };
  }, [contentRef, initialFocusRef, isOpen, rootRef]);
}
