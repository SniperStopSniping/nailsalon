// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { confirmNormalHandoffBooking, recoverNormalBooking } from './normalBooking.client';

const mocks = vi.hoisted(() => ({ handoff: vi.fn() }));
vi.mock('./normalConfirmHandoff.client', () => ({ readNormalConfirmHandoff: mocks.handoff }));

const salonId = 'salon-a';
const flowToken = 'v1.123e4567-e89b-12d3-a456-426614174000.1.mac';
const operation = { capability: 'capability', revision: 1, fingerprint: 'a'.repeat(64), expiresAt: '2030-01-01T03:00:00.000Z' };
const status = { kind: 'booking_status', operation, status: 'confirmed', review: {}, appointment: null, payment: null, lastFailure: null };
const args = { salonId, booking: { clientName: 'Ava', clientEmail: 'ava@example.test', clientPhone: '4165551212' }, displayed: {} } as never;
const key = `luster.normal-booking.operation.${salonId}.${flowToken.split('.')[1]}`;

function response(value: unknown, ok = true) {
  return { ok, json: vi.fn().mockResolvedValue(value) };
}

beforeEach(() => {
  localStorage.clear();
  vi.restoreAllMocks();
  mocks.handoff.mockReturnValue({ flowToken, expiresAt: '2030-01-01T02:00:00.000Z' });
  vi.spyOn(Date, 'now').mockReturnValue(new Date('2030-01-01T00:00:00.000Z').getTime());
});

describe('normal booking coordinator', () => {
  it('reads status before repeated confirmation and does not prepare/create a committed operation', async () => {
    localStorage.setItem(key, JSON.stringify(operation));
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response(status)));

    await expect(confirmNormalHandoffBooking(args)).resolves.toEqual(status);
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(String((fetch as ReturnType<typeof vi.fn>).mock.calls[0]?.[0])).toContain('/status');
  });

  it('saves the operation before create and recovers its status after a lost create response', async () => {
    vi.stubGlobal('fetch', vi.fn()
      .mockResolvedValueOnce(response({ operation }))
      .mockRejectedValueOnce(new Error('timeout'))
      .mockResolvedValueOnce(response(status)));

    await expect(confirmNormalHandoffBooking(args)).resolves.toEqual(status);
    expect(JSON.parse(localStorage.getItem(key)!)).toMatchObject(operation);
    expect(fetch).toHaveBeenCalledTimes(3);
  });

  it('blocks creation when storage cannot preserve the prepared capability', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response({ operation })));
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {});

    await expect(confirmNormalHandoffBooking(args)).rejects.toMatchObject({ reason: 'storage_unavailable' });
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('keeps the flow identity through a lost prepare response and retries preparation', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValueOnce(new Error('lost')).mockResolvedValueOnce(response({ operation })).mockResolvedValueOnce(response(status)));

    await expect(confirmNormalHandoffBooking(args)).rejects.toThrow('lost');
    await expect(confirmNormalHandoffBooking(args)).resolves.toEqual(status);

    const prepareBodies = (fetch as ReturnType<typeof vi.fn>).mock.calls.filter(([url]) => String(url).endsWith('/prepare')).map(([, init]) => JSON.parse((init as RequestInit).body as string));

    expect(prepareBodies.every(body => body.flowToken === flowToken)).toBe(true);
  });

  it('allows expired flow recovery but never creation', async () => {
    localStorage.setItem(key, JSON.stringify(operation));
    mocks.handoff.mockReturnValue({ flowToken, expiresAt: '2029-01-01T00:00:00.000Z' });
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response({ ...status, status: 'not_created' })));

    await expect(confirmNormalHandoffBooking(args)).rejects.toMatchObject({ reason: 'handoff_expired' });
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('never falls back when handoff is missing or invalid storage is present', async () => {
    mocks.handoff.mockReturnValue(null);

    await expect(recoverNormalBooking(salonId)).rejects.toMatchObject({ reason: 'handoff_missing' });

    mocks.handoff.mockReturnValue({ flowToken, expiresAt: '2030-01-01T02:00:00.000Z' });
    localStorage.setItem(key, '{}');

    await expect(recoverNormalBooking(salonId)).rejects.toMatchObject({ reason: 'recovery_unavailable' });
  });
});
