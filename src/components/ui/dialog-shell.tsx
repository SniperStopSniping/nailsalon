'use client';

import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';

import { useBodyScrollLock } from '@/hooks/useBodyScrollLock';
import { cn } from '@/utils/Helpers';

type DialogShellProps = {
  isOpen: boolean;
  onClose: () => void;
  children: React.ReactNode;
  maxWidthClassName?: string;
  contentClassName?: string;
  alignClassName?: string;
  closeOnBackdrop?: boolean;
  closeOnEscape?: boolean;
};

export function DialogShell({
  isOpen,
  onClose,
  children,
  maxWidthClassName = 'max-w-sm',
  contentClassName = 'max-h-[calc(100vh-2rem)] touch-pan-y overflow-y-auto overscroll-contain rounded-2xl bg-white p-6 shadow-2xl supports-[height:100dvh]:max-h-[calc(100dvh-2rem)]',
  alignClassName = 'items-center justify-center p-4',
  closeOnBackdrop = true,
  closeOnEscape = true,
}: DialogShellProps) {
  const [portalReady, setPortalReady] = useState(false);

  useEffect(() => {
    setPortalReady(true);
  }, []);

  useBodyScrollLock(isOpen);

  useEffect(() => {
    if (!isOpen || !closeOnEscape) {
      return undefined;
    }

    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        onClose();
      }
    };

    window.addEventListener('keydown', handleEscape);
    return () => window.removeEventListener('keydown', handleEscape);
  }, [closeOnEscape, isOpen, onClose]);

  if (!isOpen || !portalReady) {
    return null;
  }

  // Dashboard apps animate with transforms. A fixed dialog left inside one of
  // those trees becomes fixed to (and clipped by) that app instead of the
  // viewport on iOS. Portalling every dialog to body restores viewport-fixed
  // positioning for sheets, confirmations, and their native scroll regions.
  return createPortal(
    <div
      role="presentation"
      data-testid="dialog-shell-overlay"
      className={cn('fixed inset-0 z-50 flex min-h-0 bg-black/50', alignClassName)}
      onClick={(event) => {
        if (closeOnBackdrop && event.target === event.currentTarget) {
          onClose();
        }
      }}
    >
      <div data-testid="dialog-shell-container" className={cn('min-h-0 w-full', maxWidthClassName)}>
        <div className={contentClassName}>
          {children}
        </div>
      </div>
    </div>,
    document.body,
  );
}
