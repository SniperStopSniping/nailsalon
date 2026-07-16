'use client';

import { useState } from 'react';

export function FindBookingForm({ salonSlug }: { salonSlug: string }) {
  const [email, setEmail] = useState('');
  const [state, setState] = useState<'idle' | 'sending' | 'sent' | 'error'>('idle');
  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setState('sending');
    const response = await fetch('/api/public/appointments/recovery', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ salonSlug, email }),
    }).catch(() => null);
    setState(response?.ok ? 'sent' : 'error');
  }
  if (state === 'sent') {
    return (
      <div className="mt-6 rounded-2xl bg-emerald-50 p-5 text-sm leading-6 text-emerald-900">
        <p className="font-semibold">Check your email</p>
        <p>If upcoming bookings match that address, your secure links will arrive shortly. Check spam or promotions too.</p>
      </div>
    );
  }
  return (
    <form className="mt-7 space-y-4" onSubmit={submit}>
      <label className="block">
        <span className="text-sm font-semibold text-stone-800">Booking email</span>
        <input type="email" autoComplete="email" required value={email} onChange={event => setEmail(event.target.value)} placeholder="you@example.com" className="mt-2 h-12 w-full rounded-xl border border-stone-300 px-4 text-base outline-none focus:border-rose-700 focus:ring-2 focus:ring-rose-100" />
      </label>
      <button type="submit" disabled={state === 'sending'} className="h-12 w-full rounded-full bg-rose-800 px-5 font-semibold text-white disabled:opacity-60">{state === 'sending' ? 'Sending secure link…' : 'Email my booking links'}</button>
      {state === 'error' && <p className="text-sm text-red-700">We could not send the email right now. Please try again shortly or contact the salon.</p>}
      <p className="text-xs leading-5 text-stone-500">For privacy, this page never confirms whether an email has a reservation.</p>
    </form>
  );
}
