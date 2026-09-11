'use client';

/**
 * "Add-ons for <service>" — the SERVICE side of the one service<->add-on
 * relationship.
 *
 * The owner-side story used to run in one direction only: you opened an
 * add-on and ticked the services it was offered with. A nail tech building
 * "Gel Manicure" had no way to say "clients can add chrome to this" without
 * leaving the service, guessing which add-ons existed, and editing each one.
 *
 * This picker is the same relationship read the other way round. It never
 * creates add-on records and never edits an add-on's own price, duration,
 * category or its bindings to OTHER services — it only chooses which of the
 * salon's existing add-ons this one service offers.
 */

import { Check, Loader2, Plus, Search } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';

import { Button } from '@/components/ui/button';
import { DialogShell } from '@/components/ui/dialog-shell';

export type PickerAddOn = {
  id: string;
  name: string;
  priceCents: number;
  priceDisplayText?: string | null;
  durationMinutes: number;
  category: string;
  isActive: boolean;
};

function formatExtraPrice(addOn: PickerAddOn): string {
  if (addOn.priceDisplayText) {
    return addOn.priceDisplayText;
  }
  const amount = (addOn.priceCents / 100).toLocaleString('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: addOn.priceCents % 100 === 0 ? 0 : 2,
  });
  return `+${amount}`;
}

function formatExtraDuration(minutes: number): string {
  if (minutes <= 0) {
    return 'no extra time';
  }
  if (minutes < 60) {
    return `+${minutes} min`;
  }
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest ? `+${hours}h ${rest}m` : `+${hours}h`;
}

