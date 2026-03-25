'use client';

import { useEffect } from 'react';

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
  contentClassName = 'rounded-2xl bg-white p-6 shadow-2xl',
  alignClassName = 'items-center justify-center p-4',
  closeOnBackdrop = true,
  closeOnEscape = true,
}: DialogShellProps) {
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

  if (!isOpen) {
    return null;
  }

  return (
    <div
      className={cn('fixed inset-0 z-50 flex bg-black/50', alignClassName)}
      onClick={(event) => {
        if (closeOnBackdrop && event.target === event.currentTarget) {
          onClose();
        }
      }}
    >
      <div className={cn('w-full', maxWidthClassName)}>
        <div className={contentClassName}>
          {children}
        </div>
      </div>
    </div>
  );
}
