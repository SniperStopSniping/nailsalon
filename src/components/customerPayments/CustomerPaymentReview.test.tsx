import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { CustomerPaymentReview } from './CustomerPaymentReview';

const preview = { testOnly: true, nonLegal: true, ordinaryActionsBlocked: true, evidenceRevision: 'a'.repeat(64), original: { serviceCents: 10000, taxCents: 0, tipCents: 2000, totalCents: 12000 }, refunded: { principalCents: 2500, tipCents: 500, totalCents: 3000 }, netTenderCents: 9000, previousCredit: { serviceCreditCents: 0, taxCreditCents: 0, tipCreditCents: 0 }, decision: null, resolution: null };
const result = { testOnly: true, nonLegal: true, ordinaryActionsBlocked: true, replayed: true, evidenceMatchesCurrent: true, decision: { id: 'decision', previousDecisionId: null, serviceCreditCents: 2500, taxCreditCents: 0, tipCreditCents: 500, deltaServiceCreditCents: 2500, deltaTaxCreditCents: 0, deltaTipCreditCents: 500, reason: 'Test credit', createdAt: '2026-11-08T00:00:00.000Z' } };
const transport = vi.fn();

beforeEach(() => {
  vi.stubGlobal('fetch', transport);
  transport.mockReset();
});

afterEach(() => vi.unstubAllGlobals());

async function load() {
  fireEvent.click(screen.getByRole('button', { name: 'Load current test evidence' }));
  await screen.findByLabelText('Service credit');
  fireEvent.change(screen.getByLabelText('Service credit'), { target: { value: '25.00' } });
  fireEvent.change(screen.getByLabelText('Tax credit'), { target: { value: '0' } });
  fireEvent.change(screen.getByLabelText('Reason for this test credit note'), { target: { value: 'Test credit' } });
  fireEvent.click(screen.getByRole('checkbox'));
}

