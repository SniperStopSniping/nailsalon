import type { ReactNode } from 'react';

import { AsyncStatePanel } from '@/components/ui/async-state-panel';
import { SectionCard } from '@/components/ui/section-card';

type SalonOption = {
  id: string;
  slug: string;
  name: string;
  role: string;
  status?: string | null;
  publicUrl?: string;
  bookingUrl?: string;
};

type AdminSalonSelectorProps = {
  salons: SalonOption[];
  onSelect: (salon: SalonOption) => void;
  footerAction?: ReactNode;
};

export function AdminSalonSelector({
  salons,
  onSelect,
  footerAction,
}: AdminSalonSelectorProps) {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-[#F2F2F7] px-5">
      <div className="w-full max-w-sm space-y-4">
        <AsyncStatePanel
          icon="🏢"
          title="My Salons"
          description="Choose a salon to manage, or open its live booking page."
        />
        <div className="space-y-3">
          {salons.map(salon => (
            <SectionCard key={salon.id} className="shadow-sm" contentClassName="py-4">
              <button
                type="button"
                onClick={() => onSelect(salon)}
                className="w-full text-left transition-opacity hover:opacity-80"
              >
                <div className="font-semibold text-[#1C1C1E]">{salon.name}</div>
                <div className="mt-1 flex items-center gap-2 text-sm text-[#8E8E93]">
                  <span className="capitalize">{salon.role}</span>
                  <span>·</span>
                  <span className="capitalize">{salon.status || 'draft'}</span>
                </div>
              </button>
              <div className="mt-3 flex flex-wrap gap-2 border-t border-black/5 pt-3">
                <button
                  type="button"
                  onClick={() => onSelect(salon)}
                  className="rounded-full bg-[#1C1C1E] px-3 py-1.5 text-xs font-semibold text-white"
                >
                  Open dashboard
                </button>
                {salon.publicUrl && (
                  <a className="rounded-full bg-black/5 px-3 py-1.5 text-xs font-semibold text-[#1C1C1E]" href={salon.publicUrl} target="_blank" rel="noreferrer">Public page</a>
                )}
                {salon.bookingUrl && (
                  <a className="rounded-full bg-black/5 px-3 py-1.5 text-xs font-semibold text-[#1C1C1E]" href={salon.bookingUrl} target="_blank" rel="noreferrer">Booking page</a>
                )}
              </div>
            </SectionCard>
          ))}
        </div>
      </div>
      {footerAction}
    </div>
  );
}
