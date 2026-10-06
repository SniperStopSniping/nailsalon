import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { factArrangement, selectPrimaryFacts } from './BalancedFacts';
import { MEDIA_LAYOUT_IDS, QUICK_BOOK_MEDIA_GROUPS, QUICK_BOOK_MEDIA_LAYOUTS } from './media-layouts';
import { quickBookMediaUrl } from './MediaQuickBookHeader';
import { QuickBookPresentation } from './QuickBookPresentation';
import { createQuickBookFixture } from './test-fixtures';

describe('24 media-aware Quick Book headers', () => {
  it('offers exactly three structurally declared variants for each of all eight combinations', () => {
    expect(QUICK_BOOK_MEDIA_LAYOUTS).toHaveLength(24);
    expect(new Set(MEDIA_LAYOUT_IDS).size).toBe(24);
    for (const group of QUICK_BOOK_MEDIA_GROUPS) {
      const layouts = QUICK_BOOK_MEDIA_LAYOUTS.filter(layout => layout.mediaConfiguration === group.id);
      expect(layouts.map(layout => layout.variant)).toEqual(['a', 'b', 'c']);
      expect(layouts.every(layout => layout.supportsCover === group.cover && layout.supportsProfile === group.profile && layout.supportsLogo === group.logo)).toBe(true);
    }
  });

  it.each(QUICK_BOOK_MEDIA_LAYOUTS)('$id composes optional facts without losing secondary content or modifying data', (layout) => {
    for (let count = 0; count <= 5; count++) {
      const { profile } = createQuickBookFixture(layout.id, `facts-${count}`);
      const original = JSON.stringify(profile);
      const view = render(<QuickBookPresentation bookingHref="#services" headingId="brand" profile={profile} />);
      const header = view.container.querySelector('.qbm-header')!;
      expect(header).toHaveAttribute('data-qb-layout', layout.id);
      expect(header.querySelectorAll('.qbm-logo')).toHaveLength(layout.supportsLogo ? 1 : 0);
      expect(header.querySelectorAll('.qbm-profile')).toHaveLength(layout.supportsProfile ? 1 : 0);
      expect(header.querySelectorAll('.qbm-cover')).toHaveLength(layout.supportsCover ? 1 : 0);
      expect(header.querySelectorAll('.qbp-fact')).toHaveLength(Math.min(count, 4));
      expect(screen.getByRole('link', { name: 'Book an appointment' })).toHaveAttribute('href', '#services');
      expect(header.querySelectorAll('.qbp-facts')).toHaveLength(count === 0 ? 0 : 1);
      if (count === 5) {
        expect(screen.getByText('Appointment only')).not.toBeVisible();
        fireEvent.click(screen.getByTestId('quick-book-profile-actions').querySelector('summary')!);
        expect(screen.getByText('Appointment only')).toBeVisible();
      }
      expect(JSON.stringify(profile)).toBe(original);
      expect(header.querySelector('[data-content-key="service_catalogue"]')).toBeNull();
      view.unmount();
    }
  });

  it('uses balanced arrangements at both phone sizes and lists genuinely long facts', () => {
    for (const width of [280, 350]) {
      for (const count of [1, 2, 3, 4, 5]) {
        const { profile } = createQuickBookFixture('complete_masthead', `facts-${count}`);
        expect(factArrangement(selectPrimaryFacts(profile, 4).primary, width)).toBe(['one', 'two', 'three', 'four', 'four'][count - 1]);
      }
      const { profile } = createQuickBookFixture('complete_masthead', 'long-facts');
      expect(factArrangement(selectPrimaryFacts(profile, 4).primary, width)).toBe('list');
    }
  });

  it('shows only supplied placeholders for missing/hidden/broken media and automatically replaces them with real uploads', () => {
    const { profile } = createQuickBookFixture('complete_masthead', 'missing-media');
    const view = render(<QuickBookPresentation bookingHref="#services" headingId="brand" profile={profile} />);
    expect([...view.container.querySelectorAll('img')].every(image => image.getAttribute('src')?.startsWith('/quick-book/placeholders/'))).toBe(true);
    const updated = { ...profile, identity: { ...profile.identity, logoUrl: '/real-transparent-logo.png' }, presentation: { ...profile.presentation, portrait: { kind: 'custom' as const, url: '/real-profile.jpg', alt: 'Daniela', focal: { x: 35, y: 25 } }, cover: { kind: 'custom' as const, url: '/real-cover.jpg', focal: { x: 70, y: 40 } } } };
    view.rerender(<QuickBookPresentation bookingHref="#services" headingId="brand" profile={updated} />);
    expect(view.container.querySelector('.qbm-logo img')).toHaveAttribute('src', '/real-transparent-logo.png');
    expect(view.container.querySelector('.qbm-profile img')).toHaveStyle({ objectPosition: '35% 25%' });
    expect(view.container.querySelector('.qbm-cover img')).toHaveStyle({ objectPosition: '70% 40%' });
    fireEvent.error(view.container.querySelector('.qbm-logo img')!);
    expect(view.container.querySelector('.qbm-logo img')).toHaveAttribute('src', '/quick-book/placeholders/logo.webp');
  });

  it('uses small delivery copies without rewriting private/signed media URLs', () => {
    expect(quickBookMediaUrl('/quick-book/placeholders/logo.webp', 160)).toContain('logo-thumb.webp');
    expect(quickBookMediaUrl('https://res.cloudinary.com/demo/image/upload/v123/logo.png', 160)).toContain('/f_auto,q_auto,c_limit,w_160/');
    expect(quickBookMediaUrl('https://res.cloudinary.com/demo/image/upload/s--signed--/logo.png', 160)).toContain('/upload/s--signed--/');
    expect(quickBookMediaUrl('https://private.example.com/image.png', 160)).toBe('https://private.example.com/image.png');
  });
});
