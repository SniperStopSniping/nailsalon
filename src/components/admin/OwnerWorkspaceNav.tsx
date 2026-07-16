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
      <div className="mx-auto grid max-w-2xl grid-cols-5 px-2 pt-2">
        {ITEMS.map((item) => {
          const Icon = item.icon;
          const selected = active === item.id;
          return (
            <button
              key={item.id}
              type="button"
              data-testid={`owner-nav-${item.id}`}
              aria-current={selected ? 'page' : undefined}
              onClick={() => onSelect(item.id)}
              className={`flex min-h-14 flex-col items-center justify-center gap-1 rounded-xl text-[11px] font-medium transition-colors ${
                selected ? 'bg-rose-50 text-rose-800' : 'text-stone-400'
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
