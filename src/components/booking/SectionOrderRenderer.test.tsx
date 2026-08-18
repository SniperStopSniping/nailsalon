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

  // Regression coverage: hiddenSections used to be written and validated but
  // never read at render time (every fixture above uses the default `[]`
  // hiddenSections, which is exactly why this shipped broken). These use a
  // NON-EMPTY hiddenSections to actually exercise the fix.
  describe('hiddenSections', () => {
    it('omits a hidden section even though both canRender and a renderer are present', () => {
      const content = withContent({
        identity: { ...EMPTY_SALON_CONTENT.identity, name: 'Isla Nail Studio' },
        policies: { ...EMPTY_SALON_CONTENT.policies, policy: { ...EMPTY_SALON_CONTENT.policies.policy, enabled: true } },
      });

      render(
        <SectionOrderRenderer
          order={QUICK_BOOK_ORDER}
          hiddenSections={['policies']}
          content={content}
          renderers={{
            salonProfile: () => <div data-testid="section-salonProfile">profile</div>,
            serviceMenu: () => <div data-testid="section-serviceMenu">menu</div>,
            policies: () => <div data-testid="section-policies">policies</div>,
            bookingCta: () => <div data-testid="section-bookingCta">cta</div>,
          }}
        />,
      );

      expect(screen.getByTestId('section-salonProfile')).toBeInTheDocument();
      expect(screen.queryByTestId('section-policies')).not.toBeInTheDocument();
      expect(screen.getByTestId('section-bookingCta')).toBeInTheDocument();
    });

    it('re-enabling a previously hidden section (empty hiddenSections again) restores it at its original order position', () => {
      const content = withContent({
        identity: { ...EMPTY_SALON_CONTENT.identity, name: 'Isla Nail Studio' },
        policies: { ...EMPTY_SALON_CONTENT.policies, policy: { ...EMPTY_SALON_CONTENT.policies.policy, enabled: true } },
        social: { instagram: 'https://instagram.com/isla', facebook: null, tiktok: null },
      });
      const renderers = {
        salonProfile: () => <div data-testid="section-salonProfile">profile</div>,
        serviceMenu: () => <div data-testid="section-serviceMenu">menu</div>,
        policies: () => <div data-testid="section-policies">policies</div>,
        socialLinks: () => <div data-testid="section-socialLinks">social</div>,
        bookingCta: () => <div data-testid="section-bookingCta">cta</div>,
      };

      const { rerender } = render(
        <SectionOrderRenderer order={QUICK_BOOK_ORDER} hiddenSections={['policies']} content={content} renderers={renderers} />,
      );

      // Hiding does not touch sectionOrder — the position between
      // salonProfile/serviceMenu and socialLinks/bookingCta survives while
      // hidden, and QUICK_BOOK_ORDER itself is passed through unchanged.
      expect(screen.queryByTestId('section-policies')).not.toBeInTheDocument();

      rerender(
        <SectionOrderRenderer order={QUICK_BOOK_ORDER} hiddenSections={[]} content={content} renderers={renderers} />,
      );

      const rendered = screen.getAllByTestId(/^section-/).map(node => node.dataset.testid);

      expect(rendered).toEqual([
        'section-salonProfile',
        'section-serviceMenu',
        'section-policies',
        'section-socialLinks',
        'section-bookingCta',
      ]);
    });

    it('defaults to hiding nothing when hiddenSections is omitted (existing callers keep working unchanged)', () => {
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

      expect(screen.getByTestId('section-salonProfile')).toBeInTheDocument();
      expect(screen.getByTestId('section-socialLinks')).toBeInTheDocument();
    });
  });
});
