import {
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';

import { isEscapeHandledInsideActiveControl } from './dialog-events';

type DialogProps = {
  children: ReactNode;
  description?: string;
  initialFocusSelector?: string;
  onClose: () => void;
  open: boolean;
  restoreFocusOnClose?: boolean;
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
const modalScrollLocks = new Set<symbol>();
let unlockedBodyOverflow: { priority: string; value: string } | null = null;

const acquireModalScrollLock = (token: symbol): void => {
  if (modalScrollLocks.has(token)) {
    return;
  }
  if (modalScrollLocks.size === 0) {
    unlockedBodyOverflow = {
      priority: document.body.style.getPropertyPriority('overflow'),
      value: document.body.style.getPropertyValue('overflow'),
    };
  }
  modalScrollLocks.add(token);
  document.body.style.setProperty('overflow', 'hidden');
};

const releaseModalScrollLock = (token: symbol): void => {
  if (!modalScrollLocks.delete(token) || modalScrollLocks.size > 0) {
    return;
  }
  document.body.style.removeProperty('overflow');
  if (unlockedBodyOverflow?.value) {
    document.body.style.setProperty(
      'overflow',
      unlockedBodyOverflow.value,
      unlockedBodyOverflow.priority,
    );
  }
  unlockedBodyOverflow = null;
};

const canRestoreFocus = (element: HTMLElement | null): element is HTMLElement => Boolean(
  element
  && element !== document.body
  && element !== document.documentElement
  && element.isConnected
  && !element.matches(':disabled')
  && !element.closest('[aria-hidden="true"], [hidden], [inert]'),
);

export function Dialog({
  children,
  description,
  initialFocusSelector,
  onClose,
  open,
  restoreFocusOnClose = true,
  title,
  variant = 'dialog',
}: DialogProps) {
  const titleId = useId();
  const descriptionId = useId();
  const dialogRef = useRef<HTMLDivElement>(null);
  const onCloseRef = useRef(onClose);
  const restoreFocusOnCloseRef = useRef(restoreFocusOnClose);
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

  restoreFocusOnCloseRef.current = restoreFocusOnClose;

  useEffect(() => {
    const media = window.matchMedia('(min-width: 900px)');
    const handleChange = () => setWideViewport(media.matches);
    media.addEventListener('change', handleChange);
    return () => media.removeEventListener('change', handleChange);
  }, []);

  useLayoutEffect(() => {
    if (!open) {
      return undefined;
    }

    const previouslyFocused = document.activeElement as HTMLElement | null;
    const stackToken = stackTokenRef.current;
    openDialogStack.push(stackToken);
    if (!nonModal) {
      acquireModalScrollLock(stackToken);
    }

    const dialog = dialogRef.current;
    const preferredFocusable = initialFocusSelector
      ? dialog?.querySelector<HTMLElement>(initialFocusSelector)
      : null;
    const firstFocusable = preferredFocusable
      ?? dialog?.querySelector<HTMLElement>(FOCUSABLE_SELECTOR);
    const focusFrame = window.requestAnimationFrame(() => {
      const focusTarget = firstFocusable ?? dialog;
      if (focusTarget?.isConnected) {
        focusTarget.focus({ preventScroll: true });
      }
    });

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
      const activeElement = document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
      if (!activeElement || !focusable.includes(activeElement)) {
        event.preventDefault();
        (event.shiftKey ? last : first)?.focus();
      } else if (event.shiftKey && activeElement === first) {
        event.preventDefault();
        last?.focus();
      } else if (!event.shiftKey && activeElement === last) {
        event.preventDefault();
        first?.focus();
      }
    };

    document.addEventListener('keydown', handleKeyDown);

    return () => {
      window.cancelAnimationFrame(focusFrame);
      document.removeEventListener('keydown', handleKeyDown);
      if (!nonModal) {
        releaseModalScrollLock(stackToken);
      }
      const stackIndex = openDialogStack.lastIndexOf(stackToken);
      if (stackIndex >= 0) {
        openDialogStack.splice(stackIndex, 1);
      }
      if (!restoreFocusOnCloseRef.current) {
        return;
      }
      window.requestAnimationFrame(() => {
        const activeElement = document.activeElement;
        const focusIsUnclaimed = !activeElement
          || activeElement === document.body
          || activeElement === document.documentElement;
        if (focusIsUnclaimed && canRestoreFocus(previouslyFocused)) {
          previouslyFocused.focus({ preventScroll: true });
        }
      });
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
          <h2 data-dialog-title id={titleId} tabIndex={-1}>{title}</h2>
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
    visuallyAdjacent && nonModal ? (
      <div className="dialog-nonmodal-layer" data-testid="dialog-nonmodal-layer">{panel}</div>
    ) : (
      <div
        className={`dialog-backdrop${visuallyAdjacent ? ' dialog-backdrop--adjacent' : ''}`}
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