export function ServiceAddOnPicker({
  isOpen,
  serviceName,
  addOns,
  addOnsLoading,
  addOnsError,
  initialSelectedIds,
  saving,
  error,
  onCreateNew,
  onCancel,
  onSave,
}: {
  isOpen: boolean;
  serviceName: string;
  addOns: PickerAddOn[];
  addOnsLoading: boolean;
  addOnsError: string | null;
  /** The service's currently-offered add-ons. Read once per open. */
  initialSelectedIds: string[];
  saving: boolean;
  error: string | null;
  onCreateNew: () => void;
  onCancel: () => void;
  onSave: (addOnIds: string[]) => void;
}) {
  const [selected, setSelected] = useState<string[]>([]);
  const [query, setQuery] = useState('');
  const openedRef = useRef(false);

  // Snapshot on open. Backing out has to leave the stored relationship exactly
  // as it was, so nothing here writes until the owner presses Save.
  useEffect(() => {
    if (isOpen && !openedRef.current) {
      openedRef.current = true;
      setSelected(initialSelectedIds);
      setQuery('');
    }
    if (!isOpen) {
      openedRef.current = false;
    }
  }, [isOpen, initialSelectedIds]);

  const visible = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) {
      return addOns;
    }
    return addOns.filter(addOn => addOn.name.toLowerCase().includes(needle));
  }, [addOns, query]);

  const selectedSet = useMemo(() => new Set(selected), [selected]);

  if (!isOpen) {
    return null;
  }

  const toggle = (id: string) => {
    setSelected(current => (current.includes(id)
      ? current.filter(existing => existing !== id)
      : [...current, id]));
  };

  return (
    <DialogShell
      isOpen
      onClose={() => {
        if (!saving) {
          onCancel();
        }
      }}
      maxWidthClassName="max-w-md"
      contentClassName="flex max-h-[92dvh] flex-col overflow-hidden rounded-3xl bg-[var(--owner-surface)] shadow-2xl"
      alignClassName="items-end justify-center p-3 sm:items-center"
      contentTestId="service-addon-picker"
    >
      <div className="shrink-0 border-b border-[var(--owner-line)] px-5 pb-3 pt-5">
        <h2 className="text-[19px] font-semibold text-[var(--owner-ink)]">
          Add-ons for
          {' '}
          {serviceName}
        </h2>
        <p className="mt-1 text-[13px] leading-5 text-[var(--owner-muted)]">
          Clients can choose these extras after selecting
          {' '}
          {serviceName}
          .
        </p>
        {addOns.length > 6 && (
          <div className="relative mt-3">
            <Search
              aria-hidden="true"
              className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-[var(--owner-muted)]"
            />
            <label htmlFor="service-addon-picker-search" className="sr-only">
              Search add-ons
            </label>
            <input
              id="service-addon-picker-search"
              type="search"
              value={query}
              onChange={event => setQuery(event.target.value)}
              placeholder="Search add-ons…"
              data-testid="service-addon-picker-search"
              className="h-11 w-full rounded-full border border-[var(--owner-line)] bg-[var(--owner-surface)] pl-9 pr-3 text-[15px] text-[var(--owner-ink)] outline-none transition placeholder:text-[var(--owner-muted)] focus:border-[var(--owner-accent)]"
            />
          </div>
        )}
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-5 py-3">
        {addOnsLoading
          ? (
              <p
                role="status"
                className="py-6 text-center text-[14px] text-[var(--owner-muted)]"
              >
                Loading add-ons…
              </p>
            )
          : addOnsError
            ? (
                <p
                  role="alert"
                  data-testid="service-addon-picker-load-error"
                  className="rounded-2xl border border-red-200 bg-red-50 px-3 py-2 text-[13px] text-red-700"
                >
                  {addOnsError}
                </p>
              )
            : addOns.length === 0
              ? (
                  <div
                    data-testid="service-addon-picker-empty"
                    className="rounded-2xl border border-[var(--owner-line)] bg-[var(--owner-ground)] p-4 text-[14px] leading-relaxed text-[var(--owner-muted)]"
                  >
                    You have no add-ons yet. Create one and it will be offered
                    with
                    {' '}
                    {serviceName}
                    {' '}
                    straight away.
                  </div>
                )
              : visible.length === 0
                ? (
                    <p className="py-6 text-center text-[14px] text-[var(--owner-muted)]">
                      No add-ons match “
                      {query.trim()}
                      ”.
                    </p>
                  )
                : (
                    <ul className="space-y-2">
                      {visible.map((addOn) => {
                        const checked = selectedSet.has(addOn.id);
                        return (
                          <li key={addOn.id}>
                            <button
                              type="button"
                              role="checkbox"
                              aria-checked={checked}
                              data-testid={`service-addon-option-${addOn.id}`}
                              onClick={() => toggle(addOn.id)}
                              className={`flex min-h-[56px] w-full items-center gap-3 rounded-2xl border px-3 py-2.5 text-left outline-none transition-colors focus-visible:ring-2 focus-visible:ring-[var(--owner-focus)] ${
                                checked
                                  ? 'border-[var(--owner-accent)] bg-[var(--owner-blush)]'
                                  : 'border-[var(--owner-line)] bg-[var(--owner-surface)] active:bg-[var(--owner-ground)]'
                              }`}
                            >
                              <span
                                aria-hidden="true"
                                className={`flex size-6 shrink-0 items-center justify-center rounded-full border transition-colors ${
                                  checked
                                    ? 'border-[var(--owner-accent)] bg-[var(--owner-accent)] text-white'
                                    : 'border-[var(--owner-line-strong)] bg-[var(--owner-surface)]'
                                }`}
                              >
                                {checked && <Check className="size-4" strokeWidth={3} />}
                              </span>
                              <span className="min-w-0 flex-1">
                                <span className="block text-[15px] font-semibold leading-5 text-[var(--owner-ink)]">
                                  {addOn.name}
                                  {!addOn.isActive && (
                                    <span className="ml-1.5 align-middle text-[11px] font-medium text-[var(--owner-muted)]">
                                      (inactive)
                                    </span>
                                  )}
                                </span>
                                <span className="mt-0.5 block text-[12px] leading-4 text-[var(--owner-muted)]">
                                  {formatExtraPrice(addOn)}
                                  {' · '}
                                  {formatExtraDuration(addOn.durationMinutes)}
                                </span>
                              </span>
                            </button>
                          </li>
                        );
                      })}
                    </ul>
                  )}

        <button
          type="button"
          data-testid="service-addon-picker-create"
          onClick={onCreateNew}
          className="mt-3 flex min-h-11 w-full items-center justify-center gap-2 rounded-2xl border border-dashed border-[var(--owner-line-strong)] px-3 py-2.5 text-[14px] font-semibold text-[var(--owner-accent)] outline-none transition-colors focus-visible:ring-2 focus-visible:ring-[var(--owner-focus)] active:bg-[var(--owner-ground)]"
        >
          <Plus aria-hidden="true" className="size-4" />
          Create new add-on
        </button>
      </div>

      <div className="shrink-0 border-t border-[var(--owner-line)] px-5 pb-5 pt-3">
        {error && (
          <p
            role="alert"
            data-testid="service-addon-picker-error"
            className="mb-2 rounded-2xl border border-red-200 bg-red-50 px-3 py-2 text-[13px] text-red-700"
          >
            {error}
          </p>
        )}
        <div className="flex items-center justify-between gap-3">
          <span
            data-testid="service-addon-picker-count"
            className="text-[13px] text-[var(--owner-muted)]"
          >
            {selected.length === 0
              ? 'No extras selected'
              : `${selected.length} selected`}
          </span>
          <div className="flex shrink-0 gap-2">
            <Button
              type="button"
              variant="ownerSecondary"
              size="pillSm"
              data-testid="service-addon-picker-cancel"
              disabled={saving}
              onClick={onCancel}
            >
              Cancel
            </Button>
            <Button
              type="button"
              variant="ownerPrimary"
              size="pillSm"
              data-testid="service-addon-picker-save"
              disabled={saving}
              onClick={() => onSave(selected)}
            >
              {saving && <Loader2 aria-hidden="true" className="mr-2 size-4 animate-spin" />}
              {saving ? 'Saving…' : 'Done'}
            </Button>
          </div>
        </div>
      </div>
    </DialogShell>
  );
}
