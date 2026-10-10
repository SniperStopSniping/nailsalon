'use client';

import { Phone } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useState } from 'react';

import styles from '@/components/customer-booking/customer-booking.module.css';

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
 * gates used by public booking and find-booking surfaces. The optional call
 * action is omitted when the salon has hidden its phone; cancellation and
 * rescheduling remain available directly through the appointment link.
 */
export function ManageAppointmentActions({ token, rescheduleUrl, appointmentStatus, isActive, salonPhone }: { token: string; rescheduleUrl: string; appointmentStatus?: string; isActive: boolean; salonPhone?: string | null }) {
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
    return <div role="status" className={styles.notice}>This appointment is cancelled.</div>;
  }
  if (!isActive && appointmentStatus) {
    const label = appointmentStatus === 'completed' ? 'This appointment is completed.' : appointmentStatus === 'in_progress' ? 'Your appointment is in progress.' : appointmentStatus === 'no_show' ? 'This appointment was marked as a no-show.' : 'This appointment is awaiting payment.';
    return <p className={styles.notice}>{label}</p>;
  }
  return (
    <div className={styles.actionGrid}>
      <a href={rescheduleUrl} className={styles.button}>Choose a new time</a>
      <button type="button" disabled={status === 'working'} onClick={cancel} className={styles.secondaryButton}>{status === 'working' ? 'Cancelling…' : 'Cancel appointment'}</button>
      {salonPhone && (
        <a className={styles.textLink} href={`tel:${salonPhone}`}>
          <Phone aria-hidden="true" />
          Call salon
        </a>
      )}
      {status === 'error' && (
        <div role="alert" className={styles.error}>
          <p>We couldn’t confirm the cancellation. Refresh to check your appointment, then try again if needed.</p>
          <button type="button" onClick={() => window.location.reload()} className={styles.textLink}>Refresh appointment</button>
        </div>
      )}
    </div>
  );
}
