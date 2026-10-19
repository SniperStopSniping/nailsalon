import { randomUUID } from 'node:crypto';

import { expect, it, vi } from 'vitest';

import { compileCanvaDesign } from './canva';
import { applyCanvaNativePhotoChanges, canvaNativePhotoChangeSummary } from './canva-native-changes';
import type { CanvaNativePhotoChange, NativePhotoChoice } from './canva-native-edits';

vi.mock('server-only', () => ({}));

function fixture() {
  const photos: NativePhotoChoice[] = ['gallery', 'gallery', 'profile'].map((role, index) => ({ mediaId: randomUUID(), role: role as 'gallery' | 'profile', width: 600, height: 900, alt: `Owned photo ${index}`, name: `${index}.webp` }));
  const image = (index: number) => ({ mediaId: photos[index]!.mediaId, role: photos[index]!.role, width: 600, height: 900, alt: photos[index]!.alt });
  const design = compileCanvaDesign({ version: 1, pages: [{ assetId: randomUUID(), width: 600, height: 1400, alt: 'Original Canva artwork' }], areas: [], controls: [], nativeContent: [{ id: 'about', type: 'about', beforePage: 0, title: 'About', textSectionIds: ['about-copy'], image: image(2), showBusinessName: true, showInstagram: true, showBookingButton: true }, { id: 'gallery', type: 'gallery', beforePage: 1, title: 'Our work', layout: 'grid', images: [image(0), image(1)] }], manualOrigin: { siteId: randomUUID(), revisionId: randomUUID(), revision: 1 }, visibleText: 'Existing printed artwork facts', notes: [], ownerReviewed: true, dataFingerprint: 'a'.repeat(64) }).canva!;
  return { design, photos };
}

it('applies a bounded ordered batch without changing artwork, bindings or the original source', () => {
  const { design, photos } = fixture();
  const before = structuredClone(design);
  const next = applyCanvaNativePhotoChanges(design, [
    { blockId: 'gallery', change: { type: 'describe', mediaId: photos[0]!.mediaId, alt: 'Green manicure photograph' } },
    { blockId: 'gallery', change: { type: 'move', mediaId: photos[0]!.mediaId, direction: 'later' } },
    { blockId: 'gallery', change: { type: 'layout', layout: 'editorial' } },
  ], photos);
  const gallery = next.nativeContent![1]!;

  expect(gallery).toMatchObject({ layout: 'editorial', images: [{ mediaId: photos[1]!.mediaId }, { mediaId: photos[0]!.mediaId, alt: 'Green manicure photograph' }] });
  expect({ ...next, nativeContent: design.nativeContent, ownerReviewed: design.ownerReviewed }).toEqual(design);
  expect(next.ownerReviewed).toBe(false);
  expect(design).toEqual(before);
});

it('removes only the selected native photo and can re-add its authorized saved identity', () => {
  const { design, photos } = fixture();
  const next = applyCanvaNativePhotoChanges(design, [
    { blockId: 'about', change: { type: 'remove', mediaId: photos[2]!.mediaId } },
    { blockId: 'gallery', change: { type: 'remove', mediaId: photos[0]!.mediaId } },
    { blockId: 'gallery', change: { type: 'use', mediaId: photos[0]!.mediaId, alt: 'Restored gallery photo' } },
  ], photos);

  expect(next.nativeContent![0]).not.toHaveProperty('image');
  expect(next.nativeContent![1]).toMatchObject({ images: [{ mediaId: photos[1]!.mediaId }, { mediaId: photos[0]!.mediaId }] });
  expect(next.pages).toEqual(design.pages);
});

it.each(['gallery', 'about'])('rejects foreign or wrong-role choices for %s', (blockId) => {
  const { design, photos } = fixture();
  const target = blockId === 'gallery' ? photos[0]! : photos[2]!;
  const wrong = blockId === 'gallery' ? photos[2]! : photos[0]!;

  expect(() => applyCanvaNativePhotoChanges(design, [{ blockId, change: { type: 'use', mediaId: randomUUID(), replaceId: target.mediaId, alt: 'Forged choice' } }], photos)).toThrow('belonging to this website');
  expect(() => applyCanvaNativePhotoChanges(design, [{ blockId, change: { type: 'use', mediaId: wrong.mediaId, replaceId: target.mediaId, alt: 'Wrong role' } }], photos)).toThrow('belonging to this website');
});

