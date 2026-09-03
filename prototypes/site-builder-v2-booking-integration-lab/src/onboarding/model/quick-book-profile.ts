import { resolveCustomDesignAction } from '../../custom-design/model/actions';
import type { ReviewRecord } from '../../model/section-library/site-content';
import { labelForVisitMode } from '../preview/customer-facts';
import { getPublicContactActions, resolveInstagramUsername } from './contact';
import {
  getPublicWeeklyHours,
  getWeeklyHoursPreviewStatus,
} from './hours';
import { getPublicDirectionsAction, getPublicLocationPreview } from './location';
import {
  getPolicyDisplayWording,
  getPublicDepositsAndCancellationsDisplayWording,
} from './policies';
import type {
  BusinessProfileDraft,
  QuickBookProfileVisibilityDraft,
} from './types';

export const QUICK_BOOK_SHORT_BIO_MAX_LENGTH = 180;

export type QuickBookProfileContact = {
  detail: string;
  href: string;
  label: string;
  rel?: 'noopener noreferrer';
  target?: '_blank';
  type: 'call' | 'email' | 'instagram' | 'text';
};

export type QuickBookProfilePolicy = {
  id: string;
  label: string;
  wording: string;
};

export type QuickBookProfileReview = Pick<ReviewRecord, 'authorName' | 'id' | 'quote' | 'rating'>;

export type QuickBookProfileViewModel = {
  bio: string | null;
  contacts: QuickBookProfileContact[];
  hours: {
    detail: string;
    label: string;
    weekly: ReturnType<typeof getPublicWeeklyHours>;
  } | null;
  instagram: QuickBookProfileContact | null;
  location: {
    detail: string | null;
    directions: ReturnType<typeof getPublicDirectionsAction>;
    notes: string[];
    primary: string;
  } | null;
  policies: QuickBookProfilePolicy[];
  reviews: {
    averageRating: number | null;
    count: number;
    items: QuickBookProfileReview[];
    ratedCount: number;
  } | null;
  techName: string | null;
  techPhotoVisible: boolean;
};

const clampBio = (value: string): string => {
  const normalized = value.trim().replace(/\s+/gu, ' ');
  if (normalized.length <= QUICK_BOOK_SHORT_BIO_MAX_LENGTH) {
    return normalized;
  }
  return `${normalized.slice(0, QUICK_BOOK_SHORT_BIO_MAX_LENGTH - 1).trimEnd()}…`;
};

const resolveInstagram = (
  profile: BusinessProfileDraft,
): QuickBookProfileContact | null => {
  const instagram = resolveInstagramUsername(profile.instagram);
  if (instagram.status !== 'resolved') {
    return null;
  }
  const resolution = resolveCustomDesignAction({
    destination: { username: instagram.username },
    type: 'instagram',
  });
  if (resolution.status !== 'resolved') {
    return null;
  }
  return {
    detail: 'Instagram',
    href: resolution.href,
    label: `@${instagram.username}`,
    rel: resolution.rel,
    target: resolution.target,
    type: 'instagram',
  };
};

const resolvePolicies = (
  profile: BusinessProfileDraft,
  visibility: QuickBookProfileVisibilityDraft,
): QuickBookProfilePolicy[] => {
  const policies: QuickBookProfilePolicy[] = [];
  const combinedWording = visibility.showCancellationPolicy
    ? getPublicDepositsAndCancellationsDisplayWording(profile.policies).trim()
    : '';
  if (visibility.showBookingPolicy) {
    const visitMode = labelForVisitMode(profile);
    if (visitMode) {
      policies.push({ id: 'appointments', label: 'Appointments', wording: visitMode });
    }
    const depositWording = getPolicyDisplayWording(profile.policies, 'deposits').trim();
    if (depositWording && !combinedWording) {
      policies.push({ id: 'deposit', label: 'Deposit', wording: depositWording });
    }
  }
  if (combinedWording) {
    policies.push({
      id: 'deposits-cancellations',
      label: 'Deposits & cancellations',
      wording: combinedWording,
    });
  }
  return policies;
};

