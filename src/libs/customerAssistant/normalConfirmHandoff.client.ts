import { useSyncExternalStore } from 'react';

const changedEvent = 'luster-normal-booking-handoff-changed';

export type NormalConfirmHandoffStorage = { flowToken: string; expiresAt: string };

function key(salonId: string): string {
  return `luster.normal-confirm-handoff.v1.${salonId}`;
}

/** Expired and damaged state must never turn an AI handoff into a fresh legacy booking. */
export function readNormalConfirmHandoff(salonId: string): NormalConfirmHandoffStorage | null {
  const raw = sessionStorage.getItem(key(salonId));
  if (!raw) {
    return null;
  }
  const value = JSON.parse(raw) as NormalConfirmHandoffStorage;
  if (typeof value.flowToken !== 'string' || !/^v1\.[0-9a-f-]{36}\.\d+\.[\w-]+$/i.test(value.flowToken)
    || typeof value.expiresAt !== 'string' || !Number.isFinite(Date.parse(value.expiresAt))) {
    throw new Error('HANDOFF_STORAGE_INVALID');
  }
  return value;
}

export function writeNormalConfirmHandoff(salonId: string, value: NormalConfirmHandoffStorage): void {
  sessionStorage.setItem(key(salonId), JSON.stringify(value));
  if (readNormalConfirmHandoff(salonId)?.flowToken !== value.flowToken) {
    throw new Error('HANDOFF_STORAGE_UNAVAILABLE');
  }
  window.dispatchEvent(new Event(changedEvent));
}

export function clearNormalConfirmHandoff(salonId: string): void {
  sessionStorage.removeItem(key(salonId));
  window.dispatchEvent(new Event(changedEvent));
}

function subscribeToHandoff(callback: () => void): () => void {
  window.addEventListener(changedEvent, callback);
  window.addEventListener('popstate', callback);
  return () => {
    window.removeEventListener(changedEvent, callback);
    window.removeEventListener('popstate', callback);
  };
}

/** URL history may predate acceptance. Presence keeps recovery fail-closed even for damaged/expired tokens. */
export function useNormalBookingFlowMarker(salonId: string | undefined, requested: string | null): 'assistant' | null {
  return useSyncExternalStore(subscribeToHandoff, () => {
    if (requested === 'assistant') {
      return 'assistant';
    }
    if (!salonId) {
      return null;
    }
    try {
      return sessionStorage.getItem(key(salonId)) === null ? null : 'assistant';
    } catch {
      return null;
    }
  }, () => requested === 'assistant' ? 'assistant' : null);
}
