/**
 * Adapts the onboarding lab's draft view model into the shared
 * `QuickBookPresentationProfile`, so the Design step preview mounts the same
 * renderer as the public booking page and applies the same image-state rules.
 *
 * Nothing here reads storage: the caller resolves image URLs through the lab
 * asset provider and passes them in.
 */
import type { QuickBookProfileViewModel } from '../model/quick-book-profile';
import type { BusinessProfileDraft } from '../model/types';
import { labelForNewClients, labelForVisitMode } from '../preview/customer-facts';
import type { QuickBookLayoutId } from './layouts';
import {
  type QuickBookGalleryItem,
  type QuickBookPresentationProfile,
  resolveQuickBookCoverSlot,
  resolveQuickBookCoverText,
  resolveQuickBookGallery,
  resolveQuickBookPortraitSlot,
  resolveQuickBookSpecialties,
} from './presentation-view';

export type LabQuickBookPresentationInput = {
  layout: QuickBookLayoutId;
  profile: BusinessProfileDraft;
  view: QuickBookProfileViewModel;
  logoUrl: string | null;
  profilePhotoUrl: string | null;
  /** The owner's cover, when onboarding has one; the lab currently has none. */
  coverUrl: string | null;
  /** Public gallery items already resolved to URLs, in the owner's order. */
  gallery: readonly QuickBookGalleryItem[];
  /** Optional website copy the cover may carry (the lab has no saved line yet). */
  websiteCopy: string | null;
};

export const buildLabQuickBookPresentationProfile = ({
  layout,
  profile,
  view,
  logoUrl,
  profilePhotoUrl,
  coverUrl,
  gallery,
  websiteCopy,
}: LabQuickBookPresentationInput): QuickBookPresentationProfile => {
  const salonName = profile.businessName.trim() || 'Your nail studio';
  const phone = view.contacts.find(contact => contact.type === 'call')
    ?? view.contacts.find(contact => contact.type === 'text')
    ?? null;
  const email = view.contacts.find(contact => contact.type === 'email') ?? null;
  const technicianPhotoUrl = view.techPhotoVisible ? profilePhotoUrl : null;

  return {
    identity: {
      salonName,
      logoUrl,
      technicianName: view.techName,
      technicianPhotoUrl,
    },
    location: view.location
      ? {
          name: null,
          addressLine: view.location.primary,
          localityLine: view.location.detail,
          directionsUrl: view.location.directions?.href ?? '#',
          instructionLines: view.location.notes,
        }
      : null,
    hours: view.hours
      ? {
          statusLabel: view.hours.label,
          todayLabel: view.hours.detail,
          weekly: view.hours.weekly.map(row => ({ day: row.label, value: row.hours })),
        }
      : null,
    contact: phone || email
      ? {
          phone: phone
            ? { actionLabel: phone.detail, display: phone.label, href: phone.href }
            : null,
          email: email
            ? { display: email.label, href: email.href }
            : null,
        }
      : null,
    policies: view.policies.map(policy => ({ label: policy.label, text: policy.wording })),
    reviews: view.reviews && view.reviews.averageRating !== null
      ? {
          ratingText: view.reviews.averageRating.toFixed(1),
          reviewCountText: `${view.reviews.count} ${view.reviews.count === 1 ? 'review' : 'reviews'}`,
          href: null,
        }
      : null,
    instagram: view.instagram
      ? { label: view.instagram.label, href: view.instagram.href }
      : null,
    bio: view.bio,
    presentation: {
      layoutId: layout,
      specialties: resolveQuickBookSpecialties({
        layout,
        specialties: profile.about.visibility.specialties ? profile.about.specialties : [],
      }),
      bookingMethod: profile.about.visibility.appointment_status ? labelForVisitMode(profile) : null,
      newClients: profile.about.visibility.new_client_status ? labelForNewClients(profile) : null,
      coverText: resolveQuickBookCoverText({
        layout,
        mode: 'website_copy',
        customText: null,
        websiteCopy,
      }),
      portrait: resolveQuickBookPortraitSlot({
        layout,
        url: technicianPhotoUrl,
        alt: view.techName ?? salonName,
        focal: null,
        visible: view.techPhotoVisible,
      }),
      cover: resolveQuickBookCoverSlot({ layout, url: coverUrl, focal: null }),
      gallery: resolveQuickBookGallery({ layout, items: gallery }),
    },
  };
};
