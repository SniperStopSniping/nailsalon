import { resolveCustomDesignAction } from '../../custom-design/model/actions';
import type { ReviewRecord } from '../../model/section-library/site-content';
import { labelForVisitMode } from '../preview/customer-facts';
import { getClientTextNumber, resolveInstagramUsername } from './contact';
import {
  formatHoursInterval,
  getPublicWeeklyHours,
  getWeeklyHoursPreviewStatus,
} from './hours';
import { getPublicDirectionsAction, getPublicLocationPreview } from './location';
import {
  getDepositsAndCancellationsDisplayWording,
  getPolicyDisplayWording,
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
  type: 'email' | 'instagram' | 'phone';
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

const resolvePhone = (
  profile: BusinessProfileDraft,
): QuickBookProfileContact | null => {
  if (profile.bookingOnlyContact) {
    return null;
  }
  const { clientContact } = profile;
  const primaryNumber = clientContact.primaryNumber.trim();
  const textNumber = getClientTextNumber(profile);
  if (clientContact.callEnabled && primaryNumber) {
    const resolution = resolveCustomDesignAction({
      destination: { phoneNumber: primaryNumber },
      type: 'call',
    });
    if (resolution.status !== 'resolved') {
      return null;
    }
    return {
      detail: clientContact.textEnabled && textNumber === primaryNumber
        ? 'Call or text'
        : 'Call',
      href: resolution.href,
      label: primaryNumber,
      type: 'phone',
    };
  }
  if (clientContact.textEnabled && textNumber) {
    const resolution = resolveCustomDesignAction({
      destination: { phoneNumber: textNumber },
      type: 'text',
    });
    if (resolution.status !== 'resolved') {
      return null;
    }
    return {
      detail: 'Text',
      href: resolution.href,
      label: textNumber,
      type: 'phone',
    };
  }
  return null;
};

const resolveEmail = (
  profile: BusinessProfileDraft,
): QuickBookProfileContact | null => {
  if (profile.bookingOnlyContact || !profile.email.trim()) {
    return null;
  }
  const resolution = resolveCustomDesignAction({
    destination: { email: profile.email.trim() },
    type: 'email',
  });
  if (resolution.status !== 'resolved') {
    return null;
  }
  return {
    detail: 'Email',
    href: resolution.href,
    label: profile.email.trim(),
    type: 'email',
  };
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
    ? getDepositsAndCancellationsDisplayWording(profile.policies).trim()
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
  const phone = visibility.showPhone ? resolvePhone(profile) : null;
  const email = visibility.showEmail ? resolveEmail(profile) : null;
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
  const isScheduledToday = Boolean(todayHours && !todayHours.closed && todayHours.open && todayHours.close);
  const profilePhotoId = profile.profilePhoto?.storageId ?? profile.profilePhoto?.id ?? null;
  const logoId = profile.logo?.storageId ?? profile.logo?.id ?? null;
  const hasDistinctProfilePhoto = Boolean(
    profilePhotoId && (!logoId || profilePhotoId !== logoId),
  );

  return {
    bio: visibility.showBio && profile.about.shortBio.trim()
      ? clampBio(profile.about.shortBio)
      : null,
    contacts: [phone, email].filter(
      (contact): contact is QuickBookProfileContact => contact !== null,
    ),
    hours: visibility.showHours && hoursStatus && todayHours
      ? {
          detail: isScheduledToday ? formatHoursInterval(todayHours) : hoursStatus.label,
          label: hoursStatus.kind === 'open'
            ? 'Open today'
            : todayHours.closed
              ? 'Closed today'
              : 'Closed now',
          weekly: getPublicWeeklyHours(profile.hours),
        }
      : null,
    instagram: visibility.showInstagram ? resolveInstagram(profile) : null,
    location: visibility.showLocation && publicLocation.primary
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
    techName: visibility.showTechName && profile.ownerName.trim()
      ? profile.ownerName.trim()
      : null,
    techPhotoVisible: visibility.showTechPhoto && hasDistinctProfilePhoto,
  };
};
