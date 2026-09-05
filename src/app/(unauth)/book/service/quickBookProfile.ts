import type { QuickBookProfileVisibility } from '@/libs/bookingPageConfig';
import type { LocationDisplayMode } from '@/libs/bookingPageContent';
import type { BusinessHours } from '@/libs/bookingPolicy';
import { applyLocationDisplayMode, isExactAddressPublic } from '@/libs/salonContent';
import {
  resolvePublicLocationInstructions,
  type SharedSalonProfile,
} from '@/libs/sharedSalonProfile';
import { getPublicTechnicianRatingDisplay } from '@/libs/technicianRating';
import type { BookingExperience } from '@/types/salonPolicy';

type PublicTechnician = {
  name: string;
  imageUrl: string | null;
  rating: number | null;
  reviewCount: number;
};

type PublicLocation = {
  name: string;
  address: string | null;
  city: string | null;
  state: string | null;
  zipCode: string | null;
  phone: string | null;
  email: string | null;
  businessHours: BusinessHours;
  isPrimary: boolean | null;
};

/**
 * Shared public-contact intent resolved from the canonical salon profile.
 * Quick Book owns only whether the phone row is visible; it must not guess
 * whether the saved number accepts calls, texts, or both.
 */
export type QuickBookPublicContactPreferences = {
  callEnabled: boolean;
  textEnabled: boolean;
  /** The canonical text destination, including a distinct SMS number. */
  textNumber: string | null;
};

type QuickBookProfileSource = {
  salon: {
    name: string;
    logoUrl: string | null;
    phone: string | null;
    email: string | null;
    address: string | null;
    city: string | null;
    state: string | null;
    zipCode: string | null;
    businessHours: BusinessHours;
  };
  technicians: readonly PublicTechnician[];
  locations: readonly PublicLocation[];
  bookingExperience: BookingExperience;
  reviewUrl: string | null;
  sharedProfile: SharedSalonProfile;
  parkingInstructions: string | null;
  visibility?: Partial<QuickBookProfileVisibility> | null;
  /** Canonical shared salon bio selected on the active draft/live content side. */
  bio: string | null;
  locationDisplayMode: LocationDisplayMode;
  publicContactPreferences?: QuickBookPublicContactPreferences | null;
  timeZone: string;
  now?: Date;
};

export type QuickBookProfileView = {
  identity: {
    salonName: string;
    logoUrl: string | null;
    technicianName: string | null;
    technicianPhotoUrl: string | null;
  };
  location: {
    name: string | null;
    addressLine: string | null;
    localityLine: string | null;
    directionsUrl: string;
    instructionLines: string[];
  } | null;
  hours: {
    statusLabel: string;
    todayLabel: string | null;
    weekly: Array<{ day: string; value: string }>;
  } | null;
  contact: {
    phone: {
      actionLabel: 'Call' | 'Call or text' | 'Text';
      display: string;
      href: string;
    } | null;
    email: { display: string; href: string } | null;
  } | null;
  policies: Array<{ label: string; text: string }>;
  reviews: {
    ratingText: string;
    reviewCountText: string;
    href: string | null;
  } | null;
  instagram: {
    label: string;
    href: string;
  } | null;
  bio: string | null;
};

const DAY_KEYS = [
  'sunday',
  'monday',
  'tuesday',
  'wednesday',
  'thursday',
  'friday',
  'saturday',
] as const;

const DAY_LABELS: Record<(typeof DAY_KEYS)[number], string> = {
  sunday: 'Sunday',
  monday: 'Monday',
  tuesday: 'Tuesday',
  wednesday: 'Wednesday',
  thursday: 'Thursday',
  friday: 'Friday',
  saturday: 'Saturday',
};

const PRIVATE_QUICK_BOOK_PROFILE_VISIBILITY: QuickBookProfileVisibility = {
  showTechName: false,
  showTechPhoto: false,
  showLocation: false,
  showHours: false,
  showPhone: false,
  showEmail: false,
  showBookingPolicy: false,
  showCancellationPolicy: false,
  showReviews: false,
  showInstagram: false,
  showBio: false,
};

function trimmed(value: string | null | undefined): string | null {
  const result = value?.trim();
  return result || null;
}

function safeHttpsUrl(value: string | null | undefined): string | null {
  const candidate = trimmed(value);
  if (!candidate) {
    return null;
  }

  try {
    const url = new URL(candidate);
    return url.protocol === 'https:' ? url.toString() : null;
  } catch {
    return null;
  }
}

