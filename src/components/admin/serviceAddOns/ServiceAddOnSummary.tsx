'use client';

/**
 * "Add-ons for this service" — the entry point that makes the relationship
 * visible from the service side.
 *
 * Deliberately NOT inside an advanced/catalog disclosure: choosing which
 * extras a client can add to an appointment is everyday menu work for a nail
 * tech, not configuration.
 */

import { Plus, Sparkles } from 'lucide-react';

import { Button } from '@/components/ui/button';

export function ServiceAddOnSummary({
  assignedNames,
  optional = false,
  busy = false,
  disabled = false,
  error,
  onManage,
  testId = 'service-addons-summary',
}: {
  /** Names of the add-ons currently offered with this service. */
  assignedNames: string[];
  /** Creation flow: labels the section as skippable and softens the copy. */
  optional?: boolean;
  busy?: boolean;
  disabled?: boolean;
  error?: string | null;
  onManage: () => void;
  testId?: string;
}) {
  const hasAny = assignedNames.length > 0;

  return (
    <section
      data-testid={testId}
      className="rounded-[18px] border border-[var(--owner-line)] bg-[var(--owner-surface)] p-4"
    >
      <div className="flex items-center gap-2">
        <Sparkles aria-hidden="true" className="size-4 shrink-0 text-[var(--owner-accent)]" />
        <h3 className="text-[14px] font-semibold text-[var(--owner-ink)]">
          {optional ? 'Add-ons' : 'Add-ons for this service'}
        </h3>
        {optional && (
          <span className="rounded-full bg-[var(--owner-ground)] px-2 py-0.5 text-[11px] font-medium text-[var(--owner-muted)]">
            Optional
          </span>
        )}
      </div>

      {hasAny
        ? (
            <p
              data-testid={`${testId}-names`}
              className="mt-2 text-[14px] leading-5 text-[var(--owner-ink)]"
            >
              {assignedNames.join(' · ')}
            </p>
          )
        : (
            <p
              data-testid={`${testId}-empty`}
              className="mt-2 text-[13px] leading-5 text-[var(--owner-muted)]"
            >
              {optional
                ? 'Choose extras clients can book with this service.'
                : 'Let clients choose extras with this appointment.'}
            </p>
          )}

      {error && (
        <p
          role="alert"
          data-testid={`${testId}-error`}
          className="mt-2 rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-[13px] leading-5 text-red-700"
        >
          {error}
        </p>
      )}

      <Button
        type="button"
        variant={hasAny ? 'ownerSecondary' : 'ownerPrimary'}
        size="pillSm"
        className="mt-3"
        data-testid={`${testId}-manage`}
        disabled={disabled || busy}
        onClick={onManage}
      >
        {!hasAny && <Plus aria-hidden="true" className="mr-1.5 size-4" />}
        {hasAny ? 'Manage add-ons' : 'Choose add-ons'}
      </Button>
    </section>
  );
}
