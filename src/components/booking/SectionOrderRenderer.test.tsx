import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import type { SectionId } from '@/libs/bookingPageConfig';
import { EMPTY_SALON_CONTENT, type SalonContent } from '@/libs/salonContent';
import { resolveSectionPresentation } from '@/libs/sectionPresentation';
import { resolveSectionDecisionPlan } from '@/libs/sectionRegistry';

import {
  SectionOrderRenderer,
  type SectionVariantRenderers,
} from './SectionOrderRenderer';

const QUICK_BOOK_ORDER: SectionId[] = [
  'salonProfile',
  'serviceMenu',
  'featuredServices',
  'policies',
  'socialLinks',
  'bookingCta',
];

function content(overrides: Partial<SalonContent> = {}): SalonContent {
  return {
    ...EMPTY_SALON_CONTENT,
    identity: {
      ...EMPTY_SALON_CONTENT.identity,
      name: 'Isla Nail Studio',
      heroImageUrl: 'https://images.example/hero.jpg',
    },
    catalog: {
      ...EMPTY_SALON_CONTENT.catalog,
      services: [{
        id: 'service-1',
        name: 'Gel manicure',
        description: null,
        durationMinutes: 60,
        priceCents: 5000,
        priceDisplayText: null,
        category: 'manicure',
        bookingCategory: null,
        imageUrl: null,
        featuredOrder: 1,
      }],
      featuredServices: [{
        id: 'service-1',
        name: 'Gel manicure',
        description: null,
        durationMinutes: 60,
        priceCents: 5000,
        priceDisplayText: null,
        category: 'manicure',
        bookingCategory: null,
        imageUrl: null,
        featuredOrder: 1,
      }],
    },
    policies: {
      ...EMPTY_SALON_CONTENT.policies,
      policy: {
        ...EMPTY_SALON_CONTENT.policies.policy,
        enabled: true,
        showOnServicePage: true,
        text: '24-hour notice.',
      },
    },
    social: { instagram: 'https://instagram.com/isla', facebook: null, tiktok: null },
    ...overrides,
  };
}

function makeRenderers(spies: Partial<Record<string, ReturnType<typeof vi.fn>>> = {}): SectionVariantRenderers {
  const render = (id: string, variant: string) => {
    spies[id]?.(variant);
    return <div data-testid={`section-${id}`} data-variant={variant}>{id}</div>;
  };

  return {
    salonProfile: {
      compact: () => render('salonProfile', 'compact'),
      hero_image: () => render('salonProfile', 'hero_image'),
    },
    technicianProfile: {
      full: () => render('technicianProfile', 'full'),
      cards: () => render('technicianProfile', 'cards'),
    },
    featuredServices: {
      carousel: () => render('featuredServices', 'carousel'),
      signature: () => render('featuredServices', 'signature'),
    },
    serviceMenu: {
      list: ({ renderSlot }) => {
        spies.serviceMenu?.('list');
        return (
          <div data-testid="section-serviceMenu" data-variant="list">
            <span data-testid="menu-start">menu start</span>
            {renderSlot('featuredServices')}
            <span data-testid="menu-middle">menu middle</span>
            {renderSlot('policies')}
            {renderSlot('socialLinks')}
          </div>
        );
      },
      grouped_categories: ({ renderSlot }) => {
        spies.serviceMenu?.('grouped_categories');
        return (
          <div data-testid="section-serviceMenu" data-variant="grouped_categories">
            <span data-testid="menu-start">menu start</span>
            {renderSlot('featuredServices')}
            <span data-testid="menu-middle">menu middle</span>
            {renderSlot('policies')}
            {renderSlot('socialLinks')}
          </div>
        );
      },
    },
    hoursLocation: {
      full: () => render('hoursLocation', 'full'),
      location_cards: () => render('hoursLocation', 'location_cards'),
    },
    policies: {
      card: () => render('policies', 'card'),
      inline: () => render('policies', 'inline'),
    },
    socialLinks: {
      icons: () => render('socialLinks', 'icons'),
      labeled: () => render('socialLinks', 'labeled'),
    },
  };
}

