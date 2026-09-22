'use client';

import { Calendar } from 'lucide-react';
import { useState } from 'react';

import { StateCard } from '@/components/ui/state-card';
import { triggerHaptic } from '@/libs/haptics';
import { n5 } from '@/theme';

export type ExistingAppointmentOptionsProps = {
  salonSlug: string;
  /** Contact details from the booking attempt — the phone is what tripped the gate. */
  guestEmail: string;
  guestPhone: string;
  salonPhone?: string | null;
  hasDepositHold?: boolean;
  onManageBooking: () => void;
  onRetryBooking: () => void;
};

type SendState = 'idle' | 'sending' | 'sent' | 'error';

const secondaryButtonClass = 'font-body w-full border border-[var(--n5-border,rgba(0,0,0,0.12))] bg-white py-4 font-semibold text-[var(--n5-ink)] transition-all active:scale-[0.98]';

/**
 * Shown when the server confirms an active appointment already exists for the
 * entered phone. Every path forward is offered here instead of a dead end:
 * self-serve link recovery, manual lookup, editing contact details, retrying
 * (the server re-verifies — browser state is never the authority), or calling
 * the salon.
 */
export function ExistingAppointmentOptions({
  salonSlug,
  guestEmail,
  guestPhone,
  salonPhone = null,
  hasDepositHold = false,
  onManageBooking,
  onRetryBooking,
}: ExistingAppointmentOptionsProps) {
  const [sendState, setSendState] = useState<SendState>('idle');

  async function sendLink() {
    if (sendState === 'sending') {
      return;
    }
    triggerHaptic('select');
    setSendState('sending');
    const response = await fetch('/api/public/appointments/recovery', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        salonSlug,
        email: guestEmail.trim() || undefined,
        phone: guestPhone.trim() || undefined,
      }),
    }).catch(() => null);
    setSendState(response?.ok ? 'sent' : 'error');
  }

  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-[var(--n5-bg-page)] px-5 py-10">
      <div className="w-full max-w-md space-y-3">
        <StateCard
          tone="warning"
          icon={<Calendar className="mx-auto size-10 text-[var(--n5-warning)]" />}
          title={hasDepositHold ? 'You have a booking waiting for its deposit' : 'You already have an upcoming appointment'}
          description={hasDepositHold ? 'Finish payment or wait for the hold to expire before checking availability again.' : 'You can manage your appointments or book another appointment.'}
          contentClassName="py-7"
        />

        {sendState === 'sent'
          ? (
              <div className="rounded-2xl bg-emerald-50 p-5 text-sm leading-6 text-emerald-900" data-testid="existing-appointment-sent">
                <p className="font-semibold">Request received</p>
                <p>If we find a matching appointment, we&apos;ll send the secure link to the contact on file.</p>
              </div>
            )
          : (
              <button
                type="button"
                onClick={sendLink}
                disabled={sendState === 'sending'}
                data-testid="existing-appointment-send-link"
                className="font-body w-full bg-[var(--n5-accent)] py-4 font-bold text-[var(--n5-ink-inverse)] transition-all active:scale-[0.98] disabled:opacity-60"
                style={{ borderRadius: n5.radiusMd, boxShadow: n5.shadowSm }}
              >
                {sendState === 'sending' ? 'Sending…' : guestEmail.trim() || !guestPhone.trim() ? 'Email my appointment link' : 'Text my appointment link'}
              </button>
            )}
        {sendState === 'error' && (
          <p className="text-center text-sm text-red-700" data-testid="existing-appointment-send-error">
            We could not process that right now. Please try again shortly.
          </p>
        )}

        <button
          type="button"
          data-testid="existing-appointment-manage"
          onClick={() => {
            triggerHaptic('select');
            onManageBooking();
          }}
          className={secondaryButtonClass}
          style={{ borderRadius: n5.radiusMd }}
        >
          View my appointments
        </button>

        <button
          type="button"
          data-testid="existing-appointment-retry"
          onClick={() => {
            triggerHaptic('select');
            onRetryBooking();
          }}
          className={secondaryButtonClass}
          style={{ borderRadius: n5.radiusMd }}
        >
          {hasDepositHold ? 'Check availability again' : 'Book another appointment'}
        </button>

        {salonPhone && (
          <a
            href={`tel:${salonPhone}`}
            data-testid="existing-appointment-call-salon"
            className={`${secondaryButtonClass} block text-center`}
            style={{ borderRadius: n5.radiusMd }}
          >
            Call the salon
          </a>
        )}
      </div>
    </div>
  );
}
