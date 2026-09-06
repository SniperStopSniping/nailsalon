'use client';

import { CalendarDays, ContactRound, Home, MoreHorizontal, Scissors } from 'lucide-react';

export type OwnerWorkspaceTab = 'today' | 'calendar' | 'clients' | 'services' | 'more';

const ITEMS = [
  { id: 'today', label: 'Today', icon: Home },
  { id: 'calendar', label: 'Calendar', icon: CalendarDays },
  { id: 'clients', label: 'Clients', icon: ContactRound },
  { id: 'services', label: 'Services', icon: Scissors },
  { id: 'more', label: 'More', icon: MoreHorizontal },
] as const;

export function OwnerWorkspaceNav({
  active,
  onSelect,
}: {
  active: OwnerWorkspaceTab;
  onSelect: (tab: OwnerWorkspaceTab) => void;
}) {
  return (
    <nav
      aria-label="Owner workspace"
      className="fixed inset-x-0 bottom-0 z-30 border-t border-rose-100 bg-white/95 shadow-[0_-8px_30px_rgba(76,29,46,0.06)] backdrop-blur-xl"
      style={{ paddingBottom: 'env(safe-area-inset-bottom, 0px)' }}
    >
      {/*
        The five destinations swap panels inside one screen rather than
        navigating, so they are tabs. Every tab stays in the tab order (no
        roving tabindex) because the workspace is a single-screen mobile shell
        where Tab is the only keyboard path onto the bar; arrow keys move
        between tabs as well.
      */}
      <div
        role="tablist"
        aria-label="Owner workspace sections"
        aria-orientation="horizontal"
        className="mx-auto grid max-w-2xl grid-cols-5 px-2 pt-2"
      >
        {ITEMS.map((item, index) => {
          const Icon = item.icon;
          const selected = active === item.id;
          return (
            <button
              key={item.id}
              type="button"
              role="tab"
              id={`owner-nav-tab-${item.id}`}
              data-testid={`owner-nav-${item.id}`}
              aria-selected={selected}
              aria-current={selected ? 'page' : undefined}
              onClick={() => onSelect(item.id)}
              onKeyDown={(event) => {
                if (event.key !== 'ArrowRight' && event.key !== 'ArrowLeft') {
                  return;
                }
                event.preventDefault();
                const offset = event.key === 'ArrowRight' ? 1 : -1;
                const next = ITEMS[(index + offset + ITEMS.length) % ITEMS.length];
                if (!next) {
                  return;
                }
                onSelect(next.id);
                document
                  .querySelector<HTMLButtonElement>(`[data-testid="owner-nav-${next.id}"]`)
                  ?.focus();
              }}
              className={`flex min-h-14 flex-col items-center justify-center gap-1 rounded-xl px-0.5 text-[12px] font-medium leading-tight outline-none transition-colors focus-visible:ring-2 focus-visible:ring-[var(--owner-focus,#b85075)] focus-visible:ring-offset-1 ${
                selected
                  ? 'bg-[var(--owner-blush,#f6e7ec)] text-[var(--owner-accent,#8f3155)]'
                  : 'text-[var(--owner-muted,#706267)]'
              }`}
            >
              <Icon size={21} strokeWidth={selected ? 2.6 : 2} />
              {item.label}
            </button>
          );
        })}
      </div>
    </nav>
  );
}
