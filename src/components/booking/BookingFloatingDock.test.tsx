import React from 'react';

import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { pushMock } = vi.hoisted(() => ({
  pushMock: vi.fn(),
}));

vi.mock('next/navigation', () => ({
  useRouter: () => ({
    push: pushMock,
  }),
  useParams: () => ({
    locale: 'en',
    slug: 'luster',
  }),
}));

vi.mock('@/providers/SalonProvider', () => ({
  useSalon: () => ({
    salonSlug: 'luster',
  }),
}));

import { BookingFloatingDock } from './BookingFloatingDock';

describe('BookingFloatingDock', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('preserves locale and slug for booking dock navigation', () => {
    render(<BookingFloatingDock />);

    fireEvent.click(screen.getByRole('button', { name: /go to invite/i }));
    expect(pushMock).toHaveBeenCalledWith('/en/luster/invite');

    fireEvent.click(screen.getByRole('button', { name: /go to rewards/i }));
    expect(pushMock).toHaveBeenCalledWith('/en/luster/rewards');

    fireEvent.click(screen.getByRole('button', { name: /go to profile/i }));
    expect(pushMock).toHaveBeenCalledWith('/en/luster/profile');
  });
});
