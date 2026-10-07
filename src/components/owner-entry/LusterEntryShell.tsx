import './owner-entry.css';

import type { ReactNode } from 'react';

export function LusterWordmark() {
  return (
    <div className="luster-entry-brand" aria-label="Luster">
      <svg aria-hidden="true" viewBox="0 0 64 58" fill="currentColor">
        <path d="M31 7c2.5 18 5.5 21 24 24-18.5 3-21.5 6-24 24C28.5 37 25.5 34 7 31 25.5 28 28.5 25 31 7Z" />
        <path d="M54 0c.7 6 2 7.3 8 8-6 .7-7.3 2-8 8-.7-6-2-7.3-8-8 6-.7 7.3-2 8-8ZM8 9c.5 4 1.5 5 5.5 5.5C9.5 15 8.5 16 8 20c-.5-4-1.5-5-5.5-5.5C6.5 14 7.5 13 8 9Z" />
      </svg>
      <span aria-hidden="true">LUSTER</span>
    </div>
  );
}

export function LusterEntryShell({
  children,
  className = '',
  variant = 'welcome',
}: {
  children: ReactNode;
  className?: string;
  variant?: 'welcome' | 'salons' | 'offer';
}) {
  return (
    <div className={`luster-entry luster-entry--${variant} ${className}`}>
      <div className="luster-entry-ornament luster-entry-ornament--top" aria-hidden="true">
        <svg viewBox="0 0 200 240" fill="none">
          <path d="M198-20C60 30 37 111 11 235M193 2c-75 44-80 107-59 142 42-37 61-84 59-142ZM182 31c-53 36-64 81-50 111" stroke="currentColor" />
        </svg>
      </div>
      <div className="luster-entry-ornament luster-entry-ornament--bottom" aria-hidden="true">✦</div>
      <div className="luster-entry-content">{children}</div>
    </div>
  );
}
