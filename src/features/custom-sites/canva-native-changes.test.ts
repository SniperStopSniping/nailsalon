import { randomUUID } from 'node:crypto';

import { expect, it, vi } from 'vitest';

import { compileCanvaDesign } from './canva';
import { applyCanvaNativeContentChanges, applyCanvaNativePhotoChanges, canvaNativePhotoChangeSummary } from './canva-native-changes';
import type { CanvaNativePhotoChange, NativePhotoChoice } from './canva-native-edits';
import { EMPTY_WEBSITE_DETAILS } from './website-details';

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

it('adds About copy and its owned portrait together, preserves policies and avoids reserved text identities', () => {
  const { design, photos } = fixture();
  const original = { ...design, nativeContent: design.nativeContent!.filter(block => block.type !== 'about') };
  const details = { ...EMPTY_WEBSITE_DETAILS, instagram: 'my_studio', sections: [{ id: 'canva-about', title: 'Booking policy', text: 'Owner supplied policy.' }] };
  const next = applyCanvaNativeContentChanges(original, details, [
    { blockId: 'native-about', change: { type: 'create_about', title: 'Meet the owner', text: 'A calm space for thoughtful nails.' } },
    { blockId: 'native-about', change: { type: 'use', mediaId: photos[2]!.mediaId, alt: 'My portrait' } },
  ], photos, true);

  expect(next.details).toEqual({ ...details, sections: [...details.sections, { id: 'canva-about-1', title: 'Meet the owner', text: 'A calm space for thoughtful nails.' }] });
  expect(next.design.nativeContent![0]).toMatchObject({ type: 'about', id: 'native-about', textSectionIds: ['canva-about-1'], image: { mediaId: photos[2]!.mediaId } });
  expect(next.design.nativeContent![1]).toEqual(original.nativeContent![0]);
  expect(compileCanvaDesign(next.design, next.details).html).toContain('data-luster-field="details.section_canva-about-1"');
  expect(next.design.pages).toEqual(original.pages);
  expect(original.ownerReviewed).toBe(true);
  expect(details.sections).toHaveLength(1);
});

it('edits only bound About text and refuses policy substitution, duplicate About or disabled creation', () => {
  const { design, photos } = fixture();
  const details = { ...EMPTY_WEBSITE_DETAILS, sections: [{ id: 'about-copy', title: 'About', text: 'Original intro' }, { id: 'policy', title: 'Policies', text: 'Leave this alone' }] };
  const change = { blockId: 'about', change: { type: 'about_text' as const, sectionId: 'about-copy', title: 'Meet me', text: 'An updated introduction' } };
  const next = applyCanvaNativeContentChanges(design, details, [change], photos);

  expect(next.details.sections).toEqual([{ id: 'about-copy', title: 'Meet me', text: 'An updated introduction' }, details.sections[1]]);
  expect(next.design.nativeContent![0]).toMatchObject({ title: 'Meet me', image: design.nativeContent![0]!.type === 'about' ? design.nativeContent![0]!.image : undefined });
  expect(() => applyCanvaNativeContentChanges(design, details, [{ ...change, change: { ...change.change, sectionId: 'policy' } }], photos)).toThrow('not part of this About');
  expect(() => applyCanvaNativeContentChanges(design, details, [{ blockId: 'native-about', change: { type: 'create_about', title: 'Duplicate', text: 'Duplicate intro' } }], photos, true)).toThrow('About section changed');
  expect(() => applyCanvaNativeContentChanges({ ...design, nativeContent: [] }, details, [{ blockId: 'native-about', change: { type: 'create_about', title: 'About', text: 'Intro' } }], photos)).toThrow('unavailable');
  expect(details.sections[0]!.text).toBe('Original intro');
});

it('adds wording to an existing text-free About section without enabling new sections or overwriting other copy', () => {
  const { design } = fixture();
  const about = design.nativeContent![0]!;
  if (about.type !== 'about') {
    throw new Error('Missing About fixture');
  }
  about.textSectionIds = [];
  const details = { ...EMPTY_WEBSITE_DETAILS, sections: [{ id: 'policy', title: 'Policies', text: 'Keep this wording.' }] };
  const result = applyCanvaNativeContentChanges(design, details, [{ blockId: about.id, change: { type: 'about_text', title: 'Meet me', text: 'My supplied introduction.' } }], [], false);

  expect(result.design.nativeContent![0]).toMatchObject({ textSectionIds: ['canva-about'], image: about.image });
  expect(result.details.sections).toEqual([...details.sections, { id: 'canva-about', title: 'Meet me', text: 'My supplied introduction.' }]);
});
