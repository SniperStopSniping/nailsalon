import { act, fireEvent, render, screen } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { describe, expect, it, vi } from 'vitest';

import en from '@/locales/en.json';

import { ConfirmationRebookingCard } from './ConfirmationRebookingCard';

function renderCard(onBook: () => Promise<void>, intervalWeeks = 3) {
  return render(
    <NextIntlClientProvider locale="en" messages={en}>
      <ConfirmationRebookingCard
        settings={{ enabled: true, intervalWeeks, message: 'Reserve your preferred time.' }}
        onBook={onBook}
      />
    </NextIntlClientProvider>,
  );
}

describe('current confirmation rebooking card', () => {
  it('shows the configured message without starting another booking', () => {
    const onBook = vi.fn().mockResolvedValue(undefined);
    renderCard(onBook);

    expect(screen.getByRole('region', { name: 'Why not book your next visit now?' })).toBeVisible();
    expect(screen.getByText('We recommend visiting every 3 weeks.')).toBeVisible();
    expect(screen.getByText('Reserve your preferred time.')).toBeVisible();
    expect(screen.queryByRole('button', { name: 'Not now' })).not.toBeInTheDocument();
    expect(onBook).not.toHaveBeenCalled();
  });

  it('uses singular wording for a weekly interval', () => {
    renderCard(vi.fn().mockResolvedValue(undefined), 1);

    expect(screen.getByText('We recommend visiting every week.')).toBeVisible();
  });

  it('explains a failed handoff and allows an explicit retry', async () => {
    const onBook = vi.fn().mockRejectedValueOnce(new Error('Unavailable')).mockResolvedValueOnce(undefined);
    renderCard(onBook);
    fireEvent.click(screen.getByRole('button', { name: 'Book my next appointment' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('Your confirmed appointment is unchanged.');
    expect(screen.getByRole('button', { name: 'Book my next appointment' })).toBeEnabled();

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Book my next appointment' }));
    });

    expect(onBook).toHaveBeenCalledTimes(2);
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('starts only one handoff while its first request is unresolved', async () => {
    let finish!: () => void;
    const onBook = vi.fn(() => new Promise<void>((resolve) => {
      finish = resolve;
    }));
    renderCard(onBook);
    const button = screen.getByRole('button', { name: 'Book my next appointment' });
    fireEvent.click(button);
    fireEvent.click(button);

    expect(onBook).toHaveBeenCalledTimes(1);
    expect(button).toBeDisabled();
    expect(button).toHaveTextContent('Opening booking…');

    await act(async () => {
      finish();
    });

    expect(button).toBeEnabled();
    expect(button).toHaveTextContent('Book my next appointment');
  });
});
