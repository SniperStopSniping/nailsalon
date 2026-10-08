'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

import { RETENTION_DATA_CHANGED_EVENT } from '@/libs/dashboardEvents';
import { SMS_CREDITS_CHANGED_EVENT, type SmsCreditStatus } from '@/libs/smsCreditStatus';

export type SmsCreditActivity = { id: string; createdAt: string; type: string; bucket: string; credits: number; eventType: string | null };
export type SmsCreditsPayload = {
  salonId: string;
  balance: { availableCredits: number; pendingCredits: number; allocationCredits: number | null; status: SmsCreditStatus; totalPurchased: number; usedThisMonth: number; monthStart: string; timeZone: string; lastPurchaseCredits?: number | null; lastPurchaseOfferKey: string | null };
  topupOffers: Array<{ key: string; credits: number; priceCents: number; currency: string; available: boolean }>;
  canPurchase: boolean;
  creditPurchasesAvailable: boolean;
  activity?: { items: SmsCreditActivity[]; nextCursor: string | null };
};

/** No cross-salon cache: a response is only visible for the request's salon and view. */
export function useSmsCredits(salonSlug: string, view: 'balance' | 'credits' = 'balance') {
  const key = `${salonSlug}:${view}`;
  const currentKey = useRef(key);
  currentKey.current = key;
  const [state, setState] = useState<{ key: string; data: SmsCreditsPayload | null; error: boolean } | null>(null);
  const sequence = useRef(0);
  const request = useRef<AbortController | null>(null);
  const refresh = useCallback(async () => {
    const serial = ++sequence.current;
    request.current?.abort();
    const controller = new AbortController();
    request.current = controller;
    try {
      const query = new URLSearchParams({ salonSlug, view });
      const response = await fetch(`/api/admin/salon/communications/usage?${query}`, { signal: controller.signal, cache: 'no-store' });
      if (!response.ok) {
        throw new Error('balance unavailable');
      }
      const body = await response.json();
      if (!body.data?.balance || !Number.isFinite(body.data.balance.availableCredits)) {
        throw new Error('invalid balance');
      }
      if (!controller.signal.aborted && serial === sequence.current && currentKey.current === key) {
        setState({ key, data: body.data, error: false });
      }
    } catch {
      // A failed refresh must not present an old balance as current.
      if (!controller.signal.aborted && serial === sequence.current && currentKey.current === key) {
        setState({ key, data: null, error: true });
      }
    }
  }, [key, salonSlug, view]);
  useEffect(() => {
    void refresh();
    const visibleRefresh = () => {
      if (document.visibilityState !== 'hidden') {
        void refresh();
      }
    };
    window.addEventListener('focus', visibleRefresh);
    document.addEventListener('visibilitychange', visibleRefresh);
    window.addEventListener(SMS_CREDITS_CHANGED_EVENT, visibleRefresh);
    window.addEventListener(RETENTION_DATA_CHANGED_EVENT, visibleRefresh);
    const timer = window.setInterval(visibleRefresh, 30_000);
    return () => {
      request.current?.abort();
      window.clearInterval(timer);
      window.removeEventListener('focus', visibleRefresh);
      document.removeEventListener('visibilitychange', visibleRefresh);
      window.removeEventListener(SMS_CREDITS_CHANGED_EVENT, visibleRefresh);
      window.removeEventListener(RETENTION_DATA_CHANGED_EVENT, visibleRefresh);
    };
  }, [refresh]);
  const matching = state?.key === key ? state : null;
  return { data: matching?.data ?? null, error: matching?.error ?? false, loading: matching === null, refresh };
}
