import { createHash, randomUUID } from 'node:crypto';

import { describe, expect, it, vi } from 'vitest';

import type { CanvaDesign } from './canva';
import { canvaAreasForModel, canvaDesignSchema, canvaModelAreasSchema, comfortableCanvaAreas, compileCanvaDesign, unusableCanvaAreas } from './canva';
import { canvaDataFingerprint, canvaFactsMatch, canvaPriceLabelsFingerprint, canvaServiceKey, canvaTargetBlockers } from './canva-data.server';
import type { CustomSiteData } from './contracts';
import { validateCustomSource } from './validate.server';
import { EMPTY_WEBSITE_DETAILS } from './website-details';

vi.mock('server-only', () => ({}));
const data: CustomSiteData = { business: { name: 'Canva Studio', city: 'Toronto', address: null, bio: '', hours: {} }, services: [{ id: 'draft-one', name: 'Gel', priceCents: 6500, durationMinutes: 60, priceLabel: '$65.00', description: null }], details: EMPTY_WEBSITE_DETAILS, currency: 'CAD', preview: true };
const design = (): CanvaDesign => ({ version: 1, pages: [{ assetId: randomUUID(), width: 600, height: 1800, alt: 'Original salon artwork' }], areas: [{ id: 'book', page: 0, label: 'Book Gel', geometry: { x: 10, y: 80, width: 80, height: 5 }, action: { type: 'service', serviceKey: canvaServiceKey(data.services[0]!) } }], visibleText: 'Original artwork', notes: [], ownerReviewed: false, dataFingerprint: canvaDataFingerprint(data) });

