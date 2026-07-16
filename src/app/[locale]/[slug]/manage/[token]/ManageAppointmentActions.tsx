'use client';

import { useState } from 'react';

export function ManageAppointmentActions({ token, rescheduleUrl, isActive, canChange, cutoffHours, salonEmail, salonPhone }: { token: string; rescheduleUrl: string; isActive: boolean; canChange: boolean; cutoffHours: number; salonEmail?: string | null; salonPhone?: string | null }) {
  const [status, setStatus] = useState<'idle' | 'working' | 'cancelled' | 'error'>(isActive ? 'idle' : 'cancelled');
  async function cancel() {
    if (!window.confirm('Cancel this appointment?')) {
      return;
    }
    setStatus('working');
    const response = await fetch(`/api/public/appointments/manage/${encodeURIComponent(token)}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'cancel', reason: 'client_request' }),
    });
    setStatus(response.ok ? 'cancelled' : 'error');
  }
  if (status === 'cancelled') {
    return <div className="rounded-2xl bg-stone-100 p-4 text-center text-sm font-medium text-stone-700">This appointment is cancelled.</div>;
  }
  if (!canChange) {
    return (
      <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-950">
        <p className="font-semibold">
          Online changes close
          {cutoffHours}
          {' '}
          hours before your appointment.
        </p>
        <p className="mt-1">Please contact the salon for help with a late change.</p>
        <div className="mt-3 flex flex-wrap gap-3 font-semibold">
          {salonPhone && <a href={`tel:${salonPhone}`}>Call salon</a>}
          {salonEmail && <a href={`mailto:${salonEmail}`}>Email salon</a>}
        </div>
      </div>
    );
  }
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      <a href={rescheduleUrl} className="rounded-full bg-stone-900 px-5 py-3 text-center text-sm font-semibold text-white">Choose a new time</a>
      <button type="button" disabled={status === 'working'} onClick={cancel} className="rounded-full border border-red-200 px-5 py-3 text-sm font-semibold text-red-700 disabled:opacity-50">{status === 'working' ? 'Cancelling…' : 'Cancel appointment'}</button>
      {status === 'error' && <p className="text-sm text-red-700 sm:col-span-2">The appointment could not be cancelled. Refresh and try again.</p>}
    </div>
  );
}
