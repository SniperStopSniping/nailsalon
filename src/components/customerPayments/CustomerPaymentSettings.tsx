'use client';

import { useId } from 'react';

import type { CustomerPaymentSettingsValue } from './types';

export type CustomerPaymentSettingsProps = {
  value: CustomerPaymentSettingsValue;
  onChange: (value: CustomerPaymentSettingsValue) => void;
  disabled?: boolean;
};

/** Test-only settings editor. Does not save or activate a payment account. */
export function CustomerPaymentSettings({ value, onChange, disabled = false }: CustomerPaymentSettingsProps) {
  const id = useId();
  return (
    <section aria-labelledby={`${id}-heading`} className="space-y-4 rounded-2xl border border-gray-200 bg-white p-5 text-gray-900">
      <p className="text-sm font-semibold text-amber-800">Test mode · Settings are not live</p>
      <h2 id={`${id}-heading`} className="text-xl font-semibold">Customer payments</h2>
      <fieldset disabled={disabled} className="space-y-4">
        <legend className="sr-only">Customer payment settings</legend>
        <label className="flex min-h-11 items-center gap-3">
          <input type="checkbox" checked={value.enabled} onChange={event => onChange({ ...value, enabled: event.target.checked })} />
          Enable online payments in this preview
        </label>
        <p>Online payments are off by default. This preview cannot activate live payments.</p>
        <label htmlFor={`${id}-policy`} className="block">Booking payment policy</label>
        <select id={`${id}-policy`} disabled={!value.enabled} value={value.policy} onChange={event => onChange({ ...value, policy: event.target.value as CustomerPaymentSettingsValue['policy'] })} className="min-h-11 w-full rounded-lg border p-2">
          <option value="optional_full">Customer chooses online or in person</option>
          <option value="required_deposit">Require an online deposit</option>
          <option value="full_online_required">Require full online payment</option>
        </select>
        <label htmlFor={`${id}-fee-payer`} className="block">Who pays payment fees?</label>
        <select id={`${id}-fee-payer`} value={value.feePayer} disabled={!value.enabled} onChange={event => onChange({ ...value, feePayer: event.target.value as CustomerPaymentSettingsValue['feePayer'] })} aria-describedby={`${id}-fee-review`} className="min-h-11 w-full rounded-lg border p-2">
          <option value="salon">Salon pays</option>
          <option value="customer" disabled>Customer pays (review required)</option>
        </select>
        <p id={`${id}-fee-review`} className="text-sm">Customer-paid fees are unavailable until tax, surcharge and disclosure requirements are reviewed. Actual Stripe processing costs are determined by Stripe and are not estimated customer charges.</p>
        <label htmlFor={`${id}-flat-fee`} className="block">Luster flat fee per online transaction (CAD)</label>
        <input
          id={`${id}-flat-fee`}
          type="number"
          min="0"
          max="100"
          step="0.01"
          placeholder="1.00"
          value={(value.platformFeeCents / 100).toFixed(2)}
          disabled={!value.enabled}
          onChange={(event) => {
            const amount = Number(event.target.value);
            if (Number.isFinite(amount) && amount >= 0 && amount <= 100) {
              onChange({ ...value, platformFeeCents: Math.round(amount * 100) });
            }
          }}
          aria-describedby={`${id}-placeholder`}
          className="min-h-11 w-full rounded-lg border p-2"
        />
        <p id={`${id}-placeholder`} className="text-sm">CAD 1.00 is a preview placeholder, not a live payment configuration.</p>
        <label htmlFor={`${id}-refunds`} className="block">Cancellation and refund policy shown to customers</label>
        <textarea id={`${id}-refunds`} rows={4} maxLength={5000} value={value.cancellationPolicy} onChange={event => onChange({ ...value, cancellationPolicy: event.target.value })} placeholder="Explain cancellation deadlines, deposit treatment and how customers can request a refund." className="w-full rounded-lg border p-3" />
        <p className="text-sm">Set clear terms suited to your salon and applicable law. Refunds remain available; this setting does not impose a blanket no-refunds policy.</p>
      </fieldset>
    </section>
  );
}