describe('mocked owner review transport', () => {
  it('shows recorded amounts only after fresh resolution, never for invalid or stale proposals', async () => {
    const resolution = { state: 'resolved', currency: 'CAD', creditNoteId: 'decision', evidenceFingerprint: 'a'.repeat(64), original: preview.original, credit: { serviceCents: 2500, taxCents: 0, tipCents: 500, totalCents: 3000 }, adjusted: { serviceCents: 7500, taxCents: 0, tipCents: 1500, totalCents: 9000 }, actualNetTenderCents: 9000, collectibleBalanceCents: 0, ordinaryActionsBlocked: true };
    transport.mockResolvedValueOnce(Response.json({ ...preview, decision: result.decision }))
      .mockResolvedValueOnce(Response.json(result))
      .mockResolvedValueOnce(Response.json({ ...preview, decision: result.decision, resolution }));
    render(<CustomerPaymentReview salonSlug="salon" appointmentId="appointment" />);
    fireEvent.click(screen.getByRole('button', { name: 'Load current test evidence' }));
    await screen.findByLabelText('Service credit');

    expect(screen.queryByText('Recorded credit-note adjustment')).not.toBeInTheDocument();
    expect(screen.queryByText('Proposed adjusted balance')).not.toBeInTheDocument();
    expect(screen.getByText(/Needs review/)).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText('Service credit'), { target: { value: '1.00' } });
    fireEvent.change(screen.getByLabelText('Tax credit'), { target: { value: '0' } });

    expect(screen.queryByText('Proposed credit-note adjustment')).not.toBeInTheDocument();

    fireEvent.change(screen.getByLabelText('Service credit'), { target: { value: '25' } });

    expect(screen.getByText('Proposed adjusted obligation').nextElementSibling).toHaveTextContent('$90.00');
    expect(screen.queryByText('Recorded credit-note adjustment')).not.toBeInTheDocument();

    fireEvent.change(screen.getByLabelText('Reason for this test credit note'), { target: { value: 'Test credit' } });
    fireEvent.click(screen.getByRole('checkbox'));
    fireEvent.click(screen.getByRole('button', { name: 'Record test credit note and review' }));
    await screen.findByText(/Reload current evidence to verify its resolution/);

    expect(screen.queryByText('Recorded credit-note adjustment')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Load current test evidence' }));
    await screen.findByText('Recorded credit-note adjustment');

    expect(screen.getByText('Adjusted obligation').nextElementSibling).toHaveTextContent('$90.00');
    expect(screen.getByText('Verified adjusted balance').nextElementSibling).toHaveTextContent('$0.00');
    expect(screen.queryByText('Proposed adjusted balance')).not.toBeInTheDocument();
  });

  it('does not auto-request and preserves exact key/payload after interrupted save', async () => {
    transport.mockResolvedValueOnce(Response.json(preview)).mockRejectedValueOnce(new Error('lost response')).mockResolvedValueOnce(Response.json(result));
    render(<CustomerPaymentReview salonSlug="salon" appointmentId="appointment" />);

    expect(transport).not.toHaveBeenCalled();

    await load();
    fireEvent.click(screen.getByRole('button', { name: 'Record test credit note and review' }));
    await screen.findByRole('button', { name: 'Retry same test review' });

    expect(screen.getByLabelText('Service credit')).toBeDisabled();

    fireEvent.click(screen.getByRole('button', { name: 'Retry same test review' }));
    await screen.findByText('Test review recorded. Reload current evidence to verify its resolution. No money was returned by this action.');

    expect(transport.mock.calls[1]?.[1].body).toBe(transport.mock.calls[2]?.[1].body);
    expect(JSON.parse(transport.mock.calls[1]?.[1].body)).toMatchObject({ expectedEvidenceRevision: preview.evidenceRevision, serviceCreditCents: 2500, taxCreditCents: 0, tipCreditCents: 500 });
  });

  it('requires fresh review and a new request ID after stale evidence', async () => {
    transport.mockResolvedValueOnce(Response.json(preview)).mockResolvedValueOnce(new Response(null, { status: 409 })).mockResolvedValueOnce(Response.json({ ...preview, evidenceRevision: 'b'.repeat(64) })).mockResolvedValueOnce(Response.json(result));
    render(<CustomerPaymentReview salonSlug="salon" appointmentId="appointment" />);
    await load();
    fireEvent.click(screen.getByRole('button', { name: 'Record test credit note and review' }));
    await screen.findByText(/Evidence changed or is not eligible/);

    expect(screen.queryByLabelText('Service credit')).not.toBeInTheDocument();

    await load();
    fireEvent.click(screen.getByRole('button', { name: 'Record test credit note and review' }));
    await screen.findByText('Test review recorded. Reload current evidence to verify its resolution. No money was returned by this action.');
    const first = JSON.parse(transport.mock.calls[1]?.[1].body);
    const second = JSON.parse(transport.mock.calls[3]?.[1].body);

    expect(second.requestId).not.toBe(first.requestId);
    expect(second.expectedEvidenceRevision).toBe('b'.repeat(64));
  });

  it('suppresses repeated saves and ignores late results after unmount', async () => {
    let finish!: (response: Response) => void;
    transport.mockResolvedValueOnce(Response.json(preview)).mockImplementationOnce(() => new Promise((resolve) => {
      finish = resolve;
    }));
    const { unmount } = render(<CustomerPaymentReview salonSlug="salon" appointmentId="appointment" />);
    await load();
    const button = screen.getByRole('button', { name: 'Record test credit note and review' });
    fireEvent.click(button);
    fireEvent.click(button);

    expect(transport).toHaveBeenCalledTimes(2);

    unmount();
    finish(Response.json(result));
    await waitFor(() => expect(transport.mock.calls[1]?.[1].signal.aborted).toBe(true));
  });

  it('does not present replayed historical evidence as a current resolution', async () => {
    transport.mockResolvedValueOnce(Response.json(preview)).mockResolvedValueOnce(Response.json({ ...result, evidenceMatchesCurrent: false }));
    render(<CustomerPaymentReview salonSlug="salon" appointmentId="appointment" />);
    await load();
    fireEvent.click(screen.getByRole('button', { name: 'Record test credit note and review' }));
    await screen.findByText(/earlier test decision was recorded/);

    expect(screen.queryByText('Proposed adjusted balance')).not.toBeInTheDocument();
  });
});
