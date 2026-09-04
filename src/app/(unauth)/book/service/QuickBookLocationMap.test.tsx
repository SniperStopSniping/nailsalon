import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { BOOKING_EXPERIENCE_DEFAULTS } from '@/libs/bookingExperience';
import { EMPTY_SHARED_SALON_PROFILE } from '@/libs/sharedSalonProfile';

import { QuickBookLocationMap } from './QuickBookLocationMap';
import { resolvePublicQuickBookProfile } from './quickBookProfile';

function source(): Parameters<typeof resolvePublicQuickBookProfile>[0] {
  return {
    salon: {
      name: 'Map Test Studio',
      logoUrl: null,
      phone: null,
      email: null,
      address: '880 Ellesmere Rd, Unit 2',
      city: 'Toronto',
      state: 'ON',
      zipCode: 'M1P 2W8',
      businessHours: null,
    },
    technicians: [],
    locations: [],
    bookingExperience: BOOKING_EXPERIENCE_DEFAULTS,
    reviewUrl: null,
    sharedProfile: {
      ...EMPTY_SHARED_SALON_PROFILE,
      entranceInstructions: 'Enter through the private rear door at Unit 2',
    },
    parkingInstructions: 'Private parking behind 880 Ellesmere',
    visibility: { showLocation: true },
    bio: null,
    locationDisplayMode: 'full_address',
    timeZone: 'America/Toronto',
  };
}

describe('QuickBookLocationMap', () => {
  it('embeds the full location only after the public projection permits it', () => {
    const profile = resolvePublicQuickBookProfile(source());
    render(<QuickBookLocationMap location={profile.location} />);

    const iframe = screen.getByTitle('Map of 880 Ellesmere Rd, Unit 2, Toronto, ON M1P 2W8');

    expect(iframe).toHaveAttribute('src', 'https://www.google.com/maps?q=880%20Ellesmere%20Rd%2C%20Unit%202%2C%20Toronto%2C%20ON%20M1P%202W8&output=embed');
    expect(iframe).toHaveAttribute('loading', 'lazy');
    expect(iframe).toHaveAttribute('referrerpolicy', 'no-referrer');
    expect(iframe).toHaveAttribute('sandbox', 'allow-scripts allow-same-origin allow-popups');
    expect(iframe).toHaveClass('h-60', 'w-full');
    expect(screen.getByRole('region', { name: 'Location map' })).toBeInTheDocument();
    expect(screen.queryByText('880 Ellesmere Rd, Unit 2')).not.toBeInTheDocument();
  });

  it('uses only the general area for the city-only projection shared by private and after-booking addresses', () => {
    const privateSource = source();
    privateSource.locationDisplayMode = 'city_only';
    const original = structuredClone(privateSource);
    const profile = resolvePublicQuickBookProfile(privateSource);
    const { container } = render(<QuickBookLocationMap location={profile.location} />);

    expect(screen.getByTitle('Map of Toronto, ON')).toHaveAttribute('src', 'https://www.google.com/maps?q=Toronto%2C%20ON&output=embed');
    expect(container.innerHTML).not.toContain('880');
    expect(container.innerHTML).not.toContain('Ellesmere');
    expect(container.innerHTML).not.toContain('Unit');
    expect(container.innerHTML).not.toContain('M1P');
    expect(container.innerHTML).not.toContain('rear door');
    expect(privateSource).toEqual(original);
  });

  it('removes the complete map region when location is hidden or absent', () => {
    const hiddenSource = source();
    hiddenSource.visibility = { showLocation: false };
    const hidden = resolvePublicQuickBookProfile(hiddenSource);
    const { container, rerender } = render(<QuickBookLocationMap location={hidden.location} />);

    expect(container).toBeEmptyDOMElement();

    const missingSource = source();
    missingSource.salon = { ...missingSource.salon, address: null, city: null, state: null, zipCode: null };
    const missing = resolvePublicQuickBookProfile(missingSource);
    rerender(<QuickBookLocationMap location={missing.location} />);

    expect(container).toBeEmptyDOMElement();

    rerender(<QuickBookLocationMap location={{ name: 'Internal name', addressLine: ' ', localityLine: null, directionsUrl: 'https://example.com', instructionLines: [] }} />);

    expect(container).toBeEmptyDOMElement();
  });
});