function safeImageUrl(value: string | null | undefined): string | null {
  const candidate = trimmed(value);
  if (!candidate) {
    return null;
  }

  try {
    const url = new URL(candidate);
    return url.protocol === 'https:' || url.protocol === 'http:' ? url.toString() : null;
  } catch {
    // Repository-owned media may use a root-relative public path.
    return candidate.startsWith('/') && !candidate.startsWith('//') ? candidate : null;
  }
}

function formatTime(value: string): string | null {
  const match = /^(\d{1,2}):(\d{2})$/.exec(value.trim());
  if (!match) {
    return null;
  }
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (!Number.isInteger(hours) || hours < 0 || hours > 23 || minutes < 0 || minutes > 59) {
    return null;
  }
  const suffix = hours >= 12 ? 'PM' : 'AM';
  const twelveHour = hours % 12 || 12;
  return `${twelveHour}:${String(minutes).padStart(2, '0')} ${suffix}`;
}

function timeInMinutes(value: string): number | null {
  const match = /^(\d{1,2}):(\d{2})$/.exec(value.trim());
  if (!match) {
    return null;
  }
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  return Number.isInteger(hours)
    && hours >= 0
    && hours <= 23
    && minutes >= 0
    && minutes <= 59
    ? hours * 60 + minutes
    : null;
}

function formatInterval(value: { open: string; close: string } | null | undefined): string | null {
  if (!value) {
    return null;
  }
  const open = formatTime(value.open);
  const close = formatTime(value.close);
  return open && close ? `${open} – ${close}` : null;
}

function validScheduleInterval(
  value: { open: string; close: string } | null | undefined,
): { closesAt: number; closeLabel: string; opensAt: number; openLabel: string } | null {
  if (!value) {
    return null;
  }
  const opensAt = timeInMinutes(value.open);
  const closesAt = timeInMinutes(value.close);
  const openLabel = formatTime(value.open);
  const closeLabel = formatTime(value.close);
  return opensAt !== null
    && closesAt !== null
    && closesAt > opensAt
    && openLabel
    && closeLabel
    ? { closesAt, closeLabel, opensAt, openLabel }
    : null;
}

function resolveHours(
  hours: BusinessHours,
  timeZone: string,
  now: Date,
): QuickBookProfileView['hours'] {
  if (!hours) {
    return null;
  }
  const weekly = DAY_KEYS.map(day => ({
    day: DAY_LABELS[day],
    value: formatInterval(hours[day]) ?? 'Closed',
  }));
  const hasAnyConfiguredDay = DAY_KEYS.some(day => formatInterval(hours[day]) !== null);
  if (!hasAnyConfiguredDay) {
    return null;
  }

  let todayIndex = -1;
  let currentMinute = -1;
  try {
    const parts = new Intl.DateTimeFormat('en-US', {
      hour: '2-digit',
      hourCycle: 'h23',
      minute: '2-digit',
      timeZone,
      weekday: 'long',
    }).formatToParts(now);
    const weekday = parts.find(part => part.type === 'weekday')?.value.toLowerCase();
    const hour = Number(parts.find(part => part.type === 'hour')?.value);
    const minute = Number(parts.find(part => part.type === 'minute')?.value);
    todayIndex = DAY_KEYS.findIndex(day => day === weekday);
    currentMinute = Number.isInteger(hour) && Number.isInteger(minute)
      ? hour * 60 + minute
      : -1;
  } catch {
    todayIndex = -1;
    currentMinute = -1;
  }

  if (todayIndex < 0 || currentMinute < 0) {
    return {
      statusLabel: 'Hours',
      todayLabel: 'See weekly hours',
      weekly,
    };
  }

  const todayKey = DAY_KEYS[todayIndex]!;
  const todayHours = validScheduleInterval(hours[todayKey]);

  if (
    todayHours
    && currentMinute >= todayHours.opensAt
    && currentMinute < todayHours.closesAt
  ) {
    return {
      statusLabel: 'Open now',
      todayLabel: `Until ${todayHours.closeLabel}`,
      weekly,
    };
  }

  const nextOpening = (() => {
    if (todayHours && currentMinute < todayHours.opensAt) {
      return { dayOffset: 0, day: todayKey, openLabel: todayHours.openLabel };
    }
    for (let dayOffset = 1; dayOffset <= DAY_KEYS.length; dayOffset += 1) {
      const day = DAY_KEYS[(todayIndex + dayOffset) % DAY_KEYS.length]!;
      const interval = validScheduleInterval(hours[day]);
      if (interval) {
        return { dayOffset, day, openLabel: interval.openLabel };
      }
    }
    return null;
  })();

  const nextOpeningLabel = (() => {
    if (!nextOpening) {
      return 'See weekly hours';
    }
    if (nextOpening.dayOffset === 0) {
      return `Opens today at ${nextOpening.openLabel}`;
    }
    if (nextOpening.dayOffset === 1) {
      return `Opens tomorrow at ${nextOpening.openLabel}`;
    }
    if (nextOpening.dayOffset === DAY_KEYS.length) {
      return `Opens next ${DAY_LABELS[nextOpening.day]} at ${nextOpening.openLabel}`;
    }
    return `Opens ${DAY_LABELS[nextOpening.day]} at ${nextOpening.openLabel}`;
  })();

  return {
    statusLabel: 'Closed',
    todayLabel: nextOpeningLabel,
    weekly,
  };
}

