'use client';

/**
 * LockedFeatureRow
 *
 * The single owner-side presentation of "this exists, but you cannot use it
 * yet". Entitlement-gated capabilities used to disappear without explanation
 * (AG-more-settings-01, AG-w2-settings-integrations-05, AG-w2-more-tools-03):
 * a heading with nothing under it, or a tile that is simply absent. A locked
 * row keeps the capability visible, names it, and says why it is unavailable.
 *
 * Reason codes come straight from the modules API (`moduleReasons`), so the
 * copy the owner reads is derived from the same value the server computed.
 */

import { Lock } from 'lucide-react';
import type { ReactNode } from 'react';

import { cn } from '@/utils/Helpers';

import {
  describeLockedFeatureReason,
  type LockedFeatureReasonCode,
} from './lockedFeatureReason';

export type LockedFeatureRowProps = {
  /** The capability's own name, exactly as it reads when unlocked. */
  name: string;
  /**
   * Reason code from the modules API. Ignored when `reason` is given. Typed as
   * `string` so an unrecognised server code still renders the fallback copy
   * rather than failing to compile.
   */
  reasonCode?: LockedFeatureReasonCode | string | null;
  /** Explicit copy, when the caller already has a sentence to show. */
  reason?: string;
  /** Optional trailing action, e.g. a link to a plan or help page. */
  link?: { label: string; href: string };
  /** Suppresses the bottom hairline on the last row of a list. */
  isLast?: boolean;
  /** Optional leading glyph; defaults to a lock. */
  icon?: ReactNode;
  className?: string;
};

export function LockedFeatureRow({
  name,
  reasonCode,
  reason,
  link,
  isLast = false,
  icon,
  className,
}: LockedFeatureRowProps) {
  const reasonText = reason ?? describeLockedFeatureReason(reasonCode);

  return (
    <div
      data-testid={`locked-feature-${name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`}
      data-locked-reason={reasonCode ?? undefined}
      className={cn('flex min-h-[48px] items-center pl-4', className)}
    >
      <div
        aria-hidden="true"
        className="mr-3 flex size-7 items-center justify-center rounded-[6px] bg-[var(--owner-blush,#f9e9ed)] text-[var(--owner-accent,#8b3151)]"
      >
        {icon ?? <Lock className="size-3.5" />}
      </div>

      <div
        className={cn(
          'flex flex-1 items-center justify-between gap-3 py-3 pr-4',
          !isLast && 'border-b border-gray-100',
        )}
      >
        <div className="flex min-w-0 flex-col">
          <span className="truncate text-[16px] tracking-tight text-[var(--owner-muted,#74666b)]">
            {name}
          </span>
          <span className="text-[11px] text-[var(--owner-accent,#8b3151)]">
            {reasonText}
          </span>
        </div>

        {link
          ? (
              <a
                href={link.href}
                className="shrink-0 rounded-full border border-[var(--owner-line,#eadde1)] px-3 py-1 text-[12px] font-semibold text-[var(--owner-accent,#8b3151)] outline-none transition-colors hover:bg-[var(--owner-blush,#f9e9ed)] focus-visible:ring-2 focus-visible:ring-[var(--owner-focus,#b85075)]"
              >
                {link.label}
              </a>
            )
          : (
              <span className="shrink-0 rounded-full bg-[var(--owner-blush,#f9e9ed)] px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.08em] text-[var(--owner-accent,#8b3151)]">
                Locked
              </span>
            )}
      </div>
    </div>
  );
}
