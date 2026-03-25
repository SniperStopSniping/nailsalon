import type { ReactNode } from 'react';

import { AsyncStatePanel } from '@/components/ui/async-state-panel';
import { SectionCard } from '@/components/ui/section-card';

type SalonOption = {
  id: string;
  slug: string;
  name: string;
  role: string;
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
          title="Select a Salon"
          description="Choose which salon to manage."
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
                <div className="text-sm text-[#8E8E93]">{salon.role}</div>
              </button>
            </SectionCard>
          ))}
        </div>
      </div>
      {footerAction}
    </div>
  );
}
