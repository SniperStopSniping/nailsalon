'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';

/**
 * S7 (Stage 1) — contact projection.
 *
 * The salon email address was REMOVED from this component's props. A capability
 * token proves the holder booked an appointment; it does not carry any owner
 * decision to publish a salon email address, and no ratified appointment
 * contract requires one to manage a booking (cancel and reschedule both go
 * through the token API). No public-email preference exists to consult, and
 * Stage 1 does not invent one, so the address is simply not serialized.
 *
 * `salonPhone` is retained but is now redacted UPSTREAM through the shared
 * public-salon-phone resolver — the same global booking-only and location-mode
 * gates used by public booking and find-booking surfaces. When the salon has
 * hidden its phone the surrounding copy still tells the client to contact the
 * salon, matching the contact-less variants the repo already ships elsewhere
 * in this same view.
 */
export function ManageAppointmentActions({ token, rescheduleUrl, appointmentStatus, isActive, canChange, cutoffHours, salonPhone }: { token: string; rescheduleUrl: string; appointmentStatus?: string; isActive: boolean; canChange: boolean; cutoffHours: number; salonPhone?: string | null }) {
  const router = useRouter();
  const [status, setStatus] = useState<'idle' | 'working' | 'cancelled' | 'error'>(appointmentStatus ? appointmentStatus === 'cancelled' ? 'cancelled' : 'idle' : isActive ? 'idle' : 'cancelled');
  async function cancel() {
    if (!window.confirm('Cancel this appointment?')) {
      return;
    }
    setStatus('working');
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15_000);
    try {
      const response = await fetch(`/api/public/appointments/manage/${encodeURIComponent(token)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'cancel', reason: 'client_request' }),
        signal: controller.signal,
      });
      setStatus(response.ok ? 'cancelled' : 'error');
      if (response.ok) {
        router.refresh();
      }
    } catch {
      // A lost response cannot tell us whether the server committed the change.
      // Keep recovery available without presenting an unverified cancellation.
      setStatus('error');
    } finally {
      clearTimeout(timeout);
    }
  }
  if (status === 'cancelled') {
    return <div className="rounded-2xl bg-stone-100 p-4 text-center text-sm font-medium text-stone-700">This appointment is cancelled.</div>;
  }
  if (!isActive && appointmentStatus) {
    const label = appointmentStatus === 'completed' ? 'This appointment is completed.' : appointmentStatus === 'in_progress' ? 'Your appointment is in progress.' : appointmentStatus === 'no_show' ? 'This appointment was marked as a no-show.' : 'This appointment is awaiting payment.';
    return <p className="rounded-2xl bg-stone-100 p-4 text-sm text-stone-700">{label}</p>;
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
        </div>
      </div>
    );
  }
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      <a href={rescheduleUrl} className="rounded-full bg-stone-900 px-5 py-3 text-center text-sm font-semibold text-white">Choose a new time</a>
      <button type="button" disabled={status === 'working'} onClick={cancel} className="rounded-full border border-red-200 px-5 py-3 text-sm font-semibold text-red-700 disabled:opacity-50">{status === 'working' ? 'Cancelling…' : 'Cancel appointment'}</button>
      {status === 'error' && (
        <div role="alert" className="text-sm text-red-700 sm:col-span-2">
          <p>We couldn’t confirm the cancellation. Refresh to check your appointment, then try again if needed.</p>
          <button type="button" onClick={() => window.location.reload()} className="mt-2 min-h-11 font-semibold underline underline-offset-4">Refresh appointment</button>
        </div>
      )}
    </div>
  );
}