function resolveEmail(
  value: string | null | undefined,
): NonNullable<QuickBookProfileView['contact']>['email'] {
  const email = trimmed(value);
  if (!email || !/^[^\s@]+@[^\s@][^\s.@]*\.[^\s@]+$/.test(email)) {
    return null;
  }
  return { display: email, href: `mailto:${email}` };
}

function resolveDialablePhone(value: string | null | undefined): {
  dialable: string;
  display: string;
} | null {
  const display = trimmed(value);
  if (!display) {
    return null;
  }
  const dialable = display.replace(/[^\d+]/g, '');
  return /^\+?\d{7,15}$/.test(dialable) ? { dialable, display } : null;
}

function resolvePhoneContact(
  callValue: string | null | undefined,
  preferences: QuickBookPublicContactPreferences | null | undefined,
): NonNullable<QuickBookProfileView['contact']>['phone'] {
  const callPhone = resolveDialablePhone(callValue);

  // Existing salons created before the shared preference was recorded retain
  // the established, conservative tap-to-call behavior. A present preference
  // is authoritative and may intentionally disable both public phone actions.
  if (preferences === undefined || preferences === null) {
    return callPhone
      ? {
          actionLabel: 'Call',
          display: callPhone.display,
          href: `tel:${callPhone.dialable}`,
        }
      : null;
  }

  const textPhone = preferences.textEnabled
    ? resolveDialablePhone(preferences.textNumber)
    : null;
  if (preferences.callEnabled && callPhone) {
    return {
      actionLabel: textPhone?.dialable === callPhone.dialable
        ? 'Call or text'
        : 'Call',
      display: callPhone.display,
      href: `tel:${callPhone.dialable}`,
    };
  }

  return textPhone
    ? {
        actionLabel: 'Text',
        display: textPhone.display,
        href: `sms:${textPhone.dialable}`,
      }
    : null;
}

function truncateBio(value: string | null | undefined): string | null {
  const bio = trimmed(value);
  if (!bio || bio.length <= 180) {
    return bio;
  }
  const candidate = bio.slice(0, 177);
  const lastSpace = candidate.lastIndexOf(' ');
  return `${candidate.slice(0, lastSpace > 130 ? lastSpace : candidate.length).trimEnd()}…`;
}

function resolveInstagram(value: string | null | undefined): QuickBookProfileView['instagram'] {
  const href = safeHttpsUrl(value);
  if (!href) {
    return null;
  }
  const parsed = new URL(href);
  if (!/(?:^|\.)instagram\.com$/i.test(parsed.hostname)) {
    return null;
  }
  const username = parsed.pathname.split('/').filter(Boolean)[0] ?? '';
  return username
    ? { label: `@${username}`, href }
    : { label: 'Check out my work', href };
}

function resolvePolicyRows(
  bookingExperience: BookingExperience,
  visibility: QuickBookProfileVisibility,
): QuickBookProfileView['policies'] {
  const rows: QuickBookProfileView['policies'] = [];
  const fullPolicy = bookingExperience.policy.enabled
    ? trimmed(bookingExperience.policy.text)
    : null;
  if (visibility.showBookingPolicy) {
    const appointmentOnly = bookingExperience.quickFacts.appointmentOnly;
    const depositNotice = bookingExperience.quickFacts.depositNotice;
    if (appointmentOnly.enabled && trimmed(appointmentOnly.label)) {
      rows.push({ label: 'Booking', text: appointmentOnly.label!.trim() });
    }
    // The canonical full policy normally contains the deposit terms. Avoid
    // repeating the compact amount label when that policy is shown too.
    if (
      (!visibility.showCancellationPolicy || !fullPolicy)
      && depositNotice.enabled
      && trimmed(depositNotice.label)
    ) {
      rows.push({ label: 'Deposit', text: depositNotice.label!.trim() });
    }
  }
  if (visibility.showCancellationPolicy) {
    const cancellation = bookingExperience.quickFacts.cancellationNotice;
    if (fullPolicy) {
      rows.push({
        label: trimmed(bookingExperience.policy.title) ?? 'Deposits & cancellations',
        text: fullPolicy,
      });
    } else if (cancellation.enabled && trimmed(cancellation.label)) {
      rows.push({ label: 'Cancellation', text: cancellation.label!.trim() });
    }
  }
  return rows;
}