export const resolveQuickBookProfile = (input: {
  previewTimestamp: string;
  profile: BusinessProfileDraft;
  /** Only a connected, account-backed review source may populate this. */
  verifiedReviews?: readonly ReviewRecord[];
  visibility: QuickBookProfileVisibilityDraft;
}): QuickBookProfileViewModel => {
  const {
    previewTimestamp,
    profile,
    verifiedReviews = [],
    visibility,
  } = input;
  const publicLocation = getPublicLocationPreview(profile.location);
  const hoursStatus = getWeeklyHoursPreviewStatus(
    profile.hours,
    previewTimestamp,
    profile.timeZone,
  );
  // Location, contact, and hours visibility are canonical profile decisions
  // made on Screens 3 and 4. Quick Book consumes those decisions; it must not
  // require a second set of template toggles before the same saved facts can
  // appear in progressive previews.
  const contacts = getPublicContactActions(profile)
    .filter((action) => action.method === 'call'
      || action.method === 'email'
      || action.method === 'text')
    .map((action): QuickBookProfileContact => ({
      detail: action.preferred
        ? `${action.actionLabel} · Preferred`
        : action.actionLabel,
      href: action.href,
      label: action.detail,
      ...(action.rel ? { rel: action.rel } : {}),
      ...(action.target ? { target: action.target } : {}),
      type: action.method as 'call' | 'email' | 'text',
    }));
  const visibleReviews = visibility.showReviews
    ? verifiedReviews.filter(review => review.visible)
    : [];
  const ratedReviews = visibleReviews.filter(
    (review): review is ReviewRecord & { rating: number } => review.rating !== null,
  );
  const averageRating = ratedReviews.length > 0
    ? ratedReviews.reduce((total, review) => total + review.rating, 0) / ratedReviews.length
    : null;
  const todayHours = hoursStatus ? profile.hours.days[hoursStatus.weekday] : null;
  const profilePhotoId = profile.profilePhoto?.storageId ?? profile.profilePhoto?.id ?? null;
  const logoId = profile.logo?.storageId ?? profile.logo?.id ?? null;
  const hasDistinctProfilePhoto = Boolean(
    profilePhotoId && (!logoId || profilePhotoId !== logoId),
  );

  return {
    bio: visibility.showBio && profile.about.shortBio.trim()
      ? clampBio(profile.about.shortBio)
      : null,
    contacts,
    hours: hoursStatus && todayHours
      ? {
          detail: hoursStatus.kind === 'open'
            ? hoursStatus.label.replace(/^Open until /u, 'Until ')
            : hoursStatus.label,
          label: hoursStatus.kind === 'open'
            ? 'Open now'
            : 'Closed',
          weekly: getPublicWeeklyHours(profile.hours),
        }
      : null,
    instagram: profile.about.visibility.instagram ? resolveInstagram(profile) : null,
    location: publicLocation.primary
      ? {
          detail: publicLocation.detail,
          directions: getPublicDirectionsAction(profile.location),
          notes: profile.location.addressVisibility === 'public'
            ? [
                profile.location.entranceInstructions,
                profile.location.parking,
                profile.location.transitInformation,
              ].map(value => value.trim()).filter(Boolean)
            : [],
          primary: publicLocation.primary,
        }
      : null,
    policies: resolvePolicies(profile, visibility),
    reviews: visibleReviews.length > 0
      ? {
          averageRating,
          count: visibleReviews.length,
          items: visibleReviews.slice(0, 3).map(({ authorName, id, quote, rating }) => ({
            authorName,
            id,
            quote,
            rating,
          })),
          ratedCount: ratedReviews.length,
        }
      : null,
    techName: profile.about.visibility.owner_name && profile.ownerName.trim()
      ? profile.ownerName.trim()
      : null,
    techPhotoVisible: profile.about.visibility.profile_photo && hasDistinctProfilePhoto,
  };
};
