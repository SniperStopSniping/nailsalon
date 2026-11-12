import { beforeEach, describe, expect, it, vi } from 'vitest';

import { computeCheckoutTotals } from '@/libs/checkoutTotals';
import { buildBookingTaxSnapshot, DISABLED_TAX_CONFIG } from '@/libs/taxConfig';

import { PaymentWorkspaceError } from './workspaceContract';
import { readPaymentWorkspaceView } from './workspaceService';

const mocks = vi.hoisted(() => ({ invoice: vi.fn(), binding: vi.fn() }));
vi.mock('server-only', () => ({}));
vi.mock('./workspaceInvoice', () => ({ readWorkspaceInvoice: mocks.invoice }));
vi.mock('./workspacePolicyRepository', () => ({ readWorkspaceBinding: mocks.binding }));
vi.mock('./workspaceRuntime', () => ({ workspaceRuntime: () => ({}) }));

const scope = { salonId: 'salon', appointmentId: 'appointment' };
const actor = { ...scope, id: 'owner', role: 'owner' as const, impersonating: false, canEditItems: true, canRecordPayment: true };
const totals = computeCheckoutTotals({ items: [{ lineTotalCents: 10000, taxable: true }], taxConfig: DISABLED_TAX_CONFIG });
const invoice = { currency: 'CAD' as const, items: [{ id: 'item', kind: 'service' as const, name: 'Manicure', quantity: 1, unitPriceCents: 10000, lineTotalCents: 10000 }], subtotalCents: 10000, discountCents: 0, taxSnapshot: buildBookingTaxSnapshot({ taxConfig: DISABLED_TAX_CONFIG, totals, currency: 'CAD', capturedAt: new Date() }), tipCents: 0 };
const state = { revision: 0, bill: { ...scope, revision: 0, serviceCents: 10000, taxCents: 0, tipCents: 0 }, billSourceHash: 'a'.repeat(64), invoice, billChanges: [], payments: [], refunds: [], requests: [], operations: [] };
const repository = {
  inspect: async (_actor: unknown, inspect: (tx: unknown, appointment: unknown, state: unknown) => Promise<unknown>) => ({ state, context: await inspect({}, {}, state) }),
} as unknown as Parameters<typeof readPaymentWorkspaceView>[0];

beforeEach(() => {
  vi.resetAllMocks();
  mocks.invoice.mockResolvedValue({ ...state, initialPayments: [], collectionHold: false });
  mocks.binding.mockResolvedValue({ connectedAccountId: 'PRIVATE_ACCOUNT_ID' });
});

describe('payment history projection', () => {
  it('returns readable invoice details without provider binding or internal source hashes', async () => {
    const result = await readPaymentWorkspaceView(repository, actor);

    expect(result.invoice.items[0]?.name).toBe('Manicure');
    expect(result.onlinePaymentsAvailable).toBe(true);
    expect(JSON.stringify(result)).not.toMatch(/PRIVATE_ACCOUNT_ID|billSourceHash|actorId|bindingId/);
  });

  it('retains readable history after cancellation but marks the saved bill as needing review', async () => {
    mocks.invoice.mockRejectedValue(new PaymentWorkspaceError('PAYMENT_WORKSPACE_APPOINTMENT_INELIGIBLE'));
    const result = await readPaymentWorkspaceView(repository, actor);

    expect(result.sourceChanged).toBe(true);
    expect(result.invoice.items[0]?.name).toBe('Manicure');
    expect(result.onlinePaymentsAvailable).toBe(false);
    expect(result.balance).toMatchObject({ canReservePayment: false, canReserveRefund: false, blockedReasons: ['PAYMENT_UNDER_REVIEW'] });
  });

  it('propagates a canonical tender review hold into both financial actions', async () => {
    mocks.invoice.mockResolvedValue({ ...state, initialPayments: [], collectionHold: true });

    expect((await readPaymentWorkspaceView(repository, actor)).balance).toMatchObject({ canReservePayment: false, canReserveRefund: false, blockedReasons: ['PAYMENT_UNDER_REVIEW'] });
  });

  it('does not hide a database outage behind a stale success response', async () => {
    mocks.invoice.mockRejectedValue(new Error('database unavailable'));

    await expect(readPaymentWorkspaceView(repository, actor)).rejects.toThrow('database unavailable');
  });
});
