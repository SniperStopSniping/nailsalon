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
  testId: string;
};

export function BookingOverlayDialog({
  children,
  className = '',
  labelledBy,
  onClose,
  testId,
}: BookingOverlayDialogProps) {
  const panelRef = useRef<HTMLDivElement>(null);
  const onCloseRef = useRef(onClose);

  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  useEffect(() => {
    const previousFocus = document.activeElement as HTMLElement | null;
    const panel = panelRef.current;
    const first = panel?.querySelector<HTMLElement>(FOCUSABLE);
    window.requestAnimationFrame(() => (first ?? panel)?.focus());

    const keydown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
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
      previousFocus?.focus();
    };
  }, []);

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
