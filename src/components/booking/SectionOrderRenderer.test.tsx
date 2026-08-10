import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import type { SectionId } from '@/libs/bookingPageConfig';
import { EMPTY_SALON_CONTENT, type SalonContent } from '@/libs/salonContent';

import { SectionOrderRenderer } from './SectionOrderRenderer';

const QUICK_BOOK_ORDER: SectionId[] = [
  'salonProfile',
  'serviceMenu',
  'featuredServices',
  'policies',
  'socialLinks',
  'bookingCta',
];

function withContent(overrides: Partial<SalonContent>): SalonContent {
  return { ...EMPTY_SALON_CONTENT, ...overrides };
}

describe('SectionOrderRenderer', () => {
  it('renders every section with both a passing canRender and a supplied renderer, in order', () => {
    const content = withContent({
      identity: { ...EMPTY_SALON_CONTENT.identity, name: 'Isla Nail Studio' },
      social: { instagram: 'https://instagram.com/isla', facebook: null, tiktok: null },
    });

    render(
      <SectionOrderRenderer
        order={QUICK_BOOK_ORDER}
        content={content}
        renderers={{
          salonProfile: () => <div data-testid="section-salonProfile">profile</div>,
          serviceMenu: () => <div data-testid="section-serviceMenu">menu</div>,
          socialLinks: () => <div data-testid="section-socialLinks">social</div>,
          bookingCta: () => <div data-testid="section-bookingCta">cta</div>,
        }}
      />,
    );

    const rendered = screen.getAllByTestId(/^section-/).map(node => node.dataset.testid);

    // featuredServices/policies are dropped: featuredServices has no
    // renderer supplied here (Quick Book folds it into serviceMenu), and
    // policies fails canRender (policy.enabled is false on this content).
    expect(rendered).toEqual([
      'section-salonProfile',
      'section-serviceMenu',
      'section-socialLinks',
      'section-bookingCta',
    ]);
  });

  it('renders only the non-removable sections against a minimally populated SalonContent', () => {
    render(
      <SectionOrderRenderer
        order={QUICK_BOOK_ORDER}
        content={EMPTY_SALON_CONTENT}
        renderers={{
          salonProfile: () => <div data-testid="section-salonProfile">profile</div>,
          serviceMenu: () => <div data-testid="section-serviceMenu">menu</div>,
          featuredServices: () => <div data-testid="section-featuredServices">featured</div>,
          policies: () => <div data-testid="section-policies">policies</div>,
          socialLinks: () => <div data-testid="section-socialLinks">social</div>,
          bookingCta: () => <div data-testid="section-bookingCta">cta</div>,
        }}
      />,
    );

    // EMPTY_SALON_CONTENT has no name, so even salonProfile is omitted here
    // — only the two non-removable sections survive, and the page is still
    // bookable (serviceMenu hosts the engine, bookingCta is its entry point).
    expect(screen.queryByTestId('section-salonProfile')).not.toBeInTheDocument();
    expect(screen.getByTestId('section-serviceMenu')).toBeInTheDocument();
    expect(screen.queryByTestId('section-featuredServices')).not.toBeInTheDocument();
    expect(screen.queryByTestId('section-policies')).not.toBeInTheDocument();
    expect(screen.queryByTestId('section-socialLinks')).not.toBeInTheDocument();
    expect(screen.getByTestId('section-bookingCta')).toBeInTheDocument();
  });

  it('never renders a section as an empty frame when its own renderer is omitted, even if canRender passes', () => {
    const content = withContent({
      identity: { ...EMPTY_SALON_CONTENT.identity, name: 'Isla Nail Studio' },
    });

    render(
      <SectionOrderRenderer
        order={['salonProfile', 'serviceMenu', 'bookingCta']}
        content={content}
        renderers={{
          serviceMenu: () => <div data-testid="section-serviceMenu">menu</div>,
          bookingCta: () => <div data-testid="section-bookingCta">cta</div>,
        }}
      />,
    );

    // salonProfile passes canRender but has no renderer supplied — omitted,
    // not rendered as an empty placeholder.
    expect(screen.queryByTestId('section-salonProfile')).not.toBeInTheDocument();
    expect(screen.getByTestId('section-serviceMenu')).toBeInTheDocument();
    expect(screen.getByTestId('section-bookingCta')).toBeInTheDocument();
  });
});
