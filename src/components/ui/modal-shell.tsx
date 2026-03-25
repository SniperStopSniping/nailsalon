import * as React from 'react';

import { cn } from '@/utils/Helpers';

type ModalShellProps = {
  isVisible: boolean;
  isContentVisible: boolean;
  children: React.ReactNode;
  maxWidthClassName?: string;
  panelClassName?: string;
};

export function ModalShell({
  isVisible,
  isContentVisible,
  children,
  maxWidthClassName = 'max-w-sm',
  panelClassName,
}: ModalShellProps) {
  if (!isVisible) {
    return null;
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div
        className="absolute inset-0 bg-black/60 backdrop-blur-sm transition-opacity duration-300"
        style={{ opacity: isContentVisible ? 1 : 0 }}
      />

      <div
        className={cn(
          'relative z-10 mx-4 w-full transition-all duration-300',
          maxWidthClassName,
        )}
        style={{
          opacity: isContentVisible ? 1 : 0,
          transform: isContentVisible ? 'translateY(0) scale(1)' : 'translateY(20px) scale(0.95)',
        }}
      >
        <div
          className={cn(
            'overflow-hidden rounded-3xl bg-white shadow-2xl',
            panelClassName,
          )}
        >
          {children}
        </div>
      </div>
    </div>
  );
}
