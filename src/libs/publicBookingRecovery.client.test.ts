// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { beginPublicBookingAttempt, clearPublicBookingAttempt, clearResolvedPublicBookingAttempt, readPublicBookingAttempt, recoverPublicBookingAttempt, resolvePublicBookingAttempt } from './publicBookingRecovery.client';

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

  it('clears a completed receipt for a new selection at the same confirmation URL but preserves pending attempts', () => {
    const confirmationPath = '/book/confirm?time=10';
    beginPublicBookingAttempt({ salonId: 'a', attemptId, confirmationPath });
    clearResolvedPublicBookingAttempt('a');
    expect(readPublicBookingAttempt('a')?.state).toBe('pending');

    resolvePublicBookingAttempt('a', receipt);
    clearResolvedPublicBookingAttempt('b');
    expect(readPublicBookingAttempt('a')?.state).toBe('resolved');

    clearResolvedPublicBookingAttempt('a');
    expect(readPublicBookingAttempt('a')).toBeNull();
    const next = beginPublicBookingAttempt({ salonId: 'a', attemptId: crypto.randomUUID(), confirmationPath });
    expect(next.attemptId).not.toBe(attemptId);
  });

  it('fails closed on malformed storage or failed persistence', () => {
    sessionStorage.setItem('luster.public-booking-attempt.v1.a', '{}');

    expect(() => readPublicBookingAttempt('a')).toThrow();

    sessionStorage.clear();
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {});

    expect(() => beginPublicBookingAttempt({ salonId: 'a', attemptId, confirmationPath: '/book/confirm' })).toThrow('BOOKING_RECOVERY_STORAGE_UNAVAILABLE');
  });

  it('releases only a server-proven failure and allows a new attempt at the same salon', async () => {
    beginPublicBookingAttempt({ salonId: 'a', attemptId, confirmationPath: '/book/confirm' });
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => ({ kind: 'resolved_failure' }) }));

    await expect(recoverPublicBookingAttempt('a')).resolves.toEqual({ kind: 'resolved_failure' });
    expect(readPublicBookingAttempt('a')).toBeNull();

    const next = beginPublicBookingAttempt({ salonId: 'a', attemptId: crypto.randomUUID(), confirmationPath: '/book/confirm' });

    expect(next.attemptId).not.toBe(attemptId);
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('does not clear a newer attempt when an older status response arrives', async () => {
    beginPublicBookingAttempt({ salonId: 'a', attemptId, confirmationPath: '/book/confirm' });
    let finish!: (value: unknown) => void;
    vi.stubGlobal('fetch', vi.fn().mockReturnValue(new Promise((resolve) => {
      finish = resolve;
    })));
    const recovery = recoverPublicBookingAttempt('a');
    clearPublicBookingAttempt('a');
    const next = beginPublicBookingAttempt({ salonId: 'a', attemptId: crypto.randomUUID(), confirmationPath: '/book/confirm' });
    finish({ ok: true, json: async () => ({ kind: 'resolved_failure' }) });

    await expect(recovery).resolves.toBeNull();
    expect(readPublicBookingAttempt('a')?.attemptId).toBe(next.attemptId);
  });

  it('uses the durable v2 protocol only for newly created browser attempts', async () => {
    const attempt = beginPublicBookingAttempt({ salonId: 'a', attemptId, confirmationPath: '/book/confirm' });
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => ({ kind: 'resolved_success', response: receipt }) }));

    await expect(recoverPublicBookingAttempt('a')).resolves.toEqual(receipt);
    expect(JSON.parse(vi.mocked(fetch).mock.calls[0]![1]!.body as string)).toEqual({
      attemptId,
      recoveryKey: attempt.recoveryKey,
      version: 2,
      startedAt: attempt.startedAt,
    });
  });

  it('never upgrades legacy pending evidence to the new failure authority', async () => {
    vi.useFakeTimers();
    sessionStorage.setItem('luster.public-booking-attempt.v1.a', JSON.stringify({
      version: 1,
      salonId: 'a',
      attemptId,
      recoveryKey: crypto.randomUUID(),
      confirmationPath: '/book/confirm',
      state: 'pending',
    }));
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => ({ kind: 'unknown' }) }));
    const result = recoverPublicBookingAttempt('a');
    await vi.runAllTimersAsync();

    await expect(result).resolves.toBeNull();
    expect(readPublicBookingAttempt('a')?.state).toBe('pending');
    expect(JSON.parse(vi.mocked(fetch).mock.calls[0]![1]!.body as string)).not.toHaveProperty('version');
  });
});
