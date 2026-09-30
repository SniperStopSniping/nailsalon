import { type ReactNode, useState } from 'react';

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
  hiddenSalons?: SalonOption[];
  onSelect: (salon: SalonOption) => void;
  onVisibilityChange?: (salon: SalonOption, hidden: boolean) => Promise<void>;
  footerAction?: ReactNode;
};

const EMPTY_SALONS: SalonOption[] = [];

export function AdminSalonSelector({
  salons,
  hiddenSalons = EMPTY_SALONS,
  onSelect,
  onVisibilityChange,
  footerAction,
}: AdminSalonSelectorProps) {
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const changeVisibility = async (salon: SalonOption, hidden: boolean) => {
    if (!onVisibilityChange) {
      return;
    }
    setBusyId(salon.id);
    setError(null);
    try {
      await onVisibilityChange(salon, hidden);
      setConfirmId(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not update the salon list. Try again.');
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-[#F8F3F0] px-5">
      <div className="w-full max-w-sm space-y-4">
        <AsyncStatePanel
          icon="✨"
          title="Your Luster salons"
          description="Choose a salon workspace or open its live booking page."
        />
        {error && <p role="alert" className="rounded-xl bg-red-50 px-4 py-3 text-sm text-red-800">{error}</p>}
        <div className="space-y-3">
          {salons.length === 0 && (
            <p className="rounded-2xl bg-white p-5 text-center text-sm text-[#626269]">No salons in your list. Restore one below to open its dashboard.</p>
          )}
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
                  className="rounded-full bg-rose-800 px-3 py-1.5 text-xs font-semibold text-white"
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
              {onVisibilityChange && salon.role === 'owner' && (
                <div className="mt-3 border-t border-black/5 pt-3">
                  {confirmId === salon.id
                    ? (
                        <div className="space-y-3 text-sm text-[#55555B]">
                          <p>{`Remove ${salon.name} from your salon list? This does not change its booking page, appointments, or subscription. You can restore it here later.`}</p>
                          <div className="flex flex-wrap gap-2">
                            <button type="button" disabled={busyId === salon.id} onClick={() => void changeVisibility(salon, true)} className="min-h-11 rounded-full bg-rose-800 px-4 text-xs font-semibold text-white disabled:opacity-50">{busyId === salon.id ? 'Removing…' : 'Remove from my list'}</button>
                            <button type="button" disabled={busyId === salon.id} onClick={() => setConfirmId(null)} className="min-h-11 rounded-full bg-black/5 px-4 text-xs font-semibold text-[#1C1C1E]">Cancel</button>
                          </div>
                        </div>
                      )
                    : (
                        <button type="button" onClick={() => setConfirmId(salon.id)} className="min-h-11 text-xs font-semibold text-[#6D565F] underline underline-offset-4">Remove from my list</button>
                      )}
                </div>
              )}
            </SectionCard>
          ))}
        </div>
        {hiddenSalons.length > 0 && (
          <details className="rounded-2xl border border-[#E9DEDA] bg-white p-4 shadow-sm">
            <summary className="cursor-pointer text-sm font-semibold text-[#1C1C1E]">{`Removed salons (${hiddenSalons.length})`}</summary>
            <p className="mt-2 text-xs text-[#626269]">These salons still exist. Restore one to put it back in your list.</p>
            <div className="mt-3 space-y-3">
              {hiddenSalons.map(salon => (
                <div key={salon.id} className="flex items-center justify-between gap-3 border-t border-black/5 pt-3">
                  <span className="min-w-0 break-words text-sm font-medium text-[#1C1C1E]">{salon.name}</span>
                  <button type="button" disabled={busyId === salon.id} onClick={() => void changeVisibility(salon, false)} className="min-h-11 shrink-0 rounded-full bg-black/5 px-4 text-xs font-semibold text-[#1C1C1E] disabled:opacity-50">{busyId === salon.id ? 'Restoring…' : 'Restore'}</button>
                </div>
              ))}
            </div>
          </details>
        )}
      </div>
      {footerAction}
    </div>
  );
}
