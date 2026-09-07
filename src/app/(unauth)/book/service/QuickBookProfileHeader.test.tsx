import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import {
  getQuickBookLayout,
  QUICK_BOOK_SITE_LAYOUTS,
  type QuickBookSiteLayout,
} from '@/libs/quickBookSiteLayout';

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
  it('renders every registered layout as a distinct presentation without changing canonical profile data', () => {
    const sourceBefore = structuredClone(FULL_PROFILE);
    const fingerprints = new Set<string>();
    // The design-system layouts share one class vocabulary and differ by
    // composition, so the fingerprint also captures their block structure
    // with text, media and the layout identifier itself stripped out.
    const structure = (root: HTMLElement) => (root.querySelector('.qb-presentation')?.outerHTML ?? '')
      .replace(/>[^<]+</g, '><')
      .replace(/ (?:id|alt|src|href|style|aria-[a-z-]+|data-qb-layout|data-qb-family)="[^"]*"/g, '');

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
      expect(profile).toHaveAttribute('data-public-surface', 'salonProfile');

      // Which blocks a layout puts above booking IS its content recipe, so the
      // inventory belongs in the fingerprint: two layouts that show the same
      // blocks in the same arrangement would not be two designs.
      const blocks = [...profile.querySelectorAll('[data-qb-block]')]
        .map(node => node.getAttribute('data-qb-block'))
        .join(',');

      fingerprints.add([
        profile.className,
        identity.className,
        details.className,
        blocks,
        structure(profile),
      ].join('|'));
      view.unmount();
    }

    expect(fingerprints).toHaveLength(QUICK_BOOK_SITE_LAYOUTS.length);
    expect(FULL_PROFILE).toEqual(sourceBefore);
  });

  it('lets each layout curate which image roles it shows, without changing the data', () => {
    const sourceBefore = structuredClone(FULL_PROFILE);
    const shown = (layout: QuickBookSiteLayout) => {
      const view = render(
        <QuickBookProfileHeader
          profile={FULL_PROFILE}
          bookingFlow={['service', 'tech', 'time', 'confirm']}
          layout={layout}
          mounted
        />,
      );
      const result = {
        logo: screen.queryByAltText(/logo$/u) !== null,
        portrait: screen.queryByAltText('Daniela') !== null
          || screen.queryByTestId('quick-book-portrait-image') !== null,
      };
      view.unmount();
      return result;
    };

    for (const layout of QUICK_BOOK_SITE_LAYOUTS) {
      const definition = getQuickBookLayout(layout);
      const rendered = shown(layout);

      expect(
        { layout, ...rendered },
        `${layout} must follow its own content recipe`,
      ).toEqual({
        layout,
        logo: definition.logo !== 'omitted',
        portrait: definition.portrait !== 'none',
      });
    }

    // Curating a header never edits the salon.
    expect(FULL_PROFILE).toEqual(sourceBefore);
  });

  it('renders the saved social link exactly once, wherever a layout parks it', () => {
    for (const layout of QUICK_BOOK_SITE_LAYOUTS) {
      const definition = getQuickBookLayout(layout);
      const view = render(
        <QuickBookProfileHeader
          profile={FULL_PROFILE}
          bookingFlow={['service', 'tech', 'time', 'confirm']}
          layout={layout}
          mounted
        />,
      );
      const links = screen.queryAllByTestId('quick-book-instagram');
      const details = screen.queryByTestId('quick-book-salon-details');

      // Never dropped and never printed twice, whatever the recipe says. A
      // layout that shows no action rows at all is the one exception.
      const expected = definition.actions === 'none' ? 0 : 1;

      expect(links, `${layout} must show the saved social link ${expected} time(s)`).toHaveLength(expected);

      if (expected === 0) {
        view.unmount();
        continue;
      }

      const [link] = links;
      if (!link) {
        throw new Error(`${layout} rendered no social link`);
      }

      expect(link).toHaveAttribute('href', FULL_PROFILE.instagram?.href);

      if (definition.social === 'details') {
        expect(details, `${layout} parks the social link in Salon details`).not.toBeNull();
        expect(details).toContainElement(link);
      } else if (details) {
        expect(details).not.toContainElement(link);
      }
      view.unmount();
    }
  });

  it('gives the social link its own row when Salon details has nothing of its own to hold', () => {
    // Editorial Split normally parks the link inside Salon details. A map-pin
    // disclosure called "Salon details" whose entire body is an Instagram row
    // would be a lie about itself, so the link keeps its row instead.
    render(
      <QuickBookProfileHeader
        profile={{ ...MINIMAL_PROFILE, instagram: FULL_PROFILE.instagram }}
        bookingFlow={['service', 'tech', 'time', 'confirm']}
        layout="editorial_split"
        mounted
      />,
    );

    const link = screen.getByTestId('quick-book-instagram');

    expect(screen.queryByTestId('quick-book-salon-details')).not.toBeInTheDocument();
    expect(link).toHaveAttribute('href', FULL_PROFILE.instagram?.href);
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

    // Clean Card's recipe keeps the logo and omits the portrait: two centred
    // image blobs either side of the name is the composition this layout is
    // meant to avoid. The photo itself is untouched on the salon record and
    // every portrait-led layout still uses it.
    expect(screen.getByAltText('Isla Nail Studio With A Deliberately Long Name logo')).toBeInTheDocument();
    expect(screen.queryByAltText('Daniela')).not.toBeInTheDocument();
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

  // AG-w2-public-quick-book-07: hub_menu lays details out in two columns, so
  // a lone contact cell kept half the width and the email broke mid-word.
  it('gives the hub_menu contact and lone social cells the whole row', () => {
    render(
      <QuickBookProfileHeader
        profile={{
          ...MINIMAL_PROFILE,
          contact: {
            phone: null,
            email: {
              display: 'hello.audit0905@example.com',
              href: 'mailto:hello.audit0905@example.com',
            },
          },
          instagram: {
            label: '@audit0905lacquerlab',
            href: 'https://www.instagram.com/audit0905lacquerlab/',
          },
        }}
        bookingFlow={['service', 'tech', 'time', 'confirm']}
        layout="hub_menu"
        mounted
      />,
    );

    expect(screen.getByTestId('quick-book-contact')).toHaveClass('col-span-full');

    const email = screen.getByRole('link', { name: /hello\.audit0905@example\.com/ });
    const emailLabel = email.querySelector('span');

    // break-all shattered the address mid-token; break-words keeps whole
    // segments together and only breaks a run that truly cannot fit.
    expect(emailLabel).toHaveClass('break-words');
    expect(emailLabel).not.toHaveClass('break-all');

    const instagram = screen.getByRole('link', { name: '@audit0905lacquerlab' });

    expect(instagram).toHaveClass('col-span-full');
    expect(instagram.querySelector('span')).not.toHaveClass('truncate');
  });
});