/**
 * Builds the only client-visible Quick Book profile payload. The source rows
 * stay server-side; disabled fields are omitted from this projection rather
 * than serialized and cosmetically hidden in the browser.
 */
export function resolvePublicQuickBookProfile(source: QuickBookProfileSource): QuickBookProfileView {
  const visibility: QuickBookProfileVisibility = {
    ...PRIVATE_QUICK_BOOK_PROFILE_VISIBILITY,
    ...(source.visibility ?? {}),
  };
  const primaryLocation = source.locations.find(location => location.isPrimary)
    ?? source.locations[0]
    ?? null;
  const locationDisplayMode = source.locationDisplayMode;
  const locationSource = primaryLocation
    ? applyLocationDisplayMode({
      address: primaryLocation.address,
      city: primaryLocation.city,
      state: primaryLocation.state,
      zipCode: primaryLocation.zipCode,
      phone: primaryLocation.phone,
    }, locationDisplayMode)
    : applyLocationDisplayMode({
      address: source.salon.address,
      city: source.salon.city,
      state: source.salon.state,
      zipCode: source.salon.zipCode,
      phone: source.salon.phone,
    }, locationDisplayMode);
  const soleTechnician = source.technicians.length === 1 ? source.technicians[0] ?? null : null;
  const logoUrl = safeImageUrl(source.salon.logoUrl);
  const technicianPhotoUrl = visibility.showTechPhoto && soleTechnician
    ? safeImageUrl(soleTechnician.imageUrl)
    : null;

  const addressLine = trimmed(locationSource.address);
  const localityLine = [
    trimmed(locationSource.city),
    [trimmed(locationSource.state), trimmed(locationSource.zipCode)].filter(Boolean).join(' '),
  ].filter(Boolean).join(', ') || null;
  const directionsQuery = [addressLine, localityLine].filter(Boolean).join(', ');
  const location = visibility.showLocation && directionsQuery
    ? {
        name: (() => {
          const candidate = trimmed(primaryLocation?.name);
          if (
            !candidate
            || candidate.localeCompare(source.salon.name, undefined, { sensitivity: 'accent' }) === 0
            || /^primary location$/iu.test(candidate)
          ) {
            return null;
          }
          return candidate;
        })(),
        addressLine,
        localityLine,
        directionsUrl: `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(directionsQuery)}`,
        instructionLines: resolvePublicLocationInstructions(source.sharedProfile, {
          addressIsPublic: isExactAddressPublic(locationDisplayMode),
          parkingInstructions: source.parkingInstructions,
        }),
      }
    : null;

  const hoursSource = primaryLocation?.businessHours ?? source.salon.businessHours;
  const hours = visibility.showHours
    ? resolveHours(hoursSource, source.timeZone, source.now ?? new Date())
    : null;

  const phoneSource = primaryLocation?.phone ?? source.salon.phone;
  const emailSource = primaryLocation?.email ?? source.salon.email;
  const publicContactAllowed = source.sharedProfile.bookingOnlyContact !== true;
  const phone = publicContactAllowed && visibility.showPhone
    ? resolvePhoneContact(phoneSource, source.publicContactPreferences)
    : null;
  const email = publicContactAllowed && visibility.showEmail
    ? resolveEmail(emailSource)
    : null;

  const rating = soleTechnician
    ? getPublicTechnicianRatingDisplay({
      rating: soleTechnician.rating,
      reviewCount: soleTechnician.reviewCount,
    })
    : null;
  const reviewHref = safeHttpsUrl(source.reviewUrl);

  return {
    identity: {
      salonName: trimmed(source.salon.name) ?? '',
      logoUrl,
      technicianName: visibility.showTechName ? trimmed(soleTechnician?.name) : null,
      // A shared URL is evidence of a historic role cross-fallback. Prefer the
      // canonical logo in the brand slot and omit the duplicate portrait.
      technicianPhotoUrl: technicianPhotoUrl && technicianPhotoUrl !== logoUrl
        ? technicianPhotoUrl
        : null,
    },
    location,
    hours,
    contact: phone || email ? { phone, email } : null,
    policies: resolvePolicyRows(source.bookingExperience, visibility),
    reviews: visibility.showReviews && rating?.kind === 'rated'
      ? {
          ratingText: rating.ratingText,
          reviewCountText: rating.reviewCountText,
          href: reviewHref,
        }
      : null,
    instagram: visibility.showInstagram
      ? resolveInstagram(source.bookingExperience.socialLinks.instagram)
      : null,
    bio: visibility.showBio
      ? truncateBio(source.bio)
      : null,
  };
}
