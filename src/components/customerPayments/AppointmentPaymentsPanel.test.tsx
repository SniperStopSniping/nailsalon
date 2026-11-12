import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { adjustmentPermissions, resolveAdjustmentBalance } from '@/libs/customerPayments/adjustments';

import type { AppointmentPaymentsPanelProps } from './AppointmentPaymentsPanel';
import { AppointmentPaymentsPanel } from './AppointmentPaymentsPanel';

function props(serviceCents = 12000, role: 'owner' | 'staff' = 'staff'): AppointmentPaymentsPanelProps {
  const scope = { salonId: 'salon-one', appointmentId: 'appointment-one' };
  return {
    appointmentId: scope.appointmentId,
    clientName: 'Example client',
    balance: resolveAdjustmentBalance({ revision: 2, bill: { ...scope, revision: 2, serviceCents, taxCents: 0, tipCents: 0 }, payments: [{ ...scope, id: 'payment-one', movementId: 'charge-one', kind: 'online', principalCents: 10000, tipCents: 0, state: 'confirmed' }], refunds: [], requests: [] }),
    permissions: adjustmentPermissions({ role, hasAppointmentAccess: true, impersonating: false, canEditItems: true, canRecordPayment: true }),
    onlinePaymentsAvailable: true,
    history: [{ id: 'payment-one', label: 'Original online payment', amountCents: 10000, status: 'paid' }],
    onAction: vi.fn().mockResolvedValue(undefined),
  };
}

describe('appointment payments panel', () => {
  it('requests the outstanding difference and keeps original history visible', async () => {
    const p = props();
    render(<AppointmentPaymentsPanel {...p} />);
    fireEvent.click(screen.getByRole('button', { name: 'Request $20.00 payment' }));
    await waitFor(() => expect(p.onAction).toHaveBeenCalledWith('request_payment', { expectedRevision: 2 }));

    expect(screen.getByText('Original online payment')).toBeVisible();
    expect(screen.queryByText('Payment successful')).not.toBeInTheDocument();
  });

  it('does not dispatch another request while the first is unresolved', () => {
    const p = props();
    p.onAction = vi.fn().mockReturnValue(new Promise(() => {}));
    render(<AppointmentPaymentsPanel {...p} />);
    const button = screen.getByRole('button', { name: 'Request $20.00 payment' });
    fireEvent.click(button);
    fireEvent.click(button);
    fireEvent.click(screen.getByRole('button', { name: 'Record payment received' }));

    expect(p.onAction).toHaveBeenCalledTimes(1);
  });

  it('requires a successful refresh after an interrupted operation before another action', async () => {
    const p = props();
    p.onAction = vi.fn().mockRejectedValueOnce(new Error('connection lost')).mockResolvedValue(undefined);
    render(<AppointmentPaymentsPanel {...p} />);
    fireEvent.click(screen.getByRole('button', { name: 'Request $20.00 payment' }));
    await screen.findByRole('alert');

    expect(screen.getByRole('button', { name: 'Request $20.00 payment' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Record payment received' })).toBeDisabled();

    fireEvent.click(screen.getByRole('button', { name: 'Refresh payment history' }));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Request $20.00 payment' })).toBeEnabled());

    expect(p.onAction).toHaveBeenLastCalledWith('refresh', { expectedRevision: 2 });
  });

  it('lets staff submit a reason for owner review without exposing refund execution', async () => {
    const p = props(8000);
    render(<AppointmentPaymentsPanel {...p} />);
    fireEvent.click(screen.getByRole('button', { name: 'Request owner refund approval' }));

    expect(screen.getByRole('button', { name: 'Send for owner approval' })).toBeDisabled();

    fireEvent.change(screen.getByLabelText('Reason for refund'), { target: { value: 'Nail art removed' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send for owner approval' }));
    await waitFor(() => expect(p.onAction).toHaveBeenCalledWith('request_refund', { expectedRevision: 2, reason: 'Nail art removed' }));

    expect(screen.queryByRole('button', { name: 'Continue to refund details' })).not.toBeInTheDocument();
  });

  it('can refresh an open request without releasing its collection hold', async () => {
    const p = props();
    p.balance = { ...p.balance, canReservePayment: false, blockedReasons: ['PAYMENT_REQUEST_ACTIVE'] };
    render(<AppointmentPaymentsPanel {...p} />);
    fireEvent.click(screen.getByRole('button', { name: 'Check payment status' }));
    await waitFor(() => expect(p.onAction).toHaveBeenCalledWith('refresh', { expectedRevision: 2 }));

    expect(screen.getByRole('button', { name: 'Request $20.00 payment' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Record payment received' })).toBeDisabled();
  });

  it('takes the owner to payment allocation review rather than immediately refunding', async () => {
    const p = props(8000, 'owner');
    render(<AppointmentPaymentsPanel {...p} />);
    fireEvent.click(screen.getByRole('button', { name: 'Review refund' }));
    fireEvent.change(screen.getByLabelText('Reason for refund'), { target: { value: 'Service removed' } });
    fireEvent.click(screen.getByRole('button', { name: 'Continue to refund details' }));
    await waitFor(() => expect(p.onAction).toHaveBeenCalledWith('review_refund', { expectedRevision: 2, reason: 'Service removed' }));
  });

  it('invalidates open refund review when the bill changes', () => {
    const p = props(8000, 'owner');
    const { rerender } = render(<AppointmentPaymentsPanel {...p} />);
    fireEvent.click(screen.getByRole('button', { name: 'Review refund' }));
    fireEvent.change(screen.getByLabelText('Reason for refund'), { target: { value: 'Service removed' } });
    rerender(<AppointmentPaymentsPanel {...p} balance={{ ...p.balance, revision: 3 }} />);

    expect(screen.getByRole('alert')).toHaveTextContent('The bill changed');
    expect(screen.getByRole('button', { name: 'Continue to refund details' })).toBeDisabled();
    expect(p.onAction).not.toHaveBeenCalled();
  });

  it('keeps manual recording available when Stripe collection is disabled', () => {
    render(<AppointmentPaymentsPanel {...props()} onlinePaymentsAvailable={false} />);

    expect(screen.getByRole('button', { name: 'Request $20.00 payment' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Record payment received' })).toBeEnabled();
  });

  it('does not expose balances or payment history without appointment access', () => {
    const p = props();
    render(<AppointmentPaymentsPanel {...p} permissions={{ ...p.permissions, canView: false }} />);

    expect(screen.queryByText('Original online payment')).not.toBeInTheDocument();
    expect(screen.queryByText('Current total')).not.toBeInTheDocument();
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });

  it('does not carry an open refund reason into a different appointment', () => {
    const p = props(8000, 'owner');
    const { rerender } = render(<AppointmentPaymentsPanel {...p} />);
    fireEvent.click(screen.getByRole('button', { name: 'Review refund' }));
    fireEvent.change(screen.getByLabelText('Reason for refund'), { target: { value: 'Private reason for first client' } });
    rerender(<AppointmentPaymentsPanel {...p} appointmentId="appointment-two" clientName="Second client" />);

    expect(screen.queryByLabelText('Reason for refund')).not.toBeInTheDocument();
    expect(screen.queryByDisplayValue('Private reason for first client')).not.toBeInTheDocument();
    expect(p.onAction).not.toHaveBeenCalled();
  });
});
