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
    window.requestAnimationFrame(() => (first ?? panel)?.focus());

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
      document.removeEventListener('keydown', keydown);
      const stackIndex = openBookingDialogStack.lastIndexOf(stackToken);
      if (stackIndex >= 0) openBookingDialogStack.splice(stackIndex, 1);
      window.requestAnimationFrame(() => {
        if (previousFocus?.isConnected) previousFocus.focus({ preventScroll: true });
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
