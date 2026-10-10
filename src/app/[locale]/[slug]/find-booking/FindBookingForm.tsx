'use client';

import { ArrowRight, CheckCircle2, LockKeyhole, Mail, Phone } from 'lucide-react';
import { useId, useRef, useState } from 'react';

import styles from '@/components/customer-booking/customer-booking.module.css';

export function FindBookingForm({ salonSlug, salonPhone }: { salonSlug: string; salonPhone?: string | null }) {
  const hintId = useId();
  const validationId = useId();
  const emailInput = useRef<HTMLInputElement>(null);
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
      emailInput.current?.focus();
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
      <div role="status" className={`${styles.section} ${styles.success}`} data-testid="find-booking-sent">
        <p className={styles.statusHeading}>
          <CheckCircle2 aria-hidden="true" />
          Request received
        </p>
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
    <form className={styles.form} onSubmit={submit} aria-busy={state === 'sending'}>
      <p className={styles.hint} id={hintId}>
        Use the email
        {' '}
        <strong>or</strong>
        {' '}
        mobile number from your booking. If you enter both, we&apos;ll email the link.
      </p>
      <label className={styles.label}>
        <span>Booking email</span>
        <span className={styles.inputWrap}>
          <Mail aria-hidden="true" />
          <input
            ref={emailInput}
            type="email"
            autoComplete="email"
            value={email}
            onChange={(event) => {
              setEmail(event.target.value);
              if (event.target.value.trim()) {
                setValidationMessage(null);
              }
            }}
            placeholder="you@example.com"
            className={styles.input}
            aria-describedby={validationMessage ? `${hintId} ${validationId}` : hintId}
            aria-invalid={!!validationMessage}
          />
        </span>
      </label>
      <div className={styles.divider} aria-hidden="true">or</div>
      <label className={styles.label}>
        <span>Mobile phone</span>
        <span className={styles.inputWrap}>
          <Phone aria-hidden="true" />
          <input
            type="tel"
            inputMode="tel"
            autoComplete="tel"
            value={phone}
            onChange={(event) => {
              setPhone(event.target.value);
              if (event.target.value.trim()) {
                setValidationMessage(null);
              }
            }}
            placeholder="(416) 555-1234"
            className={styles.input}
            aria-describedby={validationMessage ? `${hintId} ${validationId}` : hintId}
            aria-invalid={!!validationMessage}
          />
        </span>
      </label>
      <button type="submit" disabled={state === 'sending'} className={styles.button}>
        <span>{state === 'sending' ? 'Sending request…' : deliveryLabel}</span>
        <ArrowRight aria-hidden="true" />
      </button>
      {validationMessage && <p role="alert" id={validationId} className={styles.error} data-testid="find-booking-validation">{validationMessage}</p>}
      {state === 'error' && (
        <p role="alert" className={styles.error} data-testid="find-booking-error">
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
      <p className={styles.privacy}>
        <LockKeyhole aria-hidden="true" />
        <span>For privacy, this page never confirms whether a booking exists.</span>
      </p>
    </form>
  );
}