function renderCanonical({
  order = QUICK_BOOK_ORDER,
  hiddenSections = [],
  layout = 'quick_book',
  value = content(),
  sectionVariants = {},
  renderers = makeRenderers(),
}: {
  order?: SectionId[];
  hiddenSections?: SectionId[];
  layout?: 'quick_book' | 'editorial';
  value?: SalonContent;
  sectionVariants?: unknown;
  renderers?: SectionVariantRenderers;
} = {}) {
  const plan = resolveSectionDecisionPlan({ order, hiddenSections, content: value });
  const presentation = resolveSectionPresentation({ layout, sectionVariants, content: value });
  return render(<SectionOrderRenderer plan={plan} presentation={presentation} renderers={renderers} />);
}

function expectCanonicalRenderToThrow(
  action: () => unknown,
  expected: RegExp,
) {
  const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
  try {
    expect(action).toThrow(expected);
  } finally {
    consoleError.mockRestore();
  }
}

describe('SectionOrderRenderer canonical dispatch', () => {
  it('uses Stage 2 orderedIds as its only admission/order authority', () => {
    const spies = Object.fromEntries([
      'salonProfile',
      'serviceMenu',
      'featuredServices',
      'policies',
      'socialLinks',
    ].map(id => [id, vi.fn()]));

    // The helper has no raw `order` route into the component itself, only
    // into Stage 2 plan construction.
    renderCanonical({ renderers: makeRenderers(spies) });

    for (const spy of Object.values(spies)) {
      expect(spy).toHaveBeenCalledTimes(1);
    }

    expect(screen.getAllByTestId(/^section-/).map(node => node.dataset.testid)).toEqual([
      'section-salonProfile',
      'section-serviceMenu',
      'section-featuredServices',
      'section-policies',
      'section-socialLinks',
    ]);
  });

  it('preserves Quick Book embedded DOM positions through the same dispatcher', () => {
    renderCanonical();

    const serviceMenu = screen.getByTestId('section-serviceMenu');

    expect([...serviceMenu.children].map(node => (node as HTMLElement).dataset.testid)).toEqual([
      'menu-start',
      'section-featuredServices',
      'menu-middle',
      'section-policies',
      'section-socialLinks',
    ]);
  });

  it('renders Editorial flow sections and the shared service-menu slot exactly once', () => {
    renderCanonical({
      layout: 'editorial',
      order: [
        'salonProfile',
        'featuredServices',
        'serviceMenu',
        'policies',
        'socialLinks',
        'bookingCta',
      ],
    });

    expect(screen.getByTestId('section-salonProfile')).toHaveAttribute('data-variant', 'hero_image');
    expect(screen.getByTestId('section-featuredServices')).toHaveAttribute('data-variant', 'signature');
    expect(screen.getByTestId('section-policies')).toHaveAttribute('data-variant', 'inline');
    expect(screen.getByTestId('section-serviceMenu')).toContainElement(screen.getByTestId('section-socialLinks'));

    for (const id of ['salonProfile', 'featuredServices', 'serviceMenu', 'policies', 'socialLinks']) {
      expect(screen.getAllByTestId(`section-${id}`), id).toHaveLength(1);
    }
  });

  it('cannot resurrect a Stage-2-hidden or omitted section through a slot', () => {
    renderCanonical({ hiddenSections: ['featuredServices', 'policies', 'socialLinks'] });

    expect(screen.queryByTestId('section-featuredServices')).not.toBeInTheDocument();
    expect(screen.queryByTestId('section-policies')).not.toBeInTheDocument();
    expect(screen.queryByTestId('section-socialLinks')).not.toBeInTheDocument();
    expect(screen.getByTestId('section-serviceMenu')).toBeInTheDocument();
  });

  it('does not render ready content that Stage 2 did not admit into orderedIds', () => {
    renderCanonical({ order: ['salonProfile', 'serviceMenu', 'bookingCta'] });

    expect(screen.queryByTestId('section-featuredServices')).not.toBeInTheDocument();
    expect(screen.queryByTestId('section-policies')).not.toBeInTheDocument();
    expect(screen.queryByTestId('section-socialLinks')).not.toBeInTheDocument();
  });

  it('renders explicitly ordered technician and visit content in Quick Book rather than silently deleting it', () => {
    const value = content({
      people: {
        technicians: [{
          id: 'tech-1',
          name: 'Ava',
          bio: 'Structured manicure specialist',
          avatarUrl: null,
          specialties: [],
          languages: [],
          rating: null,
          reviewCount: 0,
          skillLevel: null,
          acceptingNewClients: true,
        }],
      },
      place: {
        ...EMPTY_SALON_CONTENT.place,
        address: { address: null, city: 'Toronto', state: null, zipCode: null },
      },
    });

    renderCanonical({
      value,
      order: ['salonProfile', 'technicianProfile', 'hoursLocation', 'serviceMenu', 'bookingCta'],
    });

    expect(screen.getByTestId('section-technicianProfile')).toHaveAttribute('data-variant', 'full');
    expect(screen.getByTestId('section-hoursLocation')).toHaveAttribute('data-variant', 'full');
  });

  it('fails closed when an admitted slot is not dispatched by its canonical host', () => {
    const renderers = makeRenderers();
    renderers.serviceMenu.list = () => <div data-testid="section-serviceMenu">menu</div>;

    expectCanonicalRenderToThrow(
      () => renderCanonical({ renderers }),
      /did not dispatch admitted sections: featuredServices, policies, socialLinks/,
    );
  });

  it('fails closed when a registered handler is missing or returns no output', () => {
    const missing = makeRenderers() as unknown as Record<string, Record<string, unknown>>;
    delete missing.salonProfile!.compact;
    expectCanonicalRenderToThrow(
      () => renderCanonical({ renderers: missing as unknown as SectionVariantRenderers }),
      /No salonProfile renderer is registered for variant compact/,
    );

    const empty = makeRenderers();
    empty.salonProfile.compact = () => null;
    expectCanonicalRenderToThrow(
      () => renderCanonical({ renderers: empty }),
      /rendered no durable output/,
    );
  });

  it('routes a valid same-section override through the same registry', () => {
    renderCanonical({
      layout: 'editorial',
      sectionVariants: { salonProfile: 'compact', featuredServices: 'carousel', policies: 'card' },
      order: ['salonProfile', 'featuredServices', 'serviceMenu', 'policies', 'bookingCta'],
    });

    expect(screen.getByTestId('section-salonProfile')).toHaveAttribute('data-variant', 'compact');
    expect(screen.getByTestId('section-featuredServices')).toHaveAttribute('data-variant', 'carousel');
    expect(screen.getByTestId('section-policies')).toHaveAttribute('data-variant', 'card');
  });

  it('dispatches every Stage 5 family through the same Stage-2-admitted registry', () => {
    const value = content({
      people: {
        technicians: [{
          id: 'tech-1',
          name: 'Ava',
          bio: 'Structured manicure specialist',
          avatarUrl: null,
          specialties: [],
          languages: [],
          rating: null,
          reviewCount: 0,
          skillLevel: null,
          acceptingNewClients: true,
        }],
      },
      place: {
        ...EMPTY_SALON_CONTENT.place,
        address: { address: '100 Test Street', city: 'Toronto', state: 'ON', zipCode: 'M5V 1A1' },
      },
    });

    renderCanonical({
      layout: 'editorial',
      value,
      sectionVariants: {
        technicianProfile: 'cards',
        serviceMenu: 'grouped_categories',
        hoursLocation: 'location_cards',
        socialLinks: 'labeled',
      },
      order: [
        'salonProfile',
        'technicianProfile',
        'serviceMenu',
        'featuredServices',
        'hoursLocation',
        'policies',
        'socialLinks',
        'bookingCta',
      ],
    });

    expect(screen.getByTestId('section-technicianProfile')).toHaveAttribute('data-variant', 'cards');
    expect(screen.getByTestId('section-serviceMenu')).toHaveAttribute('data-variant', 'grouped_categories');
    expect(screen.getByTestId('section-hoursLocation')).toHaveAttribute('data-variant', 'location_cards');
    expect(screen.getByTestId('section-socialLinks')).toHaveAttribute('data-variant', 'labeled');

    for (const id of ['technicianProfile', 'serviceMenu', 'hoursLocation', 'socialLinks']) {
      expect(screen.getAllByTestId(`section-${id}`), id).toHaveLength(1);
    }
  });
});
