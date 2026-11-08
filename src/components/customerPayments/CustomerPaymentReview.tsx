'use client';

import { useEffect, useRef, useState } from 'react';

import type { CustomerPaymentCreditReviewPreview, CustomerPaymentCreditReviewRequest } from '@/libs/customerPayments/creditReviewContract';
import { customerPaymentCreditReviewPreviewSchema, customerPaymentCreditReviewResultSchema } from '@/libs/customerPayments/creditReviewContract';
import { formatMoney } from '@/libs/formatMoney';

import { CustomerPaymentReviewView } from './CustomerPaymentReviewView';

function cents(value: string): number | null {
  if (!/^\d+(?:\.\d{1,2})?$/.test(value.trim())) {
    return null;
  }
  const result = Math.round(Number(value) * 100);
  return Number.isSafeInteger(result) && result <= 50_000_000 ? result : null;
}

export function CustomerPaymentReview({ salonSlug, appointmentId }: { salonSlug: string;appointmentId: string }) {
  const url = `/api/admin/appointments/${encodeURIComponent(appointmentId)}/customer-payment-review?salonSlug=${encodeURIComponent(salonSlug)}`;
  const [preview, setPreview] = useState<CustomerPaymentCreditReviewPreview | null>(null);
  const [service, setService] = useState('');
  const [tax, setTax] = useState('');
  const [reason, setReason] = useState('');
  const [acknowledged, setAcknowledged] = useState(false);
  const [busy, setBusy] = useState(false);
  const [uncertain, setUncertain] = useState(false);
  const [recorded, setRecorded] = useState(false);
  const [message, setMessage] = useState('');
  const inFlight = useRef(false);
  const pending = useRef<CustomerPaymentCreditReviewRequest | null>(null);
  const generation = useRef(0);
  const controller = useRef<AbortController | null>(null);
  useEffect(() => {
    generation.current += 1;
    setPreview(null);
    pending.current = null;
    setUncertain(false);
    setRecorded(false);
    setBusy(false);
    inFlight.current = false;
    return () => {
      generation.current += 1;
      controller.current?.abort();
    };
  }, [url]);

  async function run(save: boolean) {
    if (inFlight.current || (!save && uncertain)) {
      return;
    }
    let body = pending.current;
    if (save && !body) {
      const serviceCreditCents = cents(service);
      const taxCreditCents = cents(tax);
      if (!preview || !acknowledged || !reason.trim() || serviceCreditCents === null || taxCreditCents === null) {
        return;
      }
      body = { requestId: crypto.randomUUID(), expectedEvidenceRevision: preview.evidenceRevision, reason: reason.trim(), serviceCreditCents, taxCreditCents, tipCreditCents: preview.refunded.tipCents };
      pending.current = body;
    }
    const current = generation.current;
    inFlight.current = true;
    setBusy(true);
    setMessage('');
    const abort = new AbortController();
    controller.current = abort;
    const timer = setTimeout(() => abort.abort(), 20000);
    try {
      const response = await fetch(url, { method: save ? 'POST' : 'GET', cache: 'no-store', signal: abort.signal, ...(save ? { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : {}) });
      if (current !== generation.current) {
        return;
      }
      if (!response.ok) {
        if (response.status >= 500) {
          throw new Error('uncertain');
        }
        pending.current = null;
        setUncertain(false);
        setPreview(null);
        setRecorded(false);
        setMessage(response.status === 409 ? 'Evidence changed or is not eligible. Reload and review all amounts before another test decision.' : 'This test review is unavailable. Check owner access and reload.');
        return;
      }
      const json: unknown = await response.json();
      if (current !== generation.current) {
        return;
      }
      if (save) {
        const result = customerPaymentCreditReviewResultSchema.parse(json);
        pending.current = null;
        setUncertain(false);
        setRecorded(result.evidenceMatchesCurrent);
        setPreview(previous => result.evidenceMatchesCurrent && previous ? { ...previous, decision: result.decision } : null);
        setMessage(result.evidenceMatchesCurrent ? 'Test decision recorded. Ordinary appointment actions remain blocked.' : 'This earlier test decision was recorded, but the evidence has changed. Reload for a new review. Ordinary actions remain blocked.');
      } else {
        const result = customerPaymentCreditReviewPreviewSchema.parse(json);
        setPreview(result);
        setService('');
        setTax('');
        setReason(result.resolution ? result.decision?.reason ?? '' : '');
        setAcknowledged(false);
        setRecorded(result.resolution !== null);
        pending.current = null;
      }
    } catch {
      if (current !== generation.current) {
        return;
      }
      if (save) {
        setUncertain(true);
        setMessage('The save could not be confirmed. Retry the same request.');
      } else {
        setPreview(null);
        setMessage('Could not load this test review. Try again.');
      }
    } finally {
      clearTimeout(timer);
      if (current === generation.current) {
        inFlight.current = false;
        setBusy(false);
      }
    }
  }
  const serviceCents = cents(service);
  const taxCents = cents(tax);
  const validAllocation = preview !== null && serviceCents !== null && taxCents !== null
    && serviceCents >= preview.previousCredit.serviceCreditCents && serviceCents <= preview.original.serviceCents
    && taxCents >= preview.previousCredit.taxCreditCents && taxCents <= preview.original.taxCents
    && serviceCents + taxCents === preview.refunded.principalCents;
  const creditTotal = preview?.resolution?.credit.totalCents ?? (serviceCents ?? 0) + (taxCents ?? 0) + (preview?.refunded.tipCents ?? 0);
  return (
    <div className="space-y-4">
      <h1 className="text-xl font-semibold">Synthetic credit-note review</h1>
      <p>This is a non-legal test record, not a customer invoice or real refund workflow. No providers are contacted. No money will be returned. Ordinary appointment actions remain blocked.</p>
      <button type="button" disabled={busy || uncertain} onClick={() => void run(false)} className="rounded border px-4 py-2">{busy ? 'Working…' : 'Load current test evidence'}</button>
      {message && <p role="status">{message}</p>}
      {preview && (
        <>
          <p>
            Previous cumulative credit: service
            {' '}
            {formatMoney(preview.previousCredit.serviceCreditCents)}
            , tax
            {' '}
            {formatMoney(preview.previousCredit.taxCreditCents)}
            , tip
            {' '}
            {formatMoney(preview.previousCredit.tipCreditCents)}
            .
          </p>
          {!recorded && (
            <fieldset disabled={busy || uncertain} className="space-y-2">
              <legend>Explicit cumulative credit allocation (CAD)</legend>
              <label className="block">
                Service credit
                <input
                  aria-label="Service credit"
                  inputMode="decimal"
                  value={service}
                  onChange={(event) => {
                    setService(event.target.value);
                    setAcknowledged(false);
                  }}
                  className="ml-2 rounded border p-2"
                />
              </label>
              <label className="block">
                Tax credit
                <input
                  aria-label="Tax credit"
                  inputMode="decimal"
                  value={tax}
                  onChange={(event) => {
                    setTax(event.target.value);
                    setAcknowledged(false);
                  }}
                  className="ml-2 rounded border p-2"
                />
              </label>
              <p>
                Tip credit is fixed to the recorded tip refund:
                {' '}
                {formatMoney(preview.refunded.tipCents)}
                .
              </p>
              {validAllocation && (
                <p>
                  New credit-note delta: service
                  {' '}
                  {formatMoney(serviceCents! - preview.previousCredit.serviceCreditCents)}
                  , tax
                  {' '}
                  {formatMoney(taxCents! - preview.previousCredit.taxCreditCents)}
                  , tip
                  {' '}
                  {formatMoney(preview.refunded.tipCents - preview.previousCredit.tipCreditCents)}
                  .
                </p>
              )}
              {!validAllocation && <p>Enter cumulative service and tax credits matching the refunded principal. Prior credit cannot be reduced.</p>}
            </fieldset>
          )}
          {recorded && preview.decision && (
            <p>
              Recorded decision:
              {' '}
              {preview.decision.id}
              . New credit-note delta: service
              {' '}
              {formatMoney(preview.decision.deltaServiceCreditCents)}
              , tax
              {' '}
              {formatMoney(preview.decision.deltaTaxCreditCents)}
              , tip
              {' '}
              {formatMoney(preview.decision.deltaTipCreditCents)}
              .
            </p>
          )}
          <CustomerPaymentReviewView
            preview={{ evidenceRevision: preview.evidenceRevision, currency: 'CAD', originalInvoiceCents: preview.original.totalCents, originalTaxCents: preview.original.taxCents, originalTipCents: preview.original.tipCents, creditNoteCents: creditTotal, customerRefundedCents: preview.refunded.totalCents, retainedCashCents: preview.netTenderCents, adjustedBalanceCents: 0, allocations: [{ refundId: 'Recorded refund totals', principalCents: preview.refunded.principalCents, tipCents: preview.refunded.tipCents }] }}
            reason={reason}
            acknowledged={acknowledged && validAllocation}
            busy={busy}
            uncertain={uncertain}
            recorded={recorded}
            resolved={preview.resolution !== null}
            proposalValid={validAllocation}
            onReasonChange={(value) => {
              setReason(value);
              setAcknowledged(false);
            }}
            onAcknowledgedChange={setAcknowledged}
            onConfirm={() => void run(true)}
            onCancel={() => {
              setPreview(null);
              setRecorded(false);
            }}
          />
        </>
      )}
    </div>
  );
}
