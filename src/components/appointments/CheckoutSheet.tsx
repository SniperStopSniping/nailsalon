'use client';

import { Banknote, Camera, CheckCircle2, Copy, Minus, Plus, QrCode, Trash2 } from 'lucide-react';
import Image from 'next/image';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { DialogShell } from '@/components/ui/dialog-shell';
import {
  computeCheckoutTotals,
  type ResolvedTaxConfig,
} from '@/libs/checkoutTotals';
import { formatMoney } from '@/libs/formatMoney';
import { themeVars } from '@/theme';

// =============================================================================
// The ONE completion flow ("Complete appointment"), shared by every surface:
// admin calendar/bookings/clients, staff agenda, and the staff canvas. A single
// scrollable page of section cards (Services & items / Time / Photos / Price &
// tax / Payment) with a sticky total bar → review → success/receipt sub-views.
// Server-side authz and totals stay authoritative; this sheet only previews.
// =============================================================================

type CheckoutItem = {
  key: string;
  kind: 'service' | 'addon' | 'custom';
  catalogServiceId: string | null;
  catalogAddOnId: string | null;
  name: string;
  quantity: number;
  unitPriceCents: number;
  durationMinutes: number | null;
  taxable: boolean;
};

type CheckoutContext = {
  appointment: {
    id: string;
    status: string;
    paymentStatus: string | null;
    clientName: string | null;
    startTime: string;
    endTime: string;
    totalDurationMinutes: number;
    totalPrice: number;
    startedAt: string | null;
    completedAt: string | null;
    actualStartAt: string | null;
    actualEndAt: string | null;
    finalPriceCents: number | null;
    finalSubtotalCents: number | null;
    finalDiscountCents: number | null;
    finalDiscountReason: string | null;
    tipCents: number | null;
    paymentMethod: string | null;
    taxEnabledSnapshot: boolean | null;
    taxNameSnapshot: string | null;
    taxRateBps: number | null;
    taxInclusive: boolean | null;
    taxAmountCents: number | null;
    taxExempt: boolean | null;
    taxExemptReason: string | null;
  };
  bookedItems: Array<Omit<CheckoutItem, 'key' | 'taxable'>>;
  finalItems: Array<Omit<CheckoutItem, 'key'> & { id: string }>;
  catalog: {
    services: Array<{ id: string; name: string; priceCents: number; durationMinutes: number }>;
    addOns: Array<{ id: string; name: string; priceCents: number; durationMinutes: number }>;
  };
  taxConfig: ResolvedTaxConfig;
  currency: string;
  timeZone: string;
  photoPolicy: { requireAfterPhotoToFinish: 'off' | 'optional' | 'required' };
  photos: Array<{ id: string; imageUrl: string; thumbnailUrl: string | null; photoType: string }>;
  payments: Array<{
    id: string;
    amountCents: number;
    method: string | null;
    reference: string | null;
    recordedAt: string;
    recordedByName: string | null;
    voidedAt: string | null;
  }>;
  balance: { totalDueCents: number; amountPaidCents: number; balanceCents: number };
  etransfer: {
    enabled: boolean;
    recipient: string | null;
    recipientName: string | null;
    autodepositEnabled: boolean;
    instructions: string | null;
    requireReference: boolean;
    qrPageEnabled: boolean;
  };
  paymentReference: string;
  permissions: {
    canEditItems: boolean;
    canApplyDiscount: boolean;
    canRecordPayment: boolean;
    canTaxExempt: boolean;
    canMarkComp: boolean;
  };
};

type CheckoutSheetProps = {
  isOpen: boolean;
  appointmentId: string | null;
  salonSlug?: string | null;
  /** Open straight onto the receipt (for already-completed appointments). */
  initialView?: 'edit' | 'receipt';
  onClose: () => void;
  onCompleted?: (result: { showReviewPrompt: boolean }) => void;
  onRebook?: () => void;
  onViewClient?: () => void;
};

const PAYMENT_METHOD_OPTIONS = [
  ['cash', 'Cash'],
  ['e_transfer', 'e-Transfer'],
  ['debit', 'Debit'],
  ['credit', 'Credit'],
  ['online', 'Online'],
  ['gift_card', 'Gift card'],
  ['other', 'Other'],
] as const;

function centsToInput(cents: number): string {
  return (cents / 100).toFixed(2).replace(/\.00$/, '');
}

function inputToCents(value: string): number {
  const parsed = Number.parseFloat(value.replace(/[^0-9.]/g, ''));
  return Number.isNaN(parsed) || parsed < 0 ? 0 : Math.round(parsed * 100);
}

