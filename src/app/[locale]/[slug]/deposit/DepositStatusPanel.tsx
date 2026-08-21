'use client';

import { useEffect, useState } from 'react';

import { useHoldCountdown } from '@/components/deposits/HoldCountdown';
import { useSalon } from '@/providers/SalonProvider';

/**
 * Shared client panel for both deposit landing pages.
 *
 * Both pages receive `?session_id={CHECKOUT_SESSION_ID}` — Stripe substitutes
 * the template on cancel URLs exactly as it does on success URLs — and both read
 * their entire state from ONE call to the public session-status endpoint. The
 * cancel page's `{time}` and its resume link therefore come from the same
 * response, which is why that endpoint returns `checkoutUrl` while, and only
 * while, the hold is live.
 */

type SessionState = 'awaiting_payment' | 'confirmed' | 'expired' | 'cancelled';

type SessionStatus = {
  state: SessionState;
  holdExpiresAt: string | null;
  checkoutUrl?: string;
};

export function DepositStatusPanel({ variant }: { variant: 'return' | 'cancel' }) {
  const { bookingTimeZone } = useSalon();
  const [status, setStatus] = useState<SessionStatus | null>(null);
  const [loadState, setLoadState] = useState<'loading' | 'ready' | 'unknown'>('loading');
  // Ticks from the endpoint's authoritative expiry; inert until a live hold loads.
  const countdown = useHoldCountdown(
    status?.state === 'awaiting_payment' ? status.holdExpiresAt : null,
    { timeZone: bookingTimeZone },
  );

  useEffect(() => {
    const sessionId = new URLSearchParams(window.location.search).get('session_id');
    if (!sessionId) {
      setLoadState('unknown');
      return;
    }
    let cancelled = false;
    fetch(`/api/public/deposits/session-status?session_id=${encodeURIComponent(sessionId)}`)
      .then(response => (response.ok ? response.json() : null))
      .then((body: SessionStatus | null) => {
        if (cancelled) {
          return;
        }
        if (!body) {
          setLoadState('unknown');
          return;
        }
        setStatus(body);
        setLoadState('ready');
      })
      .catch(() => {
        if (!cancelled) {
          setLoadState('unknown');
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

  if (loadState === 'loading') {
    return <p className="mt-3 text-sm leading-6 text-stone-600">Checking your payment…</p>;
  }

  if (loadState === 'unknown' || !status) {
    return (
      <p className="mt-3 text-sm leading-6 text-stone-600">
        We could not find this payment. If you completed it, your confirmation will still arrive —
        please contact the salon if you are unsure.
      </p>
    );
  }

  if (status.state === 'confirmed') {
    return (
      <p className="mt-3 text-sm leading-6 text-stone-600">
        Payment received — your booking is confirmed. Your confirmation details are on their way.
      </p>
    );
  }

  if (status.state === 'awaiting_payment') {
    // The endpoint said the hold was live when it answered; once the local
    // countdown of that SAME server expiry hits zero, stop offering resume —
    // the session and the hold die at that instant, so the link would 404
    // into Stripe's expired-session page.
    if (countdown.expired && status.holdExpiresAt) {
      return (
        <p className="mt-3 text-sm leading-6 text-stone-600">
          This booking hold has ended and the time has been released. You are welcome to book again.
        </p>
      );
    }
    return (
      <div className="mt-3 space-y-4">
        <p className="text-sm leading-6 text-stone-600">
          {variant === 'cancel'
            ? 'Payment not completed'
            : 'We have not received your deposit yet'}
          {countdown.label
            ? (
                <>
                  {' — your slot is held for another '}
                  <span data-testid="hold-countdown" className="font-semibold tabular-nums">{countdown.label}</span>
                  .
                </>
              )
            : '.'}
          {countdown.absoluteLabel && countdown.dateTime && (
            <>
              {' The hold ends at '}
              <time data-testid="hold-deadline" dateTime={countdown.dateTime}>
                {countdown.absoluteLabel}
              </time>
              {' (salon local time).'}
            </>
          )}
        </p>
        {status.checkoutUrl
          ? (
              <a
                className="inline-flex rounded-full bg-stone-950 px-5 py-2.5 text-sm font-semibold text-white"
                href={status.checkoutUrl}
              >
                Resume payment
              </a>
            )
          : null}
      </div>
    );
  }

  return (
    <p className="mt-3 text-sm leading-6 text-stone-600">
      This booking hold has ended and the time has been released. You are welcome to book again.
    </p>
  );
}
