// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { confirmNormalHandoffBooking, recoverNormalBooking } from './normalBooking.client';

const mocks = vi.hoisted(() => ({ handoff: vi.fn(), writeHandoff: vi.fn() }));
vi.mock('./normalConfirmHandoff.client', () => ({ readNormalConfirmHandoff: mocks.handoff, writeNormalConfirmHandoff: mocks.writeHandoff }));

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
  vi.useRealTimers();
  mocks.writeHandoff.mockReset();
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

  it('polls an in-flight confirmation after refresh without a creation POST', async () => {
    vi.useFakeTimers();
    localStorage.setItem(key, JSON.stringify(operation));
    localStorage.setItem(`${key}.confirming`, '1');
    vi.stubGlobal('fetch', vi.fn()
      .mockResolvedValueOnce(response({ ...status, status: 'not_created' }))
      .mockResolvedValueOnce(response(status)));
    const recovered = recoverNormalBooking(salonId);
    await vi.runAllTimersAsync();

    await expect(recovered).resolves.toEqual(status);
    expect(localStorage.getItem(`${key}.confirming`)).toBeNull();
    expect(vi.mocked(fetch).mock.calls.every(([url]) => String(url).endsWith('/status'))).toBe(true);
  });

  it('adopts a legacy capability into the same server-verified flow without creation', async () => {
    mocks.handoff.mockReturnValue(null);
    const legacyKey = `luster.customer-booking.operation.${salonId}`;
    localStorage.setItem(legacyKey, JSON.stringify({ ...operation, version: 1, salonId }));
    vi.stubGlobal('fetch', vi.fn()
      .mockResolvedValueOnce(response({ handoff: { flowToken, expiresAt: operation.expiresAt }, status }))
      .mockResolvedValueOnce(response(status)));

    await expect(recoverNormalBooking(salonId)).resolves.toEqual(status);
    expect(JSON.parse(localStorage.getItem(key)!)).toEqual(operation);
    expect(mocks.writeHandoff).toHaveBeenCalledWith(salonId, { flowToken, expiresAt: operation.expiresAt });
    expect(localStorage.getItem(legacyKey)).toBeNull();
    expect(vi.mocked(fetch).mock.calls.map(([url]) => String(url).split('/').at(-1))).toEqual(['handoff', 'status']);
  });

  it('preserves legacy evidence when adoption storage fails', async () => {
    mocks.handoff.mockReturnValue(null);
    const legacyKey = `luster.customer-booking.operation.${salonId}`;
    localStorage.setItem(legacyKey, JSON.stringify({ ...operation, version: 1, salonId }));
    mocks.writeHandoff.mockImplementation(() => {
      throw new Error('storage failed');
    });
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response({ handoff: { flowToken, expiresAt: operation.expiresAt }, status })));

    await expect(recoverNormalBooking(salonId)).rejects.toThrow('storage failed');
    expect(localStorage.getItem(legacyKey)).not.toBeNull();
  });

  it('does not overwrite a conflicting normal operation with a legacy operation', async () => {
    localStorage.setItem(key, JSON.stringify(operation));
    const legacyKey = `luster.customer-booking.operation.${salonId}`;
    localStorage.setItem(legacyKey, JSON.stringify({ ...operation, capability: 'different', version: 1, salonId }));
    vi.stubGlobal('fetch', vi.fn());

    await expect(recoverNormalBooking(salonId)).rejects.toMatchObject({ reason: 'recovery_unavailable' });
    expect(fetch).not.toHaveBeenCalled();
    expect(localStorage.getItem(legacyKey)).not.toBeNull();
  });

  it('keeps unresolved confirmation contextual on refresh and retries only the same operation after a deliberate click', async () => {
    vi.useFakeTimers();
    localStorage.setItem(key, JSON.stringify(operation));
    localStorage.setItem(`${key}.confirming`, '1');
    const unresolved = { ...status, status: 'not_created', lastFailure: null };
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response(unresolved)));
    const recovery = expect(recoverNormalBooking(salonId)).rejects.toMatchObject({ reason: 'recovery_unavailable' });
    await vi.runAllTimersAsync();
    await recovery;

    expect(localStorage.getItem(`${key}.confirming`)).toBe('1');
    expect(vi.mocked(fetch).mock.calls.every(([url]) => String(url).endsWith('/status'))).toBe(true);

    vi.mocked(fetch).mockImplementation(async (url) => {
      if (String(url).endsWith('/prepare')) {
        return response({ operation }) as unknown as Response;
      }
      return response(String(url).endsWith('/confirm') ? status : unresolved) as unknown as Response;
    });
    const retry = confirmNormalHandoffBooking(args);
    await vi.runAllTimersAsync();

    await expect(retry).resolves.toEqual(status);

    const create = vi.mocked(fetch).mock.calls.filter(([url]) => String(url).endsWith('/confirm'));

    expect(create).toHaveLength(1);
    expect(JSON.parse(create[0]![1]!.body as string).capability).toBe(operation.capability);
  });
});

describe('contact-dependent deposit review', () => {
  it.each([
    { required: true, amountCents: 2500, currency: 'CAD', fingerprint: 'deposit-v1:cad:2500' },
    { required: false, fingerprint: 'deposit-v1:none' },
  ])('requires another user action after changed deposit terms: %j', async (deposit) => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 409, json: async () => ({ reason: 'deposit_changed', deposit, confirmationMode: 'instant' }) }));

    await expect(confirmNormalHandoffBooking(args)).rejects.toMatchObject({ reason: 'deposit_changed', depositUpdate: { deposit, confirmationMode: 'instant' } });
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(String(vi.mocked(fetch).mock.calls[0]?.[0])).toContain('/prepare');
    expect(localStorage.getItem(key)).toBeNull();
  });

  it('rejects inconsistent money disclosure rather than adopting it', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 409, json: async () => ({ reason: 'deposit_changed', deposit: { required: true, amountCents: 2500, currency: 'CAD', fingerprint: 'deposit-v1:cad:5000' }, confirmationMode: 'instant' }) }));

    await expect(confirmNormalHandoffBooking(args)).rejects.toMatchObject({ reason: 'review_unavailable' });
    expect(fetch).toHaveBeenCalledTimes(1);
  });
});
