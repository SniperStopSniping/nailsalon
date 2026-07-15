'use client';

import { useEffect, useMemo, useState } from 'react';

import type { AppointmentData } from './StaffAppointmentCard';

// Cappuccino tokens (match ActionBar)
const c = {
  title: '#6F4E37',
  cardBg: '#FAF8F5',
  cardBorder: '#E6DED6',
  primary: '#4B2E1E',
  secondary: '#EADBC8',
  secondaryText: '#4B2E1E',
  accent: '#059669',
};

type CatalogItem = { id: string; name: string; category: string; priceCents: number; durationMinutes: number };
type PaymentMethod = 'cash' | 'debit' | 'credit' | 'e_transfer' | 'other';

const PAYMENT_METHODS: Array<{ value: PaymentMethod; label: string }> = [
  { value: 'cash', label: 'Cash' },
  { value: 'debit', label: 'Debit' },
  { value: 'credit', label: 'Credit' },
  { value: 'e_transfer', label: 'E-transfer' },
  { value: 'other', label: 'Other' },
];

export type CompleteResult = { showReviewPrompt: boolean };

type Props = {
  appointment: AppointmentData;
  onCancel: () => void;
  onCompleted: (result: CompleteResult) => void;
};

export function CompleteAppointmentSheet({ appointment, onCancel, onCompleted }: Props) {
  const [services, setServices] = useState<CatalogItem[]>([]);
  const [addOns, setAddOns] = useState<CatalogItem[]>([]);
  const [catalogLoaded, setCatalogLoaded] = useState(false);

  const [mainServiceId, setMainServiceId] = useState<string>('');
  const [selectedAddOnIds, setSelectedAddOnIds] = useState<Set<string>>(new Set());
  const [finalPrice, setFinalPrice] = useState<string>((appointment.totalPrice / 100).toFixed(0));
  const [tip, setTip] = useState<string>('');
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod | null>(null);
  const [techNotes, setTechNotes] = useState<string>('');

  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Load the salon's active catalog; preselect the booked service when it matches.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch('/api/staff/service-catalog');
        if (res.ok) {
          const json = await res.json();
          if (!cancelled) {
            const svc: CatalogItem[] = json.data?.services ?? [];
            const ao: CatalogItem[] = json.data?.addOns ?? [];
            setServices(svc);
            setAddOns(ao);
            const bookedName = appointment.services[0]?.name?.toLowerCase();
            const match = svc.find(s => s.name.toLowerCase() === bookedName);
            setMainServiceId(match?.id ?? svc[0]?.id ?? '');
          }
        }
      } catch {
        // leave catalog empty; UI shows a fallback
      } finally {
        if (!cancelled) {
          setCatalogLoaded(true);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [appointment.services]);

  const toggleAddOn = (id: string) => {
    setSelectedAddOnIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  const finalPriceCents = useMemo(() => {
    const n = Number.parseFloat(finalPrice);
    return Number.isFinite(n) ? Math.round(n * 100) : null;
  }, [finalPrice]);

  const tipCents = useMemo(() => {
    if (tip.trim() === '') {
      return 0;
    }
    const n = Number.parseFloat(tip);
    return Number.isFinite(n) ? Math.round(n * 100) : 0;
  }, [tip]);

  const canSubmit = Boolean(mainServiceId) && finalPriceCents !== null && finalPriceCents >= 0 && !!paymentMethod && !submitting;

  const handleSubmit = async () => {
    if (!canSubmit || finalPriceCents === null) {
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch(`/api/appointments/${appointment.id}/complete`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          performedServiceIds: [mainServiceId],
          performedAddOnIds: Array.from(selectedAddOnIds),
          finalPriceCents,
          tipCents,
          paymentMethod,
          techNotes: techNotes.trim() || undefined,
          skipPhotoValidation: true,
        }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(json?.error?.message || 'Could not complete the appointment. Please try again.');
        return;
      }
      onCompleted({ showReviewPrompt: Boolean(json?.data?.showReviewPrompt) });
    } catch {
      setError('Something went wrong. Please try again.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div
      role="button"
      tabIndex={0}
      className="fixed inset-0 z-[60] flex items-end justify-center bg-black/50 sm:items-center"
      onClick={(e) => {
        if (e.target === e.currentTarget && !submitting) {
          onCancel();
        }
      }}
      onKeyDown={(e) => {
        if (e.key === 'Escape' && !submitting) {
          onCancel();
        }
      }}
    >
      <div
        className="max-h-[92vh] w-full max-w-md overflow-y-auto rounded-t-2xl shadow-2xl sm:rounded-2xl"
        style={{ backgroundColor: c.cardBg }}
      >
        <div className="p-6">
          <div className="mb-1 flex items-center justify-between">
            <h2 className="text-xl font-semibold" style={{ color: c.title }}>Complete Appointment</h2>
            <button type="button" onClick={onCancel} disabled={submitting} className="text-2xl text-neutral-400 hover:text-neutral-600 disabled:opacity-50">×</button>
          </div>
          <p className="mb-4 text-sm text-neutral-500">
            {appointment.clientName || 'Client'}
            {' · '}
            Record what was actually done.
          </p>

          {error && (
            <div className="mb-4 rounded-xl bg-red-50 p-3 text-sm text-red-700">{error}</div>
          )}

          {/* Main service */}
          <label htmlFor="ca-service" className="mb-1 block text-sm font-semibold" style={{ color: c.title }}>Main service</label>
          <select
            id="ca-service"
            value={mainServiceId}
            onChange={e => setMainServiceId(e.target.value)}
            disabled={!catalogLoaded || services.length === 0}
            className="mb-4 w-full rounded-xl border bg-white p-3 text-sm"
            style={{ borderColor: c.cardBorder }}
          >
            {!catalogLoaded && <option>Loading…</option>}
            {catalogLoaded && services.length === 0 && <option value="">No services found</option>}
            {services.map(s => (
              <option key={s.id} value={s.id}>{s.name}</option>
            ))}
          </select>

          {/* Add-ons */}
          {addOns.length > 0 && (
            <>
              <span className="mb-1 block text-sm font-semibold" style={{ color: c.title }}>Add-ons</span>
              <div className="mb-4 grid grid-cols-2 gap-2">
                {addOns.map(a => (
                  <button
                    key={a.id}
                    type="button"
                    onClick={() => toggleAddOn(a.id)}
                    className="flex items-center gap-2 rounded-xl border px-3 py-2.5 text-left text-sm transition-all active:scale-[0.98]"
                    style={{
                      borderColor: selectedAddOnIds.has(a.id) ? c.primary : c.cardBorder,
                      backgroundColor: selectedAddOnIds.has(a.id) ? c.secondary : 'white',
                      color: c.secondaryText,
                    }}
                  >
                    <span
                      className="flex size-4 shrink-0 items-center justify-center rounded border text-[10px] text-white"
                      style={{ borderColor: c.primary, backgroundColor: selectedAddOnIds.has(a.id) ? c.primary : 'transparent' }}
                    >
                      {selectedAddOnIds.has(a.id) ? '✓' : ''}
                    </span>
                    {a.name}
                  </button>
                ))}
              </div>
            </>
          )}

          {/* Price + tip */}
          <div className="mb-4 grid grid-cols-2 gap-3">
            <div>
              <label htmlFor="ca-price" className="mb-1 block text-sm font-semibold" style={{ color: c.title }}>Final price ($)</label>
              <input
                id="ca-price"
                inputMode="decimal"
                value={finalPrice}
                onChange={e => setFinalPrice(e.target.value.replace(/[^0-9.]/g, ''))}
                className="w-full rounded-xl border bg-white p-3 text-sm"
                style={{ borderColor: c.cardBorder }}
              />
            </div>
            <div>
              <label htmlFor="ca-tip" className="mb-1 block text-sm font-semibold" style={{ color: c.title }}>Tip ($)</label>
              <input
                id="ca-tip"
                inputMode="decimal"
                value={tip}
                placeholder="0"
                onChange={e => setTip(e.target.value.replace(/[^0-9.]/g, ''))}
                className="w-full rounded-xl border bg-white p-3 text-sm"
                style={{ borderColor: c.cardBorder }}
              />
            </div>
          </div>

          {/* Payment method */}
          <span className="mb-1 block text-sm font-semibold" style={{ color: c.title }}>Payment method</span>
          <div className="mb-4 flex flex-wrap gap-2">
            {PAYMENT_METHODS.map(pm => (
              <button
                key={pm.value}
                type="button"
                onClick={() => setPaymentMethod(pm.value)}
                className="rounded-full border px-3.5 py-2 text-sm transition-all active:scale-[0.98]"
                style={{
                  borderColor: paymentMethod === pm.value ? c.primary : c.cardBorder,
                  backgroundColor: paymentMethod === pm.value ? c.primary : 'white',
                  color: paymentMethod === pm.value ? 'white' : c.secondaryText,
                }}
              >
                {pm.label}
              </button>
            ))}
          </div>

          {/* Private notes */}
          <label htmlFor="ca-notes" className="mb-1 block text-sm font-semibold" style={{ color: c.title }}>Private notes</label>
          <p className="mb-1 text-xs text-neutral-400">Only visible to salon staff — never shown to the client.</p>
          <textarea
            id="ca-notes"
            value={techNotes}
            onChange={e => setTechNotes(e.target.value.slice(0, 2000))}
            rows={3}
            placeholder="e.g. prefers almond shape, sensitive cuticles"
            className="mb-5 w-full rounded-xl border bg-white p-3 text-sm"
            style={{ borderColor: c.cardBorder }}
          />

          <button
            type="button"
            data-testid="staff-complete-submit"
            onClick={handleSubmit}
            disabled={!canSubmit}
            className="w-full rounded-xl py-3.5 text-sm font-bold text-white transition-all hover:opacity-90 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-50"
            style={{ backgroundColor: c.accent }}
          >
            {submitting ? 'Completing…' : 'Complete Appointment'}
          </button>
          <button
            type="button"
            onClick={onCancel}
            disabled={submitting}
            className="mt-2 w-full py-2 text-sm font-medium text-neutral-500 hover:text-neutral-700 disabled:opacity-50"
          >
            Back
          </button>
        </div>
      </div>
    </div>
  );
}

export default CompleteAppointmentSheet;
