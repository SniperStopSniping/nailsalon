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
import type { BookingTaxSnapshot, FinalTaxSnapshot } from '@/libs/taxConfig';
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

type DepositCreditSummary = {
  state: 'resolved' | 'blocked';
  blockedCode: string | null;
  blockedDetail?: string | null;
  collectedCents: number;
  refundedCents: number;
  eligibleCents: number;
};

type CheckoutBalance = {
  /** Gross service invoice before tip. Added by D6.1. */
  serviceInvoiceTotalCents?: number;
  totalDueCents: number;
  /** Non-voided appointment_payment rows only. */
  appointmentPaymentsCents?: number;
  depositCreditAppliedCents?: number;
  amountAlreadyPaidCents?: number;
  balanceCents: number;
  excessDepositCents?: number;
  tenderExcessCents?: number;
  legacyPaidAssumed?: boolean;
  /** Pre-D6.1 compatibility: this meant appointment payments only. */
  amountPaidCents?: number;
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
    discountAmountCents: number | null;
    discountLabel: string | null;
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
    bookingTaxSnapshot: BookingTaxSnapshot | null;
    rescheduleTaxSnapshot?: BookingTaxSnapshot | null;
    finalTaxSnapshot: FinalTaxSnapshot | null;
  };
  bookedItems: Array<Omit<CheckoutItem, 'key' | 'taxable'>>;
  finalItems: Array<Omit<CheckoutItem, 'key'> & { id: string }>;
  catalog: {
    services: Array<{ id: string; name: string; priceCents: number; durationMinutes: number }>;
    addOns: Array<{ id: string; name: string; priceCents: number; durationMinutes: number }>;
  };
  taxConfig: ResolvedTaxConfig;
  currency: string | null;
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
  balance: CheckoutBalance;
  /** Absent on an older server response means a resolved zero-credit deposit. */
  depositCredit?: DepositCreditSummary;
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

type DisplayTaxConfiguration = {
  enabled: boolean;
  label: string | null;
  rateBps: number;
  mode: 'included' | 'added';
  effectiveFrom: string | null;
};

function describeTaxConfiguration(configuration: DisplayTaxConfiguration): string {
  if (!configuration.enabled) {
    return 'tax disabled';
  }
  const precision = configuration.rateBps % 100 === 0 ? 0 : 2;
  const effective = configuration.effectiveFrom
    ? `, effective ${configuration.effectiveFrom}`
    : '';
  return `${configuration.label ?? 'Tax'} ${(configuration.rateBps / 100).toFixed(precision)}% (${configuration.mode}${effective})`;
}

function taxConfigurationChanged(
  booking: BookingTaxSnapshot | null | undefined,
  finalConfiguration: DisplayTaxConfiguration | null,
): { booking: string; final: string } | null {
  if (!booking || !finalConfiguration) {
    return null;
  }
  const bookingConfiguration: DisplayTaxConfiguration = {
    enabled: booking.configuration.enabled,
    label: booking.configuration.label,
    rateBps: booking.configuration.rateBps,
    mode: booking.configuration.mode,
    effectiveFrom: booking.configuration.configurationEffectiveFrom,
  };
  if (
    bookingConfiguration.enabled === finalConfiguration.enabled
    && bookingConfiguration.label === finalConfiguration.label
    && bookingConfiguration.rateBps === finalConfiguration.rateBps
    && bookingConfiguration.mode === finalConfiguration.mode
    && bookingConfiguration.effectiveFrom === finalConfiguration.effectiveFrom
  ) {
    return null;
  }
  return {
    booking: describeTaxConfiguration(bookingConfiguration),
    final: describeTaxConfiguration(finalConfiguration),
  };
}

// Preset options of the discount-reason <select>. A seeded booking-discount
// label (or a reopened custom reason) that isn't one of these is rendered as
// its own option so the select displays it instead of appearing blank.
const DISCOUNT_REASON_PRESETS = [
  '',
  'Added service',
  'Added nail art',
  'Repair',
  'Discount',
  'Price correction',
  'Complimentary item',
  'Custom',
];

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

function safeCents(value: number | null | undefined): number {
  return Number.isSafeInteger(value) && (value ?? 0) > 0 ? value! : 0;
}

type CheckoutFinancialBreakdown = {
  depositState: 'resolved' | 'blocked';
  depositBlockedCode: string | null;
  depositCollectedCents: number;
  depositRefundedCents: number;
  depositEligibleCents: number;
  appointmentPaymentsCents: number;
  depositCreditAppliedCents: number;
  amountAlreadyPaidCents: number;
  balanceCents: number;
  excessDepositCents: number;
  tenderExcessCents: number;
};

