import { readFileSync } from 'node:fs';
import { join } from 'node:path';

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
    if (!activePage) {
      throw new Error('Quick Book is missing Home.');
    }

    const view = render(
      <Preview
        activePage={activePage}
        bookingFixture={createMenuFixture()}
        bookingSession={createEmptyBookingSession()}
        businessMetadata={{
          contacts: [{
            actionLabel: 'Book now',
            detail: 'Booking is the best way to reach us',
            external: false,
            href: '#booking',
            method: 'booking',
            preferred: true,
          }],
          currentHoursStatusLabel: 'Open until 6:00 PM',
          directions: null,
          location: {
            detail: 'Exact address shared after booking.',
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
    expect(within(metadata).queryByRole('link', { name: /Directions/u })).not.toBeInTheDocument();
    expect(within(metadata).getByRole('link', { name: 'Book now' })).toHaveAttribute('href', '#booking');
    expect(globalThis.document.querySelector('#booking'))
      .toHaveAttribute('data-section-type', 'booking');
    // Quick Book owns one opening Hero and one transactional service catalogue.
    // The catalogue lives inside Booking; there is no separate Featured Services
    // section in the locked V1 document.
    expect(screen.getByRole('heading', { name: 'Salon intro' })).toBeVisible();
    expect(activePage.sections.map(section => section.sectionType)).toEqual([
      'hero',
      'booking',
      'gallery',
      'visit_us',
    ]);
    expect(view.container.querySelectorAll('[data-section-type="booking"]')).toHaveLength(1);
    expect(view.container.querySelector('[data-section-type="featured_services"]'))
      .not.toBeInTheDocument();
    expect(within(screen.getByRole('region', { name: 'Booking section' }))
      .getByRole('heading', { name: 'All services' })).toBeVisible();
    expect(screen.queryByText(/Future section/u)).not.toBeInTheDocument();

    view.rerender(
      <Preview
        activePage={activePage}
        bookingFixture={createMenuFixture()}
        bookingSession={createEmptyBookingSession()}
        businessMetadata={{
          contacts: [],
          directions: null,
          location: {
            detail: null,
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

  it('renders every canonical contact action and an activatable safe Directions link', () => {
    const document = initializeStarter('quick_book');
    const activePage = document.pages[0];
    if (!activePage) {
      throw new Error('Quick Book is missing Home.');
    }

    const view = render(
      <Preview
        activePage={activePage}
        bookingFixture={createMenuFixture()}
        bookingSession={createEmptyBookingSession()}
        businessMetadata={{
          contacts: [
            {
              actionLabel: 'Text',
              detail: '647-555-0199',
              external: true,
              href: 'sms:6475550199',
              method: 'text',
              preferred: true,
            },
            {
              actionLabel: 'Call',
              detail: '416-555-0100',
              external: true,
              href: 'tel:4165550100',
              method: 'call',
              preferred: false,
            },
          ],
          directions: {
            accessibleLabel: 'Directions to 123 Example Avenue',
            href: 'https://www.google.com/maps/search/?api=1&query=123%20Example%20Avenue',
            rel: 'noopener noreferrer',
            target: '_blank',
          },
          location: {
            detail: 'Scarborough, Ontario',
            primary: '123 Example Avenue',
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

    const metadata = screen.getByRole('region', { name: 'Business details' });

    expect(within(metadata).getByText('647-555-0199')).toBeVisible();
    expect(within(metadata).getByRole('link', { name: 'Text · Preferred' }))
      .toHaveAttribute('href', 'sms:6475550199');
    expect(within(metadata).getByRole('link', { name: 'Text · Preferred' }))
      .toHaveClass('is-preferred');
    expect(within(metadata).getByRole('link', { name: 'Call' }))
      .toHaveAttribute('href', 'tel:4165550100');
    expect(within(metadata).getByRole('link', { name: 'Directions to 123 Example Avenue' }))
      .toHaveAttribute(
        'href',
        'https://www.google.com/maps/search/?api=1&query=123%20Example%20Avenue',
      );

    view.rerender(
      <Preview
        activePage={activePage}
        bookingFixture={createMenuFixture()}
        bookingSession={createEmptyBookingSession()}
        businessMetadata={{
          contacts: [{
            actionLabel: 'Book now',
            detail: 'Booking is the best way to reach us',
            external: false,
            href: '#booking',
            method: 'booking',
            preferred: true,
          }],
          directions: null,
          location: { detail: null, primary: 'Scarborough, Ontario' },
          weeklyHours: [],
        }}
        document={document}
        onBookingSessionChange={vi.fn()}
        onNavigate={vi.fn()}
        tokenPreset="warm"
        viewport="mobile"
      />,
    );

    const bookingOnlyMetadata = screen.getByRole('region', { name: 'Business details' });

    expect(within(bookingOnlyMetadata).queryByRole('link', { name: /Call|Text/u }))
      .not.toBeInTheDocument();
    expect(within(bookingOnlyMetadata).getByRole('link', { name: 'Book now' }))
      .toHaveAttribute('href', '#booking');
  });

  it('keeps a long Builder business name bounded without losing its full accessible value', () => {
    const document = initializeStarter('multi_page');
    document.siteName = 'Polished Beauty Lounge and Academy with an Exceptionally Long Studio Name';
    const activePage = document.pages[0];
    if (!activePage) {
      throw new Error('Multi-page starter is missing Home.');
    }

    render(
      <Preview
        activePage={activePage}
        bookingFixture={createMenuFixture()}
        bookingSession={createEmptyBookingSession()}
        document={document}
        onBookingSessionChange={vi.fn()}
        onNavigate={vi.fn()}
        tokenPreset="warm"
        viewport="desktop"
      />,
    );

    const brand = screen.getByTitle(document.siteName);

    expect(within(brand).getByText(document.siteName)).toBeVisible();
    expect(screen.getByRole('navigation', { name: 'Preview site navigation' })).toBeVisible();

    const css = readFileSync(join(process.cwd(), 'src/styles.css'), 'utf8');

    expect(css).toMatch(/\.client-brand\s*\{[^}]*min-width:\s*0;/u);
    expect(css).toMatch(/\.client-brand\s*>\s*strong\s*\{[^}]*text-overflow:\s*ellipsis;/u);
  });
});
