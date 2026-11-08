'use client';

import { useState } from 'react';

import { calculatePaymentSnapshot } from '@/libs/customerPayments/money';
import { resolvePaymentChoice } from '@/libs/customerPayments/policy';

import { CustomerPaymentChooser } from './CustomerPaymentChooser';
import { CustomerPaymentSettings } from './CustomerPaymentSettings';
import type { CustomerPaymentChoice, CustomerPaymentQuote } from './types';
import { DEFAULT_CUSTOMER_PAYMENT_SETTINGS } from './types';

export function CustomerPaymentsRehearsal() {
  const [settings, setSettings] = useState(DEFAULT_CUSTOMER_PAYMENT_SETTINGS);
  const [choice, setChoice] = useState<CustomerPaymentChoice>('in_person');
  const [tip, setTip] = useState(0);
  const [message, setMessage] = useState('');
  const effectivePolicy = settings.enabled ? settings.policy : 'optional_full';
  const collection = resolvePaymentChoice({ mode: effectivePolicy, choice, requiredDepositCents: 2000 });
  let quote: CustomerPaymentQuote | null = null;
  let quoteError: string | null = null;
  try {
    const snapshot = calculatePaymentSnapshot({
      currency: 'cad',
      servicesCents: 10500,
      discountCents: 0,
      taxCents: 1365,
      tipCents: tip,
      collection,
      ...(collection === 'deposit' ? { depositCents: 2000 } : {}),
      feePolicy: { payer: settings.feePayer, feeCents: settings.platformFeeCents, taxTreatment: 'not_collected_in_test_mode' },
    });
    quote = {
      currency: 'CAD',
      choice,
      tipCents: tip,
      lines: [
        { id: 'service', label: 'Services (example)', amountCents: snapshot.servicesCents, recipient: 'Salon' },
        { id: 'tax', label: 'Tax (13% example only)', amountCents: snapshot.taxCents, recipient: 'Salon, for tax authority' },
        { id: 'fee', label: 'Customer payment fees (salon pays)', amountCents: 0, recipient: 'No customer fee collected' },
        { id: 'tip', label: 'Optional tip', amountCents: snapshot.tipCents, recipient: 'Salon team' },
      ],
      totalCents: snapshot.totalCents,
      dueNowCents: snapshot.chargeCents,
      remainingCents: snapshot.remainingCents,
    };
  } catch {
    quoteError = 'This test fee configuration is not supported. Use a salon-paid fee between CAD 0 and CAD 100.';
  }
  return (
    <main className="mx-auto grid max-w-2xl gap-6 p-4">
      <h1 className="text-2xl font-semibold">Test setup</h1>
      <p>Local rehearsal only. No providers contacted, bank connection, account changes, booking or live payments. Settings are not saved to a salon. Example service CAD 105.00 and 13% tax are synthetic, not a tax recommendation.</p>
      <CustomerPaymentSettings
        value={settings}
        onChange={(next) => {
          setSettings(next);
          setChoice(next.enabled && next.policy !== 'optional_full' ? 'online' : 'in_person');
        }}
      />
      <button type="button" className="min-h-11 rounded-lg border bg-white px-4 py-2" onClick={() => setMessage('Test setup saved for this page only. Nothing is live.')}>Save test setup</button>
      <CustomerPaymentChooser onlineEnabled={settings.enabled} policy={effectivePolicy} choice={choice} tipCents={tip} quote={quote} error={quoteError} cancellationPolicy={settings.cancellationPolicy} onChoiceChange={setChoice} onTipChange={setTip} onBack={() => setMessage('Back selected. No booking or payment was made.')} onContinue={() => setMessage('Rehearsal complete. No payment or booking was made.')} />
      <p role="status">{message}</p>
    </main>
  );
}
