import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { AdminSalonSelector } from './AdminSalonSelector';

const salon = { id: 'old', slug: 'old', name: 'Old Salon', role: 'owner', status: 'cancelled' };

describe('AdminSalonSelector', () => {
  it('explains removal before changing the list and offers restoration', async () => {
    const onVisibilityChange = vi.fn(async () => {});
    const view = render(<AdminSalonSelector salons={[salon]} onSelect={vi.fn()} onVisibilityChange={onVisibilityChange} />);

    fireEvent.click(screen.getByRole('button', { name: 'Remove from my list' }));

    expect(screen.getByText(/does not change its booking page, appointments, or subscription/i)).toBeInTheDocument();
    expect(onVisibilityChange).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: 'Remove from my list' }));
    await waitFor(() => expect(onVisibilityChange).toHaveBeenCalledWith(salon, true));

    view.rerender(<AdminSalonSelector salons={[]} hiddenSalons={[salon]} onSelect={vi.fn()} onVisibilityChange={onVisibilityChange} />);
    fireEvent.click(screen.getByRole('button', { name: 'Restore' }));
    await waitFor(() => expect(onVisibilityChange).toHaveBeenCalledWith(salon, false));
  });
});

it('keeps the real dashboard callback, role/status and public URLs', () => {
  const onSelect = vi.fn();
  const active = { ...salon, name: 'Isla Nail Studio', status: 'active', publicUrl: 'https://studio.example/', bookingUrl: 'https://studio.example/book' };
  render(<AdminSalonSelector salons={[active]} onSelect={onSelect} />);

  expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Your Luster salons');
  expect(screen.getByRole('heading', { level: 2 })).toHaveTextContent('Isla Nail Studio');
  expect(screen.getByRole('link', { name: 'Public page' })).toHaveAttribute('href', active.publicUrl);
  expect(screen.getByRole('link', { name: 'Booking page' })).toHaveAttribute('href', active.bookingUrl);

  fireEvent.click(screen.getByRole('button', { name: 'Open dashboard' }));

  expect(onSelect).toHaveBeenCalledWith(active);
  expect(screen.queryByRole('button', { name: 'Remove from my list' })).not.toBeInTheDocument();
});

it('keeps a failed removal recoverable and the removed list initially collapsed', async () => {
  const onVisibilityChange = vi.fn(async () => {
    throw new Error('Could not update the salon list. Try again.');
  });
  render(<AdminSalonSelector salons={[salon]} hiddenSalons={[{ ...salon, id: 'hidden', name: 'Hidden Salon' }]} onSelect={vi.fn()} onVisibilityChange={onVisibilityChange} />);

  expect(screen.getByText('Removed salons (1)').closest('details')).not.toHaveAttribute('open');

  fireEvent.click(screen.getByRole('button', { name: 'Remove from my list' }));
  fireEvent.click(screen.getByRole('button', { name: 'Remove from my list' }));
  await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('Could not update the salon list. Try again.'));

  expect(screen.getByRole('button', { name: 'Remove from my list' })).toBeEnabled();

  fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));

  expect(screen.getByRole('button', { name: 'Open dashboard' })).toBeInTheDocument();
});

it('does not show an active status or owner-only removal for other roles', () => {
  render(<AdminSalonSelector salons={[{ ...salon, role: 'staff', status: null }]} onSelect={vi.fn()} onVisibilityChange={vi.fn()} />);

  expect(screen.getByText('draft')).toBeInTheDocument();
  expect(screen.queryByText('Active')).not.toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Remove from my list' })).not.toBeInTheDocument();
});

it('uses an existing salon logo and falls back gracefully if that image fails', () => {
  const view = render(<AdminSalonSelector salons={[{ ...salon, logoUrl: '/salon-logo.png' }]} onSelect={vi.fn()} />);
  const logo = view.container.querySelector('img');

  expect(logo).toHaveAttribute('src', '/salon-logo.png');

  fireEvent.error(logo!);

  expect(view.container.querySelector('img')).not.toBeInTheDocument();
  expect(view.container.querySelector('.luster-salon-avatar svg')).toBeInTheDocument();
});
