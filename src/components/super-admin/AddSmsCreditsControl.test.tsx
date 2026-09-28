import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { AddSmsCreditsControl } from './AddSmsCreditsControl';

const fetchMock = vi.fn();

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
  vi.stubGlobal('crypto', { randomUUID: vi.fn(() => '1de0d696-aee6-4bd4-88b4-18bb6a74ebd3') });
});

afterEach(() => vi.unstubAllGlobals());

describe('AddSmsCreditsControl', () => {
  it('shows the administrative balance and submits a confirmed, reasoned grant to the selected salon', async () => {
    const user = userEvent.setup();
    fetchMock
      .mockResolvedValueOnce(new Response(JSON.stringify({ balance: 100, administrativeBalance: 15 }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ lotId: 'lot_1', created: true, balance: 125, administrativeBalance: 40 }), { status: 200 }));
    render(<AddSmsCreditsControl salonId="salon_1" salonName="Aster Nails" />);

    expect(await screen.findByText('100')).toBeInTheDocument();
    expect(screen.getByText('15')).toBeInTheDocument();

    await user.type(screen.getByLabelText('Texts to add'), '25');
    await user.type(screen.getByLabelText('Reason'), 'Courtesy credit');

    expect(screen.getByRole('button', { name: 'Add texts' })).toBeDisabled();

    await user.click(screen.getByLabelText('I confirm adding 25 texts to Aster Nails.'));
    await user.click(screen.getByRole('button', { name: 'Add texts' }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));

    expect(fetchMock).toHaveBeenLastCalledWith('/api/super-admin/salons/salon_1/sms-credits', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ amount: 25, reason: 'Courtesy credit', idempotencyKey: '1de0d696-aee6-4bd4-88b4-18bb6a74ebd3' }),
    });
    expect(await screen.findByText('25 texts added to Aster Nails.')).toBeInTheDocument();
    expect(screen.getByText('125')).toBeInTheDocument();
  });

  it('keeps one idempotency key for an unchanged retry after an ambiguous failure', async () => {
    const user = userEvent.setup();
    fetchMock
      .mockResolvedValueOnce(new Response(JSON.stringify({ balance: 0, administrativeBalance: 0 }), { status: 200 }))
      .mockRejectedValueOnce(new Error('Network unavailable'))
      .mockResolvedValueOnce(new Response(JSON.stringify({ lotId: 'lot_1', created: false, balance: 10, administrativeBalance: 10 }), { status: 200 }));
    render(<AddSmsCreditsControl salonId="salon_2" salonName="Briar Nails" />);
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    fireEvent.change(screen.getByLabelText('Texts to add'), { target: { value: '10' } });
    fireEvent.change(screen.getByLabelText('Reason'), { target: { value: 'Support' } });
    fireEvent.click(screen.getByLabelText('I confirm adding 10 texts to Briar Nails.'));
    await user.click(screen.getByRole('button', { name: 'Add texts' }));

    expect(await screen.findByText('Network unavailable')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Add texts' }));

    const firstBody = JSON.parse((fetchMock.mock.calls[1]![1] as RequestInit).body as string);
    const secondBody = JSON.parse((fetchMock.mock.calls[2]![1] as RequestInit).body as string);

    expect(secondBody.idempotencyKey).toBe(firstBody.idempotencyKey);
  });

  it('clears the previous salon balance, draft, and confirmation when the panel changes target', async () => {
    fetchMock
      .mockResolvedValueOnce(new Response(JSON.stringify({ balance: 50, administrativeBalance: 5 }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ balance: 8, administrativeBalance: 0 }), { status: 200 }));
    const rendered = render(<AddSmsCreditsControl salonId="salon_a" salonName="Aster Nails" />);

    expect(await screen.findByText('50')).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText('Texts to add'), { target: { value: '12' } });
    fireEvent.change(screen.getByLabelText('Reason'), { target: { value: 'Courtesy' } });
    fireEvent.click(screen.getByLabelText('I confirm adding 12 texts to Aster Nails.'));

    rendered.rerender(<AddSmsCreditsControl salonId="salon_b" salonName="Briar Nails" />);

    expect(screen.getAllByText('Loading…')).toHaveLength(2);
    expect(screen.getByLabelText('Texts to add')).toHaveValue(null);
    expect(screen.getByLabelText('Reason')).toHaveValue('');
    expect(screen.getByLabelText('I confirm adding texts to Briar Nails.')).not.toBeChecked();
    expect(await screen.findByText('8')).toBeInTheDocument();
    expect(screen.queryByText('50')).not.toBeInTheDocument();
  });

  it('does not apply a late grant response from the previously selected salon', async () => {
    let finishGrant: ((response: Response) => void) | undefined;
    fetchMock
      .mockResolvedValueOnce(new Response(JSON.stringify({ balance: 50, administrativeBalance: 5 }), { status: 200 }))
      .mockImplementationOnce(() => new Promise<Response>((resolve) => {
        finishGrant = resolve;
      }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ balance: 8, administrativeBalance: 0 }), { status: 200 }));
    const rendered = render(<AddSmsCreditsControl salonId="salon_a" salonName="Aster Nails" />);

    expect(await screen.findByText('50')).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText('Texts to add'), { target: { value: '12' } });
    fireEvent.change(screen.getByLabelText('Reason'), { target: { value: 'Courtesy' } });
    fireEvent.click(screen.getByLabelText('I confirm adding 12 texts to Aster Nails.'));
    fireEvent.click(screen.getByRole('button', { name: 'Add texts' }));

    rendered.rerender(<AddSmsCreditsControl salonId="salon_b" salonName="Briar Nails" />);

    expect(await screen.findByText('8')).toBeInTheDocument();

    finishGrant?.(new Response(JSON.stringify({ lotId: 'old_lot', created: true, balance: 62, administrativeBalance: 17 }), { status: 200 }));

    await waitFor(() => expect(screen.queryByText('12 texts added to Aster Nails.')).not.toBeInTheDocument());

    expect(screen.getByText('8')).toBeInTheDocument();
    expect(screen.queryByText('62')).not.toBeInTheDocument();
  });
});
