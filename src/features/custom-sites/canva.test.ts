import { randomUUID } from 'node:crypto';

import { describe, expect, it, vi } from 'vitest';

import type { CanvaDesign } from './canva';
import { canvaDesignSchema, comfortableCanvaAreas, compileCanvaDesign } from './canva';
import { canvaDataFingerprint, canvaServiceKey, canvaTargetBlockers } from './canva-data.server';
import type { CustomSiteData } from './contracts';
import { validateCustomSource } from './validate.server';
import { EMPTY_WEBSITE_DETAILS } from './website-details';

vi.mock('server-only', () => ({}));
const data: CustomSiteData = { business: { name: 'Canva Studio', city: 'Toronto', address: null, bio: '', hours: {} }, services: [{ id: 'draft-one', name: 'Gel', priceCents: 6500, durationMinutes: 60, priceLabel: '$65.00', description: null }], details: EMPTY_WEBSITE_DETAILS, currency: 'CAD', preview: true };
const design = (): CanvaDesign => ({ version: 1, pages: [{ assetId: randomUUID(), width: 600, height: 1800, alt: 'Original salon artwork' }], areas: [{ id: 'book', page: 0, label: 'Book Gel', geometry: { x: 10, y: 80, width: 80, height: 5 }, action: { type: 'service', serviceKey: canvaServiceKey(data.services[0]!) } }], visibleText: 'Original artwork', notes: [], ownerReviewed: false, dataFingerprint: canvaDataFingerprint(data) });

describe('preserved Canva artwork', () => {
  it('pads tiny links for mobile without moving artwork or covering other links', () => {
    const input = design();
    input.areas[0]!.geometry = { x: 10, y: 80, width: 10, height: 1 };
    const padded = comfortableCanvaAreas(input.areas, input.pages);

    expect(padded[0]!.geometry.height * 1800 * 360 / 600 / 100).toBeCloseTo(44);
    expect(input.areas[0]!.geometry.height).toBe(1);
    expect(canvaDesignSchema.safeParse({ ...input, areas: padded }).success).toBe(true);

    const crowded = [...input.areas, { ...input.areas[0]!, id: 'nearby', geometry: { x: 10, y: 81, width: 10, height: 1 } }];

    expect(comfortableCanvaAreas(crowded, input.pages)[0]!.geometry).toEqual(input.areas[0]!.geometry);
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
      expect(canvaDesignSchema.safeParse({ ...input, areas: [{ ...input.areas[0], action: { type: 'website', url } }] }).success).toBe(false);
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
