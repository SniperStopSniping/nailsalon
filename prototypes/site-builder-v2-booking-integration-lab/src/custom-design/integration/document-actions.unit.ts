import { initializeStarter } from '../../model/starters';
import type { SiteBuilderDocument } from '../../model/types';
import { createDefaultCustomDesignSettings } from '../model/settings';
import type { CustomDesignAction } from '../model/types';
import {
  createCustomDesignDocumentActionResolver,
  resolveCustomDesignDocumentAction,
} from './document-actions';

const resolve = (
  action: CustomDesignAction,
  document: SiteBuilderDocument,
  activePageId?: string,
) => resolveCustomDesignDocumentAction(action, { activePageId, document });

describe('Custom Design document action resolution', () => {
  it('resolves the canonical visible Booking on the current page by stable IDs', () => {
    const document = initializeStarter('quick_book');
    const page = document.pages[0];
    const booking = page?.sections.find(section => section.sectionType === 'booking');
    if (!page || !booking) {
      throw new Error('Quick Book fixture is incomplete.');
    }

    expect(resolve({ type: 'start_booking' }, document, page.id)).toEqual({
      documentTarget: {
        kind: 'booking',
        pageId: page.id,
        relationship: 'same_page',
        sectionId: booking.id,
      },
      external: false,
      href: `/#page=${encodeURIComponent(page.id)}&section=${encodeURIComponent(booking.id)}`,
      status: 'resolved',
    });
  });

  it('exposes cross-page Booking navigation followed by a stable section target', () => {
    const document = initializeStarter('multi_page');
    const activePage = document.pages.find(page => page.isHome);
    const bookingPage = document.pages.find(page =>
      page.sections.some(section => section.sectionType === 'booking'),
    );
    const booking = bookingPage?.sections.find(section => section.sectionType === 'booking');
    if (!activePage || !bookingPage || !booking) {
      throw new Error('Multi-page fixture is incomplete.');
    }

    const result = resolve({ type: 'start_booking' }, document, activePage.id);

    expect(result).toMatchObject({
      documentTarget: {
        kind: 'booking',
        pageId: bookingPage.id,
        relationship: 'cross_page',
        sectionId: booking.id,
      },
      external: false,
      status: 'resolved',
    });
  });

  it.each([
    ['hidden Booking', (document: SiteBuilderDocument) => {
      const booking = document.pages
        .flatMap(page => page.sections)
        .find(section => section.sectionType === 'booking');
      if (booking) {
        booking.visible = false;
      }
    }],
    ['hidden Booking page', (document: SiteBuilderDocument) => {
      const page = document.pages.find(candidate =>
        candidate.sections.some(section => section.sectionType === 'booking'),
      );
      if (page) {
        page.visible = false;
      }
    }],
    ['ambiguous Booking', (document: SiteBuilderDocument) => {
      const booking = document.pages
        .flatMap(page => page.sections)
        .find(section => section.sectionType === 'booking');
      const page = document.pages.find(candidate =>
        !candidate.sections.some(section => section.sectionType === 'booking'),
      );
      if (booking && page) {
        page.sections.push({ ...booking, id: `${booking.id}-duplicate` });
      }
    }],
  ])('suppresses %s rather than guessing a destination', (_label, mutate) => {
    const document = structuredClone(initializeStarter('multi_page'));
    mutate(document);

    expect(resolve({ type: 'start_booking' }, document)).toEqual({
      reason: 'booking_unavailable',
      status: 'unresolved',
    });
  });

  it('resolves visible internal pages and visible sections by stable IDs', () => {
    const document = initializeStarter('multi_page');
    const sourcePage = document.pages[0];
    const targetPage = document.pages[2];
    const targetSection = targetPage?.sections[0];
    if (!sourcePage || !targetPage || !targetSection) {
      throw new Error('Multi-page fixture is incomplete.');
    }

    expect(resolve({
      type: 'internal',
      destination: { pageId: targetPage.id },
    }, document, sourcePage.id)).toMatchObject({
      documentTarget: {
        kind: 'internal',
        pageId: targetPage.id,
        relationship: 'cross_page',
      },
      external: false,
      status: 'resolved',
    });
    expect(resolve({
      type: 'internal',
      destination: { pageId: targetPage.id, sectionId: targetSection.id },
    }, document, targetPage.id)).toMatchObject({
      documentTarget: {
        kind: 'internal',
        pageId: targetPage.id,
        relationship: 'same_page',
        sectionId: targetSection.id,
      },
      external: false,
      status: 'resolved',
    });
  });

  it('suppresses an internal target omitted from customer Preview because it has no images', () => {
    const document = initializeStarter('quick_book');
    const page = document.pages[0];
    if (!page) {
      throw new Error('Quick Book fixture is incomplete.');
    }
    const sectionId = 'section_empty_custom_design';
    page.sections.push({
      id: sectionId,
      label: 'Custom Design',
      order: page.sections.length,
      sectionType: 'custom_design',
      settings: createDefaultCustomDesignSettings(),
      visible: true,
    });

    expect(resolve({
      type: 'internal',
      destination: { pageId: page.id, sectionId },
    }, document, page.id)).toEqual({
      reason: 'internal_destination_unavailable',
      status: 'unresolved',
    });
  });

  it.each([
    ['missing page', (_document: SiteBuilderDocument) => ({
      pageId: 'page_missing',
    })],
    ['hidden page', (document: SiteBuilderDocument) => {
      const page = document.pages[1];
      if (!page) {
        throw new Error('Missing page fixture.');
      }
      page.visible = false;
      return { pageId: page.id };
    }],
    ['missing section', (document: SiteBuilderDocument) => {
      const page = document.pages[1];
      if (!page) {
        throw new Error('Missing page fixture.');
      }
      return { pageId: page.id, sectionId: 'section_missing' };
    }],
    ['hidden section', (document: SiteBuilderDocument) => {
      const page = document.pages[1];
      const section = page?.sections[0];
      if (!page || !section) {
        throw new Error('Missing section fixture.');
      }
      section.visible = false;
      return { pageId: page.id, sectionId: section.id };
    }],
    ['section on a different page', (document: SiteBuilderDocument) => {
      const page = document.pages[1];
      const otherSection = document.pages[2]?.sections[0];
      if (!page || !otherSection) {
        throw new Error('Missing section fixture.');
      }
      return { pageId: page.id, sectionId: otherSection.id };
    }],
  ])('suppresses an internal action with a %s target', (_label, destinationFactory) => {
    const document = structuredClone(initializeStarter('multi_page'));
    const destination = destinationFactory(document);

    expect(resolve({ type: 'internal', destination }, document)).toEqual({
      reason: 'internal_destination_unavailable',
      status: 'unresolved',
    });
  });

  it.each<[string, CustomDesignAction, string, boolean]>([
    [
      'directions',
      { type: 'directions', destination: { address: '123 King St W, Toronto' } },
      'https://www.google.com/maps/search/?api=1&query=123%20King%20St%20W%2C%20Toronto',
      true,
    ],
    [
      'Instagram',
      { type: 'instagram', destination: { username: 'luster.nails' } },
      'https://www.instagram.com/luster.nails/',
      true,
    ],
    [
      'website',
      { type: 'website', destination: { url: 'https://example.com/services' } },
      'https://example.com/services',
      true,
    ],
    [
      'call',
      { type: 'call', destination: { phoneNumber: '+1 416 555 0199' } },
      'tel:+14165550199',
      false,
    ],
    [
      'text',
      { type: 'text', destination: { phoneNumber: '+1 416 555 0199' } },
      'sms:+14165550199',
      false,
    ],
    [
      'email',
      { type: 'email', destination: { email: 'hello@example.com', subject: 'Booking help' } },
      'mailto:hello@example.com?subject=Booking%20help',
      false,
    ],
    [
      'custom safe URL',
      { type: 'custom_url', destination: { url: 'https://example.org/policies' } },
      'https://example.org/policies',
      true,
    ],
  ])('delegates the structured %s action to safe model resolution', (
    _label,
    action,
    href,
    external,
  ) => {
    const resolver = createCustomDesignDocumentActionResolver({
      document: initializeStarter('quick_book'),
    });
    const result = resolver(action);

    expect(result).toMatchObject({ external, href, status: 'resolved' });

    if (external) {
      expect(result).toMatchObject({
        rel: 'noopener noreferrer',
        target: '_blank',
      });
    } else {
      expect(result).not.toHaveProperty('rel');
      expect(result).not.toHaveProperty('target');
    }

    expect(result).not.toHaveProperty('documentTarget');
  });
});
