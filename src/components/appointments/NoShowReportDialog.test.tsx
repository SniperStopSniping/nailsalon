import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { NoShowReportDialog } from './NoShowReportDialog';

afterEach(() => vi.useRealTimers());

function setup(startTime = '2030-06-15T19:00:00Z', result: 'shared' | 'not_shared' | null = 'shared') {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2030-06-15T18:30:00Z'));
  const confirm = vi.fn(async () => result);
  render(<NoShowReportDialog isOpen startTime={startTime} timeZone="America/Toronto" busy={false} error={null} onClose={vi.fn()} onConfirm={confirm} />);
  return confirm;
}

describe('owner no-show reason dialog', () => {
  it('only enables confirmed nonattendance and explicit late cancellation before start', () => {
    setup();

    expect(screen.getByRole('radio', { name: /Customer did not attend/ })).toBeDisabled();
    expect(screen.getByRole('radio', { name: /Other/ })).toBeDisabled();
    expect(screen.getByRole('radio', { name: /Customer cancelled/ })).toBeEnabled();
    expect(screen.getByRole('radio', { name: /Customer confirmed/ })).toBeEnabled();
    expect(screen.getByText(/3:00 PM/)).toBeVisible();
    expect(screen.getByRole('button', { name: 'Confirm no-show' })).toBeDisabled();
  });

  it.each(['shared', 'not_shared'] as const)('records one reason and private note and explains the %s outcome', async (result) => {
    const confirm = setup(undefined, result);
    fireEvent.click(screen.getByRole('radio', { name: /Customer confirmed/ }));
    fireEvent.click(screen.getByText('Add a private note (optional)'));
    fireEvent.change(screen.getByLabelText(/Private note/), { target: { value: 'Contacted and confirmed.' } });
    fireEvent.click(screen.getByRole('button', { name: 'Confirm no-show' }));
    await waitFor(() => expect(screen.getByText('No-show saved')).toBeVisible());

    expect(confirm).toHaveBeenCalledWith({ reason: 'confirmed_nonattendance', privateNote: 'Contacted and confirmed.' });
    expect(screen.getByText(result === 'shared' ? /now shared with participating/ : /saved locally but was not shared/)).toBeVisible();
  });

  it('requires an Other explanation and allows nonattendance at the start', () => {
    setup('2030-06-15T18:30:00Z');

    expect(screen.getByRole('radio', { name: /Customer did not attend/ })).toBeEnabled();

    fireEvent.click(screen.getByRole('radio', { name: 'Other' }));

    expect(screen.getByRole('button', { name: 'Confirm no-show' })).toBeDisabled();

    fireEvent.change(screen.getByLabelText('Explanation (required)'), { target: { value: 'Verified absence reported by manager.' } });

    expect(screen.getByRole('button', { name: 'Confirm no-show' })).toBeEnabled();
  });

  it('keeps entered evidence available when the server rejects the attempt', async () => {
    const confirm = setup(undefined, null);
    fireEvent.click(screen.getByRole('radio', { name: /Customer confirmed/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Confirm no-show' }));
    await waitFor(() => expect(confirm).toHaveBeenCalledOnce());

    expect(screen.getByRole('radio', { name: /Customer confirmed/ })).toBeChecked();
    expect(screen.queryByText('No-show saved')).not.toBeInTheDocument();
  });
});
