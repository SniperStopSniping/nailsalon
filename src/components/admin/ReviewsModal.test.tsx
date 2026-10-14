import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ReviewsModal } from './ReviewsModal';

const { fetchMock, push } = vi.hoisted(() => ({
  fetchMock: vi.fn(),
  push: vi.fn(),
}));

vi.mock('@/providers/SalonProvider', () => ({
  useSalon: () => ({ salonSlug: 'nail-salon-no5' }),
}));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push }),
  usePathname: () => '/en/admin',
  useSearchParams: () => new URLSearchParams('salon=nail-salon-no5&app=reviews'),
}));

describe('ReviewsModal', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    fetchMock.mockReset();
    vi.stubGlobal('fetch', fetchMock);
    fetchMock.mockResolvedValue(
      new Response(
        JSON.stringify({ data: { reviews: [], stats: { totalReviews: 0, averageRating: 0 } } }),
        { status: 200 },
      ),
    );
  });

  it('is named for what it does, so it no longer collides with review settings', async () => {
    render(<ReviewsModal onClose={() => {}} />);

    // Header + card heading both name it; the point is neither says 'Reviews'.
    expect((await screen.findAllByText('Client reviews')).length).toBeGreaterThan(0);
    expect(screen.queryByText('Manual Google review rewards')).not.toBeInTheDocument();
    expect(screen.getByText('Read recorded client feedback')).toBeInTheDocument();
  });

  it('has no review reward grant action, even for existing review rows', async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ data: { reviews: [{ id: 'review_1', clientName: 'Synthetic Client', clientPhone: null, rating: 4, comment: 'Synthetic feedback', createdAt: '2026-10-13T15:00:00Z', googleReviewRewardGranted: false }], stats: { totalReviews: 1, averageRating: 4 } } })));
    render(<ReviewsModal onClose={() => {}} />);
    await screen.findByText('Synthetic feedback');

    expect(screen.queryByRole('button', { name: /grant/i })).not.toBeInTheDocument();
    expect(fetchMock.mock.calls.every(([url]) => !String(url).endsWith('/reward'))).toBe(true);
  });

  it('reaches the Google review link in one tap, keeping the salon', async () => {
    const user = userEvent.setup();
    render(<ReviewsModal onClose={() => {}} />);

    await user.click(await screen.findByTestId('reviews-open-review-settings'));

    expect(push).toHaveBeenCalledWith('/en/admin?salon=nail-salon-no5&app=marketing&view=reviews');
  });

  it('offers a next step when the salon has no reviews yet', async () => {
    render(<ReviewsModal onClose={() => {}} />);

    await waitFor(() => {
      expect(screen.getByTestId('reviews-empty')).toBeInTheDocument();
    });

    const empty = screen.getByTestId('reviews-empty');

    expect(empty).toHaveTextContent('No reviews yet for this salon.');
    expect(empty).toHaveTextContent('add your review link in Review settings');
    expect(
      screen.getByRole('button', { name: /Open Review settings/ }),
    ).toBeInTheDocument();
  });
});
