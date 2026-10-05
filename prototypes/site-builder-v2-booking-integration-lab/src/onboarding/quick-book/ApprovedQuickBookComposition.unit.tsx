import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { APPROVED_QUICK_BOOK_LAYOUTS, ApprovedQuickBookComposition } from './ApprovedQuickBookComposition';
import { BalancedFacts, factArrangement, selectPrimaryFacts } from './BalancedFacts';
import { QuickBookPresentation } from './QuickBookPresentation';
import { buildQuickBookFacts } from './QuickBookPrimitives';
import { createQuickBookFixture } from './test-fixtures';

vi.stubGlobal('ResizeObserver', class {
  observe() {} disconnect() {}
});

describe('integrated approved Quick Book compositions', () => {
  it.each(APPROVED_QUICK_BOOK_LAYOUTS)('%s prioritizes data without losing or modifying permitted facts', (layout) => {
    for (let count = 0; count <= 5; count += 1) {
      const { profile } = createQuickBookFixture(layout, `facts-${count}`);
      const original = JSON.stringify(profile);
      const selection = selectPrimaryFacts(profile, layout === 'compact_dropdown' ? 3 : 4);

      expect(selection.primary.length).toBe(Math.min(count, layout === 'compact_dropdown' ? 3 : 4));
      expect([...selection.primary, ...selection.secondary].map(fact => fact.id).sort())
        .toEqual(buildQuickBookFacts(profile).map(fact => fact.id).sort());
      expect(selection.primary.some(fact => fact.id === 'booking')).toBe(false);
      expect(JSON.stringify(profile)).toBe(original);
    }
  });

  it('balances each count and makes long values a full-width list', () => {
    for (const width of [284, 346]) {
      for (let count = 1; count <= 4; count += 1) {
        const { profile } = createQuickBookFixture('side_portrait', `facts-${count}`);

        expect(factArrangement(selectPrimaryFacts(profile, 4).primary, width))
          .toBe(['one', 'two', 'three', 'four'][count - 1]);
      }
      const { profile } = createQuickBookFixture('side_portrait', 'long-facts');

      expect(factArrangement(selectPrimaryFacts(profile, 4).primary, width)).toBe('list');
    }
  });

  it('renders no empty primary information region for zero facts', () => {
    const { profile } = createQuickBookFixture('compact_dropdown', 'facts-0');
    const { container } = render(<BalancedFacts facts={[]} hours={profile.hours} />);

    expect(container).toBeEmptyDOMElement();
  });

  it('uses permitted review values without adding a rating to the normal fixture', () => {
    const normal = createQuickBookFixture('side_portrait', 'normal');

    expect(selectPrimaryFacts(normal.profile, 4).primary.some(fact => fact.id === 'reviews')).toBe(false);

    const rated = createQuickBookFixture('side_portrait', 'facts-4');
    const review = selectPrimaryFacts(rated.profile, 4).primary.find(fact => fact.id === 'reviews');

    expect(review?.value).toBe(rated.profile.reviews?.ratingText);
    expect(review?.detail).toBe(rated.profile.reviews?.reviewCountText);
  });

  it.each(APPROVED_QUICK_BOOK_LAYOUTS)('%s does not require a portrait or cover node', (layout) => {
    const { profile } = createQuickBookFixture(layout, 'hidden-media');
    const { container } = render(<ApprovedQuickBookComposition bookingHref="#services" headingId="business" layout={layout} profile={profile} />);

    expect(container.querySelector('.qb-portrait')).toBeNull();
    expect(container.querySelector('.qb-cover')).toBeNull();
    expect(screen.getByRole('heading', { name: profile.identity.salonName })).toBeVisible();
  });

  it.each(APPROVED_QUICK_BOOK_LAYOUTS)('%s preserves privacy, complete biography and secondary policies', (layout) => {
    const { profile } = createQuickBookFixture(layout, 'facts-5');
    const { container } = render(<ApprovedQuickBookComposition bookingHref="#services" headingId="business" layout={layout} profile={profile} />);

    expect(container.innerHTML).not.toContain('880 Ellesmere');
    expect(container.innerHTML).not.toContain('maps.google');

    const summary = screen.getByTestId('quick-book-profile-actions').querySelector('summary')!;
    fireEvent.click(summary);

    expect(screen.getByText('Appointment only')).toBeVisible();
    expect(screen.getByText(profile.fullBio!)).toBeVisible();
    expect(screen.getByText('Exact address shared after booking.')).toBeVisible();

    for (const policy of profile.policies) {
      expect(screen.getByText(policy.text)).toBeVisible();
    }
  });

  it('routes the approved layouts through the shared customer renderer', () => {
    const { profile } = createQuickBookFixture('side_portrait', 'normal');
    const { container } = render(<QuickBookPresentation bookingHref="#services" headingId="business" profile={profile} />);

    expect(container.querySelector('.qbp-personal')).not.toBeNull();
    expect(screen.getByRole('link', { name: 'Book an appointment' })).toHaveAttribute('href', '#services');
  });

  it('uses the fixture-selected services and existing deposit adapter', () => {
    const normal = createQuickBookFixture('compact_dropdown', 'normal');
    const missing = createQuickBookFixture('compact_dropdown', 'no-service-images');

    expect(normal.menu.services).toHaveLength(6);
    expect(missing.menu.services.map(service => service.id)).toEqual(normal.menu.services.map(service => service.id));
    expect(missing.menu.services.every(service => service.image === null)).toBe(true);
    expect(normal.depositSummary).toBe('$50 deposit');
  });
});
