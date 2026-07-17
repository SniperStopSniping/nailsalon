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
  onManageBooking: () => void;
  onEditContact: () => void;
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
  onManageBooking,
  onEditContact,
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
          title="You already have a booking"
          description="To avoid duplicates, manage your existing appointment instead of booking another one."
          contentClassName="py-7"
        />

        {sendState === 'sent'
          ? (
              <div className="rounded-2xl bg-emerald-50 p-5 text-sm leading-6 text-emerald-900" data-testid="existing-appointment-sent">
                <p className="font-semibold">Request received</p>
                <p>If we find a matching appointment, we&apos;ll email the secure link to the contact on file within a few minutes. Check spam too.</p>
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
                {sendState === 'sending' ? 'Sending…' : 'Send my appointment link'}
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
          Manage my appointment
        </button>

        <button
          type="button"
          data-testid="existing-appointment-edit-contact"
          onClick={() => {
            triggerHaptic('select');
            onEditContact();
          }}
          className={secondaryButtonClass}
          style={{ borderRadius: n5.radiusMd }}
        >
          Use different contact information
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
          I don&apos;t have a booking — try again
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
