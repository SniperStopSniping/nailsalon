'use client';

import { useEffect, useId, useRef, useState } from 'react';

import { computeCheckoutTotals } from '@/libs/checkoutTotals';
import { type CompletedBillChange, completedBillChangeSchema, type CompletedBillView } from '@/libs/customerPayments/completedBillContract';

type CatalogItem = { id: string; name: string; priceCents: number; durationMinutes: number };
type Props = { appointmentId: string; salonSlug?: string | null; catalog: { services: CatalogItem[]; addOns: CatalogItem[] }; disabled: boolean; onEditingChange: (editing: boolean) => void; onSaved: () => Promise<void> };
type DraftItem = CompletedBillChange['finalItems'][number] & { key: string; priceInput: string; quantityInput: string };

function parseMoney(value: string) {
  return /^\d+(?:\.\d{1,2})?$/.test(value.trim()) ? Math.round(Number(value) * 100) : Number.NaN;
}

const money = (cents: number) => new Intl.NumberFormat('en-CA', { style: 'currency', currency: 'CAD' }).format(cents / 100);

export function CompletedBillEditor(props: Props) {
  return <BillEditor key={props.appointmentId} {...props} />;
}

function BillEditor({ appointmentId, salonSlug, catalog, disabled, onEditingChange, onSaved }: Props) {
  const id = useId();
  const [open, setOpen] = useState(false);
  const [view, setView] = useState<CompletedBillView | null>(null);
  const [items, setItems] = useState<DraftItem[]>([]);
  const [discount, setDiscount] = useState('0.00');
  const [discountReason, setDiscountReason] = useState('');
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [uncertain, setUncertain] = useState(false);
  const pending = useRef<CompletedBillChange | null>(null);
  const generation = useRef(0);
  const endpoint = `/api/appointments/${encodeURIComponent(appointmentId)}/payment-workspace/bill${salonSlug ? `?salonSlug=${encodeURIComponent(salonSlug)}` : ''}`;
  const button = 'min-h-11 rounded-xl border border-neutral-300 px-3 py-2 text-sm font-medium disabled:opacity-50';
  const inputClass = 'min-h-11 min-w-0 w-full rounded-xl border border-neutral-300 bg-white px-3 py-2 text-sm';

  useEffect(() => {
    onEditingChange(open);
    return () => onEditingChange(false);
  }, [open, onEditingChange]);
  useEffect(() => () => {
    generation.current += 1;
  }, []);

  async function load() {
    const current = ++generation.current;
    setOpen(true);
    setView(null);
    setBusy(true);
    setError(null);
    try {
      const response = await fetch(endpoint, { cache: 'no-store' });
      const result = await response.json();
      if (current !== generation.current) {
        return;
      }
      if (!response.ok) {
        throw new Error('This bill cannot be adjusted yet. Check its payment status and refresh.');
      }
      const next: CompletedBillView = result.data;
      setView(next);
      setItems(next.items.map(item => ({ ...item, key: crypto.randomUUID(), priceInput: (item.unitPriceCents / 100).toFixed(2), quantityInput: String(item.quantity) })));
      setDiscount((next.discountCents / 100).toFixed(2));
      setDiscountReason(next.discountReason);
      setReason('');
      pending.current = null;
      setUncertain(false);
    } catch (error) {
      if (current === generation.current) {
        setError(error instanceof Error ? error.message : 'Could not load the bill.');
      }
    } finally {
      if (current === generation.current) {
        setBusy(false);
      }
    }
  }

  const finalItems = items.map(({ key: _key, priceInput, quantityInput, ...item }) => ({ ...item, unitPriceCents: parseMoney(priceInput), quantity: /^\d+$/.test(quantityInput) ? Number(quantityInput) : Number.NaN }));
  let totals: ReturnType<typeof computeCheckoutTotals> | null = null;
  if (view) {
    try {
      totals = computeCheckoutTotals({ items: finalItems.map(item => ({ lineTotalCents: item.unitPriceCents * item.quantity, taxable: item.taxable ?? false })), discountCents: parseMoney(discount), taxConfig: view.taxConfig, taxExempt: view.taxExempt, tipCents: view.tipCents });
    } catch { /* Invalid input remains editable; it cannot be submitted. */ }
  }
  const proposed = view && totals ? completedBillChangeSchema.safeParse({ requestId: '00000000-0000-4000-8000-000000000000', initializationId: '00000000-0000-4000-8000-000000000001', expectedRevision: view.revision, expectedInvoiceHash: view.invoiceHash, expectedTotalDueCents: totals.totalDueCents, finalItems, discountCents: parseMoney(discount), discountReason, reason }) : null;
  const overpaid = view && totals ? Math.max(0, view.paidCents - totals.totalDueCents) : 0;
  const needsReview = !!view && !!totals && (parseMoney(discount) > totals.finalSubtotalCents || view.depositCreditCents > totals.finalPriceCents + totals.taxAmountCents || overpaid > view.refundableOnlinePrincipalCents);
  const editable = !busy && !uncertain && !!view?.canEdit;

  async function save() {
    if (busy || (!pending.current && (!proposed?.success || needsReview || !view?.canEdit))) {
      return;
    }
    if (!pending.current && proposed?.success) {
      pending.current = { ...proposed.data, requestId: crypto.randomUUID(), initializationId: crypto.randomUUID() };
    }
    const current = ++generation.current;
    setBusy(true);
    setError(null);
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 30000);
    try {
      const response = await fetch(endpoint, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(pending.current), signal: controller.signal });
      if (current !== generation.current) {
        return;
      }
      if (!response.ok) {
        if (response.status < 500) {
          pending.current = null;
          setUncertain(false);
          setView(current => current ? { ...current, canEdit: false } : null);
          throw new Error('The bill changed or needs review. Reload it before editing again.');
        }
        throw new Error('The save could not be confirmed. Retry this saved change before editing again.');
      }
      pending.current = null;
      setUncertain(false);
      setView(current => current ? { ...current, canEdit: false } : null);
      await onSaved();
      if (current === generation.current) {
        setOpen(false);
      }
    } catch (error) {
      if (current === generation.current) {
        setUncertain(pending.current !== null);
        setError(error instanceof Error && error.name !== 'AbortError' ? error.message : 'The save could not be confirmed. Retry this saved change before editing again.');
      }
    } finally {
      clearTimeout(timeout);
      if (current === generation.current) {
        setBusy(false);
      }
    }
  }

  function addItem(kind: 'service' | 'addon' | 'custom', item?: CatalogItem) {
    if (!view) {
      return;
    }
    setItems(current => [...current, { key: crypto.randomUUID(), kind, catalogServiceId: kind === 'service' ? item?.id : null, catalogAddOnId: kind === 'addon' ? item?.id : null, name: item?.name ?? '', quantity: 1, quantityInput: '1', unitPriceCents: item?.priceCents ?? 0, priceInput: ((item?.priceCents ?? 0) / 100).toFixed(2), durationMinutes: item?.durationMinutes ?? null, taxable: kind === 'service' ? view.taxConfig.taxServicesByDefault : kind === 'addon' ? view.taxConfig.taxAddOnsByDefault : view.taxConfig.taxCustomByDefault }]);
  }

  if (!open) {
    return <button type="button" className={`${button} mb-4`} disabled={disabled} onClick={() => void load()}>Adjust bill</button>;
  }
  return (
    <section aria-labelledby={`${id}-title`} className="mb-4 min-w-0 space-y-4 rounded-2xl border border-neutral-200 p-4">
      <h3 id={`${id}-title`} className="font-semibold">Adjust completed bill</h3>
      <p className="text-sm text-neutral-600">Save service changes here, then use Payments to collect the extra balance or review a refund. Saving does not move money. The original completion date, tax settings and tip stay the same.</p>
      {error && <p role="alert" className="text-sm text-red-800">{error}</p>}
      {busy && <p role="status" className="text-sm">{view ? 'Saving bill…' : 'Loading bill…'}</p>}
      {view && (
        <>
          {!view.canEdit && <p role="status" className="text-sm text-amber-900">Resolve the existing payment request or review hold before adjusting this bill.</p>}
          <fieldset disabled={!editable} className="min-w-0 space-y-3">
            <legend className="mb-2 text-sm font-semibold">Services and items</legend>
            {items.map((item, index) => (
              <div key={item.key} className="min-w-0 space-y-2 rounded-xl border p-3">
                <label className="block text-sm">
                  Item name
                  <input className={inputClass} value={item.name} maxLength={120} onChange={event => setItems(current => current.map((row, i) => i === index ? { ...row, name: event.target.value } : row))} />
                </label>
                <div className="grid min-w-0 grid-cols-2 gap-2">
                  <label className="min-w-0 text-sm">
                    Price
                    <input className={inputClass} inputMode="decimal" value={item.priceInput} onChange={event => setItems(current => current.map((row, i) => i === index ? { ...row, priceInput: event.target.value } : row))} />
                  </label>
                  <label className="min-w-0 text-sm">
                    Quantity
                    <input className={inputClass} inputMode="numeric" value={item.quantityInput} onChange={event => setItems(current => current.map((row, i) => i === index ? { ...row, quantityInput: event.target.value } : row))} />
                  </label>
                </div>
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <label className="flex min-h-11 items-center gap-2 text-sm">
                    <input type="checkbox" checked={item.taxable ?? false} onChange={event => setItems(current => current.map((row, i) => i === index ? { ...row, taxable: event.target.checked } : row))} />
                    Tax applies
                  </label>
                  <button type="button" className={button} aria-label={`Remove item ${index + 1}`} onClick={() => setItems(current => current.filter((_, i) => i !== index))}>Remove</button>
                </div>
              </div>
            ))}
            <label className="block text-sm">
              Add a service or add-on
              <select
                className={inputClass}
                value=""
                disabled={items.length >= 40}
                onChange={(event) => {
                  const [kind, index] = event.target.value.split(':');
                  if (kind === 'service' || kind === 'addon') {
                    addItem(kind, (kind === 'service' ? catalog.services : catalog.addOns)[Number(index)]);
                  }
                }}
              >
                <option value="">Choose an item</option>
                {catalog.services.map((item, index) => <option key={item.id} value={`service:${index}`}>{item.name}</option>)}
                {catalog.addOns.map((item, index) => <option key={item.id} value={`addon:${index}`}>{item.name}</option>)}
              </select>
            </label>
            <button type="button" className={button} disabled={items.length >= 40} onClick={() => addItem('custom')}>Add custom item</button>
            <label className="block text-sm">
              Discount
              <input className={inputClass} inputMode="decimal" value={discount} onChange={event => setDiscount(event.target.value)} />
            </label>
            <label className="block text-sm">
              Discount reason
              <input className={inputClass} value={discountReason} maxLength={200} onChange={event => setDiscountReason(event.target.value)} />
            </label>
            <label className="block text-sm">
              Reason for this change
              <textarea className={inputClass} value={reason} maxLength={500} onChange={event => setReason(event.target.value)} />
            </label>
          </fieldset>
          {totals && (
            <dl className="space-y-2 text-sm">
              <div className="flex justify-between gap-2">
                <dt>Revised total</dt>
                <dd>{money(totals.totalDueCents)}</dd>
              </div>
              <div className="flex justify-between gap-2">
                <dt>Already paid</dt>
                <dd>{money(view.paidCents)}</dd>
              </div>
              <div className="flex justify-between gap-2 font-semibold">
                <dt>{overpaid > 0 ? 'Overpayment to review' : 'Remaining balance'}</dt>
                <dd>{money(overpaid || Math.max(0, totals.totalDueCents - view.paidCents))}</dd>
              </div>
            </dl>
          )}
          {needsReview && <p role="alert" className="text-sm text-amber-900">The revised bill would exceed the available online refund or deposit credit. Resolve that payment history with the owner before saving.</p>}
        </>
      )}
      <div className="flex flex-wrap gap-2">
        <button type="button" className={button} disabled={busy || (!uncertain && (!proposed?.success || needsReview || !view?.canEdit))} onClick={() => void save()}>{uncertain ? 'Retry saved change' : 'Save bill changes'}</button>
        <button type="button" className={button} disabled={busy} onClick={() => void load()}>Reload bill</button>
        <button type="button" className={button} disabled={busy || uncertain} onClick={() => setOpen(false)}>Cancel editing</button>
      </div>
    </section>
  );
}
