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
