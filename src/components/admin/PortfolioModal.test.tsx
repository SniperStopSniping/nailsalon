import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { PortfolioModal } from './PortfolioModal';

const fetchMock = vi.fn();

vi.mock('@/providers/SalonProvider', () => ({
  useSalon: () => ({ salonSlug: 'salon-a' }),
}));

const portfolioPayload = {
  usage: { stored: 1, max: 10, remaining: 9, overAllowance: false, plan: 'pro', source: 'plan' },
  readiness: {
    discoverEligiblePhotos: 1,
    retainedOverAllowance: 0,
    missingCrop: 0,
    missingServiceFamily: 0,
    missingNailLength: 0,
    unbookableFamily: 0,
  },
  bookableFamilies: ['nail_art'],
  photos: [{
    id: 'photo-1',
    publicId: 'portfolio/photo-1',
    imageUrl: 'https://example.test/photo.jpg',
    width: 800,
    height: 1000,
    ownerVisible: true,
    discoverIncluded: true,
    serviceFamily: 'nail_art',
    nailLength: 'short',
    altText: 'Cherry ombré manicure',
    crop: null,
    eligibility: null,
  }],
};

describe('PortfolioModal destructive confirmation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal('fetch', fetchMock);
    fetchMock.mockImplementation((_input: RequestInfo | URL, init?: RequestInit) => {
      if (init?.method === 'DELETE') {
        return Promise.resolve(new Response(null, { status: 204 }));
      }
      return Promise.resolve(new Response(JSON.stringify(portfolioPayload), { status: 200 }));
    });
  });

  it('does not delete on invocation or cancel and executes the existing delete exactly once on confirm', async () => {
    const user = userEvent.setup();
    render(<PortfolioModal onClose={vi.fn()} />);

    const deleteButton = await screen.findByRole('button', { name: 'Delete Cherry ombré manicure' });
    await user.click(deleteButton);

    expect(screen.getByText('Delete this portfolio photo?')).toBeInTheDocument();
    expect(screen.getByText('“Cherry ombré manicure” will be permanently removed.')).toBeInTheDocument();
    expect(fetchMock.mock.calls.filter(([, init]) => init?.method === 'DELETE')).toHaveLength(0);

    await user.click(screen.getByTestId('confirm-dialog-cancel'));

    expect(fetchMock.mock.calls.filter(([, init]) => init?.method === 'DELETE')).toHaveLength(0);

    await user.click(deleteButton);
    await user.click(screen.getByTestId('confirm-dialog-confirm'));

    await waitFor(() => {
      expect(fetchMock.mock.calls.filter(([, init]) => init?.method === 'DELETE')).toHaveLength(1);
    });

    expect(fetchMock).toHaveBeenCalledWith(
      '/api/admin/portfolio/photo-1?salonSlug=salon-a',
      { method: 'DELETE' },
    );
  });
});
