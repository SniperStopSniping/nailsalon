import { SetupError } from '@/features/business-setup/contracts';

import type { CanvaDesign } from './canva';
import type { CanvaNativeContent } from './canva-native-content';
import { canvaNativeContentSchema } from './canva-native-content';
import type { CanvaNativePhotoChange, NativePhotoChoice } from './canva-native-edits';
import { canvaNativePhotoChangesSchema } from './canva-native-edits';
import type { WebsiteDetails } from './website-details';
import { EMPTY_WEBSITE_DETAILS, websiteDetailsSchema } from './website-details';

/** Shared manual/chat reducer. Choices are authorized server metadata, never model dimensions or URLs. */
export function applyCanvaNativePhotoChanges(design: CanvaDesign, raw: CanvaNativePhotoChange[], choices: NativePhotoChoice[], allowNewGallery = false): CanvaDesign {
  return applyCanvaNativeContentChanges(design, EMPTY_WEBSITE_DETAILS, raw, choices, allowNewGallery).design;
}

/** About copy uses the existing website details, never a second text catalog. */
export function applyCanvaNativeContentChanges(design: CanvaDesign, details: WebsiteDetails | undefined, raw: CanvaNativePhotoChange[], choices: NativePhotoChoice[], allowNewSection = false) {
  const changes = canvaNativePhotoChangesSchema.parse(raw);
  const result = structuredClone(design);
  const nextDetails = websiteDetailsSchema.parse(details ?? EMPTY_WEBSITE_DETAILS);
  const addText = (title: string, text: string) => {
    const id = Array.from({ length: 21 }, (_, index) => index ? `canva-about-${index}` : 'canva-about').find(id => !nextDetails.sections.some(section => section.id === id));
    if (!id || nextDetails.sections.length >= 20) {
      throw new SetupError('INVALID', 'Your website already has twenty text sections. Edit an existing section instead.');
    }
    nextDetails.sections.push({ id, title, text });
    return id;
  };
  for (const { blockId, change } of changes) {
    let block = result.nativeContent?.find(item => item.id === blockId);
    if (change.type === 'create_about') {
      if (!allowNewSection) {
        throw new SetupError('NOT_READY', 'Adding an About section is unavailable right now. Your saved website is safe.');
      }
      if (blockId !== 'native-about' || block || result.nativeContent?.some(item => item.type === 'about')) {
        throw new SetupError('INVALID', 'Your About section changed. Reload before adding it.');
      }
      const sectionId = addText(change.title, change.text);
      const about = { type: 'about' as const, id: blockId, title: change.title, beforePage: design.pages.length, textSectionIds: [sectionId], showBusinessName: false, showInstagram: false, showBookingButton: false };
      const blocks = result.nativeContent ?? [];
      const galleryIndex = blocks.findIndex(item => item.type === 'gallery' && item.beforePage === design.pages.length);
      blocks.splice(galleryIndex < 0 ? blocks.length : galleryIndex, 0, about);
      result.nativeContent = blocks;
      continue;
    }
    if (!block && change.type === 'use' && change.createGallery && blockId === 'native-photo-gallery') {
      if (!allowNewSection) {
        throw new SetupError('NOT_READY', 'Adding a Gallery is unavailable right now. Your saved website is safe.');
      }
      block = { type: 'gallery', id: blockId, title: 'Gallery', beforePage: design.pages.length, layout: 'grid', images: [] };
      result.nativeContent = [...(result.nativeContent ?? []), block];
    }
    if (!block || block.type === 'reviews') {
      throw new SetupError('INVALID', 'That photo section changed. Reload your saved design.');
    }
    if (change.type === 'about_text') {
      if (block.type === 'about' && !change.sectionId && !block.textSectionIds.length) {
        block.textSectionIds.push(addText(change.title, change.text));
        block.title = change.title;
        continue;
      }
      const section = nextDetails.sections.find(section => section.id === change.sectionId);
      if (block.type !== 'about' || !change.sectionId || !block.textSectionIds.includes(change.sectionId) || !section) {
        throw new SetupError('INVALID', 'That text is not part of this About section. Reload your saved design.');
      }
      section.title = change.title;
      section.text = change.text;
      if (block.textSectionIds[0] === change.sectionId) {
        block.title = change.title;
      }
      continue;
    }
    const images = block.type === 'about' ? block.image ? [block.image] : [] : block.images;
    if (change.type === 'layout') {
      if (block.type !== 'gallery') {
        throw new SetupError('INVALID', 'Choose a Gallery section to change its layout.');
      }
      block.layout = change.layout;
    } else if (change.type === 'use') {
      const choice = choices.find(item => item.mediaId === change.mediaId && item.role === (block.type === 'about' ? 'profile' : 'gallery') && (design.manualOrigin || item.storageKind === 'asset'));
      if (!choice) {
        throw new SetupError('INVALID', 'Choose a saved photo belonging to this website and section.');
      }
      const image = { mediaId: choice.mediaId, ...(choice.storageKind ? { storageKind: choice.storageKind } : {}), role: choice.role, width: choice.width, height: choice.height, alt: change.alt };
      if (block.type === 'about') {
        if (change.replaceId && block.image?.mediaId !== change.replaceId) {
          throw new SetupError('INVALID', 'That photo changed. Reload before replacing it.');
        }
        block.image = image;
      } else {
        if (images.some(image => image.mediaId === change.mediaId && image.mediaId !== change.replaceId)) {
          throw new SetupError('INVALID', 'That photo is already in this Gallery.');
        }
        if (change.replaceId) {
          const index = block.images.findIndex(image => image.mediaId === change.replaceId);
          if (index < 0) {
            throw new SetupError('INVALID', 'That photo changed. Reload before replacing it.');
          }
          block.images[index] = image;
        } else {
          block.images.push(image);
        }
      }
    } else {
      const index = images.findIndex(image => image.mediaId === change.mediaId);
      if (index < 0) {
        throw new SetupError('INVALID', 'That photo is no longer displayed in this section.');
      }
      if (change.type === 'remove') {
        if (block.type === 'about') {
          delete block.image;
        } else {
          block.images.splice(index, 1);
        }
      } else if (change.type === 'describe') {
        images[index]!.alt = change.alt;
      } else {
        const destination = index + (change.direction === 'earlier' ? -1 : 1);
        if (block.type !== 'gallery' || destination < 0 || destination >= images.length) {
          throw new SetupError('INVALID', 'That photo cannot move further in this section.');
        }
        [images[index], images[destination]] = [images[destination]!, images[index]!];
      }
    }
  }
  result.nativeContent = canvaNativeContentSchema.parse(result.nativeContent ?? []) as CanvaNativeContent;
  result.ownerReviewed = false;
  return { design: result, details: websiteDetailsSchema.parse(nextDetails) };
}

/** Describe applied commands, rather than trusting a model's success/publication claim. */
export function canvaNativePhotoChangeSummary(changes: CanvaNativePhotoChange[]) {
  const count = (type: CanvaNativePhotoChange['change']['type']) => changes.filter(item => item.change.type === type).length;
  const summaries = ([
    ['create_about', 'Added', 'About section'],
    ['about_text', 'Updated', 'About text'],
    ['remove', 'Removed', 'photo'],
    ['describe', 'Updated', 'photo description'],
    ['move', 'Moved', 'photo'],
    ['layout', 'Changed', 'gallery layout'],
    ['use', 'Changed', 'saved photo'],
  ] as const).flatMap(([type, verb, noun]) => {
    const amount = count(type);
    return amount ? [`${verb} ${amount} ${noun}${amount === 1 ? '' : 's'}.`] : [];
  });
  return `${summaries.join(' ')} Saved in your draft.`;
}
