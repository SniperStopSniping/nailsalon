import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { adjustmentPermissions, resolveAdjustmentBalance } from '@/libs/customerPayments/adjustments';
import type { PaymentWorkspaceView } from '@/libs/customerPayments/workspaceView';

import { AppointmentPaymentWorkspace } from './AppointmentPaymentWorkspace';

const fetchMock = vi.fn();
const scope = { salonId: 'salon', appointmentId: 'appointment' };
const permissions = adjustmentPermissions({ role: 'owner', hasAppointmentAccess: true, impersonating: false, canEditItems: true, canRecordPayment: true });
function fixture(paid = false): PaymentWorkspaceView {
  const payments = paid ? [{ ...scope, id: 'original-online-payment', movementId: 'charge', kind: 'online' as const, principalCents: 12000, tipCents: 1000, state: 'confirmed' as const }] : [];
  const bill = { ...scope, revision: 0, serviceCents: 10000, taxCents: 0, tipCents: 1000 };
  return { initialized: true, sourceChanged: false, onlinePaymentsAvailable: true, permissions, invoice: { items: [], subtotalCents: 10000, discountCents: 0, taxCents: 0, tipCents: 1000 }, balance: resolveAdjustmentBalance({ revision: 4, bill, payments, refunds: [], requests: [] }), payments: [], operations: [] };
}
const response = (data: PaymentWorkspaceView, checkoutUrl: string | null = null) => ({ ok: true, json: async () => ({ data, checkoutUrl }) });
const props = { appointmentId: 'appointment', salonSlug: 'salon', hasUnsavedInvoice: false, refreshKey: 'initial', onChanged: vi.fn(async () => {}), onBusyChange: vi.fn() };
async function open() {
  fireEvent.click(screen.getByText(/^Payments/));
  await screen.findByText('Saved total');
}

beforeEach(() => {
  vi.resetAllMocks();
  vi.stubGlobal('fetch', fetchMock);
});

describe('technician payment workspace', () => {
  it('refreshes resolved deposit credit without creating a payment or issuing a refund', async () => {
    const view = { ...fixture(), sourceChanged: true };
    fetchMock.mockResolvedValueOnce(response(view));
    render(<AppointmentPaymentWorkspace {...props} />);
    await open();
    fetchMock.mockResolvedValueOnce(response({ ...view, sourceChanged: false, payments: [{ id: 'deposit', kind: 'deposit', amountCents: 2000, state: 'confirmed', depositDisposition: 'refunded', voided: false }] }));
    fireEvent.click(screen.getByRole('button', { name: 'Refresh deposit credit' }));

    expect(await screen.findByText(/Deposit refunded/)).toBeInTheDocument();
    expect(JSON.parse(fetchMock.mock.calls[1]![1].body)).toMatchObject({ kind: 'reconcile_deposits' });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(screen.queryByRole('button', { name: 'Refresh deposit credit' })).not.toBeInTheDocument();
  });

  it.each([false, true])('does not block an unrelated legacy checkout on a history read failure (existing workspace=%s)', async (hasWorkspace) => {
    const onHoldChange = vi.fn();
    fetchMock.mockResolvedValueOnce({ ok: false, json: async () => ({ error: { code: 'PAYMENT_WORKSPACE_FROZEN_INVOICE_REQUIRED' } }) });
    render(<AppointmentPaymentWorkspace {...props} hasWorkspace={hasWorkspace} onHoldChange={onHoldChange} />);
    fireEvent.click(screen.getByText(/^Payments/));
    await screen.findByRole('alert');

    expect(onHoldChange).toHaveBeenLastCalledWith(hasWorkspace);
  });

  it('uses only the saved server balance and blocks collection while service edits are unsaved', async () => {
    fetchMock.mockResolvedValueOnce(response(fixture()));
    render(<AppointmentPaymentWorkspace {...props} hasUnsavedInvoice />);
    await open();

    expect(screen.getByRole('button', { name: /Create .* payment link/ })).toBeDisabled();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('status')).toHaveTextContent('Finish saving');
  });

  it('creates a payment link without marking its open request paid', async () => {
    const view = fixture();
    fetchMock.mockResolvedValueOnce(response(view));
    render(<AppointmentPaymentWorkspace {...props} />);
    await open();
    fetchMock.mockResolvedValueOnce(response({ ...view, operations: [{ id: 'operation', kind: 'payment', state: 'open', principalCents: 10000, tipCents: 1000, reason: null, createdAt: 1 }] }, 'https://checkout.stripe.com/c/pay/test-link'));
    fireEvent.click(screen.getByRole('button', { name: /Create .* payment link/ }));

    expect(await screen.findByRole('link', { name: 'Open secure payment page' })).toHaveAttribute('href', 'https://checkout.stripe.com/c/pay/test-link');
    expect(screen.getByText(/Payment link open/)).toBeInTheDocument();
    expect(JSON.parse(fetchMock.mock.calls[1]![1].body)).toMatchObject({ kind: 'request_payment', expectedRevision: 4 });
    expect(JSON.parse(fetchMock.mock.calls[1]![1].body)).not.toHaveProperty('amountCents');
  });

  it('retries a lost response with the identical command and never blindly creates a second payment', async () => {
    const view = fixture();
    fetchMock.mockResolvedValueOnce(response(view));
    render(<AppointmentPaymentWorkspace {...props} />);
    await open();
    fetchMock.mockRejectedValueOnce(new TypeError('Response lost'));
    fireEvent.click(screen.getByRole('button', { name: /Create .* payment link/ }));
    await screen.findByRole('alert');
    const body = fetchMock.mock.calls[1]![1].body;

    expect(screen.getByRole('button', { name: /Create .* payment link/ })).toBeDisabled();

    fetchMock.mockResolvedValueOnce(response(view));
    fetchMock.mockResolvedValueOnce(response(view));
    fireEvent.click(screen.getByRole('button', { name: 'Check saved request' }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(4));

    expect(fetchMock.mock.calls[3]![1].body).toBe(body);
  });

  it('shows the exact original-payment allocation before the owner confirms a refund', async () => {
    const view = fixture(true);
    fetchMock.mockResolvedValueOnce(response(view));
    render(<AppointmentPaymentWorkspace {...props} />);
    await open();
    fireEvent.change(screen.getByLabelText('Refund to the original online payment'), { target: { value: 'original-online-payment' } });
    fireEvent.change(screen.getByLabelText('Reason for refund'), { target: { value: 'Removed nail art' } });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(screen.getByText(/Confirming submits this refund to Stripe/)).toHaveTextContent('20.00');

    fetchMock.mockResolvedValueOnce(response(view));
    fireEvent.click(screen.getByRole('button', { name: /Confirm .* refund/ }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));

    expect(JSON.parse(fetchMock.mock.calls[1]![1].body)).toMatchObject({ kind: 'request_refund', paymentId: 'original-online-payment', principalCents: 2000, tipCents: 0, reason: 'Removed nail art', expectedRevision: 4 });
  });

  it('offers staff approval requests without owner approval controls', async () => {
    const view = fixture(true);
    fetchMock.mockResolvedValueOnce(response({ ...view, permissions: { ...view.permissions, canIssueRefund: false } }));
    render(<AppointmentPaymentWorkspace {...props} />);
    await open();

    expect(screen.getByRole('button', { name: 'Request owner refund approval' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Confirm .* refund/ })).not.toBeInTheDocument();
  });
});
