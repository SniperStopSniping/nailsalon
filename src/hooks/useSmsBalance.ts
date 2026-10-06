'use client';

import { useEffect, useState } from 'react';

import { SMS_BALANCE_CHANGED_EVENT } from '@/libs/commercialPolicy';

/** Live meter for the existing usage destination; never carries another salon's balance. */
export function useSmsBalance(salonSlug: string | null | undefined): number | null {
  const [balance, setBalance] = useState<{ salonSlug: string; available: number } | null>(null);
  useEffect(() => {
    if (!salonSlug) {
      return;
    }
    let active = true;
    let version = 0;
    const controller = new AbortController();
    const refresh = async () => {
      const current = ++version;
      try {
        const response = await fetch(`/api/admin/salon/communications/usage?salonSlug=${encodeURIComponent(salonSlug)}`, { cache: 'no-store', signal: controller.signal });
        if (!response.ok) {
          throw new Error('usage unavailable');
        }
        const body = await response.json();
        const available = body?.data?.usage?.availableCredits;
        if (active && current === version && Number.isInteger(available) && available >= 0) {
          setBalance({ salonSlug, available });
        }
      } catch {
        if (active && current === version) {
          setBalance(null);
        }
      }
    };
    const onFocus = () => void refresh();
    void refresh();
    window.addEventListener('focus', onFocus);
    window.addEventListener(SMS_BALANCE_CHANGED_EVENT, onFocus);
    // Sends settle asynchronously, so refresh while More is visible too.
    const timer = window.setInterval(onFocus, 30000);
    return () => {
      active = false;
      controller.abort();
      window.clearInterval(timer);
      window.removeEventListener('focus', onFocus);
      window.removeEventListener(SMS_BALANCE_CHANGED_EVENT, onFocus);
    };
  }, [salonSlug]);
  return balance && balance.salonSlug === salonSlug ? balance.available : null;
}