/**
 * Reprices only the balance side of an editable checkout. Deposit credit remains
 * a payment after tax (never a discount), while the live invoice total may move
 * as items, tax, discount, or tip are edited.
 */
function financialBreakdownForTotal(
  context: CheckoutContext,
  totalDueCents: number,
  serviceInvoiceTotalCents = context.balance.serviceInvoiceTotalCents ?? totalDueCents,
): CheckoutFinancialBreakdown {
  const total = safeCents(totalDueCents);
  const serviceInvoiceTotal = safeCents(serviceInvoiceTotalCents);
  const appointmentPaymentsCents = safeCents(
    context.balance.appointmentPaymentsCents ?? context.balance.amountPaidCents,
  );
  const serverAppliedCents = safeCents(context.balance.depositCreditAppliedCents);
  const depositCollectedCents = safeCents(
    context.depositCredit?.collectedCents ?? serverAppliedCents,
  );
  const depositRefundedCents = safeCents(context.depositCredit?.refundedCents);
  const depositEligibleCents = safeCents(
    context.depositCredit?.eligibleCents ?? serverAppliedCents,
  );
  const depositCreditAppliedCents = Math.min(
    depositEligibleCents,
    serviceInvoiceTotal,
  );
  const amountAlreadyPaidCents = appointmentPaymentsCents + depositCreditAppliedCents;

  return {
    depositState: context.depositCredit?.state ?? 'resolved',
    depositBlockedCode: context.depositCredit?.blockedCode ?? null,
    depositCollectedCents,
    depositRefundedCents,
    depositEligibleCents,
    appointmentPaymentsCents,
    depositCreditAppliedCents,
    amountAlreadyPaidCents,
    balanceCents: Math.max(0, total - amountAlreadyPaidCents),
    // The server excess belongs to the persisted invoice. Once the checkout
    // draft is repriced, carrying that old value forward can strand a valid
    // deposit even after performed work raises the service invoice. The
    // completion route revalidates this live result under lock.
    excessDepositCents: Math.max(
      0,
      depositEligibleCents - depositCreditAppliedCents,
    ),
    tenderExcessCents: Math.max(0, amountAlreadyPaidCents - total),
  };
}

function blockedDepositCopy(code: string | null): string {
  if (!code) {
    return 'Deposit credit needs review before this appointment can be completed.';
  }
  const detail = code.replaceAll('_', ' ').toLowerCase();
  return `Deposit credit needs review (${detail}) before this appointment can be completed.`;
}

type CheckoutDraftFields = {
  items: CheckoutItem[];
  discountInput: string;
  discountReason: string;
  tipInput: string;
  taxExempt: boolean;
  taxExemptReason: string;
  actualStart: string;
  actualEnd: string;
  amountReceivedCents: number;
  paymentMethod: string | null;
  paymentRefInput: string;
  comp: boolean;
  notes: string;
};

