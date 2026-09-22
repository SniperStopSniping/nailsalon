'use client';

import { useState } from 'react';

export function FindBookingForm({ salonSlug, salonPhone }: { salonSlug: string; salonPhone?: string | null }) {
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [state, setState] = useState<'idle' | 'sending' | 'sent' | 'error'>('idle');
  const [requestedChannel, setRequestedChannel] = useState<'email' | 'sms'>('email');
  const [validationMessage, setValidationMessage] = useState<string | null>(null);
  const deliveryLabel = email.trim() || !phone.trim() ? 'Email my booking link' : 'Text my booking link';

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    const trimmedEmail = email.trim();
    const trimmedPhone = phone.trim();
    if (!trimmedEmail && !trimmedPhone) {
      setValidationMessage('Enter the email or phone number you booked with.');
      return;
    }
    setValidationMessage(null);
    setRequestedChannel(trimmedEmail ? 'email' : 'sms');
    setState('sending');
    const response = await fetch('/api/public/appointments/recovery', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        salonSlug,
        email: trimmedEmail || undefined,
        phone: trimmedPhone || undefined,
      }),
    }).catch(() => null);
    setState(response?.ok ? 'sent' : 'error');
  }

  if (state === 'sent') {
    return (
      <div className="mt-6 rounded-2xl bg-emerald-50 p-5 text-sm leading-6 text-emerald-900" data-testid="find-booking-sent">
        <p className="font-semibold">Request received</p>
        <p>
          If we find a matching appointment, we&apos;ll
          {' '}
          {requestedChannel === 'email' ? 'email' : 'text'}
          {' '}
          the secure link to the contact on file.
        </p>
        <p className="mt-2">
          If the link doesn&apos;t arrive,
          {' '}
          {salonPhone
            ? (
                <a href={`tel:${salonPhone}`} className="font-semibold underline">please call the salon</a>
              )
            : 'please contact the salon directly'}
          .
        </p>
      </div>
    );
  }

  return (
    <form className="mt-7 space-y-4" onSubmit={submit}>
      <label className="block">
        <span className="text-sm font-semibold text-stone-800">Booking email</span>
        <input type="email" autoComplete="email" value={email} onChange={event => setEmail(event.target.value)} placeholder="you@example.com" className="mt-2 h-12 w-full rounded-xl border border-stone-300 px-4 text-base outline-none focus:border-rose-700 focus:ring-2 focus:ring-rose-100" />
      </label>
      <p className="text-sm text-stone-600">
        Use the email
        {' '}
        <strong>or</strong>
        {' '}
        mobile number from your booking. If you enter both, we&apos;ll email the link.
      </p>
      <label className="block">
        <span className="text-sm font-semibold text-stone-800">Mobile phone</span>
        <input type="tel" inputMode="tel" autoComplete="tel" value={phone} onChange={event => setPhone(event.target.value)} placeholder="(416) 555-1234" className="mt-2 h-12 w-full rounded-xl border border-stone-300 px-4 text-base outline-none focus:border-rose-700 focus:ring-2 focus:ring-rose-100" />
      </label>
      <button type="submit" disabled={state === 'sending'} className="h-auto min-h-12 w-full rounded-full bg-rose-800 px-5 py-3 font-semibold text-white disabled:opacity-60">{state === 'sending' ? 'Sending request…' : deliveryLabel}</button>
      {validationMessage && <p className="text-sm text-amber-700" data-testid="find-booking-validation">{validationMessage}</p>}
      {state === 'error' && (
        <p className="text-sm text-red-700" data-testid="find-booking-error">
          We could not process the request right now. Your details are still filled in — please try again shortly
          {salonPhone
            ? (
                <>
                  {' '}
                  or
                  {' '}
                  <a href={`tel:${salonPhone}`} className="font-semibold underline">call the salon</a>
                </>
              )
            : ' or contact the salon'}
          .
        </p>
      )}
      <p className="text-xs leading-5 text-stone-500">For privacy, this page never confirms whether a booking exists.</p>
    </form>
  );
}
