import 'server-only';

import { createHash } from 'node:crypto';

import { SetupError } from '@/features/business-setup/contracts';
import type { OnboardingCompiledSiteDocument, OnboardingPersistedSnapshot } from '@/features/onboarding-v1-integration/contracts';
import type { onboardingSiteMediaSchema } from '@/models/Schema';

import { resolveAboutBio } from '../../../prototypes/site-builder-v2-booking-integration-lab/src/onboarding/model/about';
import { labelForNewClients, labelForVisitMode } from '../../../prototypes/site-builder-v2-booking-integration-lab/src/onboarding/preview/customer-facts';
import type { CanvaNativeContent, CanvaNativeImage } from './canva-native-content';
import type { WebsiteDetails } from './website-details';

/** Preserve visible owner content; never substitute demonstration gallery/reviews. */
export function onboardingCanvaContent(document: OnboardingCompiledSiteDocument, snapshot: OnboardingPersistedSnapshot, rows: (typeof onboardingSiteMediaSchema.$inferSelect)[], anchors: ReadonlyMap<string, string>) {
  const blocks: CanvaNativeContent = [];
  const textSections: WebsiteDetails['sections'] = [];
  const originals = document.builderDocument.pages.flatMap(page => page.sections);
  const profile = snapshot.profile;
  function image(localId: string, role: 'gallery' | 'profile', alt: string): CanvaNativeImage {
    const row = rows.find(row => row.localItemId === localId && row.role === role);
    if (!row || row.claimStatus !== 'ready' || !row.width || !row.height || !row.storageKey || row.mimeType !== 'image/webp') {
      throw new SetupError('NOT_READY', 'Your About or Gallery photos have not finished saving. Retry their uploads before continuing.');
    }
    return { mediaId: row.id, role, width: row.width, height: row.height, alt: (role === 'gallery' ? row.altText?.trim() || alt : alt).slice(0, 500) };
  }
  let beforePage = 0;
  const sections = [...document.pages].filter(page => page.visible).sort((a, b) => a.order - b.order).flatMap(page => [...page.sections].filter(section => section.visible).sort((a, b) => a.order - b.order));
  for (const section of sections) {
    if (section.type === 'custom_design') {
      beforePage += section.customDesignSettings?.images.length ?? 0;
      continue;
    }
    const id = anchors.get(section.id)?.slice(1);
    if (!id) {
      continue;
    }
    const original = originals.find(original => original.id === section.id);
    if (section.type === 'about') {
      const visibility = profile.about.visibility;
      const override = original?.sectionType === 'about' && original.settings.intro.source === 'override' ? original.settings.intro.value.trim() : '';
      const bio = resolveAboutBio(profile.about.shortBio, profile.about.fullBio);
      // Match the original manual editor: a section intro replaces only the
      // lead. It must not discard the owner's expanded biography.
      const intro = override || visibility.bio ? [override || bio.lead, bio.expanded].filter(Boolean).join('\n\n') : '';
      const years = profile.about.yearsOfExperience.trim();
      const experience = /^\d+$/u.test(years) ? `${years} years of experience` : years;
      const text = [visibility.owner_name ? profile.ownerName : '', intro, profile.about.clientAppreciation, visibility.specialties ? profile.about.specialties.join(', ') : '', visibility.experience ? experience : '', visibility.certifications ? profile.about.certifications.join(', ') : '', visibility.languages ? profile.about.languages.join(', ') : '', visibility.appointment_status ? labelForVisitMode(profile) : '', visibility.new_client_status ? labelForNewClients(profile) : ''].filter(Boolean).join('\n\n');
      const chunks: string[] = [];
      let current = '';
      for (const character of text) {
        if (current.length + character.length > 3000) {
          chunks.push(current.trim());
          current = '';
        }
        current += character;
      }
      if (current.trim()) {
        chunks.push(current.trim());
      }
      const prefix = `manual_about_${createHash('sha256').update(section.id).digest('hex').slice(0, 20)}`;
      const textSectionIds = chunks.map((text, index) => {
        const id = `${prefix}_${index}`;
        textSections.push({ id, title: index ? 'More about us' : 'About', text });
        return id;
      });
      const identity = (visibility.owner_name ? profile.ownerName : '') || (visibility.salon_name ? profile.businessName : '') || 'Business owner';
      blocks.push({ id, beforePage, type: 'about', title: 'About', textSectionIds, ...(visibility.profile_photo && profile.profilePhotoItemId ? { image: image(profile.profilePhotoItemId, 'profile', `${identity} profile photo`) } : {}), showBusinessName: visibility.salon_name, showInstagram: visibility.instagram && !profile.bookingOnlyContact, showBookingButton: visibility.book_button });
    }
    if (section.type === 'gallery' && snapshot.site.galleryEnabled) {
      if (snapshot.gallery.source === 'mock_luster') {
        throw new SetupError('NOT_READY', 'Replace the example gallery with your own photos before continuing. Your original design is saved.');
      }
      const settings = original?.sectionType === 'gallery' ? original.settings : null;
      const ids = settings?.selection.mode === 'picked' ? settings.selection.imageIds.filter(id => snapshot.gallery.imageItemIds.includes(id)) : snapshot.gallery.imageItemIds;
      if (ids.length) {
        blocks.push({ id, beforePage, type: 'gallery', title: 'Gallery', layout: settings?.preset ?? snapshot.gallery.layout, images: ids.map((id, index) => image(id, 'gallery', `Portfolio work ${index + 1}`)) });
      }
    }
    if (section.type === 'reviews' && original?.sectionType === 'reviews') {
      const reviews = original.settings.reviewIds.flatMap((id) => {
        const record = document.builderDocument.siteContent.reviews.find(review => review.id === id && review.visible);
        return record ? [{ id: record.id, quote: record.quote, authorName: record.authorName, rating: record.rating }] : [];
      }).slice(0, 3);
      if (reviews.length) {
        blocks.push({ id, beforePage, type: 'reviews', title: 'What clients say', showRatings: original.settings.showRatings, reviews });
      }
    }
  }
  return { blocks, textSections };
}