function toDatetimeLocal(iso: string | null): string {
  if (!iso) {
    return '';
  }
  const date = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

let itemKeyCounter = 0;
function nextItemKey(): string {
  itemKeyCounter += 1;
  return `item_${itemKeyCounter}`;
}

export function CheckoutSheet({
  isOpen,
  appointmentId,
  salonSlug = null,
  initialView = 'edit',
  onClose,
  onCompleted,
  onRebook,
  onViewClient,
}: CheckoutSheetProps) {
  const [view, setView] = useState<'edit' | 'review' | 'success' | 'receipt'>(initialView);
  const [context, setContext] = useState<CheckoutContext | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const [items, setItems] = useState<CheckoutItem[]>([]);
  const [discountInput, setDiscountInput] = useState('');
  const [discountReason, setDiscountReason] = useState('');
  const [tipInput, setTipInput] = useState('');
  const [taxExempt, setTaxExempt] = useState(false);
  const [taxExemptReason, setTaxExemptReason] = useState('');
  const [actualStart, setActualStart] = useState('');
  const [actualEnd, setActualEnd] = useState('');
  const [amountReceivedInput, setAmountReceivedInput] = useState('');
  const [amountTouched, setAmountTouched] = useState(false);
  const [paymentMethod, setPaymentMethod] = useState<string | null>(null);
  const [paymentRefInput, setPaymentRefInput] = useState('');
  const [comp, setComp] = useState(false);
  const [notes, setNotes] = useState('');
  const [skipPhotoConfirmed, setSkipPhotoConfirmed] = useState(false);
  const [showPhotoPrompt, setShowPhotoPrompt] = useState(false);
  const [copied, setCopied] = useState<string | null>(null);
  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null);
  const [qrLoading, setQrLoading] = useState(false);
  const [uploadingPhoto, setUploadingPhoto] = useState(false);
  const [pendingPhotoType, setPendingPhotoType] = useState<'before' | 'after'>('after');
  const [successResult, setSuccessResult] = useState<{ showReviewPrompt: boolean } | null>(null);
  const [postPaymentAmount, setPostPaymentAmount] = useState('');
  const [postPaymentMethod, setPostPaymentMethod] = useState<string | null>(null);
  const [recordingPayment, setRecordingPayment] = useState(false);

  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const apiPath = useCallback((path: string) => (
    salonSlug ? `${path}?salonSlug=${encodeURIComponent(salonSlug)}` : path
  ), [salonSlug]);

  const seedFromContext = useCallback((data: CheckoutContext) => {
    const source = data.finalItems.length > 0 ? data.finalItems : data.bookedItems;
    setItems(source.map(item => ({
      key: nextItemKey(),
      kind: item.kind,
      catalogServiceId: item.catalogServiceId,
      catalogAddOnId: item.catalogAddOnId,
      name: item.name,
      quantity: item.quantity,
      unitPriceCents: item.unitPriceCents,
      durationMinutes: item.durationMinutes,
      taxable: 'taxable' in item && typeof item.taxable === 'boolean'
        ? item.taxable
        : item.kind === 'service'
          ? data.taxConfig.taxServicesByDefault
          : item.kind === 'addon'
            ? data.taxConfig.taxAddOnsByDefault
            : data.taxConfig.taxCustomByDefault,
    })));
    setDiscountInput(data.appointment.finalDiscountCents ? centsToInput(data.appointment.finalDiscountCents) : '');
    setDiscountReason(data.appointment.finalDiscountReason ?? '');
    setTipInput(data.appointment.tipCents ? centsToInput(data.appointment.tipCents) : '');
    setTaxExempt(data.appointment.taxExempt ?? false);
    setTaxExemptReason(data.appointment.taxExemptReason ?? '');
    setActualStart(toDatetimeLocal(data.appointment.actualStartAt ?? data.appointment.startedAt ?? data.appointment.startTime));
    setActualEnd(toDatetimeLocal(data.appointment.actualEndAt));
    setPaymentMethod(data.appointment.paymentMethod);
    setAmountTouched(false);
    setComp(false);
    setSkipPhotoConfirmed(false);
  }, []);

  const fetchContext = useCallback(async () => {
    if (!appointmentId) {
      return;
    }
    try {
      setLoading(true);
      setError(null);
      const response = await fetch(apiPath(`/api/appointments/${appointmentId}/checkout`));
      const result = await response.json().catch(() => null);
      if (!response.ok) {
        throw new Error(result?.error?.message ?? 'Failed to load checkout details');
      }
      setContext(result.data);
      seedFromContext(result.data);
    } catch (fetchError) {
      setContext(null);
      setError(fetchError instanceof Error ? fetchError.message : 'Failed to load checkout details');
    } finally {
      setLoading(false);
    }
  }, [apiPath, appointmentId, seedFromContext]);

  useEffect(() => {
    if (isOpen && appointmentId) {
      setView(initialView);
      setSuccessResult(null);
      setQrDataUrl(null);
      void fetchContext();
    }
  }, [isOpen, appointmentId, initialView, fetchContext]);

  const totals = useMemo(() => {
    if (!context) {
      return null;
    }
    return computeCheckoutTotals({
      items: items.map(item => ({
        lineTotalCents: item.unitPriceCents * item.quantity,
        taxable: item.taxable,
      })),
      discountCents: inputToCents(discountInput),
      taxConfig: context.taxConfig,
      taxExempt,
      tipCents: inputToCents(tipInput),
    });
  }, [context, items, discountInput, taxExempt, tipInput]);

  const amountReceivedCents = comp
    ? 0
    : amountTouched
      ? inputToCents(amountReceivedInput)
      : totals?.totalDueCents ?? 0;

  const hasAfterPhoto = context?.photos.some(photo => photo.photoType === 'after') ?? false;
  const photoPolicyMode = context?.photoPolicy.requireAfterPhotoToFinish ?? 'off';
  const currency = context?.currency ?? 'CAD';

  const money = useCallback((cents: number) => formatMoney(cents, currency), [currency]);

  // ---------------------------------------------------------------------------
  // Actions
  // ---------------------------------------------------------------------------

  const copyToClipboard = useCallback(async (label: string, value: string) => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(label);
      setTimeout(() => setCopied(current => (current === label ? null : current)), 2000);
    } catch {
      setError('Could not copy to the clipboard');
    }
  }, []);

  const uploadPhoto = useCallback(async (file: File, photoType: 'before' | 'after') => {
    if (!appointmentId) {
      return;
    }
    try {
      setUploadingPhoto(true);
      setError(null);
      const formData = new FormData();
      formData.append('file', file);
      formData.append('photoType', photoType);
      const response = await fetch(apiPath(`/api/appointments/${appointmentId}/photos`), {
        method: 'POST',
        body: formData,
      });
      const result = await response.json().catch(() => null);
      if (!response.ok) {
        throw new Error(result?.error?.message ?? 'Photo upload failed');
      }
      await fetchContext();
    } catch (uploadError) {
      setError(uploadError instanceof Error ? uploadError.message : 'Photo upload failed');
    } finally {
      setUploadingPhoto(false);
    }
  }, [apiPath, appointmentId, fetchContext]);

  const removePhoto = useCallback(async (photoId: string) => {
    if (!appointmentId) {
      return;
    }
    try {
      setError(null);
      const response = await fetch(apiPath(`/api/appointments/${appointmentId}/photos/${photoId}`), {
        method: 'DELETE',
      });
      const result = await response.json().catch(() => null);
      if (!response.ok) {
        throw new Error(result?.error?.message ?? 'Could not remove the photo');
      }
      await fetchContext();
    } catch (removeError) {
      setError(removeError instanceof Error ? removeError.message : 'Could not remove the photo');
    }
  }, [apiPath, appointmentId, fetchContext]);

  const showQr = useCallback(async () => {
    if (!appointmentId) {
      return;
    }
    try {
      setQrLoading(true);
      setError(null);
      const response = await fetch(apiPath(`/api/appointments/${appointmentId}/payment-link`), {
        method: 'POST',
      });
      const result = await response.json().catch(() => null);
      if (!response.ok) {
        throw new Error(result?.error?.message ?? 'Could not create the payment page');
      }
      const { toDataURL } = await import('qrcode');
      setQrDataUrl(await toDataURL(result.data.url, { width: 240, margin: 1 }));
    } catch (qrError) {
      setError(qrError instanceof Error ? qrError.message : 'Could not create the payment page');
    } finally {
      setQrLoading(false);
    }
  }, [apiPath, appointmentId]);

  const submitCompletion = useCallback(async (options: { skipPhoto?: boolean } = {}) => {
    if (!appointmentId || !context || !totals) {
      return;
    }
    try {
      setSubmitting(true);
      setError(null);
      const payments = amountReceivedCents > 0
        ? [{
            amountCents: Math.min(amountReceivedCents, totals.totalDueCents),
            ...(paymentMethod ? { method: paymentMethod } : {}),
            ...(paymentRefInput.trim() ? { reference: paymentRefInput.trim() } : {}),
          }]
        : [];
      const response = await fetch(apiPath(`/api/appointments/${appointmentId}/complete`), {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          finalItems: items.map(item => ({
            kind: item.kind,
            catalogServiceId: item.catalogServiceId,
            catalogAddOnId: item.catalogAddOnId,
            name: item.name,
            quantity: item.quantity,
            unitPriceCents: item.unitPriceCents,
            durationMinutes: item.durationMinutes,
            taxable: item.taxable,
          })),
          discountCents: inputToCents(discountInput),
          ...(discountReason.trim() ? { discountReason: discountReason.trim() } : {}),
          tipCents: inputToCents(tipInput),
          ...(context.permissions.canTaxExempt && taxExempt
            ? { taxExempt: true, ...(taxExemptReason.trim() ? { taxExemptReason: taxExemptReason.trim() } : {}) }
            : {}),
          ...(actualStart ? { actualStartAt: new Date(actualStart).toISOString() } : {}),
          ...(actualEnd ? { actualEndAt: new Date(actualEnd).toISOString() } : {}),
          ...(comp ? { paymentStatusIntent: 'comp', payments: [] } : { payments }),
          ...(paymentMethod ? { paymentMethod } : {}),
          ...(notes.trim() ? { techNotes: notes.trim() } : {}),
          expectedTotalDueCents: totals.totalDueCents,
          ...(options.skipPhoto || skipPhotoConfirmed ? { skipPhotoValidation: true } : {}),
        }),
      });
      const result = await response.json().catch(() => null);
      if (!response.ok) {
        const code = result?.error?.code;
        if (code === 'PHOTOS_REQUIRED') {
          if (result.error.details?.policy === 'required') {
            setError('This salon requires an after photo before completing. Add one in the Photos section.');
          } else {
            setShowPhotoPrompt(true);
          }
          return;
        }
        if (code === 'TOTALS_MISMATCH') {
          setError('Salon pricing or tax settings changed — totals were refreshed. Review and try again.');
          await fetchContext();
          return;
        }
        throw new Error(result?.error?.message ?? 'Unable to complete appointment');
      }
      setSuccessResult({ showReviewPrompt: Boolean(result?.data?.showReviewPrompt) });
      setView('success');
      await fetchContext();
      onCompleted?.({ showReviewPrompt: Boolean(result?.data?.showReviewPrompt) });
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : 'Unable to complete appointment');
    } finally {
      setSubmitting(false);
    }
  }, [apiPath, appointmentId, context, totals, items, discountInput, discountReason, tipInput, taxExempt, taxExemptReason, actualStart, actualEnd, comp, amountReceivedCents, paymentMethod, paymentRefInput, notes, skipPhotoConfirmed, fetchContext, onCompleted]);

  const recordPostPayment = useCallback(async () => {
    if (!appointmentId) {
      return;
    }
    const amountCents = inputToCents(postPaymentAmount);
    if (amountCents <= 0) {
      return;
    }
    try {
      setRecordingPayment(true);
      setError(null);
      const response = await fetch(apiPath(`/api/appointments/${appointmentId}/payments`), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          amountCents,
          ...(postPaymentMethod ? { method: postPaymentMethod } : {}),
        }),
      });
      const result = await response.json().catch(() => null);
      if (!response.ok) {
        throw new Error(result?.error?.message ?? 'Could not record the payment');
      }
      setPostPaymentAmount('');
      await fetchContext();
    } catch (paymentError) {
      setError(paymentError instanceof Error ? paymentError.message : 'Could not record the payment');
    } finally {
      setRecordingPayment(false);
    }
  }, [apiPath, appointmentId, postPaymentAmount, postPaymentMethod, fetchContext]);

  // ---------------------------------------------------------------------------
  // Item helpers
  // ---------------------------------------------------------------------------

  const updateItem = (key: string, patch: Partial<CheckoutItem>) => {
    setItems(prev => prev.map(item => (item.key === key ? { ...item, ...patch } : item)));
  };

  const removeItem = (key: string) => {
    setItems(prev => prev.filter(item => item.key !== key));
  };

  const addCatalogService = (serviceId: string) => {
    const service = context?.catalog.services.find(entry => entry.id === serviceId);
    if (!service || !context) {
      return;
    }
    setItems(prev => [...prev, {
      key: nextItemKey(),
      kind: 'service',
      catalogServiceId: service.id,
      catalogAddOnId: null,
      name: service.name,
      quantity: 1,
      unitPriceCents: service.priceCents,
      durationMinutes: service.durationMinutes,
      taxable: context.taxConfig.taxServicesByDefault,
    }]);
  };

  const addCatalogAddOn = (addOnId: string) => {
    const addOn = context?.catalog.addOns.find(entry => entry.id === addOnId);
    if (!addOn || !context) {
      return;
    }
    setItems(prev => [...prev, {
      key: nextItemKey(),
      kind: 'addon',
      catalogServiceId: null,
      catalogAddOnId: addOn.id,
      name: addOn.name,
      quantity: 1,
      unitPriceCents: addOn.priceCents,
      durationMinutes: addOn.durationMinutes,
      taxable: context.taxConfig.taxAddOnsByDefault,
    }]);
  };

  const addCustomItem = () => {
    if (!context) {
      return;
    }
    setItems(prev => [...prev, {
      key: nextItemKey(),
      kind: 'custom',
      catalogServiceId: null,
      catalogAddOnId: null,
      name: '',
      quantity: 1,
      unitPriceCents: 0,
      durationMinutes: null,
      taxable: context.taxConfig.taxCustomByDefault,
    }]);
  };

  // ---------------------------------------------------------------------------
  // Render helpers
  // ---------------------------------------------------------------------------

  const sectionCard = 'rounded-2xl border border-neutral-200 p-4';
  const sectionTitle = 'mb-3 text-sm font-semibold text-neutral-900';
  const fieldLabel = 'mb-1 block text-xs font-medium uppercase tracking-[0.08em] text-neutral-400';
  const inputClass = 'w-full rounded-xl border border-neutral-200 bg-white p-3 text-sm text-neutral-900';

  const scheduledDuration = context?.appointment.totalDurationMinutes ?? 0;
  const actualDurationMinutes = actualStart && actualEnd
    ? Math.max(0, Math.round((new Date(actualEnd).getTime() - new Date(actualStart).getTime()) / 60000))
    : null;

  const originalSubtotal = context
    ? context.bookedItems.reduce((sum, item) => sum + item.unitPriceCents * item.quantity, 0)
    : 0;

  const balanceAfterPayment = totals
    ? (comp ? 0 : Math.max(0, totals.totalDueCents - Math.min(amountReceivedCents, totals.totalDueCents)))
    : 0;

  const isCompleted = context?.appointment.status === 'completed';

  const renderTotalsRows = (options: { includePayment: boolean }) => {
    if (!totals || !context) {
      return null;
    }
    const taxLabel = context.taxConfig.enabled
      ? `${context.taxConfig.name ?? 'Tax'} (${(context.taxConfig.rateBps / 100).toFixed(context.taxConfig.rateBps % 100 === 0 ? 0 : 2)}%)`
      : 'Tax';
    return (
      <div className="space-y-1.5 text-sm text-neutral-700">
        <div className="flex justify-between">
          <span>Original booked subtotal</span>
          <span>{money(originalSubtotal)}</span>
        </div>
        <div className="flex justify-between">
          <span>Final subtotal</span>
          <span data-testid="checkout-final-subtotal">{money(totals.finalSubtotalCents)}</span>
        </div>
        {totals.finalDiscountCents > 0 && (
          <div className="flex justify-between text-emerald-700">
            <span>Discount</span>
            <span>
              −
              {money(totals.finalDiscountCents)}
            </span>
          </div>
        )}
        {(context.taxConfig.enabled || taxExempt) && (
          <div className="flex justify-between">
            <span>
              {taxLabel}
              {taxExempt ? ' — exempt' : context.taxConfig.pricesIncludeTax ? ' (included)' : ''}
            </span>
            <span data-testid="checkout-tax-amount">{money(totals.taxAmountCents)}</span>
          </div>
        )}
        {totals.tipCents > 0 && (
          <div className="flex justify-between">
            <span>Tip</span>
            <span>{money(totals.tipCents)}</span>
          </div>
        )}
        <div className="flex justify-between border-t border-neutral-200 pt-1.5 text-base font-semibold text-neutral-900">
          <span>Total</span>
          <span data-testid="checkout-total-due">{money(totals.totalDueCents)}</span>
        </div>
        {options.includePayment && !comp && (
          <>
            <div className="flex justify-between">
              <span>Receiving now</span>
              <span>{money(Math.min(amountReceivedCents, totals.totalDueCents))}</span>
            </div>
            <div className="flex justify-between font-medium">
              <span>Remaining balance</span>
              <span data-testid="checkout-remaining-balance">{money(balanceAfterPayment)}</span>
            </div>
          </>
        )}
        {options.includePayment && comp && (
          <div className="flex justify-between font-medium text-emerald-700">
            <span>Complimentary — nothing due</span>
            <span>{money(0)}</span>
          </div>
        )}
      </div>
    );
  };

  const renderReceipt = () => {
    if (!context) {
      return null;
    }
    const appt = context.appointment;
    const receiptItems = context.finalItems.length > 0 ? context.finalItems : context.bookedItems;
    const totalDue = context.balance.totalDueCents;
    return (
      <div className="space-y-4" data-testid="checkout-receipt">
        <div className={sectionCard}>
          <div className={sectionTitle}>Receipt</div>
          <div className="text-sm text-neutral-500">
            {appt.clientName || 'Guest client'}
            {' · '}
            {new Date(appt.startTime).toLocaleDateString('en-CA', { dateStyle: 'medium' })}
          </div>
          <div className="mt-3 space-y-1.5 text-sm text-neutral-700">
            {receiptItems.map((item, index) => (
              <div key={`receipt-${index}`} className="flex justify-between">
                <span>
                  {item.name}
                  {item.quantity > 1 ? ` × ${item.quantity}` : ''}
                </span>
                <span>{money(item.unitPriceCents * item.quantity)}</span>
              </div>
            ))}
            {(appt.finalDiscountCents ?? 0) > 0 && (
              <div className="flex justify-between text-emerald-700">
                <span>
                  Discount
                  {appt.finalDiscountReason ? ` (${appt.finalDiscountReason})` : ''}
                </span>
                <span>
                  −
                  {money(appt.finalDiscountCents ?? 0)}
                </span>
              </div>
            )}
            {appt.taxEnabledSnapshot && (
              <div className="flex justify-between">
                <span>
                  {appt.taxNameSnapshot ?? 'Tax'}
                  {' '}
                  (
                  {((appt.taxRateBps ?? 0) / 100).toFixed((appt.taxRateBps ?? 0) % 100 === 0 ? 0 : 2)}
                  %
                  {appt.taxInclusive ? ', included' : ''}
                  {appt.taxExempt ? ', exempt' : ''}
                  )
                </span>
                <span>{money(appt.taxAmountCents ?? 0)}</span>
              </div>
            )}
            {(appt.tipCents ?? 0) > 0 && (
              <div className="flex justify-between">
                <span>Tip</span>
                <span>{money(appt.tipCents ?? 0)}</span>
              </div>
            )}
            <div className="flex justify-between border-t border-neutral-200 pt-1.5 text-base font-semibold text-neutral-900">
              <span>Total</span>
              <span>{money(totalDue)}</span>
            </div>
            <div className="flex justify-between">
              <span>Paid</span>
              <span>{money(context.balance.amountPaidCents)}</span>
            </div>
            <div className="flex justify-between font-medium">
              <span>Balance</span>
              <span>{money(context.balance.balanceCents)}</span>
            </div>
          </div>
        </div>

        {context.payments.length > 0 && (
          <div className={sectionCard}>
            <div className={sectionTitle}>Payments</div>
            <div className="space-y-2 text-sm text-neutral-700">
              {context.payments.map(payment => (
                <div key={payment.id} className={`flex justify-between ${payment.voidedAt ? 'text-neutral-400 line-through' : ''}`}>
                  <span>
                    {new Date(payment.recordedAt).toLocaleDateString('en-CA', { dateStyle: 'medium' })}
                    {payment.method ? ` · ${payment.method.replace('_', '-')}` : ''}
                    {payment.reference ? ` · ${payment.reference}` : ''}
                    {payment.voidedAt ? ' · voided' : ''}
                  </span>
                  <span>{money(payment.amountCents)}</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    );
  };

  return (
    <DialogShell
      isOpen={isOpen}
      onClose={onClose}
      closeOnBackdrop={!submitting}
      closeOnEscape={!submitting}
      maxWidthClassName="w-full sm:max-w-lg"
      alignClassName="items-end justify-center bg-black/50 p-0 sm:items-stretch sm:justify-end"
      contentClassName="flex max-h-[92vh] min-h-[70vh] flex-col overflow-hidden rounded-t-3xl bg-white shadow-2xl sm:ml-auto sm:h-full sm:max-h-none sm:rounded-none sm:rounded-l-3xl"
    >
      <div data-testid="checkout-sheet" className="flex h-full flex-col">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-neutral-100 px-4 pb-3 pt-4 sm:px-5">
          <div>
            <div className="text-lg font-semibold text-neutral-900">
              {view === 'success' ? 'Appointment completed' : view === 'receipt' ? 'Receipt' : 'Complete appointment'}
            </div>
            <div className="text-sm text-neutral-500">
              {context?.appointment.clientName || 'Checkout'}
            </div>
          </div>
          <div className="flex items-center gap-2">
            {view === 'review' && (
              <button
                type="button"
                data-testid="checkout-back"
                onClick={() => setView('edit')}
                className="rounded-full border border-neutral-200 px-3 py-1.5 text-sm font-medium text-neutral-700"
              >
                Back
              </button>
            )}
            <button
              type="button"
              data-testid="checkout-close"
              onClick={onClose}
              className="rounded-full p-2 text-neutral-400 transition-colors hover:bg-neutral-100 hover:text-neutral-700"
            >
              ×
            </button>
          </div>
        </div>

        {/* Body */}
        <div
          className="min-h-0 flex-1 overflow-y-auto px-4 pt-4 sm:px-5"
          style={{ paddingBottom: 'calc(env(safe-area-inset-bottom, 0px) + 7rem)' }}
        >
          {loading && (
            <div className="py-10 text-sm text-neutral-500">Loading checkout…</div>
          )}

          {!loading && error && (
            <div data-testid="checkout-error" className="mb-4 rounded-2xl border border-red-200 bg-red-50 p-3 text-sm text-red-700">
              {error}
            </div>
          )}

          {!loading && !context && !error && (
            <div className="py-10 text-sm text-neutral-500">Checkout details are unavailable.</div>
          )}

          {!loading && context && view === 'edit' && (
            <div className="space-y-4">
              {/* Services & items */}
              <div className={sectionCard} data-testid="checkout-items-section">
                <div className={sectionTitle}>Services & items</div>
                <div className="space-y-3">
                  {items.map(item => (
                    <div key={item.key} className="rounded-xl bg-neutral-50 p-3" data-testid={`checkout-item-${item.key}`}>
                      <div className="flex items-start justify-between gap-2">
                        {item.kind === 'custom'
                          ? (
                              <input
                                type="text"
                                value={item.name}
                                placeholder="Custom item (e.g. Nail art, Repair)"
                                onChange={event => updateItem(item.key, { name: event.target.value })}
                                className="flex-1 rounded-lg border border-neutral-200 bg-white p-2 text-sm font-medium text-neutral-900"
                                data-testid="checkout-custom-name"
                              />
                            )
                          : (
                              <div className="min-w-0 flex-1">
                                <div className="truncate text-sm font-medium text-neutral-900">{item.name}</div>
                                <div className="text-xs uppercase tracking-wide text-neutral-400">{item.kind}</div>
                              </div>
                            )}
                        <button
                          type="button"
                          aria-label={`Remove ${item.name || 'item'}`}
                          onClick={() => removeItem(item.key)}
                          className="rounded-lg p-2 text-neutral-400 hover:bg-neutral-100 hover:text-red-600"
                        >
                          <Trash2 className="size-4" />
                        </button>
                      </div>
                      <div className="mt-2 flex flex-wrap items-center gap-3">
                        <div className="flex items-center gap-1">
                          <button
                            type="button"
                            aria-label="Decrease quantity"
                            onClick={() => updateItem(item.key, { quantity: Math.max(1, item.quantity - 1) })}
                            className="rounded-lg border border-neutral-200 p-1.5 text-neutral-600"
                          >
                            <Minus className="size-3.5" />
                          </button>
                          <span className="w-7 text-center text-sm font-medium">{item.quantity}</span>
                          <button
                            type="button"
                            aria-label="Increase quantity"
                            onClick={() => updateItem(item.key, { quantity: Math.min(99, item.quantity + 1) })}
                            className="rounded-lg border border-neutral-200 p-1.5 text-neutral-600"
                          >
                            <Plus className="size-3.5" />
                          </button>
                        </div>
                        <div className="relative">
                          <span className="pointer-events-none absolute inset-y-0 left-2.5 flex items-center text-xs text-neutral-400">$</span>
                          <input
                            type="text"
                            inputMode="decimal"
                            aria-label={`Price for ${item.name || 'item'}`}
                            value={centsToInput(item.unitPriceCents)}
                            onChange={event => updateItem(item.key, { unitPriceCents: inputToCents(event.target.value) })}
                            className="w-24 rounded-lg border border-neutral-200 bg-white p-2 pl-6 text-sm text-neutral-900"
                          />
                        </div>
                        {context.taxConfig.enabled && (
                          <label className="flex items-center gap-1.5 text-xs text-neutral-500">
                            <input
                              type="checkbox"
                              checked={item.taxable}
                              onChange={event => updateItem(item.key, { taxable: event.target.checked })}
                              className="size-3.5 rounded border-neutral-300"
                            />
                            Taxable
                          </label>
                        )}
                        <div className="ml-auto text-sm font-medium text-neutral-900">
                          {money(item.unitPriceCents * item.quantity)}
                        </div>
                      </div>
                    </div>
                  ))}
                  {items.length === 0 && (
                    <div className="rounded-xl border border-dashed border-neutral-200 p-3 text-center text-sm text-neutral-400">
                      No items — add the services performed below.
                    </div>
                  )}
                </div>

                <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-3">
                  <select
                    aria-label="Add a service"
                    data-testid="checkout-add-service"
                    value=""
                    onChange={(event) => {
                      if (event.target.value) {
                        addCatalogService(event.target.value);
                      }
                    }}
                    className="rounded-xl border border-neutral-200 bg-white p-2.5 text-sm text-neutral-700"
                  >
                    <option value="">+ Add service…</option>
                    {context.catalog.services.map(service => (
                      <option key={service.id} value={service.id}>
                        {service.name}
                        {' '}
                        ·
                        {' '}
                        {money(service.priceCents)}
                      </option>
                    ))}
                  </select>
                  <select
                    aria-label="Add an add-on"
                    data-testid="checkout-add-addon"
                    value=""
                    onChange={(event) => {
                      if (event.target.value) {
                        addCatalogAddOn(event.target.value);
                      }
                    }}
                    className="rounded-xl border border-neutral-200 bg-white p-2.5 text-sm text-neutral-700"
                  >
                    <option value="">+ Add add-on…</option>
                    {context.catalog.addOns.map(addOn => (
                      <option key={addOn.id} value={addOn.id}>
                        {addOn.name}
                        {' '}
                        ·
                        {' '}
                        {money(addOn.priceCents)}
                      </option>
                    ))}
                  </select>
                  <button
                    type="button"
                    data-testid="checkout-add-custom"
                    onClick={addCustomItem}
                    className="rounded-xl border border-dashed border-neutral-300 p-2.5 text-sm font-medium text-neutral-700"
                  >
                    + Custom item
                  </button>
                </div>
              </div>

              {/* Time */}
              <div className={sectionCard} data-testid="checkout-time-section">
                <div className={sectionTitle}>Time</div>
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <label className="block">
                    <span className={fieldLabel}>Actual start</span>
                    <input
                      type="datetime-local"
                      data-testid="checkout-actual-start"
                      value={actualStart}
                      onChange={event => setActualStart(event.target.value)}
                      className={inputClass}
                    />
                  </label>
                  <label className="block">
                    <span className={fieldLabel}>Actual finish</span>
                    <input
                      type="datetime-local"
                      data-testid="checkout-actual-end"
                      value={actualEnd}
                      onChange={event => setActualEnd(event.target.value)}
                      className={inputClass}
                    />
                  </label>
                </div>
                {actualStart && actualEnd && new Date(actualEnd) < new Date(actualStart) && (
                  <div className="mt-2 text-sm text-red-600" data-testid="checkout-time-error">
                    Finish cannot be before start.
                  </div>
                )}
                <div className="mt-2 text-xs text-neutral-500">
                  Scheduled
                  {' '}
                  {scheduledDuration}
                  {' '}
                  min
                  {actualDurationMinutes !== null && (
                    <>
                      {' · Actual '}
                      <span data-testid="checkout-actual-duration">{actualDurationMinutes}</span>
                      {' '}
                      min
                    </>
                  )}
                </div>
              </div>

              {/* Photos */}
              <div className={sectionCard} data-testid="checkout-photos-section">
                <div className={sectionTitle}>Photos</div>
                {context.photos.length > 0 && (
                  <div className="mb-3 flex gap-2 overflow-x-auto">
                    {context.photos.map(photo => (
                      <div key={photo.id} className="relative size-20 shrink-0 overflow-hidden rounded-xl">
                        <Image
                          src={photo.thumbnailUrl || photo.imageUrl}
                          alt={photo.photoType}
                          fill
                          className="object-cover"
                        />
                        <span className={`absolute left-1 top-1 rounded px-1 text-[10px] font-semibold uppercase text-white ${photo.photoType === 'before' ? 'bg-amber-600' : 'bg-emerald-600'}`}>
                          {photo.photoType}
                        </span>
                        <button
                          type="button"
                          aria-label={`Remove ${photo.photoType} photo`}
                          onClick={() => void removePhoto(photo.id)}
                          className="absolute right-1 top-1 rounded bg-black/50 p-0.5 text-white"
                        >
                          <Trash2 className="size-3" />
                        </button>
                      </div>
                    ))}
                  </div>
                )}
                {!hasAfterPhoto && (
                  <div className="mb-3 rounded-xl bg-amber-50 p-3 text-sm text-amber-900" data-testid="checkout-photo-nudge">
                    {photoPolicyMode === 'required'
                      ? 'This salon requires an after photo before completing.'
                      : 'Add an after photo? Save the finished set to the client’s history.'}
                  </div>
                )}
                <div className="grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    data-testid="checkout-upload-before"
                    disabled={uploadingPhoto}
                    onClick={() => {
                      setPendingPhotoType('before');
                      fileInputRef.current?.click();
                    }}
                    className="inline-flex items-center justify-center gap-2 rounded-xl border border-dashed border-neutral-300 p-3 text-sm font-medium text-neutral-700 disabled:opacity-50"
                  >
                    <Camera className="size-4" />
                    {uploadingPhoto && pendingPhotoType === 'before' ? 'Uploading…' : 'Add before'}
                  </button>
                  <button
                    type="button"
                    data-testid="checkout-upload-after"
                    disabled={uploadingPhoto}
                    onClick={() => {
                      setPendingPhotoType('after');
                      fileInputRef.current?.click();
                    }}
                    className="inline-flex items-center justify-center gap-2 rounded-xl border border-dashed border-neutral-300 p-3 text-sm font-medium text-neutral-700 disabled:opacity-50"
                  >
                    <Camera className="size-4" />
                    {uploadingPhoto && pendingPhotoType === 'after' ? 'Uploading…' : 'Add after'}
                  </button>
                </div>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/*"
                  capture="environment"
                  className="hidden"
                  data-testid="checkout-photo-input"
                  onChange={(event) => {
                    const file = event.target.files?.[0];
                    if (file) {
                      void uploadPhoto(file, pendingPhotoType);
                    }
                    event.target.value = '';
                  }}
                />
              </div>

              {/* Price & tax */}
              <div className={sectionCard} data-testid="checkout-price-section">
                <div className={sectionTitle}>Price & tax</div>
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <label className="block">
                    <span className={fieldLabel}>Discount ($)</span>
                    <input
                      type="text"
                      inputMode="decimal"
                      data-testid="checkout-discount"
                      value={discountInput}
                      onChange={event => setDiscountInput(event.target.value.replace(/[^0-9.]/g, ''))}
                      placeholder="0"
                      className={inputClass}
                      disabled={!context.permissions.canApplyDiscount}
                    />
                  </label>
                  <label className="block">
                    <span className={fieldLabel}>Discount reason</span>
                    <select
                      data-testid="checkout-discount-reason"
                      value={discountReason}
                      onChange={event => setDiscountReason(event.target.value)}
                      className={inputClass}
                    >
                      <option value="">No reason</option>
                      <option value="Added service">Added service</option>
                      <option value="Added nail art">Added nail art</option>
                      <option value="Repair">Repair</option>
                      <option value="Discount">Discount</option>
                      <option value="Price correction">Price correction</option>
                      <option value="Complimentary item">Complimentary item</option>
                      <option value="Custom">Custom reason</option>
                    </select>
                  </label>
                  <label className="block">
                    <span className={fieldLabel}>Tip ($)</span>
                    <input
                      type="text"
                      inputMode="decimal"
                      data-testid="checkout-tip"
                      value={tipInput}
                      onChange={event => setTipInput(event.target.value.replace(/[^0-9.]/g, ''))}
                      placeholder="0"
                      className={inputClass}
                    />
                  </label>
                  {context.permissions.canTaxExempt && context.taxConfig.enabled && (
                    <div className="block">
                      <span className={fieldLabel}>Tax exemption</span>
                      <label className="flex items-center justify-between rounded-xl border border-neutral-200 p-3 text-sm text-neutral-700">
                        Tax exempt
                        <input
                          type="checkbox"
                          data-testid="checkout-tax-exempt"
                          checked={taxExempt}
                          onChange={event => setTaxExempt(event.target.checked)}
                          className="size-4 rounded border-neutral-300"
                        />
                      </label>
                      {taxExempt && (
                        <input
                          type="text"
                          data-testid="checkout-tax-exempt-reason"
                          value={taxExemptReason}
                          onChange={event => setTaxExemptReason(event.target.value)}
                          placeholder="Exemption reason"
                          className={`${inputClass} mt-2`}
                        />
                      )}
                    </div>
                  )}
                </div>
                <div className="mt-4 rounded-xl bg-neutral-50 p-3">
                  {renderTotalsRows({ includePayment: false })}
                </div>
              </div>

              {/* Payment */}
              <div className={sectionCard} data-testid="checkout-payment-section">
                <div className={sectionTitle}>Payment</div>
                {context.permissions.canMarkComp && (
                  <label className="mb-3 flex items-center justify-between rounded-xl border border-neutral-200 p-3 text-sm text-neutral-700">
                    Complimentary (no charge)
                    <input
                      type="checkbox"
                      data-testid="checkout-comp"
                      checked={comp}
                      onChange={event => setComp(event.target.checked)}
                      className="size-4 rounded border-neutral-300"
                    />
                  </label>
                )}
                {!comp && (
                  <>
                    <div className="mb-3 flex flex-wrap gap-2">
                      {PAYMENT_METHOD_OPTIONS.map(([value, label]) => (
                        <button
                          key={value}
                          type="button"
                          data-testid={`checkout-method-${value}`}
                          onClick={() => setPaymentMethod(current => (current === value ? null : value))}
                          className={`min-h-9 rounded-full px-3 py-1.5 text-xs font-medium ${paymentMethod === value ? 'bg-black text-white' : 'bg-neutral-100 text-neutral-600'}`}
                        >
                          {label}
                        </button>
                      ))}
                    </div>
                    <label className="block">
                      <span className={fieldLabel}>Amount received now ($)</span>
                      <input
                        type="text"
                        inputMode="decimal"
                        data-testid="checkout-amount-received"
                        value={amountTouched ? amountReceivedInput : totals ? centsToInput(totals.totalDueCents) : ''}
                        onChange={(event) => {
                          setAmountTouched(true);
                          setAmountReceivedInput(event.target.value.replace(/[^0-9.]/g, ''));
                        }}
                        className={inputClass}
                      />
                    </label>
                    <div className="mt-1 text-xs text-neutral-500">
                      Enter less for a partial payment, or 0 to record the payment later.
                    </div>
                    {paymentMethod === 'e_transfer' && (
                      <label className="mt-3 block">
                        <span className={fieldLabel}>Payment reference</span>
                        <input
                          type="text"
                          data-testid="checkout-payment-reference"
                          value={paymentRefInput}
                          onChange={event => setPaymentRefInput(event.target.value)}
                          placeholder="e-Transfer confirmation #"
                          className={inputClass}
                        />
                      </label>
                    )}

                    {/* e-Transfer instructions */}
                    {context.etransfer.enabled && (
                      <div className="mt-4 rounded-xl bg-neutral-50 p-3" data-testid="checkout-etransfer-panel">
                        <div className="mb-2 flex items-center gap-2 text-sm font-semibold text-neutral-900">
                          <Banknote className="size-4" />
                          Interac e-Transfer
                        </div>
                        <div className="space-y-1.5 text-sm text-neutral-700">
                          <div className="flex items-center justify-between gap-2">
                            <span className="truncate">
                              Send to
                              {' '}
                              <span className="font-medium">{context.etransfer.recipient}</span>
                              {context.etransfer.recipientName ? ` (${context.etransfer.recipientName})` : ''}
                            </span>
                            <button
                              type="button"
                              aria-label="Copy recipient"
                              onClick={() => void copyToClipboard('recipient', context.etransfer.recipient ?? '')}
                              className="rounded-lg border border-neutral-200 p-1.5 text-neutral-600"
                            >
                              {copied === 'recipient' ? <CheckCircle2 className="size-3.5 text-emerald-600" /> : <Copy className="size-3.5" />}
                            </button>
                          </div>
                          <div className="flex items-center justify-between gap-2">
                            <span>
                              Amount
                              {' '}
                              <span className="font-medium">{money(comp ? 0 : balanceAfterPayment > 0 ? balanceAfterPayment : totals?.totalDueCents ?? 0)}</span>
                            </span>
                            <button
                              type="button"
                              aria-label="Copy amount"
                              onClick={() => void copyToClipboard('amount', ((balanceAfterPayment > 0 ? balanceAfterPayment : totals?.totalDueCents ?? 0) / 100).toFixed(2))}
                              className="rounded-lg border border-neutral-200 p-1.5 text-neutral-600"
                            >
                              {copied === 'amount' ? <CheckCircle2 className="size-3.5 text-emerald-600" /> : <Copy className="size-3.5" />}
                            </button>
                          </div>
                          <div className="flex items-center justify-between gap-2">
                            <span>
                              Reference
                              {' '}
                              <span className="font-medium" data-testid="checkout-etransfer-reference">{context.paymentReference}</span>
                            </span>
                            <button
                              type="button"
                              aria-label="Copy reference"
                              onClick={() => void copyToClipboard('reference', context.paymentReference)}
                              className="rounded-lg border border-neutral-200 p-1.5 text-neutral-600"
                            >
                              {copied === 'reference' ? <CheckCircle2 className="size-3.5 text-emerald-600" /> : <Copy className="size-3.5" />}
                            </button>
                          </div>
                          {context.etransfer.autodepositEnabled && (
                            <div className="text-xs text-neutral-500">Autodeposit is on — no security question needed.</div>
                          )}
                          {context.etransfer.instructions && (
                            <div className="text-xs text-neutral-500">{context.etransfer.instructions}</div>
                          )}
                        </div>
                        {context.etransfer.qrPageEnabled && (
                          <div className="mt-3">
                            {qrDataUrl
                              ? (
                                  // eslint-disable-next-line @next/next/no-img-element -- data URL QR, no optimization needed
                                  <img src={qrDataUrl} alt="Payment instructions QR code" className="mx-auto size-40" data-testid="checkout-qr-image" />
                                )
                              : (
                                  <button
                                    type="button"
                                    data-testid="checkout-show-qr"
                                    disabled={qrLoading}
                                    onClick={() => void showQr()}
                                    className="inline-flex w-full items-center justify-center gap-2 rounded-xl border border-neutral-200 p-2.5 text-sm font-medium text-neutral-700 disabled:opacity-50"
                                  >
                                    <QrCode className="size-4" />
                                    {qrLoading ? 'Preparing…' : 'Show payment QR'}
                                  </button>
                                )}
                          </div>
                        )}
                      </div>
                    )}
                  </>
                )}
              </div>

              {/* Notes */}
              <div className={sectionCard}>
                <div className={sectionTitle}>Private note</div>
                <textarea
                  value={notes}
                  data-testid="checkout-notes"
                  onChange={event => setNotes(event.target.value)}
                  rows={2}
                  maxLength={2000}
                  placeholder="Only visible to your team"
                  className={inputClass}
                />
              </div>
            </div>
          )}

          {!loading && context && view === 'review' && totals && (
            <div className="space-y-4" data-testid="checkout-review">
              <div className={sectionCard}>
                <div className={sectionTitle}>Review</div>
                <div className="mb-3 space-y-1.5 text-sm text-neutral-700">
                  {items.map(item => (
                    <div key={item.key} className="flex justify-between">
                      <span>
                        {item.name || 'Custom item'}
                        {item.quantity > 1 ? ` × ${item.quantity}` : ''}
                      </span>
                      <span>{money(item.unitPriceCents * item.quantity)}</span>
                    </div>
                  ))}
                </div>
                {renderTotalsRows({ includePayment: true })}
                <div className="mt-3 space-y-1 border-t border-neutral-100 pt-3 text-xs text-neutral-500">
                  <div>
                    Scheduled
                    {' '}
                    {scheduledDuration}
                    {' '}
                    min
                    {actualDurationMinutes !== null ? ` · Actual ${actualDurationMinutes} min` : ' · Actual time not recorded'}
                  </div>
                  <div>
                    {hasAfterPhoto ? 'After photo added' : 'No after photo'}
                    {' · '}
                    {comp ? 'Complimentary' : paymentMethod ? `Paying by ${paymentMethod.replace('_', '-')}` : 'No payment method selected'}
                  </div>
                </div>
              </div>
            </div>
          )}

          {!loading && context && view === 'success' && (
            <div className="space-y-4" data-testid="checkout-success">
              <div className="flex flex-col items-center py-6 text-center">
                <CheckCircle2 className="size-12 text-emerald-600" />
                <div className="mt-2 text-lg font-semibold text-neutral-900">Appointment completed</div>
                <div className="text-sm text-neutral-500">
                  {context.appointment.clientName || 'Client'}
                  {' · '}
                  {money(context.balance.totalDueCents)}
                </div>
              </div>
              <div className={sectionCard}>
                <div className="space-y-1.5 text-sm text-neutral-700">
                  <div className="flex justify-between">
                    <span>Total</span>
                    <span>{money(context.balance.totalDueCents)}</span>
                  </div>
                  {(context.appointment.taxAmountCents ?? 0) > 0 && (
                    <div className="flex justify-between">
                      <span>
                        Includes
                        {' '}
                        {context.appointment.taxNameSnapshot ?? 'tax'}
                      </span>
                      <span>{money(context.appointment.taxAmountCents ?? 0)}</span>
                    </div>
                  )}
                  <div className="flex justify-between">
                    <span>Payment status</span>
                    <span className="font-medium capitalize" data-testid="checkout-success-status">
                      {(context.appointment.paymentStatus ?? 'paid').replace('_', ' ')}
                    </span>
                  </div>
                  {context.appointment.paymentMethod && (
                    <div className="flex justify-between">
                      <span>Method</span>
                      <span className="capitalize">{context.appointment.paymentMethod.replace('_', '-')}</span>
                    </div>
                  )}
                  <div className="flex justify-between font-medium">
                    <span>Remaining balance</span>
                    <span data-testid="checkout-success-balance">{money(context.balance.balanceCents)}</span>
                  </div>
                </div>
              </div>

              {context.balance.balanceCents > 0 && context.appointment.paymentStatus !== 'comp' && (
                <div className={sectionCard} data-testid="checkout-record-payment">
                  <div className={sectionTitle}>Record a payment</div>
                  <div className="flex flex-wrap gap-2 pb-3">
                    {PAYMENT_METHOD_OPTIONS.map(([value, label]) => (
                      <button
                        key={value}
                        type="button"
                        onClick={() => setPostPaymentMethod(current => (current === value ? null : value))}
                        className={`min-h-9 rounded-full px-3 py-1.5 text-xs font-medium ${postPaymentMethod === value ? 'bg-black text-white' : 'bg-neutral-100 text-neutral-600'}`}
                      >
                        {label}
                      </button>
                    ))}
                  </div>
                  <div className="flex gap-2">
                    <input
                      type="text"
                      inputMode="decimal"
                      value={postPaymentAmount}
                      onChange={event => setPostPaymentAmount(event.target.value.replace(/[^0-9.]/g, ''))}
                      placeholder={centsToInput(context.balance.balanceCents)}
                      className={`${inputClass} flex-1`}
                      aria-label="Payment amount"
                    />
                    <button
                      type="button"
                      disabled={recordingPayment}
                      onClick={() => {
                        if (!postPaymentAmount) {
                          setPostPaymentAmount(centsToInput(context.balance.balanceCents));
                        }
                        void recordPostPayment();
                      }}
                      className="rounded-xl px-4 py-3 text-sm font-semibold text-white disabled:opacity-50"
                      style={{ backgroundColor: themeVars.primary }}
                    >
                      {recordingPayment ? 'Recording…' : 'Record'}
                    </button>
                  </div>
                </div>
              )}

              <div className="grid grid-cols-2 gap-2">
                {onRebook && (
                  <button
                    type="button"
                    data-testid="checkout-success-rebook"
                    onClick={onRebook}
                    className="rounded-xl border border-neutral-200 p-3 text-sm font-medium text-neutral-900"
                  >
                    Rebook client
                  </button>
                )}
                {onViewClient && (
                  <button
                    type="button"
                    data-testid="checkout-success-view-client"
                    onClick={onViewClient}
                    className="rounded-xl border border-neutral-200 p-3 text-sm font-medium text-neutral-900"
                  >
                    View client
                  </button>
                )}
                <button
                  type="button"
                  data-testid="checkout-success-view-receipt"
                  onClick={() => setView('receipt')}
                  className="rounded-xl border border-neutral-200 p-3 text-sm font-medium text-neutral-900"
                >
                  View receipt
                </button>
                <button
                  type="button"
                  data-testid="checkout-success-close"
                  onClick={onClose}
                  className="rounded-xl border border-neutral-200 p-3 text-sm font-medium text-neutral-900"
                >
                  Close
                </button>
              </div>
              {successResult?.showReviewPrompt && (
                <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-800">
                  Tip: this client hasn't left a Google review yet — the review follow-up is available from their profile.
                </div>
              )}
            </div>
          )}

          {!loading && context && view === 'receipt' && renderReceipt()}
        </div>

        {/* Sticky action bar */}
        {context && (view === 'edit' || view === 'review') && totals && (
          <div
            className="sticky bottom-0 border-t border-neutral-200 bg-white px-4 pt-3 sm:px-5"
            style={{ paddingBottom: 'calc(env(safe-area-inset-bottom, 0px) + 0.75rem)' }}
          >
            <div className="flex items-center gap-3">
              <div className="min-w-0">
                <div className="text-xs uppercase tracking-[0.08em] text-neutral-400">Total</div>
                <div className="text-lg font-semibold" style={{ color: themeVars.primary }}>
                  {money(totals.totalDueCents)}
                </div>
              </div>
              {view === 'edit'
                ? (
                    <button
                      type="button"
                      data-testid="checkout-review-button"
                      disabled={submitting || isCompleted || Boolean(actualStart && actualEnd && new Date(actualEnd) < new Date(actualStart))}
                      onClick={() => setView('review')}
                      className="ml-auto flex-1 rounded-2xl px-4 py-3 text-sm font-semibold text-white disabled:opacity-50"
                      style={{ backgroundColor: themeVars.primary }}
                    >
                      Review
                    </button>
                  )
                : (
                    <button
                      type="button"
                      data-testid="checkout-complete-button"
                      disabled={submitting}
                      onClick={() => {
                        if (!hasAfterPhoto && photoPolicyMode !== 'required' && !skipPhotoConfirmed) {
                          setShowPhotoPrompt(true);
                          return;
                        }
                        void submitCompletion();
                      }}
                      className="ml-auto flex-1 rounded-2xl px-4 py-3 text-sm font-semibold text-white disabled:opacity-50"
                      style={{ backgroundColor: themeVars.primary }}
                    >
                      {submitting ? 'Completing…' : 'Complete appointment'}
                    </button>
                  )}
            </div>
          </div>
        )}
      </div>

      {/* Photo decision — a clear choice with a working uploader, not a dead end */}
      <ConfirmDialog
        isOpen={showPhotoPrompt}
        title="Add an after photo?"
        busy={submitting || uploadingPhoto}
        confirmLabel="Complete without photo"
        cancelLabel="Add photo"
        description="Save the finished set to the client's history."
        onClose={() => {
          setShowPhotoPrompt(false);
          setView('edit');
          setPendingPhotoType('after');
          fileInputRef.current?.click();
        }}
        onConfirm={() => {
          setShowPhotoPrompt(false);
          setSkipPhotoConfirmed(true);
          void submitCompletion({ skipPhoto: true });
        }}
      />
    </DialogShell>
  );
}
