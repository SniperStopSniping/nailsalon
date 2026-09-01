import { useEffect, useRef, type ReactNode } from 'react';

const FOCUSABLE = [
  'button:not([disabled])',
  'input:not([disabled])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  'a[href]',
  '[tabindex]:not([tabindex="-1"])',
].join(',');

type BookingOverlayDialogProps = {
  children: ReactNode;
  className?: string;
  labelledBy: string;
  onClose: () => void;
  suspended?: boolean;
  testId: string;
};

const openBookingDialogStack: symbol[] = [];

type DialogScrollSnapshot = {
  ancestors: Array<{
    element: HTMLElement;
    left: number;
    top: number;
  }>;
  windowX: number;
  windowY: number;
};

const captureDialogScroll = (anchor: HTMLElement | null): DialogScrollSnapshot => {
  const ancestors: DialogScrollSnapshot['ancestors'] = [];
  let current = anchor?.parentElement ?? null;
  while (current) {
    if (
      current.scrollTop !== 0
      || current.scrollLeft !== 0
      || current.scrollHeight > current.clientHeight
      || current.scrollWidth > current.clientWidth
    ) {
      ancestors.push({
        element: current,
        left: current.scrollLeft,
        top: current.scrollTop,
      });
    }
    current = current.parentElement;
  }
  return {
    ancestors,
    windowX: window.scrollX,
    windowY: window.scrollY,
  };
};

const restoreDialogScroll = (snapshot: DialogScrollSnapshot) => {
  for (const { element, left, top } of snapshot.ancestors) {
    if (!element.isConnected) {
      continue;
    }
    if (element.scrollLeft !== left) {
      element.scrollLeft = left;
    }
    if (element.scrollTop !== top) {
      element.scrollTop = top;
    }
  }
  if (window.scrollX !== snapshot.windowX || window.scrollY !== snapshot.windowY) {
    window.scrollTo(snapshot.windowX, snapshot.windowY);
  }
};

export function BookingOverlayDialog({
  children,
  className = '',
  labelledBy,
  onClose,
  suspended = false,
  testId,
}: BookingOverlayDialogProps) {
  const panelRef = useRef<HTMLDivElement>(null);
  const onCloseRef = useRef(onClose);
  const stackTokenRef = useRef(Symbol('luster-booking-dialog'));

  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  useEffect(() => {
    const previousFocus = document.activeElement as HTMLElement | null;
    const panel = panelRef.current;
    const stackToken = stackTokenRef.current;
    openBookingDialogStack.push(stackToken);
    const first = panel?.querySelector<HTMLElement>(FOCUSABLE);
    const openingScroll = captureDialogScroll(previousFocus);
    let restoreFrame: number | null = null;
    const focusFrame = window.requestAnimationFrame(() => {
      (first ?? panel)?.focus({ preventScroll: true });
      restoreDialogScroll(openingScroll);
      // WebKit may finish its focus reveal after the focus call returns.
      restoreFrame = window.requestAnimationFrame(() => restoreDialogScroll(openingScroll));
    });

    const keydown = (event: KeyboardEvent) => {
      if (openBookingDialogStack.at(-1) !== stackToken) return;
      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        onCloseRef.current();
        return;
      }
      if (event.key !== 'Tab' || !panel) return;
      const focusable = [...panel.querySelectorAll<HTMLElement>(FOCUSABLE)];
      if (focusable.length === 0) {
        event.preventDefault();
        panel.focus();
        return;
      }
      const firstFocusable = focusable[0];
      const lastFocusable = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === firstFocusable) {
        event.preventDefault();
        lastFocusable?.focus();
      } else if (!event.shiftKey && document.activeElement === lastFocusable) {
        event.preventDefault();
        firstFocusable?.focus();
      }
    };
    document.addEventListener('keydown', keydown);
    return () => {
      window.cancelAnimationFrame(focusFrame);
      if (restoreFrame !== null) {
        window.cancelAnimationFrame(restoreFrame);
      }
      document.removeEventListener('keydown', keydown);
      const stackIndex = openBookingDialogStack.lastIndexOf(stackToken);
      if (stackIndex >= 0) openBookingDialogStack.splice(stackIndex, 1);
      window.requestAnimationFrame(() => {
        if (previousFocus?.isConnected) previousFocus.focus({ preventScroll: true });
        restoreDialogScroll(openingScroll);
        window.requestAnimationFrame(() => restoreDialogScroll(openingScroll));
      });
    };
  }, []);

  useEffect(() => {
    const panel = panelRef.current;
    if (!panel) return;
    if (suspended) panel.setAttribute('inert', '');
    else panel.removeAttribute('inert');
    return () => panel.removeAttribute('inert');
  }, [suspended]);

  return (
    <div
      className="booking-contained-dialog-backdrop"
      data-testid={`${testId}-backdrop`}
      onMouseDown={(event) => {
        if (event.currentTarget === event.target) onClose();
      }}
    >
      <div
        ref={panelRef}
        aria-labelledby={labelledBy}
        aria-modal="true"
        aria-hidden={suspended ? 'true' : undefined}
        className={`booking-contained-dialog ${className}`.trim()}
        data-testid={testId}
        role="dialog"
        tabIndex={-1}
      >
        {children}
      </div>
    </div>
  );
}
