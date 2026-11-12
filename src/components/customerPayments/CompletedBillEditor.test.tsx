import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { CompletedBillView } from '@/libs/customerPayments/completedBillContract';
import { resolveTaxConfig } from '@/libs/taxConfig';

import { CompletedBillEditor } from './CompletedBillEditor';

const fetchMock = vi.fn();
const view: CompletedBillView = {
  revision: 5,
  invoiceHash: 'a'.repeat(64),
  canEdit: true,
  items: [{ kind: 'custom', name: 'Manicure', quantity: 1, unitPriceCents: 10000, taxable: true }],
  discountCents: 0,
  discountReason: '',
  tipCents: 2000,
  taxExempt: false,
  taxConfig: resolveTaxConfig({ payments: { tax: { enabled: true, rateBps: 1300 } } }, new Date()),
  paidCents: 13300,
  refundableOnlinePrincipalCents: 11300,
  depositCreditCents: 0,
};
const response = (data = view) => ({ ok: true, status: 200, json: async () => ({ data }) });
const props = { appointmentId: 'appointment-one', disabled: false, catalog: { services: [], addOns: [{ id: 'art', name: 'Nail art', priceCents: 2000, durationMinutes: 15 }] }, onEditingChange: vi.fn(), onSaved: vi.fn(async () => {}) };

beforeEach(() => {
  vi.resetAllMocks();
  vi.stubGlobal('fetch', fetchMock);
});

async function edit() {
  fireEvent.click(screen.getByRole('button', { name: 'Adjust bill' }));
  await screen.findByRole('textbox', { name: 'Item name' });
}

describe('completed bill editor', () => {
  it('requires a reason and saves a revision without requesting a payment', async () => {
    fetchMock.mockResolvedValue(response());
    render(<CompletedBillEditor {...props} />);
    await edit();

    expect(screen.getByRole('button', { name: 'Save bill changes' })).toBeDisabled();

    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'addon:0' } });
    fireEvent.change(screen.getByRole('textbox', { name: 'Reason for this change' }), { target: { value: 'Added nail art at the client’s request' } });

    expect(screen.getByText('$22.60')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Save bill changes' }));
    await waitFor(() => expect(props.onSaved).toHaveBeenCalledTimes(1));
    const command = JSON.parse(fetchMock.mock.calls[1]![1].body);

    expect(command).toMatchObject({ expectedRevision: 5, expectedInvoiceHash: view.invoiceHash, expectedTotalDueCents: 15560, finalItems: [{ name: 'Manicure' }, { kind: 'addon', catalogAddOnId: 'art' }] });
    expect(command).not.toHaveProperty('payments');
    expect(command).not.toHaveProperty('tipCents');
    expect(fetchMock.mock.calls.every(([url]) => String(url).endsWith('/payment-workspace/bill'))).toBe(true);
  });

  it('shows a reduction as a separate overpayment to review and refuses manual overpayment', async () => {
    fetchMock.mockResolvedValue(response({ ...view, refundableOnlinePrincipalCents: 0 }));
    render(<CompletedBillEditor {...props} />);
    await edit();
    fireEvent.change(screen.getByRole('textbox', { name: 'Price' }), { target: { value: '80' } });
    fireEvent.change(screen.getByRole('textbox', { name: 'Reason for this change' }), { target: { value: 'Removed service' } });

    expect(screen.getByText('Overpayment to review')).toBeInTheDocument();
    expect(screen.getByText('$22.60')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Save bill changes' })).toBeDisabled();
  });

  it('retains the exact request after a lost save response and locks draft editing', async () => {
    fetchMock.mockResolvedValueOnce(response()).mockRejectedValueOnce(new TypeError('Response lost')).mockResolvedValueOnce(response());
    render(<CompletedBillEditor {...props} />);
    await edit();
    fireEvent.change(screen.getByRole('textbox', { name: 'Reason for this change' }), { target: { value: 'Corrected service name' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save bill changes' }));
    await screen.findByRole('button', { name: 'Retry saved change' });

    expect(screen.getByRole('textbox', { name: 'Price' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Cancel editing' })).toBeDisabled();

    fireEvent.click(screen.getByRole('button', { name: 'Retry saved change' }));
    await waitFor(() => expect(props.onSaved).toHaveBeenCalledTimes(1));

    expect(fetchMock.mock.calls[2]![1].body).toBe(fetchMock.mock.calls[1]![1].body);
  });

  it('requires a new read after a stale revision and holds an unresolved payment', async () => {
    fetchMock.mockResolvedValueOnce(response()).mockResolvedValueOnce({ ok: false, status: 409 }).mockResolvedValueOnce(response({ ...view, canEdit: false }));
    render(<CompletedBillEditor {...props} />);
    await edit();
    fireEvent.change(screen.getByRole('textbox', { name: 'Reason for this change' }), { target: { value: 'A change' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save bill changes' }));
    await screen.findByRole('alert');

    expect(screen.getByRole('button', { name: 'Save bill changes' })).toBeDisabled();

    fireEvent.click(screen.getByRole('button', { name: 'Reload bill' }));
    await screen.findByRole('textbox', { name: 'Item name' });

    expect(screen.getByRole('textbox', { name: 'Price' })).toBeDisabled();
    expect(screen.getByText(/Resolve the existing payment request/)).toBeInTheDocument();
  });

  it('ignores a late response from an appointment that has been closed', async () => {
    let resolveFirst!: (value: ReturnType<typeof response>) => void;
    fetchMock.mockImplementationOnce(() => new Promise((resolve) => {
      resolveFirst = resolve;
    }));
    const rendered = render(<CompletedBillEditor {...props} />);
    fireEvent.click(screen.getByRole('button', { name: 'Adjust bill' }));
    rendered.rerender(<CompletedBillEditor {...props} appointmentId="appointment-two" />);
    await act(async () => resolveFirst(response()));

    expect(screen.queryByRole('textbox', { name: 'Item name' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Adjust bill' })).toBeInTheDocument();
  });
});
