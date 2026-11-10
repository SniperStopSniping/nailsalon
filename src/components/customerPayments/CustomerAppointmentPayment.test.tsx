import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { CustomerWorkspaceView } from '@/libs/customerPayments/customerWorkspaceView';

import { CustomerAppointmentPayment } from './CustomerAppointmentPayment';

const fetchMock = vi.fn();
const view: CustomerWorkspaceView = { initialized: false, revision: 0, invoiceHash: 'a'.repeat(64), canPay: true, needsReview: false, totalCents: 13300, paidCents: 2000, depositCreditCents: 2000, balanceCents: 11300, overpaidCents: 0, policy: { revision: 1, cancellationPolicy: 'Contact your salon before cancelling.' }, activePayment: null };
const active = { ...view, initialized: true, revision: 2, canPay: false, activePayment: { id: '11111111-1111-4111-8111-111111111111', state: 'open', canResume: true } };
const response = (data = view, checkoutUrl: string | null = null) => ({ ok: true, json: async () => ({ data, checkoutUrl }) });

beforeEach(() => {
  vi.resetAllMocks();
  vi.stubGlobal('fetch', fetchMock);
});

describe('customer private appointment payment', () => {
  it('hides collection when the salon has not enabled payments', async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 404 });
    const { container } = render(<CustomerAppointmentPayment token="synthetic-capability" />);
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());

    expect(container).toBeEmptyDOMElement();
  });

  it('subtracts an existing deposit and requires policy acceptance before requesting a server-priced payment', async () => {
    fetchMock.mockResolvedValueOnce(response()).mockResolvedValueOnce(response(active, 'https://checkout.stripe.com/c/pay/cs_test_fixture'));
    render(<CustomerAppointmentPayment token="synthetic-capability" />);
    const pay = await screen.findByRole('button', { name: 'Pay $113.00 online' });

    expect(pay).toBeDisabled();
    expect(screen.getByText('Deposit included above')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('checkbox'));
    fireEvent.click(pay);
    await screen.findByRole('link', { name: 'Continue to secure payment' });
    const payload = JSON.parse(fetchMock.mock.calls[1]![1].body);

    expect(payload).toMatchObject({ kind: 'request_payment', expectedRevision: 0, expectedInvoiceHash: view.invoiceHash, acceptedPolicyRevision: 1 });
    expect(Object.keys(payload).sort()).toEqual(['acceptedPolicyRevision', 'expectedInvoiceHash', 'expectedRevision', 'initializationId', 'kind', 'requestId']);
    expect(screen.queryByText('Payment received')).not.toBeInTheDocument();
  });

  it('keeps the same request identity after a lost response and never offers a second payment', async () => {
    fetchMock.mockResolvedValueOnce(response()).mockRejectedValueOnce(new TypeError('Response lost')).mockResolvedValueOnce(response(active, 'https://checkout.stripe.com/c/pay/cs_test_fixture'));
    render(<CustomerAppointmentPayment token="synthetic-capability" />);
    await screen.findByRole('checkbox');
    fireEvent.click(screen.getByRole('checkbox'));
    fireEvent.click(screen.getByRole('button', { name: 'Pay $113.00 online' }));
    await screen.findByRole('alert');

    expect(screen.queryByRole('button', { name: 'Pay $113.00 online' })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Check payment' }));
    await screen.findByRole('link', { name: 'Continue to secure payment' });

    expect(fetchMock.mock.calls[2]![1].body).toBe(fetchMock.mock.calls[1]![1].body);
  });

  it('requires new acceptance when the saved invoice or policy changes', async () => {
    fetchMock.mockResolvedValueOnce(response()).mockResolvedValueOnce({ ok: false, status: 409, json: async () => ({}) }).mockResolvedValueOnce(response({ ...view, invoiceHash: 'b'.repeat(64), balanceCents: 12300, totalCents: 14300, policy: { revision: 2, cancellationPolicy: 'Updated cancellation policy.' } }));
    render(<CustomerAppointmentPayment token="synthetic-capability" />);
    await screen.findByRole('checkbox');
    fireEvent.click(screen.getByRole('checkbox'));
    fireEvent.click(screen.getByRole('button', { name: 'Pay $113.00 online' }));
    await screen.findByRole('alert');
    fireEvent.click(screen.getByRole('button', { name: 'Check payment' }));
    await screen.findByText('Updated cancellation policy.');

    expect(screen.getByRole('checkbox')).not.toBeChecked();
    expect(screen.getByRole('button', { name: 'Pay $123.00 online' })).toBeDisabled();
  });

  it('ignores a late link from a previously viewed appointment', async () => {
    let resolveOld: (value: ReturnType<typeof response>) => void = () => {};
    fetchMock.mockResolvedValueOnce(response()).mockImplementationOnce(() => new Promise((resolve) => {
      resolveOld = resolve;
    })).mockResolvedValueOnce(response({ ...view, canPay: false, needsReview: true }));
    const rendered = render(<CustomerAppointmentPayment token="old-capability" />);
    await screen.findByRole('checkbox');
    fireEvent.click(screen.getByRole('checkbox'));
    fireEvent.click(screen.getByRole('button', { name: 'Pay $113.00 online' }));
    rendered.rerender(<CustomerAppointmentPayment token="new-capability" />);
    await screen.findByText(/needs to review/);
    await act(async () => resolveOld(response(active, 'https://checkout.stripe.com/c/pay/cs_test_old')));

    expect(screen.queryByRole('link')).not.toBeInTheDocument();
  });
});
