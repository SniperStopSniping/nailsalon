import { randomUUID } from 'node:crypto';

import { describe, expect, it, vi } from 'vitest';

import { compileCanvaDesign } from './canva';
import type { CanvaNativeContent } from './canva-native-content';
import { canvaNativeContentSchema, canvaNativeImages } from './canva-native-content';
import { validateCustomSource } from './validate.server';

vi.mock('server-only', () => ({}));
const gallery = (): CanvaNativeContent[number] => ({ id: 'owned-gallery', type: 'gallery', title: 'Our work', beforePage: 1, layout: 'grid', images: [{ mediaId: randomUUID(), role: 'gallery', alt: 'Owned photograph', width: 800, height: 1200 }] });
function source(blocks: CanvaNativeContent) {
  const assetId = randomUUID();
  return { assetId, value: compileCanvaDesign({ version: 1, pages: [{ assetId, width: 900, height: 500, alt: 'Original artwork' }], areas: [], controls: [], nativeContent: blocks, manualOrigin: { siteId: randomUUID(), revisionId: randomUUID(), revision: 1 }, visibleText: '', notes: [], dataFingerprint: 'a'.repeat(64), ownerReviewed: false }) };
}

describe('trusted native content beside Canva artwork', () => {
  it('supports sixty owned photos and preserves their intrinsic sizes without copying bytes into source', () => {
    const block = gallery();
    if (block.type !== 'gallery') {
      throw new Error('Fixture');
    }
    block.images = Array.from({ length: 60 }, (_, index) => ({ mediaId: randomUUID(), role: 'gallery', alt: `Photo ${index}`, width: index % 2 ? 1200 : 400, height: index % 2 ? 500 : 1000 }));
    const { value, assetId } = source([block]);

    expect(canvaNativeImages(value.canva!.nativeContent)).toHaveLength(60);
    expect(value.html.match(/data-luster-native-image=/gu)).toHaveLength(60);
    expect(value.html).not.toContain('data:image');
    expect(value.css).toContain('object-fit:contain');
    expect(validateCustomSource(value, new Set([assetId])).html).toContain('loading="lazy"');
  });

  it('escapes owner-supplied content and permits only declared image bindings', () => {
    const block = gallery();
    block.title = '<script>publish()</script>';
    const { value, assetId } = source([block]);

    expect(value.html).toContain('&lt;script&gt;publish()&lt;/script&gt;');
    expect(() => validateCustomSource({ ...value, html: `${value.html}<img data-luster-native-image="${randomUUID()}" alt="Hidden file">` }, new Set([assetId]))).toThrow();
    expect(() => validateCustomSource({ ...value, html: `${value.html}<img src="https://attacker.invalid/image.webp">` }, new Set([assetId]))).toThrow();
    expect(() => validateCustomSource({ ...value, canva: undefined }, new Set([assetId]))).toThrow();
  });

  it('rejects role confusion, conflicting dimensions and arbitrary media URLs', () => {
    const block = gallery();
    if (block.type !== 'gallery') {
      throw new Error('Fixture');
    }

    expect(canvaNativeContentSchema.safeParse([{ ...block, images: [{ ...block.images[0], role: 'profile' }] }]).success).toBe(false);
    expect(canvaNativeContentSchema.safeParse([{ ...block, images: [block.images[0], { ...block.images[0], width: 99 }] }]).success).toBe(false);
    expect(canvaNativeContentSchema.safeParse([{ ...block, images: [{ ...block.images[0], url: 'https://attacker.invalid' }] }]).success).toBe(false);
  });
});
