// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { beginPublicBookingAttempt, clearPublicBookingAttempt, readPublicBookingAttempt, recoverPublicBookingAttempt, resolvePublicBookingAttempt } from './publicBookingRecovery.client';

const attemptId = '123e4567-e89b-12d3-a456-426614174000';
const receipt = { data: { appointmentId: 'appointment-a', appointment: { id: 'appointment-a', status: 'confirmed' } } };

beforeEach(() => {
  sessionStorage.clear();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe('manual booking receipt recovery', () => {
  it('does nothing for a new visitor', async () => {
    vi.stubGlobal('fetch', vi.fn());

    expect(readPublicBookingAttempt('a')).toBeNull();
    await expect(recoverPublicBookingAttempt('a')).resolves.toBeNull();
    expect(fetch).not.toHaveBeenCalled();
  });

  it('preserves identity across refresh and blocks a second create while uncertain', () => {
    const first = beginPublicBookingAttempt({ salonId: 'a', attemptId, confirmationPath: '/book/confirm?time=10' });

    expect(readPublicBookingAttempt('a')).toEqual(first);
    expect(() => beginPublicBookingAttempt({ salonId: 'a', attemptId: crypto.randomUUID(), confirmationPath: '/book/confirm' })).toThrow('BOOKING_RECOVERY_REQUIRED');
    expect(readPublicBookingAttempt('b')).toBeNull();
  });

  it('reconciles lost success by reads without ever resubmitting creation', async () => {
    vi.useFakeTimers();
    beginPublicBookingAttempt({ salonId: 'a', attemptId, confirmationPath: '/book/confirm' });
    vi.stubGlobal('fetch', vi.fn()
      .mockResolvedValueOnce({ ok: true, json: async () => ({ kind: 'unresolved' }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ kind: 'resolved', response: receipt }) }));
    const result = recoverPublicBookingAttempt('a');
    await vi.runAllTimersAsync();

    await expect(result).resolves.toEqual(receipt);
    expect(readPublicBookingAttempt('a')?.state).toBe('resolved');
    expect(vi.mocked(fetch).mock.calls.every(([url]) => String(url).endsWith('/status'))).toBe(true);
    expect(JSON.parse(vi.mocked(fetch).mock.calls[0]![1]!.body as string).attemptId).toBe(attemptId);
  });

  it('retains unknown outcomes after failed reads and repeated recovery', async () => {
    vi.useFakeTimers();
    beginPublicBookingAttempt({ salonId: 'a', attemptId, confirmationPath: '/book/confirm' });
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')));
    const result = recoverPublicBookingAttempt('a');
    await vi.runAllTimersAsync();

    await expect(result).resolves.toBeNull();
    expect(readPublicBookingAttempt('a')?.attemptId).toBe(attemptId);
    expect(readPublicBookingAttempt('a')?.state).toBe('pending');
    expect(fetch).toHaveBeenCalledTimes(4);
  });

  it('restores resolved receipt locally and permits a new deliberate attempt', async () => {
    beginPublicBookingAttempt({ salonId: 'a', attemptId, confirmationPath: '/book/confirm' });
    resolvePublicBookingAttempt('a', receipt);
    vi.stubGlobal('fetch', vi.fn());

    await expect(recoverPublicBookingAttempt('a')).resolves.toEqual(receipt);
    expect(fetch).not.toHaveBeenCalled();

    clearPublicBookingAttempt('a');

    expect(readPublicBookingAttempt('a')).toBeNull();
  });

  it('fails closed on malformed storage or failed persistence', () => {
    sessionStorage.setItem('luster.public-booking-attempt.v1.a', '{}');

    expect(() => readPublicBookingAttempt('a')).toThrow();

    sessionStorage.clear();
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {});

    expect(() => beginPublicBookingAttempt({ salonId: 'a', attemptId, confirmationPath: '/book/confirm' })).toThrow('BOOKING_RECOVERY_STORAGE_UNAVAILABLE');
  });
});
