'use client';

import type { RefObject } from 'react';
import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

import { useBodyScrollLock } from '@/hooks/useBodyScrollLock';
import { useModalFocusLifecycle } from '@/hooks/useModalFocusLifecycle';
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
  overlayTestId?: string;
  contentTestId?: string;
  overlayClassName?: string;
};

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
  overlayTestId = 'dialog-shell-overlay',
  contentTestId = 'dialog-shell-content',
  overlayClassName,
}: DialogShellProps) {
  const [portalReady, setPortalReady] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);

  useEffect(() => setPortalReady(true), []);
  useBodyScrollLock(isOpen);
  useModalFocusLifecycle({
    isOpen: isOpen && portalReady,
    onClose,
    rootRef,
    contentRef,
    initialFocusRef,
    closeOnEscape,
  });

  if (!isOpen || !portalReady) {
    return null;
  }

  // Portalling keeps fixed dialogs viewport-bound even inside transformed apps.
  return createPortal(
    <div
      ref={rootRef}
      role="presentation"
      data-dialog-shell-root="true"
      data-modal-focus-root="true"
      data-testid={overlayTestId}
      className={cn('fixed inset-0 z-50 flex min-h-0 bg-black/50', alignClassName, overlayClassName)}
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
          data-modal-focus-content="true"
          data-testid={contentTestId}
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
