/**
 * Shared site-content collections carried by the document (schema v2).
 *
 * Each collection is a single authority: staff, reviews, offers, and FAQ
 * records are owned once here and referenced by id from section settings, so
 * two sections can never hold diverging copies of the same person, quote, or
 * offer. Records are text-first in V1 (avatars fall back to initials); media
 * attachment is a documented deferred variant because no Builder-side media
 * claim path exists yet for any section type.
 */

export type StaffMemberRecord = {
  id: string;
  name: string;
  title: string;
  specialties: string[];
  acceptsBookings: boolean;
};

export type ReviewSource = 'client' | 'google' | 'other';

export type ReviewRecord = {
  id: string;
  quote: string;
  authorName: string;
  /** 1–5 when a real rating exists; null renders no stars. */
  rating: number | null;
  source: ReviewSource;
  visible: boolean;
};

export type OfferRecord = {
  id: string;
  title: string;
  detail: string;
  terms: string;
  /** ISO date; expiry copy renders only when this is a real future date. */
  expiresAt: string | null;
  actionLabel: string | null;
};

export type FaqItemRecord = {
  id: string;
  question: string;
  answer: string;
};

export type SiteContentCollections = {
  staff: StaffMemberRecord[];
  reviews: ReviewRecord[];
  offers: OfferRecord[];
  faq: FaqItemRecord[];
};

export type SiteContentCollectionKey = keyof SiteContentCollections;

export const SITE_CONTENT_COLLECTION_KEYS = [
  'staff',
  'reviews',
  'offers',
  'faq',
] as const satisfies readonly SiteContentCollectionKey[];

export const createEmptySiteContent = (): SiteContentCollections => ({
  faq: [],
  offers: [],
  reviews: [],
  staff: [],
});

export type SiteContentRecordByKey = {
  faq: FaqItemRecord;
  offers: OfferRecord;
  reviews: ReviewRecord;
  staff: StaffMemberRecord;
};

export type UpdateSiteContentInput =
  | {
      collection: SiteContentCollectionKey;
      operation: 'upsert';
      record: SiteContentRecordByKey[SiteContentCollectionKey];
    }
  | { collection: SiteContentCollectionKey; operation: 'remove'; recordId: string }
  | {
      collection: SiteContentCollectionKey;
      operation: 'reorder';
      orderedIds: string[];
    };
