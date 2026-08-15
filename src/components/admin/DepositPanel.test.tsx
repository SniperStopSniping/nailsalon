import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { DepositPanel } from './DepositPanel';

const { fetchMock } = vi.hoisted(() => ({ fetchMock: vi.fn() }));

const resolvedCancelledDeposit = {
  data: {
    appointmentStatus: 'cancelled',
    deposit: {
      id: 'dep_cancelled',
      status: 'paid',
      amountCents: 2500,
      currency: 'cad',
      refundStatus: null,
      forfeitedAt: null,
    },
    deposits: [],
    depositCredit: {
      state: 'resolved',
      blockedCode: null,
      blockedDetail: null,
      collectedCents: 2500,
      refundedCents: 0,
      forfeitedCents: 0,
      eligibleCents: 0,
    },
    auditRows: [],
    moreOmitted: 0,
  },
};

describe('DepositPanel — explicit cancelled-deposit retention', () => {
  beforeEach(() => {
    fetchMock.mockReset();
    fetchMock.mockImplementation(async (_input: RequestInfo | URL, init?: RequestInit) => (
      new Response(JSON.stringify(init?.method === 'POST' ? { data: { ok: true } } : resolvedCancelledDeposit), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    ));
    vi.stubGlobal('fetch', fetchMock);
  });

  it('requires an owner reason and posts the explicit retain action', async () => {
    render(<DepositPanel appointmentId="appt_cancelled" salonSlug="isla" />);

    const retain = await screen.findByRole('button', { name: 'Retain deposit' });
    fireEvent.click(retain);

    expect(screen.getByText('Retain this cancelled deposit?')).toBeInTheDocument();

    fireEvent.click(screen.getByTestId('confirm-dialog-confirm'));

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Add a short reason before continuing.',
    );
    expect(fetchMock).toHaveBeenCalledTimes(1);

    fireEvent.change(screen.getByLabelText('Reason'), {
      target: { value: 'Cancellation was inside the disclosed retained-deposit window.' },
    });
    fireEvent.click(screen.getByTestId('confirm-dialog-confirm'));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(3));

    expect(fetchMock.mock.calls[1]).toEqual([
      '/api/admin/appointments/appt_cancelled/deposit/forfeit?salonSlug=isla',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({
          reason: 'Cancellation was inside the disclosed retained-deposit window.',
        }),
      }),
    ]);
  });

  it('never offers retention while deposit resolution is blocked', async () => {
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({
      data: {
        ...resolvedCancelledDeposit.data,
        depositCredit: {
          ...resolvedCancelledDeposit.data.depositCredit,
          state: 'blocked',
          blockedCode: 'DEPOSIT_REFUND_IN_FLIGHT',
          blockedDetail: 'Refund status is pending.',
        },
      },
    }), { status: 200, headers: { 'Content-Type': 'application/json' } }));

    render(<DepositPanel appointmentId="appt_cancelled" salonSlug="isla" />);

    expect(await screen.findByRole('alert')).toHaveTextContent('Deposit credit is paused');
    expect(screen.queryByRole('button', { name: 'Retain deposit' })).not.toBeInTheDocument();
  });
});
