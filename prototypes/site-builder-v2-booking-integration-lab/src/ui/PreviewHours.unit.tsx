import { render, screen, within } from '@testing-library/react';
import { vi } from 'vitest';

import { createEmptyBookingSession, createMenuFixture } from '../booking/helpers';
import { initializeStarter } from '../model';
import { Preview } from './Preview';

vi.mock('../custom-design/integration/CustomDesignAssetProvider', () => ({
  useCustomDesignAssetMap: () => new Map(),
}));

describe('Builder handoff business metadata', () => {
  it('shows public location, contact, status, and the shared weekly schedule', () => {
    const document = initializeStarter('quick_book');
    const activePage = document.pages[0];
    if (!activePage) throw new Error('Quick Book is missing Home.');

    const view = render(
      <Preview
        activePage={activePage}
        bookingFixture={createMenuFixture()}
        bookingSession={createEmptyBookingSession()}
        businessMetadata={{
          contact: {
            actionLabel: 'Book now',
            detail: 'Booking is the best way to reach us',
          },
          currentHoursStatusLabel: 'Open until 6:00 PM',
          location: {
            detail: 'Exact address shared after booking.',
            directionsAvailable: false,
            primary: 'Scarborough, Ontario',
          },
          weeklyHours: [
            { hours: '10:00 AM–6:00 PM', label: 'Thursday' },
            { hours: 'Closed', label: 'Sunday' },
          ],
        }}
        document={document}
        onBookingSessionChange={vi.fn()}
        onNavigate={vi.fn()}
        tokenPreset="warm"
        viewport="mobile"
      />,
    );
    expect(screen.getByText('Open until 6:00 PM')).toBeVisible();
    const metadata = screen.getByRole('region', { name: 'Business details' });
    expect(within(metadata).getByText('Scarborough, Ontario')).toBeVisible();
    expect(within(metadata).getByText('Exact address shared after booking.')).toBeVisible();
    expect(within(metadata).getByText('Sunday')).toBeVisible();
    expect(within(metadata).getByText('Closed')).toBeVisible();
    expect(within(metadata).queryByRole('button', { name: 'Directions' })).not.toBeInTheDocument();
    expect(within(metadata).getByRole('button', { name: 'Book now' })).toBeVisible();

    view.rerender(
      <Preview
        activePage={activePage}
        bookingFixture={createMenuFixture()}
        bookingSession={createEmptyBookingSession()}
        businessMetadata={{
          contact: null,
          location: {
            detail: null,
            directionsAvailable: false,
            primary: 'Scarborough, Ontario',
          },
          weeklyHours: [],
        }}
        document={document}
        onBookingSessionChange={vi.fn()}
        onNavigate={vi.fn()}
        tokenPreset="warm"
        viewport="mobile"
      />,
    );
    expect(screen.queryByText(/Open until|Closed/u)).not.toBeInTheDocument();
    expect(within(screen.getByRole('region', { name: 'Business details' }))
      .queryByText('Hours')).not.toBeInTheDocument();
  });
});
