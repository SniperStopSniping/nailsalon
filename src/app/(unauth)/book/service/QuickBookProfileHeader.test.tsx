import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { QUICK_BOOK_SITE_LAYOUTS } from '@/libs/quickBookSiteLayout';

import type { QuickBookProfileView } from './quickBookProfile';
import { QuickBookProfileHeader } from './QuickBookProfileHeader';

const MINIMAL_PROFILE: QuickBookProfileView = {
  identity: {
    salonName: 'Isla Nail Studio',
    logoUrl: null,
    technicianName: null,
    technicianPhotoUrl: null,
  },
  location: null,
  hours: null,
  contact: null,
  policies: [],
  reviews: null,
  instagram: null,
  bio: null,
};

const FULL_PROFILE: QuickBookProfileView = {
  identity: {
    salonName: 'Isla Nail Studio With A Deliberately Long Name',
    logoUrl: '/isla-logo.png',
    technicianName: 'Daniela',
    technicianPhotoUrl: '/daniela.jpg',
  },
  location: {
    name: null,
    addressLine: '880 Ellesmere Rd, Unit 2',
    localityLine: 'Scarborough, ON M1P 2W8',
    directionsUrl: 'https://www.google.com/maps/search/?api=1&query=880%20Ellesmere',
    instructionLines: [
      'Inside TB Nails · Back of building',
      'Parking: Use the rear lot',
    ],
  },
  hours: {
    statusLabel: 'Open today',
    todayLabel: '10:00 AM – 9:30 PM',
    weekly: [
      { day: 'Monday', value: '10:00 AM – 9:30 PM' },
      { day: 'Tuesday', value: 'Closed' },
    ],
  },
  contact: {
    phone: { actionLabel: 'Call or text', display: '(647) 123-4567', href: 'tel:6471234567' },
    email: { display: 'appointments.with.a.long.address@islanails.com', href: 'mailto:appointments.with.a.long.address@islanails.com' },
  },
  policies: [
    { label: 'Booking', text: 'Appointment only.' },
    { label: 'Cancellation', text: 'Please provide 24 hours notice.' },
  ],
  reviews: {
    ratingText: '5.0',
    reviewCountText: '128',
    href: 'https://g.page/r/isla/review',
  },
  instagram: {
    label: '@isla.nails',
    href: 'https://www.instagram.com/isla.nails/',
  },
  bio: 'Healthy nails, flawless results. Specializing in BIAB, Gel-X and Russian Manicure.',
};

describe('QuickBookProfileHeader', () => {
  it('renders six distinct presentations without changing canonical profile data', () => {
    const sourceBefore = structuredClone(FULL_PROFILE);
    const fingerprints = new Set<string>();

    for (const layout of QUICK_BOOK_SITE_LAYOUTS) {
      const view = render(
        <QuickBookProfileHeader
          profile={FULL_PROFILE}
          bookingFlow={['service', 'tech', 'time', 'confirm']}
          layout={layout}
          mounted
        />,
      );
      const header = screen.getByTestId('booking-step-header');
      const profile = screen.getByTestId('quick-book-profile');
      const identity = screen.getByTestId('quick-book-identity');
      const details = screen.getByTestId('quick-book-business-details');

      expect(header).toHaveAttribute('data-quick-book-layout', layout);
      expect(profile).toHaveAttribute('data-layout-presentation', layout);

      fingerprints.add([
        profile.className,
        identity.className,
        details.className,
        screen.getByTestId('quick-book-bio').className,
      ].join('|'));
      view.unmount();
    }

    expect(fingerprints).toHaveLength(QUICK_BOOK_SITE_LAYOUTS.length);
    expect(FULL_PROFILE).toEqual(sourceBefore);
  });

  it('renders a compact minimal identity immediately above booking', () => {
    render(
      <QuickBookProfileHeader
        profile={MINIMAL_PROFILE}
        bookingFlow={['service', 'tech', 'time', 'confirm']}
        mounted
      />,
    );

    expect(screen.getByRole('heading', { level: 1, name: 'Isla Nail Studio' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 2, name: 'Book an appointment' })).toBeInTheDocument();
    expect(screen.queryByTestId('quick-book-location')).not.toBeInTheDocument();
    expect(screen.queryByTestId('quick-book-hours')).not.toBeInTheDocument();
    expect(screen.queryByTestId('quick-book-contact')).not.toBeInTheDocument();
    expect(screen.queryByTestId('quick-book-profile-actions')).not.toBeInTheDocument();
    expect(screen.queryByTestId('quick-book-bio')).not.toBeInTheDocument();
  });

  it('renders a full, tappable profile and discloses hours and policies accessibly', () => {
    render(
      <QuickBookProfileHeader
        profile={FULL_PROFILE}
        bookingFlow={['service', 'tech', 'time', 'confirm']}
        mounted
      />,
    );

    expect(screen.getByAltText('Isla Nail Studio With A Deliberately Long Name logo')).toBeInTheDocument();
    expect(screen.getByAltText('Daniela')).toBeInTheDocument();
    expect(screen.getByTestId('quick-book-location')).toHaveAttribute('href', expect.stringContaining('google.com/maps'));
    expect(screen.getByTestId('quick-book-location')).toHaveTextContent('Inside TB Nails · Back of building');
    expect(screen.getByTestId('quick-book-location')).toHaveTextContent('Parking: Use the rear lot');
    expect(screen.getByRole('link', { name: /647.*123.*4567/ })).toHaveAttribute('href', 'tel:6471234567');
    expect(screen.getByRole('link', { name: /647.*123.*4567.*call or text/i })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /appointments\.with\.a\.long\.address@islanails\.com/i })).toHaveAttribute(
      'href',
      'mailto:appointments.with.a.long.address@islanails.com',
    );
    expect(screen.getByRole('link', { name: '@isla.nails' })).toHaveAttribute(
      'href',
      'https://www.instagram.com/isla.nails/',
    );
    expect(screen.getByRole('link', { name: /Reviews 5\.0 ★ \(128\)/u })).toHaveAttribute(
      'href',
      'https://g.page/r/isla/review',
    );

    const hours = screen.getByTestId('quick-book-hours');
    fireEvent.click(within(hours).getByText('Open today'));

    expect(within(hours).getByText('Tuesday')).toBeInTheDocument();
    expect(within(hours).getByText('Closed')).toBeInTheDocument();

    const policies = screen.getByTestId('quick-book-policies');
    fireEvent.click(within(policies).getByText('Policies'));

    expect(within(policies).getByText('Appointment only.')).toBeInTheDocument();
    expect(within(policies).getByText('Please provide 24 hours notice.')).toBeInTheDocument();
    expect(screen.getByTestId('quick-book-bio')).toHaveTextContent('Healthy nails');
  });

  it('uses full-width rows instead of reserving blank columns for one contact or action', () => {
    render(
      <QuickBookProfileHeader
        profile={{
          ...MINIMAL_PROFILE,
          contact: {
            phone: { actionLabel: 'Call', display: '(647) 123-4567', href: 'tel:6471234567' },
            email: null,
          },
          reviews: {
            ratingText: '5.0',
            reviewCountText: '128',
            href: null,
          },
        }}
        bookingFlow={['service', 'tech', 'time', 'confirm']}
        mounted
      />,
    );

    expect(screen.getByTestId('quick-book-contact')).toHaveClass('grid-cols-1');
    expect(screen.getByTestId('quick-book-profile-actions')).toHaveClass('grid-cols-1');
    expect(screen.getByTestId('quick-book-profile-actions')).not.toHaveClass('sm:grid-cols-3');
  });
});
