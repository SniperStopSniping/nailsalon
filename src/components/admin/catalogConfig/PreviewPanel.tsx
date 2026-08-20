'use client';

/**
 * Luster L1 PR6 — owner catalog configuration: "preview and test this
 * service" (G).
 *
 * Every number shown here (price, duration, line totals) is exactly what
 * `POST /api/salon/catalog-preview` returned — the SAME resolver booking
 * itself uses. Nothing in this file adds, multiplies, or otherwise
 * recomputes a price or duration; it only formats and labels the response.
 */

import { Loader2 } from 'lucide-react';
import { useRef, useState } from 'react';

import { Button } from '@/components/ui/button';
import type { AddOnResponse, CatalogPreviewResponse, ServiceResponse } from '@/types/admin';

import {
  addOnName,
  describeCatalogPreviewFailureCode,
  describeCatalogViolation,
  formatCurrency,
  formatDuration,
  type TechnicianOption,
} from './shared';

type PreviewPanelProps = {
  salonSlug: string;
  services: ServiceResponse[];
  addOns: AddOnResponse[];
  technicians: TechnicianOption[];
};

export function PreviewPanel({ salonSlug, services, addOns, technicians }: PreviewPanelProps) {
  const [serviceId, setServiceId] = useState('');
  const [technicianId, setTechnicianId] = useState('');
  const [selectedAddOnIds, setSelectedAddOnIds] = useState<string[]>([]);
  const [quantities, setQuantities] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<CatalogPreviewResponse | null>(null);
  const submitInFlightRef = useRef(false);

  const compatibleAddOns = serviceId
    ? addOns.filter(addOn => addOn.compatibleServiceIds?.includes(serviceId))
    : [];

  const toggleAddOn = (addOnId: string) => {
    setSelectedAddOnIds(current => (current.includes(addOnId)
      ? current.filter(id => id !== addOnId)
      : [...current, addOnId]));
  };

  const handlePreview = async () => {
    if (submitInFlightRef.current || !serviceId) {
      return;
    }
    submitInFlightRef.current = true;
    setLoading(true);
    setError(null);
    setResult(null);
    try {
      const response = await fetch('/api/salon/catalog-preview', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          salonSlug,
          serviceId,
          technicianId: technicianId || null,
          selectedAddOns: selectedAddOnIds.map(addOnId => ({
            addOnId,
            quantity: Math.max(1, Number.parseInt(quantities[addOnId] ?? '1', 10) || 1),
          })),
        }),
      });
      const payload = await response.json().catch(() => null);
      if (!response.ok) {
        setError(payload?.error?.message ?? 'This could not be previewed. Try again.');
        return;
      }
      setResult(payload?.data ?? null);
    } catch {
      setError('We could not run this preview. Check your connection and try again.');
    } finally {
      setLoading(false);
      submitInFlightRef.current = false;
    }
  };

  return (
    <div className="space-y-4" data-testid="catalog-preview-panel">
      <div>
        <h3 className="text-[15px] font-semibold text-[#1C1C1E]">Preview &amp; test this service</h3>
        <p className="mt-0.5 text-[13px] text-[#6B7280]">
          See exactly what a client would get — the same price, duration,
          and rules used at checkout.
        </p>
      </div>

      <label className="block" htmlFor="preview-service">
        <span className="mb-1.5 block text-sm font-medium text-[#1C1C1E]">Service</span>
        <select
          id="preview-service"
          value={serviceId}
          onChange={(event) => {
            setServiceId(event.target.value);
            setSelectedAddOnIds([]);
            setResult(null);
          }}
          className="h-11 w-full rounded-xl border border-gray-200 px-3 text-sm outline-none transition focus:border-rose-700"
        >
          <option value="">Select a service…</option>
          {services.map(service => (
            <option key={service.id} value={service.id}>{service.name}</option>
          ))}
        </select>
      </label>

      <label className="block" htmlFor="preview-technician">
        <span className="mb-1.5 block text-sm font-medium text-[#1C1C1E]">Technician (optional)</span>
        <select
          id="preview-technician"
          value={technicianId}
          onChange={event => setTechnicianId(event.target.value)}
          className="h-11 w-full rounded-xl border border-gray-200 px-3 text-sm outline-none transition focus:border-rose-700"
        >
          <option value="">Any technician</option>
          {technicians.map(technician => (
            <option key={technician.id} value={technician.id}>{technician.name}</option>
          ))}
        </select>
      </label>

      {serviceId && (
        <div>
          <span className="mb-1.5 block text-sm font-medium text-[#1C1C1E]">Add-ons</span>
          {compatibleAddOns.length === 0
            ? <p className="text-xs text-[#8E8E93]">No add-ons are offered with this service.</p>
            : (
                <div className="space-y-1 rounded-xl border border-gray-200 p-2">
                  {compatibleAddOns.map(addOn => (
                    <div key={addOn.id} className="flex items-center justify-between gap-2 rounded-lg px-2 py-1.5">
                      <label className="flex min-w-0 flex-1 items-center gap-2 text-[13px] text-[#1C1C1E]">
                        <input
                          type="checkbox"
                          className="size-4 shrink-0"
                          checked={selectedAddOnIds.includes(addOn.id)}
                          onChange={() => toggleAddOn(addOn.id)}
                        />
                        <span className="truncate">{addOn.name}</span>
                      </label>
                      {addOn.pricingType === 'per_unit' && selectedAddOnIds.includes(addOn.id) && (
                        <input
                          type="number"
                          min="1"
                          aria-label={`Quantity for ${addOn.name}`}
                          value={quantities[addOn.id] ?? '1'}
                          onChange={event => setQuantities(current => ({ ...current, [addOn.id]: event.target.value }))}
                          className="h-8 w-16 rounded-lg border border-gray-200 px-2 text-xs"
                        />
                      )}
                    </div>
                  ))}
                </div>
              )}
        </div>
      )}

      {error && (
        <div role="alert" className="rounded-2xl border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-600">
          {error}
        </div>
      )}

      <Button
        type="button"
        variant="brand"
        size="pillSm"
        onClick={() => void handlePreview()}
        disabled={loading || !serviceId}
        data-testid="catalog-preview-run"
      >
        {loading
          ? (
              <>
                <Loader2 className="mr-2 size-4 animate-spin" />
                Previewing…
              </>
            )
          : 'Preview this selection'}
      </Button>

      <div aria-live="polite" className="sr-only">
        {loading ? 'Running preview' : result ? 'Preview ready' : ''}
      </div>

      {result && (
        <div className="rounded-[18px] border border-gray-100 bg-white p-4" data-testid="catalog-preview-result">
          {result.ok
            ? (
                <div className="space-y-3">
                  <div
                    className={`rounded-xl px-3 py-2 text-sm font-medium ${result.blocksContinue ? 'bg-amber-50 text-amber-800' : 'bg-emerald-50 text-emerald-700'}`}
                    data-testid="catalog-preview-status"
                  >
                    {result.blocksContinue ? 'This selection could not be booked as-is.' : 'This selection is bookable.'}
                  </div>
                  <div className="grid grid-cols-2 gap-3 text-sm">
                    <div>
                      <p className="text-xs uppercase text-[#8E8E93]">Base price</p>
                      <p className="font-semibold text-[#1C1C1E]">{formatCurrency(result.basePriceCents)}</p>
                    </div>
                    <div>
                      <p className="text-xs uppercase text-[#8E8E93]">Base duration</p>
                      <p className="font-semibold text-[#1C1C1E]">{formatDuration(result.baseDurationMinutes)}</p>
                    </div>
                    <div>
                      <p className="text-xs uppercase text-[#8E8E93]">Total price</p>
                      <p className="font-semibold text-[#1C1C1E]">{formatCurrency(result.subtotalCents)}</p>
                    </div>
                    <div>
                      <p className="text-xs uppercase text-[#8E8E93]">Total duration</p>
                      <p className="font-semibold text-[#1C1C1E]">{formatDuration(result.totalDurationMinutes)}</p>
                    </div>
                  </div>
                  {result.addOns.length > 0 && (
                    <div>
                      <p className="mb-1 text-xs font-semibold uppercase text-[#8E8E93]">What&apos;s included</p>
                      <ul className="space-y-1 text-sm text-[#1C1C1E]">
                        {result.addOns.map(line => (
                          <li key={line.addOnId} className="flex items-center justify-between">
                            <span>
                              {addOnName(addOns, line.addOnId)}
                              {line.quantity > 1 && ` × ${line.quantity}`}
                              {line.autoAdded && <span className="ml-1.5 rounded-full bg-gray-100 px-1.5 py-0.5 text-[10px] text-[#6B7280]">Auto-added</span>}
                            </span>
                            <span>{formatCurrency(line.lineTotalCents)}</span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                  {result.violations.length > 0 && (
                    <div>
                      <p className="mb-1 text-xs font-semibold uppercase text-amber-700">Blocked or limited</p>
                      <ul className="space-y-1 text-sm text-amber-800">
                        {result.violations.map((violation, index) => (
                          // eslint-disable-next-line react/no-array-index-key
                          <li key={index}>{describeCatalogViolation(violation, { services, addOns })}</li>
                        ))}
                      </ul>
                    </div>
                  )}
                </div>
              )
            : (
                <div role="alert" className="rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-600">
                  {describeCatalogPreviewFailureCode(result.code)}
                </div>
              )}
        </div>
      )}
    </div>
  );
}
