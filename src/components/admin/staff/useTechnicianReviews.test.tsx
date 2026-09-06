import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { StaffCard, type StaffCardData } from './StaffCard';
import { summarizeTechnicianReviews } from './useTechnicianReviews';

const DANIELA: StaffCardData = {
  id: 'tech_daniela',
  name: 'Daniela',
  avatarUrl: null,
  role: 'tech',
  skillLevel: 'standard',
  currentStatus: 'available',
  isActive: true,
  acceptingNewClients: true,
  // The hand-entered columns the workspace used to contradict itself with.
  rating: 4.8,
  reviewCount: 127,
  stats: { today: { appointments: 0, revenue: 0 } },
};

describe('summarizeTechnicianReviews', () => {
  it('counts and averages only the reviews the Reviews app lists', () => {
    const summary = summarizeTechnicianReviews([
      { technicianId: 'tech_daniela', rating: 5 },
      { technicianId: 'tech_daniela', rating: 4 },
      { technicianId: 'tech_jenny', rating: 3 },
      // Salon-level review with no technician: belongs to nobody.
      { technicianId: null, rating: 5 },
    ]);

    expect(summary.tech_daniela).toEqual({ count: 2, average: 4.5 });
    expect(summary.tech_jenny).toEqual({ count: 1, average: 3 });
    expect(Object.keys(summary)).toHaveLength(2);
  });

  it('returns nothing for a salon with no reviews', () => {
    expect(summarizeTechnicianReviews([])).toEqual({});
  });
});

describe('StaffCard rating (AG-w2-more-tools-04)', () => {
  it('shows no rating when the salon has no reviews, whatever the technician row says', () => {
    render(
      <StaffCard staff={DANIELA} reviews={null} isLast onClick={() => {}} />,
    );

    // The Reviews app says "0 reviews"; the staff row must not claim 127.
    expect(screen.queryByText('4.8')).not.toBeInTheDocument();
    expect(screen.queryByText(/127/)).not.toBeInTheDocument();
  });

  it('shows the derived rating when real reviews exist', () => {
    render(
      <StaffCard
        staff={DANIELA}
        reviews={{ count: 2, average: 4.5 }}
        isLast
        onClick={() => {}}
      />,
    );

    expect(screen.getByText('4.5')).toBeInTheDocument();
    expect(screen.getByText(/2 reviews/)).toBeInTheDocument();
    // Never the manual column.
    expect(screen.queryByText('4.8')).not.toBeInTheDocument();
  });
});
