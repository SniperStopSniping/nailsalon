'use client';

import { useEffect, useState } from 'react';

/**
 * Ticks against the SERVER-provided absolute expiry instant.
 *
 * The client never invents a duration: the only input is the ISO timestamp the
 * server returned (`deposit.holdExpiresAt` on the 201, `details.holdExpiresAt`
 * on the DEPOSIT_HOLD_ACTIVE 409, `status.holdExpiresAt` from session-status),
 * so a refresh, a backgrounded tab, or plain clock passage all re-derive the
 * same remaining time instead of drifting. An already-past timestamp renders
 * as expired immediately.
 */
export function useHoldCountdown(expiresAt: string | null | undefined): {
  label: string | null;
  expired: boolean;
} {
  const targetMs = expiresAt ? Date.parse(expiresAt) : Number.NaN;
  const valid = Number.isFinite(targetMs);
  const [nowMs, setNowMs] = useState(() => Date.now());

  useEffect(() => {
    if (!valid) {
      return;
    }
    // Wall-clock re-read every tick (not an accumulated offset), so time spent
    // backgrounded is accounted for the moment the tab wakes.
    const id = setInterval(() => setNowMs(Date.now()), 1_000);
    return () => clearInterval(id);
  }, [valid, expiresAt]);

  if (!valid) {
    return { label: null, expired: false };
  }

  const msLeft = Math.max(0, targetMs - nowMs);
  const totalSeconds = Math.floor(msLeft / 1_000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;

  return {
    label: `${minutes}:${String(seconds).padStart(2, '0')}`,
    expired: msLeft <= 0,
  };
}

/** Inline mm:ss ticker. Renders nothing for an unparsable timestamp. */
export function HoldCountdown({ expiresAt }: { expiresAt: string }) {
  const { label, expired } = useHoldCountdown(expiresAt);

  if (!label) {
    return null;
  }

  return (
    <span data-testid="hold-countdown" className="font-semibold tabular-nums">
      {expired ? '0:00' : label}
    </span>
  );
}