function checkoutDraftSignature(fields: CheckoutDraftFields): string {
  return JSON.stringify({
    items: fields.items.map(item => ({
      kind: item.kind,
      catalogServiceId: item.catalogServiceId,
      catalogAddOnId: item.catalogAddOnId,
      name: item.name,
      quantity: item.quantity,
      unitPriceCents: item.unitPriceCents,
      durationMinutes: item.durationMinutes,
      taxable: item.taxable,
    })),
    discountCents: inputToCents(fields.discountInput),
    discountReason: fields.discountReason.trim(),
    tipCents: inputToCents(fields.tipInput),
    taxExempt: fields.taxExempt,
    taxExemptReason: fields.taxExemptReason.trim(),
    actualStart: fields.actualStart,
    actualEnd: fields.actualEnd,
    amountReceivedCents: fields.amountReceivedCents,
    paymentMethod: fields.paymentMethod,
    paymentReference: fields.paymentRefInput.trim(),
    comp: fields.comp,
    notes: fields.notes.trim(),
  });
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
  const [initialDraftSignature, setInitialDraftSignature] = useState<string | null>(null);
  const [showDiscardPrompt, setShowDiscardPrompt] = useState(false);
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
  const postPaymentIdempotencyRef = useRef<{
    signature: string;
    key: string;
  } | null>(null);

  const apiPath = useCallback((path: string) => (
    salonSlug ? `${path}?salonSlug=${encodeURIComponent(salonSlug)}` : path
  ), [salonSlug]);

  const seedFromContext = useCallback((data: CheckoutContext) => {
    const source = data.finalItems.length > 0 ? data.finalItems : data.bookedItems;
    const seededItems = source.map(item => ({
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
    }));
    let seededDiscountInput = '';
    let seededDiscountReason = '';
    if (data.appointment.finalDiscountCents != null) {
      // A prior itemized checkout already recorded a discount decision
      // (including an explicit 0) — honor it verbatim on reopen.
      seededDiscountInput = data.appointment.finalDiscountCents ? centsToInput(data.appointment.finalDiscountCents) : '';
      seededDiscountReason = data.appointment.finalDiscountReason ?? '';
    } else {
      // First itemized checkout: carry the booking-time discount
      // (first-visit / reward / campaign snapshot) into the sheet so it is
      // never silently dropped from the recomputed totals.
      const bookedDiscountCents = data.appointment.discountAmountCents ?? 0;
      seededDiscountInput = bookedDiscountCents > 0 ? centsToInput(bookedDiscountCents) : '';
      seededDiscountReason = bookedDiscountCents > 0 ? (data.appointment.discountLabel ?? 'Booked discount') : '';
    }
    const seededTipInput = data.appointment.tipCents ? centsToInput(data.appointment.tipCents) : '';
    const seededTaxExempt = data.appointment.taxExempt ?? false;
    const seededTaxExemptReason = data.appointment.taxExemptReason ?? '';
    const seededActualStart = toDatetimeLocal(data.appointment.actualStartAt ?? data.appointment.startedAt ?? data.appointment.startTime);
    const seededActualEnd = toDatetimeLocal(data.appointment.actualEndAt);
    const seededTotals = computeCheckoutTotals({
      items: seededItems.map(item => ({
        lineTotalCents: item.unitPriceCents * item.quantity,
        taxable: item.taxable,
      })),
      discountCents: inputToCents(seededDiscountInput),
      taxConfig: data.taxConfig,
      taxExempt: seededTaxExempt,
      tipCents: inputToCents(seededTipInput),
    });
    const seededFinancials = financialBreakdownForTotal(
      data,
      seededTotals.totalDueCents,
      seededTotals.finalPriceCents + seededTotals.taxAmountCents,
    );

    setItems(seededItems);
    setDiscountInput(seededDiscountInput);
    setDiscountReason(seededDiscountReason);
    setTipInput(seededTipInput);
    setTaxExempt(seededTaxExempt);
    setTaxExemptReason(seededTaxExemptReason);
    setActualStart(seededActualStart);
    setActualEnd(seededActualEnd);
    setAmountReceivedInput('');
    setAmountTouched(false);
    setPaymentMethod(data.appointment.paymentMethod);
    setPaymentRefInput('');
    setComp(false);
    setNotes('');
    setSkipPhotoConfirmed(false);
    setInitialDraftSignature(checkoutDraftSignature({
      items: seededItems,
      discountInput: seededDiscountInput,
      discountReason: seededDiscountReason,
      tipInput: seededTipInput,
      taxExempt: seededTaxExempt,
      taxExemptReason: seededTaxExemptReason,
      actualStart: seededActualStart,
      actualEnd: seededActualEnd,
      amountReceivedCents: seededFinancials.balanceCents,
      paymentMethod: data.appointment.paymentMethod,
      paymentRefInput: '',
      comp: false,
      notes: '',
    }));
  }, []);

  const fetchContext = useCallback(async (seedDraft = true) => {
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
      if (seedDraft) {
        seedFromContext(result.data);
      }
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
      setShowDiscardPrompt(false);
      setInitialDraftSignature(null);
      void fetchContext(true);
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

  const liveFinancials = useMemo(() => (
    context && totals
      ? financialBreakdownForTotal(
          context,
          totals.totalDueCents,
          totals.finalPriceCents + totals.taxAmountCents,
        )
      : null
  ), [context, totals]);

  const balanceBeforeNewPaymentCents = liveFinancials?.balanceCents ?? 0;

  const amountReceivedCents = comp
    ? 0
    : amountTouched
      ? inputToCents(amountReceivedInput)
      : balanceBeforeNewPaymentCents;
  const paymentNowCents = comp
    ? 0
    : Math.min(amountReceivedCents, balanceBeforeNewPaymentCents);

  const currentDraftSignature = useMemo(() => checkoutDraftSignature({
    items,
    discountInput,
    discountReason,
    tipInput,
    taxExempt,
    taxExemptReason,
    actualStart,
    actualEnd,
    amountReceivedCents,
    paymentMethod,
    paymentRefInput,
    comp,
    notes,
  }), [items, discountInput, discountReason, tipInput, taxExempt, taxExemptReason, actualStart, actualEnd, amountReceivedCents, paymentMethod, paymentRefInput, comp, notes]);

  const hasUnsavedChanges = initialDraftSignature !== null
    && currentDraftSignature !== initialDraftSignature;

  const requestClose = useCallback(() => {
    if (submitting) {
      return;
    }
    if ((view === 'edit' || view === 'review') && hasUnsavedChanges) {
      setShowDiscardPrompt(true);
      return;
    }
    onClose();
  }, [hasUnsavedChanges, onClose, submitting, view]);

  const hasAfterPhoto = context?.photos.some(photo => photo.photoType === 'after') ?? false;
  const photoPolicyMode = context?.photoPolicy.requireAfterPhotoToFinish ?? 'off';
  const currency = context?.currency ?? null;

  const money = useCallback(
    (cents: number) => currency ? formatMoney(cents, currency) : 'Unavailable',
    [currency],
  );
  const excessDepositCents = comp
    ? Math.max(
        liveFinancials?.excessDepositCents ?? 0,
        liveFinancials?.depositEligibleCents ?? 0,
      )
    : liveFinancials?.excessDepositCents ?? 0;
  const financialBlockReason = context && !currency
    ? 'This historical appointment has no frozen invoice currency. Reconcile it before taking payment or completing the appointment.'
    : liveFinancials?.depositState === 'blocked'
      ? blockedDepositCopy(liveFinancials.depositBlockedCode)
      : excessDepositCents > 0
        ? `The eligible deposit exceeds this invoice by ${money(excessDepositCents)}. Resolve the excess before completing the appointment.`
        : (liveFinancials?.tenderExcessCents ?? 0) > 0
            ? `Collected payments exceed this invoice by ${money(liveFinancials?.tenderExcessCents ?? 0)}. Reconcile the overpayment before completing the appointment.`
            : null;
  const financialBlocked = financialBlockReason !== null;

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
      await fetchContext(false);
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
      await fetchContext(false);
    } catch (removeError) {
      setError(removeError instanceof Error ? removeError.message : 'Could not remove the photo');
    }
  }, [apiPath, appointmentId, fetchContext]);

  const showQr = useCallback(async () => {
    if (!appointmentId) {
      return;
    }
    if (context?.appointment.status !== 'completed') {
      setError('Complete the appointment to finalize its invoice before creating a payment QR.');
      return;
    }
    if (financialBlockReason) {
      setError(financialBlockReason);
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
  }, [apiPath, appointmentId, context?.appointment.status, financialBlockReason]);

  const submitCompletion = useCallback(async (options: { skipPhoto?: boolean } = {}) => {
    if (!appointmentId || !context || !totals) {
      return;
    }
    if (financialBlockReason) {
      setError(financialBlockReason);
      return;
    }
    try {
      setSubmitting(true);
      setError(null);
      const payments = paymentNowCents > 0
        ? [{
            amountCents: paymentNowCents,
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
          await fetchContext(true);
          return;
        }
        throw new Error(result?.error?.message ?? 'Unable to complete appointment');
      }
      setSuccessResult({ showReviewPrompt: Boolean(result?.data?.showReviewPrompt) });
      setView('success');
      await fetchContext(false);
      onCompleted?.({ showReviewPrompt: Boolean(result?.data?.showReviewPrompt) });
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : 'Unable to complete appointment');
    } finally {
      setSubmitting(false);
    }
  }, [apiPath, appointmentId, context, totals, financialBlockReason, paymentNowCents, items, discountInput, discountReason, tipInput, taxExempt, taxExemptReason, actualStart, actualEnd, comp, paymentMethod, paymentRefInput, notes, skipPhotoConfirmed, fetchContext, onCompleted]);

  const recordPostPayment = useCallback(async (requestedAmount = postPaymentAmount) => {
    if (!appointmentId || !context) {
      return;
    }
    const persistedFinancials = financialBreakdownForTotal(
      context,
      context.balance.totalDueCents,
    );
    if (
      persistedFinancials.depositState === 'blocked'
      || persistedFinancials.excessDepositCents > 0
      || persistedFinancials.tenderExcessCents > 0
    ) {
      setError(
        persistedFinancials.depositState === 'blocked'
          ? blockedDepositCopy(persistedFinancials.depositBlockedCode)
          : persistedFinancials.excessDepositCents > 0
            ? `The eligible deposit exceeds this invoice by ${money(persistedFinancials.excessDepositCents)}. Resolve the excess before recording another payment.`
            : `Collected payments exceed this invoice by ${money(persistedFinancials.tenderExcessCents)}. Reconcile the overpayment before recording another payment.`,
      );
      return;
    }
    const amountCents = Math.min(
      inputToCents(requestedAmount),
      persistedFinancials.balanceCents,
    );
    if (amountCents <= 0) {
      return;
    }
    const paymentSignature = `${amountCents}:${postPaymentMethod ?? ''}`;
    if (postPaymentIdempotencyRef.current?.signature !== paymentSignature) {
      postPaymentIdempotencyRef.current = {
        signature: paymentSignature,
        key: `checkout-payment-${crypto.randomUUID()}`,
      };
    }
    const idempotencyKey = postPaymentIdempotencyRef.current.key;
    try {
      setRecordingPayment(true);
      setError(null);
      const response = await fetch(apiPath(`/api/appointments/${appointmentId}/payments`), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          amountCents,
          idempotencyKey,
          ...(postPaymentMethod ? { method: postPaymentMethod } : {}),
        }),
      });
      const result = await response.json().catch(() => null);
      if (!response.ok) {
        throw new Error(result?.error?.message ?? 'Could not record the payment');
      }
      setPostPaymentAmount('');
      postPaymentIdempotencyRef.current = null;
      await fetchContext(false);
    } catch (paymentError) {
      setError(paymentError instanceof Error ? paymentError.message : 'Could not record the payment');
    } finally {
      setRecordingPayment(false);
    }
  }, [apiPath, appointmentId, context, postPaymentAmount, postPaymentMethod, fetchContext, money]);

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

  const balanceAfterPayment = comp
    ? 0
    : Math.max(0, balanceBeforeNewPaymentCents - paymentNowCents);

  const isCompleted = context?.appointment.status === 'completed';
  const persistedFinancials = context
    ? financialBreakdownForTotal(context, context.balance.totalDueCents)
    : null;

  const renderTotalsRows = (options: { includePayment: boolean }) => {
    if (!totals || !context || !liveFinancials) {
      return null;
    }
    const taxLabel = context.taxConfig.enabled
      ? `${context.taxConfig.name ?? 'Tax'} (${(context.taxConfig.rateBps / 100).toFixed(context.taxConfig.rateBps % 100 === 0 ? 0 : 2)}%)`
      : 'Tax';
    const taxChange = taxConfigurationChanged(
      context.appointment.rescheduleTaxSnapshot
      ?? context.appointment.bookingTaxSnapshot,
      {
        enabled: context.taxConfig.enabled,
        label: context.taxConfig.name,
        rateBps: context.taxConfig.rateBps,
        mode: context.taxConfig.pricesIncludeTax ? 'included' : 'added',
        effectiveFrom: context.taxConfig.configurationEffectiveFrom,
      },
    );
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
        {taxChange && (
          <div
            data-testid="checkout-tax-configuration-change"
            className="rounded-xl border border-sky-200 bg-sky-50 p-3 text-xs leading-5 text-sky-950"
          >
            Booking estimate:
            {' '}
            {taxChange.booking}
            . Final invoice:
            {' '}
            {taxChange.final}
            . Tax is calculated before the deposit payment credit.
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
        {liveFinancials.depositCollectedCents > 0 && (
          <div className="flex justify-between text-neutral-700">
            <span>Deposit paid</span>
            <span data-testid="checkout-deposit-paid">{money(liveFinancials.depositCollectedCents)}</span>
          </div>
        )}
        {liveFinancials.depositRefundedCents > 0 && (
          <div className="flex justify-between text-neutral-700">
            <span>Deposit refunded</span>
            <span data-testid="checkout-deposit-refunded">
              −
              {money(liveFinancials.depositRefundedCents)}
            </span>
          </div>
        )}
        {(options.includePayment || liveFinancials.appointmentPaymentsCents > 0) && (
          <div className="flex justify-between">
            <span>Other payments</span>
            <span data-testid="checkout-other-payments">{money(liveFinancials.appointmentPaymentsCents)}</span>
          </div>
        )}
        {(options.includePayment
          || liveFinancials.depositCollectedCents > 0
          || liveFinancials.appointmentPaymentsCents > 0) && (
          <div className="flex justify-between font-medium">
            <span>Already paid</span>
            <span data-testid="checkout-already-paid">{money(liveFinancials.amountAlreadyPaidCents)}</span>
          </div>
        )}
        {options.includePayment && !comp && (
          <>
            <div className="flex justify-between">
              <span>Receiving now</span>
              <span data-testid="checkout-receiving-now">{money(paymentNowCents)}</span>
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
        {financialBlockReason && (
          <div
            data-testid="checkout-deposit-block"
            className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm font-medium text-amber-900"
            role="alert"
          >
            {financialBlockReason}
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
    const receiptFinancials = financialBreakdownForTotal(context, totalDue);
    const receiptDepositBlocked = receiptFinancials.depositState === 'blocked'
      || receiptFinancials.excessDepositCents > 0
      || receiptFinancials.tenderExcessCents > 0;
    const finalSnapshot = appt.finalTaxSnapshot;
    const receiptTaxEnabled = finalSnapshot
      ? finalSnapshot.configuration.enabled
      : appt.taxEnabledSnapshot;
    const receiptTaxName = finalSnapshot
      ? finalSnapshot.configuration.label
      : appt.taxNameSnapshot;
    const receiptTaxRateBps = finalSnapshot
      ? finalSnapshot.configuration.rateBps
      : (appt.taxRateBps ?? 0);
    const receiptTaxIncluded = finalSnapshot
      ? finalSnapshot.configuration.mode === 'included'
      : Boolean(appt.taxInclusive);
    const receiptTaxExempt = finalSnapshot
      ? finalSnapshot.taxExempt
      : Boolean(appt.taxExempt);
    const receiptTaxAmountCents = finalSnapshot
      ? finalSnapshot.taxAmountCents
      : (appt.taxAmountCents ?? 0);
    const taxChange = taxConfigurationChanged(
      appt.rescheduleTaxSnapshot ?? appt.bookingTaxSnapshot,
      finalSnapshot
        ? {
            enabled: finalSnapshot.configuration.enabled,
            label: finalSnapshot.configuration.label,
            rateBps: finalSnapshot.configuration.rateBps,
            mode: finalSnapshot.configuration.mode,
            effectiveFrom: finalSnapshot.configuration.configurationEffectiveFrom,
          }
        : null,
    );
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
            {receiptTaxEnabled && (
              <div className="flex justify-between" data-testid="checkout-receipt-tax-line">
                <span>
                  {receiptTaxName ?? 'Tax'}
                  {' '}
                  (
                  {(receiptTaxRateBps / 100).toFixed(receiptTaxRateBps % 100 === 0 ? 0 : 2)}
                  %
                  {receiptTaxIncluded ? ', included' : ''}
                  {receiptTaxExempt ? ', exempt' : ''}
                  )
                </span>
                <span>{money(receiptTaxAmountCents)}</span>
              </div>
            )}
            {taxChange && (
              <div
                data-testid="checkout-receipt-tax-configuration-change"
                className="rounded-xl border border-sky-200 bg-sky-50 p-3 text-xs leading-5 text-sky-950"
              >
                Booking estimate:
                {' '}
                {taxChange.booking}
                . Final invoice:
                {' '}
                {taxChange.final}
                . The booking estimate was preserved; the final invoice used the configuration effective when issued.
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
            {receiptFinancials.depositCollectedCents > 0 && (
              <div className="flex justify-between">
                <span>Deposit paid</span>
                <span data-testid="checkout-receipt-deposit-paid">{money(receiptFinancials.depositCollectedCents)}</span>
              </div>
            )}
            {receiptFinancials.depositRefundedCents > 0 && (
              <div className="flex justify-between">
                <span>Deposit refunded</span>
                <span data-testid="checkout-receipt-deposit-refunded">
                  −
                  {money(receiptFinancials.depositRefundedCents)}
                </span>
              </div>
            )}
            {receiptDepositBlocked
              ? (
                  <div
                    data-testid="checkout-receipt-financial-review"
                    className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm font-medium text-amber-900"
                    role="alert"
                  >
                    Payment totals are under review while the deposit or refund is reconciled. Already-paid and balance amounts will appear once the review is complete.
                  </div>
                )
              : (
                  <>
                    <div className="flex justify-between">
                      <span>Other payments</span>
                      <span data-testid="checkout-receipt-other-payments">{money(receiptFinancials.appointmentPaymentsCents)}</span>
                    </div>
                    <div className="flex justify-between font-medium">
                      <span>Already paid</span>
                      <span data-testid="checkout-receipt-already-paid">{money(receiptFinancials.amountAlreadyPaidCents)}</span>
                    </div>
                    <div className="flex justify-between font-medium">
                      <span>Balance</span>
                      <span data-testid="checkout-receipt-balance">{money(receiptFinancials.balanceCents)}</span>
                    </div>
                  </>
                )}
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
      onClose={requestClose}
      closeOnBackdrop={!submitting}
      closeOnEscape={!submitting}
      maxWidthClassName="w-full sm:h-full sm:max-w-lg"
      alignClassName="items-end justify-center bg-black/50 p-0 sm:items-stretch sm:justify-end"
      contentClassName="flex h-[92vh] max-h-[92vh] min-h-0 flex-col overflow-hidden rounded-t-3xl bg-white shadow-2xl supports-[height:100dvh]:h-[92dvh] supports-[height:100dvh]:max-h-[92dvh] sm:ml-auto sm:h-full sm:max-h-none sm:rounded-none sm:rounded-l-3xl sm:supports-[height:100dvh]:h-full sm:supports-[height:100dvh]:max-h-none"
    >
      <div data-testid="checkout-sheet" className="flex min-h-0 flex-1 flex-col">
        {/* Header */}
        <div className="flex shrink-0 items-center justify-between border-b border-neutral-100 px-4 pb-3 pt-4 sm:px-5">
          <div>
            <div className="text-lg font-semibold text-neutral-900">
              {view === 'success' ? 'Appointment completed' : view === 'receipt' ? 'Receipt' : 'Complete appointment'}
            </div>
            <div className="text-sm text-neutral-500">
              {context?.appointment.clientName || 'Checkout'}
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              data-testid="checkout-close"
              aria-label="Close checkout"
              disabled={submitting}
              onClick={requestClose}
              className="rounded-full p-2 text-neutral-400 transition-colors hover:bg-neutral-100 hover:text-neutral-700"
            >
              ×
            </button>
          </div>
        </div>

        {/* Body */}
        <div
          data-testid="checkout-scroll-region"
          className="min-h-0 flex-1 touch-pan-y overflow-y-auto overscroll-contain px-4 pt-4 sm:px-5"
          style={{ paddingBottom: 'calc(env(safe-area-inset-bottom, 0px) + 1rem)' }}
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
                      {discountReason !== '' && !DISCOUNT_REASON_PRESETS.includes(discountReason) && (
                        <option value={discountReason}>{discountReason}</option>
                      )}
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
                        value={amountTouched ? amountReceivedInput : centsToInput(balanceBeforeNewPaymentCents)}
                        onChange={(event) => {
                          setAmountTouched(true);
                          setAmountReceivedInput(event.target.value.replace(/[^0-9.]/g, ''));
                        }}
                        className={inputClass}
                      />
                    </label>
                    <div className="mt-1 text-xs text-neutral-500">
                      Enter less for a partial payment, or 0 to record it later. Luster will never record more than the balance due.
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
                              disabled={financialBlocked}
                              onClick={() => void copyToClipboard('recipient', context.etransfer.recipient ?? '')}
                              className="rounded-lg border border-neutral-200 p-1.5 text-neutral-600 disabled:opacity-40"
                            >
                              {copied === 'recipient' ? <CheckCircle2 className="size-3.5 text-emerald-600" /> : <Copy className="size-3.5" />}
                            </button>
                          </div>
                          <div className="flex items-center justify-between gap-2">
                            <span>
                              Amount
                              {' '}
                              <span className="font-medium">{money(paymentNowCents)}</span>
                            </span>
                            <button
                              type="button"
                              aria-label="Copy amount"
                              data-testid="checkout-copy-amount"
                              disabled={financialBlocked || paymentNowCents <= 0}
                              onClick={() => void copyToClipboard('amount', (paymentNowCents / 100).toFixed(2))}
                              className="rounded-lg border border-neutral-200 p-1.5 text-neutral-600 disabled:opacity-40"
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
                              disabled={financialBlocked}
                              onClick={() => void copyToClipboard('reference', context.paymentReference)}
                              className="rounded-lg border border-neutral-200 p-1.5 text-neutral-600 disabled:opacity-40"
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
                                    disabled={qrLoading
                                    || financialBlocked
                                    || balanceBeforeNewPaymentCents <= 0
                                    || context.appointment.status !== 'completed'}
                                    onClick={() => void showQr()}
                                    className="inline-flex w-full items-center justify-center gap-2 rounded-xl border border-neutral-200 p-2.5 text-sm font-medium text-neutral-700 disabled:opacity-50"
                                  >
                                    <QrCode className="size-4" />
                                    {qrLoading
                                      ? 'Preparing…'
                                      : context.appointment.status === 'completed'
                                        ? 'Show payment QR'
                                        : 'Complete appointment for QR'}
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
                  {(persistedFinancials?.depositCollectedCents ?? 0) > 0 && (
                    <div className="flex justify-between">
                      <span>Deposit paid</span>
                      <span data-testid="checkout-success-deposit-paid">
                        {money(persistedFinancials?.depositCollectedCents ?? 0)}
                      </span>
                    </div>
                  )}
                  {(persistedFinancials?.depositRefundedCents ?? 0) > 0 && (
                    <div className="flex justify-between">
                      <span>Deposit refunded</span>
                      <span data-testid="checkout-success-deposit-refunded">
                        −
                        {money(persistedFinancials?.depositRefundedCents ?? 0)}
                      </span>
                    </div>
                  )}
                  <div className="flex justify-between">
                    <span>Other payments</span>
                    <span data-testid="checkout-success-other-payments">
                      {money(persistedFinancials?.appointmentPaymentsCents ?? 0)}
                    </span>
                  </div>
                  <div className="flex justify-between font-medium">
                    <span>Already paid</span>
                    <span data-testid="checkout-success-already-paid">
                      {money(persistedFinancials?.amountAlreadyPaidCents ?? 0)}
                    </span>
                  </div>
                  <div className="flex justify-between font-medium">
                    <span>Remaining balance</span>
                    <span data-testid="checkout-success-balance">
                      {money(persistedFinancials?.balanceCents ?? 0)}
                    </span>
                  </div>
                </div>
              </div>

              {(persistedFinancials?.balanceCents ?? 0) > 0
              && persistedFinancials?.depositState !== 'blocked'
              && persistedFinancials?.excessDepositCents === 0
              && persistedFinancials?.tenderExcessCents === 0
              && context.appointment.paymentStatus !== 'comp' && (
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
                      placeholder={centsToInput(persistedFinancials?.balanceCents ?? 0)}
                      className={`${inputClass} flex-1`}
                      aria-label="Payment amount"
                    />
                    <button
                      type="button"
                      disabled={recordingPayment}
                      onClick={() => {
                        const requestedAmount = postPaymentAmount
                          || centsToInput(persistedFinancials?.balanceCents ?? 0);
                        setPostPaymentAmount(requestedAmount);
                        void recordPostPayment(requestedAmount);
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

        {/* Action bar stays outside the dedicated scroll region. */}
        {context && (view === 'edit' || view === 'review') && totals && (
          <div
            data-testid="checkout-action-bar"
            className="shrink-0 border-t border-neutral-200 bg-white px-4 pt-3 sm:px-5"
            style={{ paddingBottom: 'calc(env(safe-area-inset-bottom, 0px) + 0.75rem)' }}
          >
            <div className="flex items-center gap-3">
              <div className="min-w-0">
                <div className="text-xs uppercase tracking-[0.08em] text-neutral-400">
                  {view === 'review' ? 'Balance after payment' : 'Balance due'}
                </div>
                <div className="text-lg font-semibold" style={{ color: themeVars.primary }}>
                  {money(view === 'review' ? balanceAfterPayment : balanceBeforeNewPaymentCents)}
                </div>
              </div>
              {view === 'edit'
                ? (
                    <div className="ml-auto flex min-w-0 flex-[1.8] gap-2">
                      <button
                        type="button"
                        data-testid="checkout-cancel"
                        disabled={submitting}
                        onClick={requestClose}
                        className="rounded-2xl border border-neutral-200 p-3 text-sm font-medium text-neutral-700 disabled:opacity-50"
                      >
                        Cancel
                      </button>
                      <button
                        type="button"
                        data-testid="checkout-review-button"
                        disabled={submitting || financialBlocked || isCompleted || Boolean(actualStart && actualEnd && new Date(actualEnd) < new Date(actualStart))}
                        onClick={() => setView('review')}
                        className="min-w-0 flex-1 rounded-2xl px-4 py-3 text-sm font-semibold text-white disabled:opacity-50"
                        style={{ backgroundColor: themeVars.primary }}
                      >
                        Review
                      </button>
                    </div>
                  )
                : (
                    <div className="ml-auto flex min-w-0 flex-[2.2] gap-2">
                      <button
                        type="button"
                        data-testid="checkout-back"
                        disabled={submitting || financialBlocked}
                        onClick={() => setView('edit')}
                        className="rounded-2xl border border-neutral-200 p-3 text-sm font-medium text-neutral-700 disabled:opacity-50"
                      >
                        Back
                      </button>
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
                        className="min-w-0 flex-1 rounded-2xl p-3 text-sm font-semibold text-white disabled:opacity-50"
                        style={{ backgroundColor: themeVars.primary }}
                      >
                        {submitting ? 'Completing…' : 'Complete appointment'}
                      </button>
                    </div>
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

      <ConfirmDialog
        isOpen={showDiscardPrompt}
        title="Discard checkout changes?"
        description="Your checkout changes haven't been saved. Return to the appointment without completing?"
        confirmLabel="Discard changes"
        cancelLabel="Keep editing"
        tone="danger"
        onClose={() => setShowDiscardPrompt(false)}
        onConfirm={() => {
          setShowDiscardPrompt(false);
          onClose();
        }}
      />
    </DialogShell>
  );
}
