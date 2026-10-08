'use client';
import { useEffect, useRef, useState } from 'react';

/** All entry points use the same server-authoritative checkout. */
export function useSmsTopupCheckout(salonId: string | undefined, onUnavailable?: () => void) {
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const currentSalon = useRef(salonId);
  currentSalon.current = salonId;
  const inFlight = useRef(false);
  const [buying, setBuying] = useState<string | null>(null);
  const [buyError, setBuyError] = useState<string | null>(null);
  useEffect(() => {
    setBuying(null);
    setBuyError(null);
  }, [salonId]);
  const buyTopup = async (topupOfferKey: string) => {
    if (!salonId || inFlight.current) {
      return;
    }
    inFlight.current = true;
    setBuying(topupOfferKey);
    setBuyError(null);
    try {
      const response = await fetch('/api/billing/checkout/topup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ salonId, topupOfferKey }),
      });
      const body = await response.json();
      if (!mounted.current || currentSalon.current !== salonId) {
        return;
      }
      if (response.ok && body.data?.url) {
        window.location.assign(body.data.url);
        return;
      }
      if (['TOPUPS_DISABLED', 'PRICE_UNCONFIGURED'].includes(body.error?.code)) {
        onUnavailable?.();
        setBuyError('Text purchases are currently unavailable. Please try again later.');
      } else if (['OWNER_REQUIRED', 'CHECKOUT_IN_PROGRESS', 'CHECKOUT_PENDING_RECONCILIATION'].includes(body.error?.code) && typeof body.error?.message === 'string') {
        setBuyError(body.error.message);
      } else {
        setBuyError('Could not start the purchase. Please try again.');
      }
    } catch {
      if (mounted.current && currentSalon.current === salonId) {
        setBuyError('Could not start the purchase. Please try again.');
      }
    } finally {
      inFlight.current = false;
      if (mounted.current && currentSalon.current === salonId) {
        setBuying(null);
      }
    }
  };
  return { buying, buyError, buyTopup };
}
