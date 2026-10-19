import { randomUUID } from 'node:crypto';

import { expect, it, vi } from 'vitest';

import type { CustomDesignAction, CustomDesignSettings } from '../../../prototypes/site-builder-v2-booking-integration-lab/src/custom-design/model/types';
import type { CustomSiteData } from './contracts';
import { manualCanvaSource } from './manual-canva.server';
import { validateCustomSource } from './validate.server';
import { EMPTY_WEBSITE_DETAILS } from './website-details';

vi.mock('server-only', () => ({}));
const data: CustomSiteData = { business: { name: 'Own Canva Studio', city: 'Toronto', address: null, bio: '', hours: {} }, services: [{ id: 'service', name: 'Gel', description: null, priceCents: 6500, priceLabel: '$65', durationMinutes: 60 }], details: EMPTY_WEBSITE_DETAILS, currency: 'CAD', preview: true };
function fixture() {
  const assetId = randomUUID();
  const settings: CustomDesignSettings = { schemaVersion: 1, displayMode: 'poster', gap: 'small', background: { mode: 'custom', color: '#f6d7e4' }, cta: { type: 'book_now', label: 'Book an appointment', placement: { type: 'after_all' } }, images: [{ id: 'image-one', assetId: 'local-one', fileName: 'canva.png', mimeType: 'image/png', fileSize: 100, width: 600, height: 1400, aspectRatio: 600 / 1400, altText: 'My original artwork', decorative: false, interactiveAreas: [{ id: 'my-link', accessibleLabel: 'Book an appointment', geometry: { x: 10, y: 70, width: 80, height: 5 }, semanticOrder: 0, labelConfirmed: true, reviewStatus: 'approved', validationStatus: 'valid', action: { type: 'start_booking' } }] }] };
  const input = { sections: [{ id: 'section-one', pageId: 'homepage', settings }], images: new Map([['image-one', { assetId, width: 600, height: 1400 }]]), data, siteBackground: '#fffaf7', origin: { siteId: randomUUID(), revisionId: randomUUID(), revision: 2 } };
  return { input, settings, assetId };
}

it('preserves approved artwork identity, geometry, page order, backgrounds and native booking without approving publication', () => {
  const { input, settings, assetId } = fixture();
  const before = structuredClone(settings);
  const source = manualCanvaSource(input);

  expect(source.canva!.pages[0]).toMatchObject({ assetId, width: 600, height: 1400, presentation: { displayMode: 'poster', background: '#F6D7E4' } });
  expect(source.canva!.areas[0]).toMatchObject({ geometry: settings.images[0]!.interactiveAreas[0]!.geometry, action: { type: 'book' } });
  expect(source.canva!.controls![0]).toMatchObject({ afterPage: 0, action: { type: 'book' } });
  expect(source.canva!.ownerReviewed).toBe(false);
  expect(source.canva!.manualOrigin).toEqual(input.origin);
  expect(source.javascript).toBe('');
  expect(source.html).toContain('data-luster-field="service.priceLabel"');
  expect(source.html).not.toContain('$65');
  expect(validateCustomSource(source, new Set([assetId]), true).html).toContain(`asset:${assetId}`);
  expect(settings).toEqual(before);
});

it.each([
  [{ type: 'instagram', destination: { username: 'my_studio' } }, 'https://www.instagram.com/my_studio/'],
  [{ type: 'call', destination: { phoneNumber: '+1 (416) 555-0100' } }, 'tel:+14165550100'],
  [{ type: 'text', destination: { phoneNumber: '4165550100' } }, 'sms:4165550100'],
  [{ type: 'email', destination: { email: 'studio@example.com', subject: 'Hello there' } }, 'mailto:studio@example.com?subject=Hello%20there'],
  [{ type: 'directions', destination: { address: 'Dixie Road and Countryside Drive' } }, 'https://www.google.com/maps/search/?api=1&query=Dixie%20Road%20and%20Countryside%20Drive'],
  [{ type: 'website', destination: { url: 'https://example.com/' } }, 'https://example.com/'],
  [{ type: 'custom_url', destination: { url: 'https://example.com/portfolio' } }, 'https://example.com/portfolio'],
] satisfies [CustomDesignAction, string][])('retains an explicit owner %j destination as a safe clickable link', (action, href) => {
  const { input, settings } = fixture();
  settings.images[0]!.interactiveAreas[0]!.action = action;
  settings.images[0]!.interactiveAreas[0]!.accessibleLabel = 'My contact link';
  const source = manualCanvaSource(input);

  expect(source.canva!.areas[0]!.action).toEqual({ type: 'manual_link', href });
});