it('rejects unavailable targets, duplicate images and invalid reorder operations without partial changes', () => {
  const { design, photos } = fixture();
  const before = structuredClone(design);

  expect(() => applyCanvaNativePhotoChanges(design, [{ blockId: 'gallery', change: { type: 'use', mediaId: photos[0]!.mediaId, alt: 'Duplicate' } }], photos)).toThrow('already in this Gallery');
  expect(() => applyCanvaNativePhotoChanges(design, [{ blockId: 'gallery', change: { type: 'describe', mediaId: photos[0]!.mediaId, alt: 'First valid change' } }, { blockId: 'gallery', change: { type: 'remove', mediaId: randomUUID() } }], photos)).toThrow('no longer displayed');
  expect(() => applyCanvaNativePhotoChanges(design, [{ blockId: 'gallery', change: { type: 'move', mediaId: photos[0]!.mediaId, direction: 'earlier' } }], photos)).toThrow('cannot move further');
  expect(() => applyCanvaNativePhotoChanges(design, [{ blockId: 'about', change: { type: 'layout', layout: 'grid' } }], photos)).toThrow('Choose a Gallery');
  expect(design).toEqual(before);
});

it('requires enrollment for a first Gallery while allowing edits of already saved photo sections', () => {
  const { design, photos } = fixture();
  const empty = { ...design, nativeContent: [] };
  const change: CanvaNativePhotoChange = { blockId: 'native-photo-gallery', change: { type: 'use', createGallery: true, mediaId: photos[0]!.mediaId, alt: 'First gallery photo' } };

  expect(() => applyCanvaNativePhotoChanges(empty, [change], photos)).toThrow('Adding a Gallery is unavailable');
  expect(applyCanvaNativePhotoChanges(empty, [change], photos, true).nativeContent).toMatchObject([{ id: 'native-photo-gallery', beforePage: 1, images: [{ mediaId: photos[0]!.mediaId }] }]);
  expect(applyCanvaNativePhotoChanges(design, [{ blockId: 'gallery', change: { type: 'layout', layout: 'carousel' } }], [], false).nativeContent![1]).toMatchObject({ layout: 'carousel' });
  expect(() => applyCanvaNativePhotoChanges({ ...design, manualOrigin: undefined }, [change], photos, true)).toThrow('belonging to this website');
});

it('uses explicit owned library bindings for AI Canva artwork without inventing a manual origin', () => {
  const { design, photos } = fixture();
  const ai = { ...design, manualOrigin: undefined, nativeContent: [] };
  const choices = photos.map(photo => ({ ...photo, storageKind: 'asset' as const }));
  const changed = applyCanvaNativePhotoChanges(ai, [{ blockId: 'native-photo-gallery', change: { type: 'use', createGallery: true, mediaId: photos[0]!.mediaId, alt: 'My nail work' } }], choices, true);

  expect(changed.nativeContent).toMatchObject([{ images: [{ storageKind: 'asset', mediaId: photos[0]!.mediaId }] }]);
  expect(changed.manualOrigin).toBeUndefined();
  expect(changed.pages).toEqual(ai.pages);
  expect(compileCanvaDesign(changed).html).toContain('data-luster-native-image');
});

it('refuses model-supplied URLs, approval fields, dimensions and oversized command batches', () => {
  const { design, photos } = fixture();
  const change: CanvaNativePhotoChange = { blockId: 'gallery', change: { type: 'describe', mediaId: photos[0]!.mediaId, alt: 'Owned image' } };

  for (const injected of [{ ...change, publish: true }, { ...change, change: { ...change.change, url: 'https://attacker.invalid' } }, { ...change, change: { ...change.change, width: 99 } }]) {
    expect(() => applyCanvaNativePhotoChanges(design, [injected] as CanvaNativePhotoChange[], photos)).toThrow();
  }

  expect(() => applyCanvaNativePhotoChanges(design, Array.from({ length: 11 }, () => change), photos)).toThrow();
});

it('summarizes only the applied photo operations without model publication claims', () => {
  const { photos } = fixture();

  expect(canvaNativePhotoChangeSummary([{ blockId: 'gallery', change: { type: 'remove', mediaId: photos[0]!.mediaId } }, { blockId: 'gallery', change: { type: 'describe', mediaId: photos[1]!.mediaId, alt: 'Owner photograph' } }])).toBe('Removed 1 photo. Updated 1 photo description. Saved in your draft.');
});
