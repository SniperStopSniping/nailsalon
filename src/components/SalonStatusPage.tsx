import type { LucideIcon } from 'lucide-react';
import Link from 'next/link';

import type { PublicSalonStatusIdentity } from '@/libs/salonContent';

/**
 * SalonStatusPage
 *
 * Shared full-page notice used by the "feature unavailable" and salon-status
 * pages (booking disabled, rewards disabled, suspended, cancelled, not found).
 * Keeps these edge states on-brand: warm cream background, white card,
 * purple heading, gold primary action.
 */

export type SalonStatusAction = {
  label: string;
  href: string;
  primary?: boolean;
};

type SalonStatusPageProps = {
  icon: LucideIcon;
  title: string;
  description: string;
  actions?: SalonStatusAction[];
  footer?: string;
  /**
   * S6b (Stage 1) — optional, and deliberately NOT a salon row.
   *
   * Only `resolvePublicSalonStatusIdentity`'s narrow projection may be passed:
   * salon name plus a city/state label, never a street address, postal code,
   * phone or email. Omitted entirely on `/not-found`, which is shared by
   * "does not exist" and "unpublished" and must stay generic.
   */
  salonIdentity?: PublicSalonStatusIdentity | null;
};

const NO_ACTIONS: SalonStatusAction[] = [];

export function SalonStatusPage({
  icon: Icon,
  title,
  description,
  actions = NO_ACTIONS,
  footer,
  salonIdentity = null,
}: SalonStatusPageProps) {
  return (
    <div className="flex min-h-screen items-center justify-center bg-[#faf3ea] p-4">
      <div className="w-full max-w-md rounded-2xl border border-[#e6d6c2] bg-white px-5 py-8 text-center shadow-[0_4px_20px_rgba(0,0,0,0.08)]">
        <div className="mx-auto mb-6 flex size-16 items-center justify-center rounded-full bg-[#f5e6d3]">
          <Icon className="size-8 text-[#d6a249]" />
        </div>

        {salonIdentity && (
          <div className="mb-3">
            <p className="text-base font-semibold text-neutral-800">
              {salonIdentity.name}
            </p>
            {salonIdentity.locationLabel && (
              <p className="text-xs text-neutral-500">
                {salonIdentity.locationLabel}
              </p>
            )}
          </div>
        )}

        <h1 className="mb-2 text-2xl font-semibold text-[#7b4ea3]">
          {title}
        </h1>

        <p className="mb-6 text-neutral-600">
          {description}
        </p>

        {actions.length > 0 && (
          <div className="space-y-3">
            {actions.map(action => (
              <Link
                key={action.href + action.label}
                href={action.href}
                className={action.primary
                  ? 'block w-full rounded-full bg-[#d6a249] px-4 py-3 font-bold text-white shadow-sm transition-colors hover:bg-[#c4923e]'
                  : 'block w-full rounded-full border border-[#e6d6c2] bg-white px-4 py-3 font-semibold text-neutral-700 transition-colors hover:bg-[#faf3ea]'}
              >
                {action.label}
              </Link>
            ))}
          </div>
        )}

        {footer && (
          <p className="mt-6 text-xs text-neutral-400">
            {footer}
          </p>
        )}
      </div>
    </div>
  );
}
