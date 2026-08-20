'use client';

/**
 * Luster L1 PR6 — owner catalog configuration: booking confirmation control
 * per service (D).
 *
 * `consultation` is ALWAYS rendered disabled ("Coming later") and this file
 * has no code path that can ever include it in a request body — the option
 * is not merely disabled visually, it is absent from every value this
 * component can set `selected` to.
 *
 * A service whose stored `confirmationMode` is NULL starts selected on
 * "Default (today's behaviour)". The Save control stays disabled until the
 * owner actually changes the selection, so simply opening this panel can
 * never convert a NULL row into an explicit 'instant' — the request is only
 * ever sent for a service the owner deliberately touched.
 */

import { Loader2 } from 'lucide-react';
import { useRef, useState } from 'react';

import { Button } from '@/components/ui/button';
import type { ServiceResponse } from '@/types/admin';

type BookingConfirmationPanelProps = {
  salonSlug: string;
  services: ServiceResponse[];
  onRefresh: () => void;
};

type StoredMode = 'instant' | 'request_approval' | 'consultation' | null;
type SelectableMode = 'default' | 'instant' | 'request_approval';

function toSelectable(stored: StoredMode): SelectableMode | 'consultation' {
  if (stored === 'instant' || stored === 'request_approval' || stored === 'consultation') {
    return stored;
  }
  return 'default';
}

function toStoredValue(selection: SelectableMode): StoredMode {
  return selection === 'default' ? null : selection;
}

function ServiceConfirmationRow({
  salonSlug,
  service,
  onSaved,
}: {
  salonSlug: string;
  service: ServiceResponse;
  onSaved: (updated: ServiceResponse) => void;
}) {
  const stored = (service.confirmationMode ?? null) as StoredMode;
  const initial = toSelectable(stored);
  const [selection, setSelection] = useState<SelectableMode>(initial === 'consultation' ? 'default' : initial);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const submitInFlightRef = useRef(false);

  const dirty = selection !== (initial === 'consultation' ? 'default' : initial);

  const handleSave = async () => {
    if (submitInFlightRef.current || !dirty) {
      return;
    }
    if (!service.category) {
      setError('This service is missing basic details. Edit it in My Menu first.');
      return;
    }
    submitInFlightRef.current = true;
    setSaving(true);
    setError(null);
    try {
      const body: Record<string, unknown> = {
        salonSlug,
        name: service.name,
        description: service.description ?? null,
        descriptionItems: service.descriptionItems ?? [],
        price: service.price,
        priceDisplayText: service.priceDisplayText ?? null,
        durationMinutes: service.durationMinutes,
        preparationBufferMinutes: service.preparationBufferMinutes ?? 0,
        cleanupBufferMinutes: service.cleanupBufferMinutes ?? 0,
        category: service.category,
        featuredOrder: service.featuredOrder ?? null,
        isIntroPrice: service.isIntroPrice ?? false,
        introPriceLabel: service.introPriceLabel ?? null,
        isActive: service.isActive ?? true,
        // NEVER 'consultation' — `selection` is typed to exclude it entirely.
        confirmationMode: toStoredValue(selection),
      };
      if (service.bookingCategory) {
        body.bookingCategory = service.bookingCategory;
      }

      const response = await fetch(`/api/salon/services/${encodeURIComponent(service.id)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const payload = await response.json().catch(() => null);
      if (!response.ok) {
        setError(payload?.error?.message ?? 'This could not be saved. Try again.');
        return;
      }
      const updated = payload?.data?.service as ServiceResponse | undefined;
      if (updated) {
        onSaved(updated);
      }
    } catch {
      setError('We could not save this change. Check your connection and try again.');
    } finally {
      setSaving(false);
      submitInFlightRef.current = false;
    }
  };

  const groupName = `confirmation-mode-${service.id}`;

  return (
    <div
      data-testid={`confirmation-row-${service.id}`}
      className="space-y-2 border-b border-gray-100 px-4 py-3 last:border-b-0"
    >
      <span className="block truncate text-[14px] font-semibold text-[#1C1C1E]">{service.name}</span>
      <fieldset disabled={saving}>
        <legend className="sr-only">
          Booking confirmation for
          {' '}
          {service.name}
        </legend>
        <div role="group" className="grid grid-cols-1 gap-1.5 sm:grid-cols-3">
          <label className="flex items-center gap-2 rounded-lg border border-gray-200 px-2.5 py-2 text-[13px] has-[:checked]:border-rose-700 has-[:checked]:bg-rose-50">
            <input
              type="radio"
              name={groupName}
              checked={selection === 'default'}
              onChange={() => setSelection('default')}
            />
            Default (today's behavior)
          </label>
          <label className="flex items-center gap-2 rounded-lg border border-gray-200 px-2.5 py-2 text-[13px] has-[:checked]:border-rose-700 has-[:checked]:bg-rose-50">
            <input
              type="radio"
              name={groupName}
              checked={selection === 'instant'}
              onChange={() => setSelection('instant')}
            />
            Book instantly
          </label>
          <label className="flex items-center gap-2 rounded-lg border border-gray-200 px-2.5 py-2 text-[13px] has-[:checked]:border-rose-700 has-[:checked]:bg-rose-50">
            <input
              type="radio"
              name={groupName}
              checked={selection === 'request_approval'}
              onChange={() => setSelection('request_approval')}
            />
            Request approval
          </label>
        </div>
        <label
          className="mt-1.5 flex items-center gap-2 rounded-lg border border-gray-100 bg-gray-50 px-2.5 py-2 text-[13px] text-[#8E8E93]"
          title="Coming in a future update"
        >
          <input type="radio" name={groupName} disabled checked={stored === 'consultation'} readOnly />
          Consultation (coming later)
        </label>
      </fieldset>
      {error && (
        <div role="alert" className="rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-600">
          {error}
        </div>
      )}
      <div className="flex justify-end">
        <Button
          type="button"
          variant="brand"
          size="pillSm"
          onClick={() => void handleSave()}
          disabled={saving || !dirty}
          data-testid={`confirmation-save-${service.id}`}
        >
          {saving
            ? (
                <>
                  <Loader2 className="mr-2 size-4 animate-spin" />
                  Saving…
                </>
              )
            : 'Save'}
        </Button>
      </div>
    </div>
  );
}

export function BookingConfirmationPanel({ salonSlug, services, onRefresh }: BookingConfirmationPanelProps) {
  return (
    <div className="space-y-3" data-testid="catalog-confirmation-panel">
      <div>
        <h3 className="text-[15px] font-semibold text-[#1C1C1E]">Booking confirmation</h3>
        <p className="mt-0.5 text-[13px] text-[#6B7280]">
          Choose whether a service books instantly or needs your approval
          first. Services left on "Default" keep today's always-instant
          behavior.
        </p>
      </div>
      {services.length === 0
        ? (
            <div className="rounded-[18px] border border-gray-200 bg-white p-4 text-[14px] text-[#8E8E93]">
              No services yet.
            </div>
          )
        : (
            <div className="overflow-hidden rounded-[18px] border border-gray-100 bg-white">
              {services.map(service => (
                <ServiceConfirmationRow
                  key={service.id}
                  salonSlug={salonSlug}
                  service={service}
                  onSaved={() => onRefresh()}
                />
              ))}
            </div>
          )}
    </div>
  );
}
