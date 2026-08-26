import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';

import { isEscapeHandledInsideActiveControl } from './dialog-events';

type DialogProps = {
  children: ReactNode;
  description?: string;
  initialFocusSelector?: string;
  onClose: () => void;
  open: boolean;
  title: string;
  variant?: 'bottom-sheet' | 'context-panel' | 'dialog' | 'move-panel' | 'section-library' | 'sheet' | 'structure-panel';
};

const FOCUSABLE_SELECTOR = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(',');

const openDialogStack: symbol[] = [];

export function Dialog({
  children,
  description,
  initialFocusSelector,
  onClose,
  open,
  title,
  variant = 'dialog',
}: DialogProps) {
  const titleId = useId();
  const descriptionId = useId();
  const dialogRef = useRef<HTMLDivElement>(null);
  const onCloseRef = useRef(onClose);
  const stackTokenRef = useRef(Symbol('luster-lab-dialog'));
  const [wideViewport, setWideViewport] = useState(() => window.matchMedia('(min-width: 900px)').matches);
  const visuallyAdjacent = wideViewport && (
    variant === 'context-panel'
    || variant === 'move-panel'
    || variant === 'structure-panel'
  );
  const nonModal = visuallyAdjacent && variant !== 'move-panel';

  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  useEffect(() => {
    const media = window.matchMedia('(min-width: 900px)');
    const handleChange = () => setWideViewport(media.matches);
    media.addEventListener('change', handleChange);
    return () => media.removeEventListener('change', handleChange);
  }, []);

  useEffect(() => {
    if (!open) {
      return undefined;
    }

    const previouslyFocused = document.activeElement as HTMLElement | null;
    const stackToken = stackTokenRef.current;
    openDialogStack.push(stackToken);
    const previousOverflow = document.body.style.overflow;
    if (!nonModal) {
      document.body.style.overflow = 'hidden';
    }

    const dialog = dialogRef.current;
    const preferredFocusable = initialFocusSelector
      ? dialog?.querySelector<HTMLElement>(initialFocusSelector)
      : null;
    const firstFocusable = preferredFocusable
      ?? dialog?.querySelector<HTMLElement>(FOCUSABLE_SELECTOR);
    window.requestAnimationFrame(() => (firstFocusable ?? dialog)?.focus());

    const handleKeyDown = (event: KeyboardEvent) => {
      if (openDialogStack.at(-1) !== stackToken) {
        return;
      }
      if (
        event.key === 'Escape'
        && !event.defaultPrevented
        && !isEscapeHandledInsideActiveControl(event)
      ) {
        event.preventDefault();
        onCloseRef.current();
        return;
      }

      if (nonModal || event.key !== 'Tab' || !dialog) {
        return;
      }

      const focusable = [...dialog.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)];
      if (focusable.length === 0) {
        event.preventDefault();
        dialog.focus();
        return;
      }

      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last?.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first?.focus();
      }
    };

    document.addEventListener('keydown', handleKeyDown);

    return () => {
      document.removeEventListener('keydown', handleKeyDown);
      if (!nonModal) {
        document.body.style.overflow = previousOverflow;
      }
      const stackIndex = openDialogStack.lastIndexOf(stackToken);
      if (stackIndex >= 0) {
        openDialogStack.splice(stackIndex, 1);
      }
      previouslyFocused?.focus();
    };
  }, [initialFocusSelector, nonModal, open]);

  if (!open) {
    return null;
  }

  const panel = (
    <div
      ref={dialogRef}
      aria-describedby={description ? descriptionId : undefined}
      aria-labelledby={titleId}
      aria-modal={nonModal ? undefined : 'true'}
      className={`dialog-panel dialog-panel--${variant}`}
      role="dialog"
      tabIndex={-1}
    >
      <div className="dialog-header">
        <div>
          <h2 id={titleId}>{title}</h2>
          {description ? <p id={descriptionId}>{description}</p> : null}
        </div>
        <button className="icon-button" type="button" aria-label={`Close ${title}`} onClick={onClose}>
          <X aria-hidden="true" size={20} />
        </button>
      </div>
      <div className="dialog-body">{children}</div>
    </div>
  );

  return createPortal(
    visuallyAdjacent ? (
      <div className="dialog-nonmodal-layer" data-testid="dialog-nonmodal-layer">{panel}</div>
    ) : (
      <div
        className="dialog-backdrop"
        data-testid="dialog-backdrop"
        onMouseDown={(event) => {
          if (event.currentTarget === event.target) {
            onClose();
          }
        }}
      >
        {panel}
      </div>
    ),
    document.body,
  );
}
