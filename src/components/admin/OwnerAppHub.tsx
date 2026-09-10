'use client';

import type { LucideIcon } from 'lucide-react';
import { ChevronRight } from 'lucide-react';

import { BackButton, ModalHeader } from './AppModal';

export type OwnerAppHubItem<T extends string> = {
  id: T;
  title: string;
  description: string;
  icon: LucideIcon;
  status?: string;
  disabled?: boolean;
};

export function OwnerAppHub<T extends string>({
  title,
  subtitle,
  items,
  onBack,
  onOpen,
}: {
  title: string;
  subtitle: string;
  items: ReadonlyArray<OwnerAppHubItem<T>>;
  onBack: () => void;
  onOpen: (id: T) => void;
}) {
  return (
    <div className="flex min-h-full w-full flex-col bg-[var(--owner-ground)] font-sans text-[var(--owner-ink)]">
      <div className="sticky top-0 z-20 bg-[var(--owner-ground)] backdrop-blur-md">
        <ModalHeader
          title={title}
          subtitle={subtitle}
          leftAction={<BackButton onClick={onBack} label="Back" />}
        />
      </div>
      <div className="grid grid-cols-1 gap-3 overflow-y-auto px-4 pb-10 min-[420px]:grid-cols-2">
        {items.map(({ id, title: itemTitle, description, icon: Icon, status, disabled }) => (
          <button
            key={id}
            type="button"
            onClick={() => onOpen(id)}
            disabled={disabled}
            className="group flex min-h-32 w-full flex-col items-start rounded-2xl border border-[var(--owner-line)] bg-[var(--owner-surface)] p-4 text-left shadow-sm outline-none transition-colors hover:bg-[var(--owner-blush)] focus-visible:ring-2 focus-visible:ring-[var(--owner-focus)] disabled:cursor-not-allowed disabled:opacity-55"
          >
            <span className="flex w-full items-start justify-between gap-3">
              <span className="flex size-11 shrink-0 items-center justify-center rounded-xl bg-[var(--owner-blush)] text-[var(--owner-accent)]">
                <Icon aria-hidden="true" className="size-5" />
              </span>
              <ChevronRight aria-hidden="true" className="mt-1 size-4 text-[var(--owner-muted)] transition-transform group-hover:translate-x-0.5" />
            </span>
            <span className="mt-3 text-[16px] font-semibold leading-tight">{itemTitle}</span>
            <span className="mt-1 text-[13px] leading-snug text-[var(--owner-muted)]">{description}</span>
            {status ? <span className="mt-2 text-[12px] font-medium text-[var(--owner-accent)]">{status}</span> : null}
          </button>
        ))}
      </div>
    </div>
  );
}
