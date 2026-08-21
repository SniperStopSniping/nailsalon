'use client';

import type { RefObject } from 'react';
import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

import { useBodyScrollLock } from '@/hooks/useBodyScrollLock';
import { cn } from '@/utils/Helpers';

type DialogShellProps = {
  isOpen: boolean;
  onClose: () => void;
  children: React.ReactNode;
  initialFocusRef?: RefObject<HTMLElement | null>;
  maxWidthClassName?: string;
  contentClassName?: string;
  alignClassName?: string;
  closeOnBackdrop?: boolean;
  closeOnEscape?: boolean;
};

const DIALOG_ROOT_SELECTOR = '[data-dialog-shell-root="true"]';
const DIALOG_CONTENT_SELECTOR = '[data-dialog-shell-content="true"]';
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

let focusTrackerSubscribers = 0;
let focusHistory: HTMLElement[] = [];
let recentPointerOpener: { element: HTMLElement; recordedAt: number } | null = null;

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

function getLatestExternalFocus(
  root: HTMLElement,
  fallback: HTMLElement | null,
): HTMLElement | null {
  const pointerOpener = recentPointerOpener;
  recentPointerOpener = null;
  if (
    pointerOpener
    && Date.now() - pointerOpener.recordedAt <= POINTER_OPENER_MAX_AGE_MS
    && !root.contains(pointerOpener.element)
    && (
      isVisibleAndEnabled(pointerOpener.element)
      || pointerOpener.element.hasAttribute(RETURN_FOCUS_KEY_ATTRIBUTE)
    )
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

function getTopmostDialogRoot(): HTMLElement | null {
  const roots = document.querySelectorAll<HTMLElement>(DIALOG_ROOT_SELECTOR);
  return roots.item(roots.length - 1);
}

function focusInsideDialog(
  root: HTMLElement,
  content: HTMLElement,
  initialFocusElement?: HTMLElement | null,
): void {
  const requestedTarget = initialFocusElement
    ?? content.querySelector<HTMLElement>('[autofocus], [data-dialog-initial-focus="true"]');

  if (
    requestedTarget
    && content.contains(requestedTarget)
    && isVisibleAndEnabled(requestedTarget)
  ) {
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

  const firstFocusable = getFocusableElements(content)[0];
  focusWithoutScrolling(firstFocusable ?? content);
}

function restoreFocusAfterClose(
  opener: HTMLElement | null,
  closingRoot: HTMLElement,
): void {
  const activeElement = document.activeElement;
  const focusMovedElsewhere = activeElement instanceof HTMLElement
    && activeElement !== document.body
    && !closingRoot.contains(activeElement);

  // Navigation or another caller may already have placed focus somewhere
  // meaningful. Never steal it back in that case.
  if (focusMovedElsewhere) {
    return;
  }

  const connectedOpener = opener && isVisibleAndEnabled(opener)
    ? opener
    : findReplacementOpener(opener);
  if (connectedOpener) {
    focusWithoutScrolling(connectedOpener);
    return;
  }

  // A removed/disabled opener inside a nested flow falls back to the active
  // parent dialog. With no parent dialog, leaving focus on the document is the
  // safest navigation/unmount behavior.
  const parentRoot = getTopmostDialogRoot();
  const parentContent = parentRoot?.querySelector<HTMLElement>(DIALOG_CONTENT_SELECTOR);
  if (parentRoot && parentContent) {
    focusInsideDialog(parentRoot, parentContent);
  }
}

function findReplacementOpener(opener: HTMLElement | null): HTMLElement | null {
  const returnFocusKey = opener?.getAttribute(RETURN_FOCUS_KEY_ATTRIBUTE);
  if (!returnFocusKey) {
    return null;
  }

  // Some current sheets intentionally unmount their invoking card while open.
  // A unique semantic key lets the close commit restore focus to the card's
  // replacement without retaining or querying by arbitrary application state.
  const candidates = Array.from(
    document.querySelectorAll<HTMLElement>(`[${RETURN_FOCUS_KEY_ATTRIBUTE}]`),
  ).filter(candidate => (
    candidate.getAttribute(RETURN_FOCUS_KEY_ATTRIBUTE) === returnFocusKey
    && isVisibleAndEnabled(candidate)
  ));

  return candidates.length === 1 ? candidates[0]! : null;
}

export function DialogShell({
  isOpen,
  onClose,
  children,
  initialFocusRef,
  maxWidthClassName = 'max-w-sm',
  contentClassName = 'max-h-[calc(100vh-2rem)] touch-pan-y overflow-y-auto overscroll-contain rounded-2xl bg-white p-6 shadow-2xl supports-[height:100dvh]:max-h-[calc(100dvh-2rem)]',
  alignClassName = 'items-center justify-center p-4',
  closeOnBackdrop = true,
  closeOnEscape = true,
}: DialogShellProps) {
  const [portalReady, setPortalReady] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const openerRef = useRef<HTMLElement | null>(null);
  const initialExternalFocusRef = useRef<HTMLElement | null>(
    typeof document !== 'undefined' && document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null,
  );
  const lifecycleTokenRef = useRef<symbol | null>(null);
  const onCloseRef = useRef(onClose);

  useEffect(() => {
    setPortalReady(true);
  }, []);

  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  useBodyScrollLock(isOpen);

  useEffect(() => subscribeToFocusHistory(), []);

  useEffect(() => {
    if (!isOpen || !portalReady) {
      return undefined;
    }

    const root = rootRef.current;
    const content = contentRef.current;
    if (!root || !content) {
      return undefined;
    }

    const lifecycleToken = Symbol('dialog-shell-open-cycle');
    lifecycleTokenRef.current = lifecycleToken;

    const opener = getLatestExternalFocus(root, initialExternalFocusRef.current);
    openerRef.current = opener && opener !== document.body ? opener : null;

    focusInsideDialog(root, content, initialFocusRef?.current);

    const handleKeyDown = (event: KeyboardEvent) => {
      if (getTopmostDialogRoot() !== root) {
        return;
      }

      if (event.key === 'Escape' && closeOnEscape) {
        event.preventDefault();
        onCloseRef.current();
        return;
      }

      if (event.key !== 'Tab') {
        return;
      }

      const focusableElements = getFocusableElements(content);
      if (focusableElements.length === 0) {
        event.preventDefault();
        focusWithoutScrolling(content);
        return;
      }

      const firstFocusable = focusableElements[0]!;
      const lastFocusable = focusableElements.at(-1)!;
      const focusedIndex = document.activeElement instanceof HTMLElement
        ? focusableElements.indexOf(document.activeElement)
        : -1;

      if (event.shiftKey && (focusedIndex <= 0)) {
        event.preventDefault();
        focusWithoutScrolling(lastFocusable);
      } else if (!event.shiftKey && (focusedIndex === -1 || document.activeElement === lastFocusable)) {
        event.preventDefault();
        focusWithoutScrolling(firstFocusable);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      const opener = openerRef.current;

      // Deferring until after the closing commit distinguishes a real close or
      // unmount from Strict Mode/effect restarts, where this root stays live.
      queueMicrotask(() => {
        if (
          lifecycleTokenRef.current !== lifecycleToken
          || root.isConnected
        ) {
          return;
        }

        restoreFocusAfterClose(opener, root);
        lifecycleTokenRef.current = null;
        openerRef.current = null;
      });
    };
  }, [closeOnEscape, initialFocusRef, isOpen, portalReady]);

  if (!isOpen || !portalReady) {
    return null;
  }

  // Dashboard apps animate with transforms. A fixed dialog left inside one of
  // those trees becomes fixed to (and clipped by) that app instead of the
  // viewport on iOS. Portalling every dialog to body restores viewport-fixed
  // positioning for sheets, confirmations, and their native scroll regions.
  return createPortal(
    <div
      ref={rootRef}
      role="presentation"
      data-dialog-shell-root="true"
      data-testid="dialog-shell-overlay"
      className={cn('fixed inset-0 z-50 flex min-h-0 bg-black/50', alignClassName)}
      onClick={(event) => {
        if (closeOnBackdrop && event.target === event.currentTarget) {
          onClose();
        }
      }}
    >
      <div data-testid="dialog-shell-container" className={cn('min-h-0 w-full', maxWidthClassName)}>
        <div
          ref={contentRef}
          data-dialog-shell-content="true"
          data-testid="dialog-shell-content"
          tabIndex={-1}
          className={contentClassName}
        >
          {children}
        </div>
      </div>
    </div>,
    document.body,
  );
}