it('preserves internal links only when their actual target exists in the converted design', () => {
  const { input, settings } = fixture();
  settings.images[0]!.interactiveAreas[0]!.action = { type: 'internal', destination: { pageId: 'homepage' } };

  expect(() => manualCanvaSource(input)).toThrow('needs checking');

  const source = manualCanvaSource({ ...input, internalAnchors: new Map([['homepage', '#manual-home']]) });

  expect(source.html).toContain('id="manual-home"');
  expect(source.canva!.areas[0]!.action).toEqual({ type: 'manual_link', href: '#manual-home' });
});

it('keeps multiple export sizes, edge-to-edge/contained choices, spacing and CTA placement', () => {
  const { input, settings } = fixture();
  const second = structuredClone(settings.images[0]!);
  second.id = 'second';
  second.assetId = 'local-second';
  second.width = 1200;
  second.height = 600;
  second.aspectRatio = 2;
  second.interactiveAreas[0]!.id = 'second-link';
  settings.images.push(second);
  input.images.set('second', { assetId: randomUUID(), width: 1200, height: 600 });
  settings.displayMode = 'full_width';
  settings.cta = { type: 'book_now', label: 'Appointments', placement: { type: 'after_image', imageItemId: 'image-one' } };
  const source = manualCanvaSource(input);

  expect(source.canva!.pages.map(page => [page.width, page.height])).toEqual([[600, 1400], [1200, 600]]);
  expect(source.canva!.pages[0]!.presentation).toMatchObject({ displayMode: 'full_width', gapAfter: 8 });
  expect(source.canva!.controls![0]!.afterPage).toBe(0);
  expect(source.css).toContain('max-width:none');
  expect(source.canva!.areas.map(area => area.id)[0]).not.toBe(source.canva!.areas.map(area => area.id)[1]);
});

it('retains all ten manual pages and eighty approved links rather than truncating to the AI reference limit', () => {
  const { input, settings } = fixture();
  const original = settings.images[0]!;
  settings.images = Array.from({ length: 10 }, (_, index) => ({ ...structuredClone(original), id: `image-${index}`, interactiveAreas: Array.from({ length: 8 }, (_, link) => ({ ...structuredClone(original.interactiveAreas[0]!), id: `link-${index}-${link}`, semanticOrder: link, geometry: { x: 10, y: link * 10, width: 30, height: 5 } })) }));
  input.images.clear();
  for (const [index, image] of settings.images.entries()) {
    input.images.set(image.id, { assetId: index === 0 ? 'cad01234-0000-4000-8000-000000000000' : randomUUID(), width: 600, height: 1400 });
  }
  const source = manualCanvaSource(input);

  expect(source.canva!.pages).toHaveLength(10);
  expect(source.canva!.areas).toHaveLength(80);
  expect(source.canva!.areas[79]!.page).toBe(9);
  expect(validateCustomSource(source, new Set([...input.images.values()].map(image => image.assetId)), true)).toBeTruthy();
});

it('rejects missing/replaced image bytes, unreviewed links and private-address directions', () => {
  const { input, settings } = fixture();

  expect(() => manualCanvaSource({ ...input, images: new Map() })).toThrow('not finished saving');
  expect(() => manualCanvaSource({ ...input, images: new Map([['image-one', { assetId: randomUUID(), width: 600, height: 600 }]]) })).toThrow('changed proportions');

  settings.images[0]!.interactiveAreas[0]!.reviewStatus = 'needs_review';
  settings.images[0]!.interactiveAreas[0]!.reviewReason = 'owner_review_required';

  expect(() => manualCanvaSource(input)).toThrow('approve');

  settings.images[0]!.interactiveAreas[0]!.reviewStatus = 'approved';
  delete settings.images[0]!.interactiveAreas[0]!.reviewReason;
  settings.images[0]!.interactiveAreas[0]!.action = { type: 'directions', destination: { address: '123 Private Street, Toronto' } };

  expect(() => manualCanvaSource({ ...input, privateAddress: '123 Private Street' })).toThrow('private address');
});

it('rejects unsafe or disconnected booking destinations even in an owner-authored control', () => {
  const { input, settings } = fixture();
  settings.cta = { type: 'custom', label: 'Book an appointment', action: { type: 'website', destination: { url: 'https://calendly.com/salon' } }, placement: { type: 'after_all' } };

  expect(() => manualCanvaSource(input)).toThrow();

  settings.cta.action = { type: 'website', destination: { url: 'https://example.com/admin' } };

  expect(() => manualCanvaSource(input)).toThrow('needs checking');
});

it('does not let a website link conceal a private service address through URL encoding', () => {
  const { input, settings } = fixture();
  settings.images[0]!.interactiveAreas[0]!.action = { type: 'website', destination: { url: 'https://www.google.com/maps/search/?query=123%2520Private%2520Street' } };

  expect(() => manualCanvaSource({ ...input, privateAddress: '123 Private Street' })).toThrow('private address');
});
