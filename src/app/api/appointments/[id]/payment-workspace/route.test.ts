import { randomUUID } from 'node:crypto';

import { beforeEach, describe, expect, it, vi } from 'vitest';

import { PaymentWorkspaceError } from '@/libs/customerPayments/server/workspaceContract';

import { GET, POST } from './route';

const mocks = vi.hoisted(() => ({ access: vi.fn(), initialize: vi.fn(), command: vi.fn(), read: vi.fn(), view: vi.fn(), dispatch: vi.fn(), reconcile: vi.fn(), cancel: vi.fn(), reader: vi.fn(), prepare: vi.fn() }));
vi.mock('server-only', () => ({}));
vi.mock('@/libs/DB', () => ({ db: {} }));
vi.mock('@/libs/customerPayments/server/workspaceAccess', () => ({ requireWorkspaceActor: mocks.access }));
vi.mock('@/libs/customerPayments/server/workspaceRepository', () => ({ createPaymentWorkspaceRepository: () => ({ initialize: mocks.initialize, command: mocks.command, read: mocks.read }) }));
vi.mock('@/libs/customerPayments/server/workspaceService', () => ({ readPaymentWorkspaceView: mocks.view, readCurrentWorkspaceBinding: mocks.reader }));
vi.mock('@/libs/customerPayments/server/workspaceInvoice', () => ({ prepareWorkspaceInvoice: mocks.prepare }));
vi.mock('@/libs/customerPayments/server/workspaceDispatcher', () => ({ dispatchWorkspacePayment: mocks.dispatch, reconcileWorkspacePayment: mocks.reconcile, cancelWorkspacePayment: mocks.cancel }));
vi.mock('@/libs/customerAssistant/http.server', () => ({ readCustomerJson: (request: Request) => request.json().catch(() => null) }));

const actor = { id: 'assigned-staff', salonId: 'salon', appointmentId: 'appointment', role: 'staff' as const, impersonating: false, canEditItems: true, canRecordPayment: true };
const operationId = randomUUID();
const params = { params: Promise.resolve({ id: actor.appointmentId }) };
const requestPayment = { kind: 'request_payment', requestId: randomUUID(), expectedRevision: 0 };
function request(body: unknown = requestPayment, origin = 'https://example.invalid') {
  return new Request('https://example.invalid/api/appointments/appointment/payment-workspace', { method: 'POST', headers: { origin, 'content-type': 'application/json' }, body: JSON.stringify(body) });
}

beforeEach(() => {
  vi.resetAllMocks();
  vi.stubEnv('APP_ENV', 'test');
  vi.stubEnv('VERCEL', '');
  vi.stubEnv('CUSTOMER_PAYMENTS_WORKSPACE_ENABLED', 'true');
  vi.stubEnv('STRIPE_SECRET_KEY', ['sk', 'test', 'non-provider-fixture'].join('_'));
  mocks.access.mockResolvedValue({ ok: true, actor });
  mocks.command.mockResolvedValue({ state: { operations: [{ id: operationId }] } });
  mocks.read.mockResolvedValue({ operations: [{ id: operationId, kind: 'payment', state: 'prepared', providerObjectId: null }] });
  mocks.dispatch.mockResolvedValue({ checkoutUrl: 'https://checkout.stripe.com/c/pay/cs_test_fixture' });
  mocks.reconcile.mockResolvedValue({ checkoutUrl: null });
  mocks.view.mockResolvedValue({ sourceChanged: false, operations: [{ id: operationId, state: 'open' }] });
});

describe('authenticated appointment payment actions', () => {
  it('does no authentication or financial work while the feature is disabled', async () => {
    vi.stubEnv('CUSTOMER_PAYMENTS_WORKSPACE_ENABLED', 'false');

    expect((await GET(request(), params)).status).toBe(404);
    expect((await POST(request(), params)).status).toBe(404);
    expect(mocks.access).not.toHaveBeenCalled();
    expect(mocks.dispatch).not.toHaveBeenCalled();
  });

  it.each([401, 403, 404])('returns the tenant/session denial (%i) before reading money', async (status) => {
    mocks.access.mockResolvedValue({ ok: false, response: new Response(null, { status }) });

    expect((await GET(request(), params)).status).toBe(status);
    expect((await POST(request(), params)).status).toBe(status);
    expect(mocks.read).not.toHaveBeenCalled();
    expect(mocks.command).not.toHaveBeenCalled();
  });

  it('rejects cross-origin actions and client-supplied financial or actor authority', async () => {
    expect((await POST(request(requestPayment, 'https://foreign.invalid'), params)).status).toBe(403);
    expect(mocks.access).not.toHaveBeenCalled();

    for (const extra of [{ amountCents: 1 }, { salonId: 'other' }, { actor }, { binding: {} }]) {
      expect((await POST(request({ ...requestPayment, ...extra }), params)).status).toBe(400);
    }

    expect(mocks.command).not.toHaveBeenCalled();
    expect(mocks.dispatch).not.toHaveBeenCalled();
  });

  it('reserves before dispatch and returns only the freshly read open request URL', async () => {
    const response = await POST(request(), params);

    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('private, no-store');
    expect(mocks.command).toHaveBeenCalledWith(actor, requestPayment, mocks.reader);
    expect(mocks.command.mock.invocationCallOrder[0]!).toBeLessThan(mocks.dispatch.mock.invocationCallOrder[0]!);
    expect(mocks.dispatch).toHaveBeenCalledWith(expect.anything(), actor, operationId, expect.any(String), mocks.reader);
    expect(await response.json()).toMatchObject({ checkoutUrl: 'https://checkout.stripe.com/c/pay/cs_test_fixture' });

    mocks.view.mockResolvedValue({ sourceChanged: false, operations: [{ id: operationId, state: 'succeeded' }] });

    expect(await (await POST(request(), params)).json()).toMatchObject({ checkoutUrl: null });
  });

  it('uses current state on retry and never dispatches again after settlement', async () => {
    mocks.read.mockResolvedValue({ operations: [{ id: operationId, kind: 'payment', state: 'succeeded', providerObjectId: 'cs_test_fixture' }] });

    expect((await POST(request(), params)).status).toBe(200);
    expect(mocks.dispatch).not.toHaveBeenCalled();
    expect(mocks.reconcile).not.toHaveBeenCalled();
  });

  it('refreshes with the minimal trusted tenant scope and never accepts a return redirect as proof', async () => {
    mocks.read.mockResolvedValue({ operations: [{ id: operationId, state: 'open', providerObjectId: 'cs_test_fixture' }] });
    const response = await POST(request({ kind: 'refresh', requestId: randomUUID(), expectedRevision: 2, operationId }), params);

    expect(response.status).toBe(200);
    expect(mocks.reconcile).toHaveBeenCalledWith(expect.anything(), { salonId: actor.salonId, appointmentId: actor.appointmentId }, operationId, expect.any(String));
    expect(mocks.dispatch).not.toHaveBeenCalled();
  });

  it('keeps uncertain provider failures actionable without exposing provider error details', async () => {
    mocks.dispatch.mockRejectedValue(new Error('PRIVATE_PROVIDER_URL_OR_KEY'));
    const response = await POST(request(), params);

    expect(response.status).toBe(503);
    expect(await response.text()).not.toContain('PRIVATE_');

    mocks.command.mockRejectedValue(new PaymentWorkspaceError('PAYMENT_WORKSPACE_STALE'));

    expect((await POST(request(), params)).status).toBe(409);
  });
});