describe('preserved Canva artwork', () => {
  it('converts fractional AI geometry exactly once while retaining saved percent geometry', () => {
    const area = { ...design().areas[0]!, geometry: { x: 24.7, y: 26, width: 46.2, height: 1.2 } };
    const wire = canvaAreasForModel([area]);

    expect(wire[0]!.geometry).toEqual({ x: 0.247, y: 0.26, width: 0.462, height: 0.012 });
    expect(canvaModelAreasSchema.parse(wire)).toEqual([area]);
    expect(compileCanvaDesign({ ...design(), areas: canvaModelAreasSchema.parse(wire) }).css).toContain('left:24.7%;top:26%;width:46.2%;height:1.2%');
    expect(area.geometry).toEqual({ x: 24.7, y: 26, width: 46.2, height: 1.2 });
  });

  it('rejects percent output at the AI boundary rather than guessing the model units', () => {
    const area = design().areas[0]!;

    expect(canvaModelAreasSchema.safeParse([area]).success).toBe(false);
    expect(canvaDesignSchema.safeParse(design()).success).toBe(true);
    expect(canvaModelAreasSchema.safeParse([{ ...area, geometry: { x: 0.9, y: 0.1, width: 0.2, height: 0.1 } }]).success).toBe(false);
  });

  it('keeps overlap validation after converting model fractions to saved percentages', () => {
    const area = design().areas[0]!;
    const parsed = canvaModelAreasSchema.safeParse([
      { ...area, id: 'instagram', geometry: { x: 0.25, y: 0.258, width: 0.43, height: 0.018 } },
      { ...area, id: 'email', geometry: { x: 0.25, y: 0.275, width: 0.49, height: 0.018 } },
    ]);

    expect(parsed.success).toBe(false);

    if (!parsed.success) {
      expect(parsed.error.issues).toContainEqual(expect.objectContaining({ path: [1, 'geometry'], message: 'Use nonoverlapping clickable areas: email overlaps instagram on page 0.' }));
    }
  });

  it('identifies previously saved subpixel targets without rewriting old artwork', () => {
    const original = design();
    original.areas[0]!.geometry = { x: 0.247, y: 0.26, width: 0.462, height: 0.012 };
    const source = compileCanvaDesign({ ...original, ownerReviewed: true });

    expect(unusableCanvaAreas(source.canva!.areas, source.canva!.pages).map(area => area.id)).toEqual(['book']);
    expect(canvaTargetBlockers(source, data)).toEqual([]);
    expect(source.canva!.areas[0]!.geometry).toEqual(original.areas[0]!.geometry);
    expect(unusableCanvaAreas(design().areas, design().pages)).toEqual([]);
  });

  it('identifies the exact overlapping contact pair without accepting intersecting targets', () => {
    const value = design();
    value.areas = [
      { id: 'instagram', page: 0, label: 'Instagram', geometry: { x: 25, y: 25.8, width: 43, height: 1.8 }, action: { type: 'instagram' } },
      { id: 'email', page: 0, label: 'Email', geometry: { x: 25, y: 27.5, width: 49, height: 1.8 }, action: { type: 'email' } },
    ];
    const parsed = canvaDesignSchema.safeParse(value);

    expect(parsed.success).toBe(false);

    if (!parsed.success) {
      expect(parsed.error.issues).toContainEqual(expect.objectContaining({ path: ['areas', 1, 'geometry'], message: 'Use nonoverlapping clickable areas: email overlaps instagram on page 0.' }));
    }
  });

  it('keeps legacy public artwork available but requires price-wording review before another publication', () => {
    const source = compileCanvaDesign({ ...design(), ownerReviewed: true });

    expect(canvaFactsMatch(source, data)).toBe(true);
    expect(canvaFactsMatch(source, data, true)).toBe(false);
  });

  it('invalidates newly reviewed artwork when only the displayed price wording changes', () => {
    const source = compileCanvaDesign({ ...design(), ownerReviewed: true, priceLabelsFingerprint: canvaPriceLabelsFingerprint(data) });
    const changed = { ...data, services: data.services.map(service => ({ ...service, priceLabel: 'From $65.00' })) };

    expect(canvaDataFingerprint(changed)).toBe(canvaDataFingerprint(data));
    expect(canvaFactsMatch(source, data, true)).toBe(true);
    expect(canvaFactsMatch(source, changed)).toBe(false);
    expect(canvaServiceKey(changed.services[0]!)).toBe(canvaServiceKey(data.services[0]!));
  });

  it('retains the same price-wording approval across draft-to-live service identity mapping', () => {
    expect(canvaPriceLabelsFingerprint({ ...data, services: data.services.map(service => ({ ...service, id: 'canonical-service' })) })).toBe(canvaPriceLabelsFingerprint(data));
  });

  it('binds generated contact labels to saved contacts and routes Show all appointments to the menu', () => {
    const input = design();
    input.areas = [
      { ...input.areas[0]!, id: 'email', label: 'Email wrong@example.com', geometry: { x: 10, y: 10, width: 80, height: 5 }, action: { type: 'email' } },
      { ...input.areas[0]!, id: 'instagram', label: 'Instagram @wrong_studio', geometry: { x: 10, y: 20, width: 80, height: 5 }, action: { type: 'instagram' } },
      { ...input.areas[0]!, id: 'all', label: 'Show All Appointments', geometry: { x: 10, y: 30, width: 80, height: 5 }, action: { type: 'manage' } },
    ];
    const source = compileCanvaDesign(input, { ...EMPTY_WEBSITE_DETAILS, email: 'studio@example.com', instagram: '@correct_studio' });

    expect(source.canva?.areas.map(area => area.label)).toEqual(['Email studio@example.com', 'Instagram @correct_studio', 'Show All Appointments']);
    expect(source.canva?.areas[2]!.action).toEqual({ type: 'book' });
    expect(source.html).toContain('id="canva-all" class="canva-area" data-luster-canva-area="all" aria-label="Show All Appointments" data-luster-book');
    expect(input.areas[0]!.label).toBe('Email wrong@example.com');
    expect(input.areas[2]!.action.type).toBe('manage');

    input.areas[0]!.label = 'Email the studio';
    input.areas[2]!.label = 'Manage my existing appointment';

    expect(compileCanvaDesign(input).canva?.areas[0]!.label).toBe('Email the studio');
    expect(compileCanvaDesign(input).canva?.areas[2]!.action.type).toBe('manage');
  });

  it('lets a narrow phone export fill a phone while preserving the image and link geometry', () => {
    const input = design();
    input.pages[0]!.width = 279;
    input.pages[0]!.height = 1280;
    const source = compileCanvaDesign(input);

    expect(source.css).toContain('.canva-site{margin:0 auto;width:100%;max-width:600px}');
    expect(source.css).toContain('width:100%;height:auto');
    expect(source.canva).toEqual(input);
    expect(source.html).toContain(`asset:${input.pages[0]!.assetId}`);
    expect(source.css).toContain('left:10%;top:80%;width:80%;height:5%');
  });

  it('gives mixed portrait, square and landscape pages independent widths without changing positions', () => {
    const input = design();
    input.pages = [
      { ...input.pages[0]!, width: 2400, height: 12000 },
      { ...input.pages[0]!, assetId: randomUUID(), width: 1600, height: 1600 },
      { ...input.pages[0]!, assetId: randomUUID(), width: 2400, height: 1200 },
    ];
    const source = compileCanvaDesign(input);

    expect(source.css).toContain('#luster-canva-page-0{max-width:600px}');
    expect(source.css).toContain('#luster-canva-page-1{max-width:800px}');
    expect(source.css).toContain('#luster-canva-page-2{max-width:1200px}');
    expect(source.canva).toEqual(input);
    expect(source.css).toContain('left:10%;top:80%;width:80%;height:5%');
  });

  it('keeps appointment links in Luster while allowing explicit general website destinations', () => {
    const input = design();
    const area = { ...input.areas[0]!, id: 'website', label: 'Visit my website', action: { type: 'website' as const, url: 'https://example.com' } };

    expect(canvaDesignSchema.safeParse({ ...input, areas: [area] }).success).toBe(true);
    expect(canvaDesignSchema.safeParse({ ...input, areas: [{ ...area, label: 'Book an appointment' }] }).success).toBe(false);
    expect(canvaDesignSchema.safeParse({ ...input, areas: [{ ...area, action: { type: 'website', url: 'https://example.com/appointments' } }] }).success).toBe(false);
  });

  it('pads tiny links for mobile without moving artwork or covering other links', () => {
    const input = design();
    input.areas[0]!.geometry = { x: 10, y: 80, width: 10, height: 1 };
    const padded = comfortableCanvaAreas(input.areas, input.pages);

    expect(padded[0]!.geometry.height * 1800 * 360 / 600 / 100).toBeCloseTo(44);
    expect(input.areas[0]!.geometry.height).toBe(1);
    expect(canvaDesignSchema.safeParse({ ...input, areas: padded }).success).toBe(true);

    const crowded = [...input.areas, { ...input.areas[0]!, id: 'above', geometry: { x: 0, y: 79, width: 100, height: 1 } }, { ...input.areas[0]!, id: 'below', geometry: { x: 0, y: 81, width: 100, height: 1 } }];

    expect(comfortableCanvaAreas(crowded, input.pages)[0]!.geometry).toEqual(input.areas[0]!.geometry);
  });

  it('grows nearby Instagram and email targets into free space without covering each other', () => {
    const input = design();
    input.pages[0] = { ...input.pages[0]!, width: 279, height: 1280 };
    input.areas = [
      { ...input.areas[0]!, id: 'instagram', geometry: { x: 17.2, y: 25.3, width: 60.9, height: 1.6 }, action: { type: 'instagram' } },
      { ...input.areas[0]!, id: 'email', geometry: { x: 17.2, y: 27.7, width: 60.9, height: 1.6 }, action: { type: 'email' } },
    ];
    const areas = comfortableCanvaAreas(input.areas, input.pages);

    for (const [index, area] of areas.entries()) {
      const original = input.areas[index]!.geometry;

      expect(area.geometry.height * 1280 / 100).toBeCloseTo(44);
      expect(area.geometry.y).toBeLessThanOrEqual(original.y);
      expect(area.geometry.y + area.geometry.height).toBeGreaterThanOrEqual(original.y + original.height);
    }

    expect(canvaDesignSchema.safeParse({ ...input, areas }).success).toBe(true);
  });

  it('compiles unchanged image identities and percentage links, with an equivalent live accessible menu', () => {
    const input = design();
    const source = compileCanvaDesign(input, data.details);

    expect(validateCustomSource(source, new Set([input.pages[0]!.assetId]), true)).toMatchObject({ canva: input, javascript: '' });
    expect(source.html).toContain(`asset:${input.pages[0]!.assetId}`);
    expect(source.css).toContain('left:10%;top:80%;width:80%;height:5%');
    expect(source.html).toContain('data-luster-field="service.priceLabel"');
    expect(source.html).not.toContain('$65.00');
  });

  it.each([
    { x: -1, y: 0, width: 10, height: 10 },
    { x: 99, y: 0, width: 10, height: 10 },
    { x: 0, y: 0, width: 0, height: 10 },
  ])('rejects out-of-page/empty geometry %j', (geometry) => {
    const input = design();
    input.areas[0]!.geometry = geometry;

    expect(canvaDesignSchema.safeParse(input).success).toBe(false);
  });

  it('rejects overlapping regions, missing pages and unsafe destinations', () => {
    const input = design();

    expect(canvaDesignSchema.safeParse({ ...input, areas: [...input.areas, { ...input.areas[0], id: 'second' }] }).success).toBe(false);
    expect(canvaDesignSchema.safeParse({ ...input, areas: [{ ...input.areas[0], page: 1 }] }).success).toBe(false);

    for (const url of ['javascript:alert(1)', 'http://example.com', 'https://user:password@example.com', 'https://127.0.0.1']) {
      expect(canvaDesignSchema.safeParse({ ...input, areas: [{ ...input.areas[0], label: 'Visit website', action: { type: 'website', url } }] }).success).toBe(false);
    }
  });

  it('preserves fact identity across publication but detects prices, hours, address and policy changes', () => {
    const before = canvaDataFingerprint(data);

    expect(canvaDataFingerprint({ ...data, preview: false, services: data.services.map(service => ({ ...service, id: randomUUID() })) })).toBe(before);
    expect(canvaDataFingerprint({ ...data, services: data.services.map(service => ({ ...service, priceCents: 7200 })) })).not.toBe(before);
    expect(canvaDataFingerprint({ ...data, business: { ...data.business, address: '123 Private Street' } })).not.toBe(before);
    expect(canvaDataFingerprint({ ...data, business: { ...data.business, hours: { monday: { open: '09:00', close: '17:00' } } } })).not.toBe(before);
    expect(canvaDataFingerprint({ ...data, bookingRules: { minimumNoticeMinutes: 120 } })).not.toBe(before);
  });

  it('requires current unambiguous service and saved contact destinations', () => {
    const input = design();

    expect(canvaTargetBlockers(compileCanvaDesign(input), data)).toEqual([]);
    expect(canvaTargetBlockers(compileCanvaDesign(input), { ...data, services: [] })).toHaveLength(1);
    expect(canvaTargetBlockers(compileCanvaDesign(input), { ...data, services: [...data.services, ...data.services] })).toHaveLength(1);

    input.areas[0]!.action = { type: 'instagram' };

    expect(canvaTargetBlockers(compileCanvaDesign(input), data)[0]).toContain('instagram');
  });
});

it('keeps the historical Canva compiler HTML and CSS byte-identical across the manual renderer extension', () => {
  const original: CanvaDesign = { version: 1, pages: [{ assetId: 'a0000000-0000-4000-8000-000000000001', width: 600, height: 1800, alt: 'Original artwork' }], areas: [{ id: 'booking', page: 0, label: 'Book now', geometry: { x: 10, y: 60, width: 80, height: 10 }, action: { type: 'book' } }], visibleText: '', notes: [], dataFingerprint: 'a'.repeat(64), ownerReviewed: true };
  const cases = [original, { ...original, pages: [...original.pages, { ...original.pages[0]!, assetId: 'a0000000-0000-4000-8000-000000000002', width: 1200, height: 600 }] }];
  // Captured and compared against the real 7fd5642b compiler before this change.
  const expected = ['1e63af6643e03a0ce46af80523dc2435f257a4923fc1c84957fb1bb73e602c4e', '23a3c96548ec7a756d15c259c31b75c78873cd8b866ced64f68030efa33cbbd4'];

  expect(cases.map((input) => {
    const source = compileCanvaDesign(input);
    return createHash('sha256').update(JSON.stringify([source.html, source.css])).digest('hex');
  })).toEqual(expected);
});
