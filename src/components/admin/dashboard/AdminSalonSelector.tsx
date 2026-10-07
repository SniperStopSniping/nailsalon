import { CalendarDays, ChevronDown, Flower2, LayoutGrid, Leaf, Link2, Sparkles, Trash2 } from 'lucide-react';
import { type ReactNode, useState } from 'react';

import { LusterEntryShell, LusterWordmark } from '@/components/owner-entry/LusterEntryShell';

type SalonOption = {
  id: string;
  slug: string;
  name: string;
  logoUrl?: string | null;
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
const SALON_ICONS = [Flower2, Leaf, Sparkles];

function SalonAvatar({ salon }: { salon: SalonOption }) {
  const [failedSource, setFailedSource] = useState<string | null>(null);
  const iconIndex = Array.from(salon.id).reduce((total, character) => total + character.charCodeAt(0), 0) % SALON_ICONS.length;
  const SalonIcon = SALON_ICONS[iconIndex] ?? Flower2;
  return (
    <div className="luster-salon-avatar" aria-hidden="true">
      {salon.logoUrl && salon.logoUrl !== failedSource
        ? <img src={salon.logoUrl} alt="" width={54} height={54} loading="lazy" onError={() => setFailedSource(salon.logoUrl ?? null)} />
        : <SalonIcon />}
    </div>
  );
}

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
    <LusterEntryShell variant="salons">
      <main>
        <LusterWordmark />
        <header className="luster-entry-header">
          <h1>Your Luster salons</h1>
          <p>Choose a salon workspace or open its live booking page.</p>
        </header>
        {error && <p role="alert" className="luster-entry-error">{error}</p>}
        <div className="luster-entry-salons">
          {salons.length === 0 && (
            <p className="luster-entry-card">No salons in your list. Restore one below to open its dashboard.</p>
          )}
          {salons.map((salon) => {
            return (
              <section className="luster-entry-card" key={salon.id} aria-label={salon.name}>
                <div className="luster-salon-heading">
                  <SalonAvatar salon={salon} />
                  <div className="luster-salon-identity">
                    <h2 className="luster-salon-title"><button type="button" onClick={() => onSelect(salon)}>{salon.name}</button></h2>
                    <span className="luster-salon-meta">
                      <span>{salon.role}</span>
                      <span aria-hidden="true">•</span>
                      <span className="luster-salon-status">
                        {salon.status?.toLowerCase() === 'active' && <i aria-hidden="true" />}
                        {salon.status || 'draft'}
                      </span>
                    </span>
                  </div>
                </div>
                <div className="luster-salon-actions">
                  <button className="luster-entry-button luster-entry-button--primary" type="button" onClick={() => onSelect(salon)}>
                    <LayoutGrid aria-hidden="true" />
                    <span>Open dashboard</span>
                  </button>
                  {salon.publicUrl && (
                    <a className="luster-entry-button" href={salon.publicUrl} target="_blank" rel="noreferrer">
                      <Link2 aria-hidden="true" />
                      <span>Public page</span>
                    </a>
                  )}
                  {salon.bookingUrl && (
                    <a className="luster-entry-button" href={salon.bookingUrl} target="_blank" rel="noreferrer">
                      <CalendarDays aria-hidden="true" />
                      <span>Booking page</span>
                    </a>
                  )}
                </div>
                {onVisibilityChange && salon.role === 'owner' && (
                  <div className="luster-salon-remove">
                    {confirmId === salon.id
                      ? (
                          <div className="luster-salon-confirmation">
                            <p>{`Remove ${salon.name} from your salon list? This does not change its booking page, appointments, or subscription. You can restore it here later.`}</p>
                            <div className="luster-salon-confirmation-actions">
                              <button type="button" disabled={busyId === salon.id} onClick={() => void changeVisibility(salon, true)} className="luster-entry-button">{busyId === salon.id ? 'Removing…' : 'Remove from my list'}</button>
                              <button type="button" disabled={busyId === salon.id} onClick={() => setConfirmId(null)} className="luster-entry-button">Cancel</button>
                            </div>
                          </div>
                        )
                      : (
                          <button type="button" onClick={() => setConfirmId(salon.id)} className="luster-entry-text-action">
                            <Trash2 aria-hidden="true" />
                            <span>Remove from my list</span>
                          </button>
                        )}
                  </div>
                )}
              </section>
            );
          })}
        </div>
        {hiddenSalons.length > 0 && (
          <details className="luster-entry-card luster-salon-removed">
            <summary>
              <span>{`Removed salons (${hiddenSalons.length})`}</span>
              <ChevronDown aria-hidden="true" />
            </summary>
            <p>These salons still exist. Restore one to put it back in your list.</p>
            <div>
              {hiddenSalons.map(salon => (
                <div key={salon.id} className="luster-salon-restore">
                  <span>{salon.name}</span>
                  <button type="button" disabled={busyId === salon.id} onClick={() => void changeVisibility(salon, false)} className="luster-entry-button">{busyId === salon.id ? 'Restoring…' : 'Restore'}</button>
                </div>
              ))}
            </div>
          </details>
        )}
        {footerAction && <footer className="luster-entry-logout">{footerAction}</footer>}
      </main>
    </LusterEntryShell>
  );
}
