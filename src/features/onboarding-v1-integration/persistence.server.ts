import 'server-only';

import { and, eq, inArray, isNotNull, isNull, ne, or, sql } from 'drizzle-orm';

import { formatPhoneE164 } from '@/libs/adminAuth';
import {
  BOOKING_EXPERIENCE_LIMITS,
  bookingExperienceUpdateSchema,
  resolveBookingExperience,
} from '@/libs/bookingExperience';
import {
  type BookingPageConfigTransaction,
  updateBookingPageDraftInTransaction,
} from '@/libs/bookingPageConfig';
import {
  bookingPageContentPatchSchema,
  type BookingPageContentTransaction,
  updateBookingPageContentDraftInTransaction,
} from '@/libs/bookingPageContent';
import { type DatabaseSessionHandle, db } from '@/libs/DB';
import { hashOpaqueToken } from '@/libs/lusterSecurity';
import { seedStarterMenuForSalon } from '@/libs/starterMenu';
import { isReservedSalonSlug, isValidSalonSlug, normalizeSalonSlug } from '@/libs/tenantSlug';
import {
  addOnSchema,
  adminSalonMembershipSchema,
  adminUserSchema,
  onboardingDraftClaimSchema,
  onboardingSiteMediaSchema,
  onboardingSiteRevisionSchema,
  onboardingSiteSchema,
  salonLocationSchema,
  salonRetentionSettingsSchema,
  salonSchema,
  serviceSchema,
  technicianSchema,
  technicianServicesSchema,
} from '@/models/Schema';

import {
  CANONICAL_SERVICES,
  MOCK_ADD_ONS,
} from '../../../prototypes/site-builder-v2-booking-integration-lab/src/booking/data';
import {
  ADD_ON_PRODUCTION_MAPPINGS,
  SERVICE_MENU_PRODUCTION_MAPPINGS,
} from '../../../prototypes/site-builder-v2-booking-integration-lab/src/onboarding/integrations/contracts/service-menu-production-mapping';
import { resolveInstagramUsername } from '../../../prototypes/site-builder-v2-booking-integration-lab/src/onboarding/model/contact';
import {
  getDepositsAndCancellationsDisplayWording,
} from '../../../prototypes/site-builder-v2-booking-integration-lab/src/onboarding/model/policies';
import {
  compileOnboardingToSiteDocument,
  fingerprintOnboardingValue,
  resolveProductionServiceSelection,
} from './compiler';
import type {
  OnboardingClaimConflict,
  OnboardingClaimSuccess,
  OnboardingDraftClaimRequest,
  OnboardingPersistedSnapshot,
  OnboardingPlanIntentRequest,
} from './contracts';
import { fingerprintOnboardingPayload } from './payload-fingerprint';

export type AuthenticatedOnboardingIdentity = {
  clerkUserId: string;
  email: string;
  name: string | null;
  phoneE164: string | null;
};

export type OnboardingClaimResult =
  | { kind: 'conflict'; conflict: OnboardingClaimConflict }
  | { kind: 'success'; data: OnboardingClaimSuccess };

export class OnboardingPersistenceError extends Error {
  readonly code: string;
  readonly status: number;

  constructor(code: string, message: string, status = 400) {
    super(message);
    this.code = code;
    this.name = 'OnboardingPersistenceError';
    this.status = status;
  }
}

const globalClaimLocks = globalThis as typeof globalThis & {
  onboardingV1ClaimLocks?: Map<string, Promise<void>>;
};
globalClaimLocks.onboardingV1ClaimLocks ??= new Map();

async function withClaimTokenLock<Value>(
  tokenHash: string,
  operation: () => Promise<Value>,
): Promise<Value> {
  const locks = globalClaimLocks.onboardingV1ClaimLocks!;
  const previous = locks.get(tokenHash) ?? Promise.resolve();
  let release: () => void = () => undefined;
  const current = new Promise<void>((resolve) => {
    release = resolve;
  });
  const queued = previous.then(() => current);
  locks.set(tokenHash, queued);
  await previous;
  try {
    return await operation();
  } finally {
    release();
    if (locks.get(tokenHash) === queued) {
      locks.delete(tokenHash);
    }
  }
}

function uniqueConstraint(error: unknown): string | null {
  let current: unknown = error;
  for (let depth = 0; depth < 5 && current && typeof current === 'object'; depth += 1) {
    const candidate = current as { cause?: unknown; code?: unknown; constraint?: unknown };
    if (candidate.code === '23505') {
      return typeof candidate.constraint === 'string' ? candidate.constraint : '';
    }
    current = candidate.cause;
  }
  return null;
}

type QueryDatabase = DatabaseSessionHandle;
type IdentityAdmin = { id: string; clerkUserId: string | null; email: string | null };

const WEEKDAYS = [
  'monday',
  'tuesday',
  'wednesday',
  'thursday',
  'friday',
  'saturday',
  'sunday',
] as const;

/**
 * Canonical salon contact data is independent from every public presentation
 * decision. `bookingOnlyContact`, the call/text preferences, and Quick Book's
 * visibility switches decide whether a renderer may expose this number; they
 * must never erase the value the owner entered into the shared profile.
 */
function canonicalSalonPhone(snapshot: OnboardingPersistedSnapshot): string | null {
  try {
    return formatPhoneE164(snapshot.profile.clientContact.primaryNumber);
  } catch {
    return null;
  }
}

function canonicalSalonEmail(snapshot: OnboardingPersistedSnapshot): string | null {
  const email = snapshot.profile.email.trim();
  return email || null;
}

function identityPhone(
  identity: AuthenticatedOnboardingIdentity,
  snapshot: OnboardingPersistedSnapshot,
): string | null {
  if (identity.phoneE164) {
    return identity.phoneE164;
  }
  try {
    return formatPhoneE164(snapshot.profile.clientContact.primaryNumber);
  } catch {
    return null;
  }
}

function businessHours(snapshot: OnboardingPersistedSnapshot) {
  return Object.fromEntries(WEEKDAYS.map((day) => {
    const value = snapshot.profile.hours.days[day];
    return [
      day,
      snapshot.profile.hours.setupState === 'configured'
      && !value.closed
      && value.open
      && value.close
        ? { open: value.open, close: value.close }
        : null,
    ];
  })) as {
    monday: { open: string; close: string } | null;
    tuesday: { open: string; close: string } | null;
    wednesday: { open: string; close: string } | null;
    thursday: { open: string; close: string } | null;
    friday: { open: string; close: string } | null;
    saturday: { open: string; close: string } | null;
    sunday: { open: string; close: string } | null;
  };
}

function technicianHours(snapshot: OnboardingPersistedSnapshot) {
  const hours = businessHours(snapshot);
  return Object.fromEntries(WEEKDAYS.map(day => [
    day,
    hours[day] ? { start: hours[day].open, end: hours[day].close } : null,
  ]));
}

function normalizedInstagram(username: string): string | null {
  const resolution = resolveInstagramUsername(username);
  return resolution.status === 'resolved'
    ? `https://www.instagram.com/${resolution.username}/`
    : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function appointmentModeLabel(
  snapshot: OnboardingPersistedSnapshot,
): string | null {
  switch (snapshot.profile.bookingPreferences.visitMode) {
    case 'appointment_only': return 'Appointment only';
    case 'walk_ins_only': return 'Walk-ins accepted';
    case 'appointments_and_walk_ins': return 'Appointments and walk-ins';
    default: return null;
  }
}

function depositLabel(snapshot: OnboardingPersistedSnapshot): string | null {
  const { deposits } = snapshot.profile.policies;
  if (deposits.mode === 'none') {
    return 'No deposit required';
  }
  if (deposits.amountCents === null) {
    return null;
  }
  const amount = new Intl.NumberFormat('en-CA', {
    currency: 'CAD',
    currencyDisplay: 'narrowSymbol',
    maximumFractionDigits: deposits.amountCents % 100 === 0 ? 0 : 2,
    minimumFractionDigits: deposits.amountCents % 100 === 0 ? 0 : 2,
    style: 'currency',
  }).format(deposits.amountCents / 100);
  return `${amount} deposit required`;
}

function cancellationNoticeLabel(
  snapshot: OnboardingPersistedSnapshot,
): string | null {
  const { cancellations } = snapshot.profile.policies;
  const label = (() => {
    switch (cancellations.notice) {
      case 'same_day': return 'Cancel before appointment day';
      case '12_hours': return '12 hours’ cancellation notice';
      case '24_hours': return '24 hours’ cancellation notice';
      case '48_hours': return '48 hours’ cancellation notice';
      case '72_hours': return '72 hours’ cancellation notice';
      case 'custom': return cancellations.customNotice.trim();
      default: return '';
    }
  })();
  return label && Array.from(label).length <= BOOKING_EXPERIENCE_LIMITS.quickFactLabel
    ? label
    : null;
}

function onboardingPolicyText(
  snapshot: OnboardingPersistedSnapshot,
): string | null {
  if (!snapshot.site.policiesEnabled) {
    return null;
  }
  const wording = getDepositsAndCancellationsDisplayWording(
    snapshot.profile.policies,
  ).trim();
  return wording
    && Array.from(wording).length <= BOOKING_EXPERIENCE_LIMITS.policyText
    ? wording
    : null;
}

/**
 * Maps onboarding's shared profile values into the same canonical authorities
 * the real public booking route resolves. Quick Book visibility remains in
 * bookingPage.draft; no template-owned copy of Instagram, policy text, or
 * directions is created here.
 */
async function syncSharedSalonProfileContent(input: {
  database: QueryDatabase;
  salonId: string;
  snapshot: OnboardingPersistedSnapshot;
}): Promise<void> {
  const { database, salonId, snapshot } = input;
  const [salon] = await database
    .select({ settings: salonSchema.settings })
    .from(salonSchema)
    .where(eq(salonSchema.id, salonId))
    .for('update')
    .limit(1);
  if (!salon) {
    throw new OnboardingPersistenceError(
      'BUSINESS_PROFILE_SAVE_FAILED',
      'The salon profile could not be saved.',
      500,
    );
  }

  const currentSettings = isRecord(salon.settings)
    ? salon.settings
    : {};
  const currentBookingExperience = resolveBookingExperience(
    salon.settings,
    { includeAcknowledgmentConfiguration: true },
  );
  const policyText = onboardingPolicyText(snapshot);
  const appointmentLabel = appointmentModeLabel(snapshot);
  const resolvedDepositLabel = depositLabel(snapshot);
  const cancellationLabel = snapshot.site.policiesEnabled
    && snapshot.profile.policies.copy.cancellations.visible
    ? cancellationNoticeLabel(snapshot)
    : null;
  const instagram = normalizedInstagram(snapshot.profile.instagram);
  const policyChanged = policyText !== currentBookingExperience.policy.text;
  const candidate = bookingExperienceUpdateSchema.parse({
    bookingMessage: currentBookingExperience.bookingMessage,
    confirmationMessage: currentBookingExperience.confirmationMessage,
    policy: {
      acknowledgment: policyChanged
        ? { required: false, text: null }
        : currentBookingExperience.policy.acknowledgment,
      enabled: policyText !== null,
      showAfterConfirmation: currentBookingExperience.policy.showAfterConfirmation,
      showBeforeConfirmation: currentBookingExperience.policy.showBeforeConfirmation,
      showInConfirmationEmail: currentBookingExperience.policy.showInConfirmationEmail,
      showOnServicePage: true,
      text: policyText,
      title: policyText ? 'Deposits & cancellations' : null,
    },
    primaryColor: currentBookingExperience.primaryColor,
    quickFacts: {
      appointmentOnly: {
        enabled: appointmentLabel !== null,
        label: appointmentLabel,
      },
      cancellationNotice: {
        enabled: cancellationLabel !== null,
        label: cancellationLabel,
      },
      depositNotice: {
        enabled: resolvedDepositLabel !== null,
        label: resolvedDepositLabel,
      },
    },
    socialLinks: {
      ...currentBookingExperience.socialLinks,
      instagram,
    },
  });

  const rawBookingExperience = isRecord(currentSettings.bookingExperience)
    ? currentSettings.bookingExperience
    : {};
  const rawBooking = isRecord(currentSettings.booking)
    ? currentSettings.booking
    : {};
  const rawPolicy = isRecord(rawBookingExperience.policy)
    ? rawBookingExperience.policy
    : {};
  const rawQuickFacts = isRecord(rawBookingExperience.quickFacts)
    ? rawBookingExperience.quickFacts
    : {};
  const rawSocialLinks = isRecord(rawBookingExperience.socialLinks)
    ? rawBookingExperience.socialLinks
    : {};
  const rawSharedProfile: Record<string, unknown> = isRecord(currentSettings.sharedProfile)
    ? currentSettings.sharedProfile
    : {};
  const {
    addressVisibility: _legacyAddressVisibility,
    parkingInstructions: _legacyParkingInstructions,
    ...retainedSharedProfile
  } = rawSharedProfile;
  const textNumber = snapshot.profile.clientContact.textEnabled
    ? snapshot.profile.clientContact.useDifferentTextNumber
      ? snapshot.profile.clientContact.differentTextNumber.trim() || null
      : snapshot.profile.clientContact.primaryNumber.trim() || null
    : null;

  await database.update(salonSchema).set({
    settings: {
      ...currentSettings,
      booking: {
        ...rawBooking,
        minimumNoticeMinutes: snapshot.profile.bookingPreferences.minimumNoticeMinutes,
        timezone: snapshot.profile.timeZone,
      },
      bookingExperience: {
        ...rawBookingExperience,
        ...candidate,
        policy: {
          ...rawPolicy,
          ...candidate.policy,
        },
        quickFacts: { ...rawQuickFacts, ...candidate.quickFacts },
        socialLinks: { ...rawSocialLinks, ...candidate.socialLinks },
      },
      sharedProfile: {
        ...retainedSharedProfile,
        bookingOnlyContact: snapshot.profile.bookingOnlyContact,
        businessType: snapshot.profile.businessType,
        callEnabled: snapshot.profile.clientContact.callEnabled,
        entranceInstructions: snapshot.profile.location.entranceInstructions.trim() || null,
        textEnabled: snapshot.profile.clientContact.textEnabled,
        textNumber,
        transitInformation: snapshot.profile.location.transitInformation.trim() || null,
      },
    },
  }).where(eq(salonSchema.id, salonId));

  await database.insert(salonRetentionSettingsSchema).values({
    salonId,
    parkingInstructions: snapshot.profile.location.parking.trim() || null,
  }).onConflictDoUpdate({
    target: salonRetentionSettingsSchema.salonId,
    set: {
      parkingInstructions: snapshot.profile.location.parking.trim() || null,
      updatedAt: new Date(),
    },
  });
}

/**
 * Claims Quick Book's presentation-only visibility into the existing owner
 * booking-page draft. The shared values themselves continue to be persisted
 * by createBusiness/syncExistingBusinessProfile; this helper never copies
 * profile content into template-owned storage and never touches the live side.
 *
 * Both helpers below write only the draft side. An existing published site
 * therefore remains unchanged until the owner explicitly publishes this new
 * configuration, while a claimed replacement/new draft still retains the
 * choices the owner just made.
 */
async function syncQuickBookProfilePresentationDraft(input: {
  database: QueryDatabase;
  salonId: string;
  snapshot: OnboardingPersistedSnapshot;
}): Promise<void> {
  const { database, salonId, snapshot } = input;
  const bookingSection = snapshot.site.builderDocument?.pages
    .flatMap(page => page.sections)
    .find(section => section.sectionType === 'booking');
  const serviceMenuLayout = bookingSection?.sectionType === 'booking'
    ? bookingSection.settings.layout
    : null;
  await updateBookingPageDraftInTransaction(
    database as BookingPageConfigTransaction,
    salonId,
    {
      quickBookLayout: snapshot.site.quickBookLayout,
      quickBookProfile: snapshot.site.quickBookProfile,
      sitePalettePreset: snapshot.site.palettePresetId,
      siteStylePreset: snapshot.site.stylePresetId,
      ...(serviceMenuLayout ? { serviceMenuLayout } : {}),
    },
  );
  await updateBookingPageContentDraftInTransaction(
    database as BookingPageContentTransaction,
    salonId,
    bookingPageContentPatchSchema.parse({
      bio: snapshot.profile.about.shortBio.trim() || null,
      locationDisplayMode: snapshot.profile.location.addressVisibility === 'public'
        ? 'full_address'
        : 'city_only',
    }),
  );
}

function baseSlug(businessName: string): string {
  const candidate = businessName
    .normalize('NFKD')
    .replace(/[\u0300-\u036F]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 38);
  if (!candidate || isReservedSalonSlug(candidate) || !isValidSalonSlug(candidate)) {
    return 'luster-studio';
  }
  return candidate;
}

async function salonSlugForSnapshot(
  database: QueryDatabase,
  snapshot: OnboardingPersistedSnapshot,
): Promise<string> {
  // Suggested URLs are the owner's choice too. Never silently rename one
  // after the owner has previewed it, including concurrent first-time claims.
  const requestedSlug = normalizeSalonSlug(snapshot.profile.siteSlug
    || (snapshot.profile.siteSlugCustomized ? '' : baseSlug(snapshot.profile.businessName)));
  if (!requestedSlug || !isValidSalonSlug(requestedSlug)) {
    throw new OnboardingPersistenceError(
      'SITE_SLUG_INVALID',
      'Choose a valid Luster URL before saving your site.',
      400,
    );
  }
  const [existing] = await database
    .select({ id: salonSchema.id })
    .from(salonSchema)
    .where(eq(salonSchema.slug, requestedSlug))
    .limit(1);
  if (existing) {
    throw new OnboardingPersistenceError(
      'SITE_SLUG_UNAVAILABLE',
      'That Luster URL is no longer available. Choose another URL and try again.',
      409,
    );
  }
  return requestedSlug;
}

async function resolveIdentityAdmin(
  database: QueryDatabase,
  identity: AuthenticatedOnboardingIdentity,
): Promise<IdentityAdmin | null> {
  const normalizedEmail = identity.email.trim().toLowerCase();
  const owners = await database
    .select({
      clerkUserId: adminUserSchema.clerkUserId,
      email: adminUserSchema.email,
      id: adminUserSchema.id,
    })
    .from(adminUserSchema)
    .where(or(
      eq(adminUserSchema.clerkUserId, identity.clerkUserId),
      sql`lower(${adminUserSchema.email}) = ${normalizedEmail}`,
    ))
    .limit(2);
  const clerkOwner = owners.find(owner => owner.clerkUserId === identity.clerkUserId);
  const emailOwner = owners.find(owner => owner.email?.trim().toLowerCase() === normalizedEmail);
  if (clerkOwner && emailOwner && clerkOwner.id !== emailOwner.id) {
    throw new OnboardingPersistenceError(
      'OWNER_ACCOUNT_CONFLICT',
      'This verified email is already connected to a different owner account.',
      409,
    );
  }
  const owner = clerkOwner ?? emailOwner ?? null;
  if (owner?.clerkUserId && owner.clerkUserId !== identity.clerkUserId) {
    throw new OnboardingPersistenceError(
      'OWNER_ACCOUNT_CONFLICT',
      'Sign in with the Luster account already connected to this email.',
      409,
    );
  }
  return owner;
}

async function ensureIdentityAdmin(
  database: QueryDatabase,
  identity: AuthenticatedOnboardingIdentity,
  snapshot: OnboardingPersistedSnapshot,
): Promise<IdentityAdmin> {
  const existing = await resolveIdentityAdmin(database, identity);
  if (existing) {
    if (!existing.clerkUserId) {
      const [linked] = await database
        .update(adminUserSchema)
        .set({
          clerkUserId: identity.clerkUserId,
          emailVerifiedAt: new Date(),
          updatedAt: new Date(),
        })
        .where(and(
          eq(adminUserSchema.id, existing.id),
          sql`${adminUserSchema.clerkUserId} IS NULL`,
        ))
        .returning();
      if (!linked) {
        throw new OnboardingPersistenceError(
          'OWNER_ACCOUNT_CONFLICT',
          'This owner account changed while the site was being saved.',
          409,
        );
      }
      return linked;
    }
    return existing;
  }

  const [created] = await database
    .insert(adminUserSchema)
    .values({
      clerkUserId: identity.clerkUserId,
      email: identity.email.trim().toLowerCase(),
      emailVerifiedAt: new Date(),
      id: crypto.randomUUID(),
      name: identity.name?.trim() || snapshot.profile.ownerName,
      // `admin_user.phone_e164` is a legacy authentication identifier. Never
      // promote an owner-entered salon/contact number into that identity
      // boundary; only Clerk-verified account data may populate it.
      phoneE164: identity.phoneE164,
    })
    .returning();
  if (!created) {
    throw new OnboardingPersistenceError('OWNER_CREATE_FAILED', 'The Luster owner account could not be created.', 500);
  }
  return created;
}

async function membershipsForAdmin(database: QueryDatabase, adminId: string) {
  return database
    .select({
      id: salonSchema.id,
      name: salonSchema.name,
      publicationStatus: salonSchema.publicationStatus,
      slug: salonSchema.slug,
    })
    .from(adminSalonMembershipSchema)
    .innerJoin(salonSchema, eq(adminSalonMembershipSchema.salonId, salonSchema.id))
    .where(and(
      eq(adminSalonMembershipSchema.adminId, adminId),
      eq(adminSalonMembershipSchema.role, 'owner'),
      sql`${salonSchema.deletedAt} IS NULL`,
    ));
}

async function currentSitesBySalon(database: QueryDatabase, salonIds: string[]) {
  if (salonIds.length === 0) {
    return [];
  }
  return database
    .select({
      currentRevision: onboardingSiteSchema.currentRevision,
      id: onboardingSiteSchema.id,
      salonId: onboardingSiteSchema.salonId,
      status: onboardingSiteSchema.status,
    })
    .from(onboardingSiteSchema)
    .where(and(
      inArray(onboardingSiteSchema.salonId, salonIds),
      eq(onboardingSiteSchema.isCurrent, true),
    ));
}

async function businessTargetConflict(
  database: QueryDatabase,
  memberships: Awaited<ReturnType<typeof membershipsForAdmin>>,
): Promise<OnboardingClaimConflict> {
  const sites = await currentSitesBySalon(database, memberships.map(item => item.id));
  const siteSalonIds = new Set(sites.map(item => item.salonId));
  return {
    businesses: memberships.map(item => ({
      hasSite: siteSalonIds.has(item.id) || item.publicationStatus === 'published',
      id: item.id,
      name: item.name,
      slug: item.slug,
    })),
    code: 'BUSINESS_TARGET_REQUIRED',
  };
}

async function createBusiness(
  database: QueryDatabase,
  admin: IdentityAdmin,
  identity: AuthenticatedOnboardingIdentity,
  snapshot: OnboardingPersistedSnapshot,
): Promise<{ salonId: string; salonSlug: string; technicianId: string }> {
  const salonId = crypto.randomUUID();
  const salonSlug = await salonSlugForSnapshot(database, snapshot);
  const locationId = crypto.randomUUID();
  const technicianId = crypto.randomUUID();
  const phone = canonicalSalonPhone(snapshot);
  const email = canonicalSalonEmail(snapshot);
  const hours = businessHours(snapshot);
  const publicAddress = snapshot.profile.location.addressVisibility === 'public'
    ? snapshot.profile.location.exactAddress || null
    : null;
  const ownerPhone = identityPhone(identity, snapshot);

  await database.insert(salonSchema).values({
    address: publicAddress,
    businessHours: hours,
    city: snapshot.profile.location.cityOrArea || null,
    email,
    id: salonId,
    isActive: true,
    name: snapshot.profile.businessName,
    onboardingCompletedAt: new Date(),
    onlineBookingEnabled: true,
    ownerClerkUserId: identity.clerkUserId,
    ownerEmail: identity.email.trim().toLowerCase(),
    ownerName: snapshot.profile.ownerName,
    ownerPhone,
    phone,
    publicationStatus: 'draft',
    publishedAt: null,
    slug: salonSlug,
    slugLockedAt: null,
    status: 'active',
  });
  await database.insert(adminSalonMembershipSchema).values({
    adminId: admin.id,
    role: 'owner',
    salonId,
  });
  await database.insert(salonLocationSchema).values({
    address: snapshot.profile.location.exactAddress || null,
    businessHours: hours,
    city: snapshot.profile.location.cityOrArea || null,
    email,
    id: locationId,
    isActive: true,
    isPrimary: true,
    name: 'Primary location',
    phone,
    salonId,
  });
  await database.insert(technicianSchema).values({
    acceptingNewClients: snapshot.profile.bookingPreferences.newClientStatus === 'yes',
    bio: snapshot.profile.about.fullBio || snapshot.profile.about.shortBio || null,
    email: identity.email.trim().toLowerCase(),
    id: technicianId,
    isActive: true,
    languages: snapshot.profile.about.languages,
    name: snapshot.profile.ownerName,
    onboardingStatus: 'completed',
    phone: ownerPhone,
    primaryLocationId: locationId,
    salonId,
    specialties: snapshot.profile.about.specialties,
    weeklySchedule: technicianHours(snapshot),
  });
  return { salonId, salonSlug, technicianId };
}

/**
 * Once an owner explicitly selects an existing business, the accepted shared
 * Business Profile is mapped back into that tenant's canonical Product rows.
 * Privacy decisions remain authoritative: the salon's public address stays
 * null unless the owner chose public, while the tenant-scoped location keeps
 * the exact address for later authenticated use.
 */
async function syncExistingBusinessProfile(input: {
  database: QueryDatabase;
  identity: AuthenticatedOnboardingIdentity;
  salonId: string;
  snapshot: OnboardingPersistedSnapshot;
}): Promise<string | null> {
  const { database, identity, salonId, snapshot } = input;
  const phone = canonicalSalonPhone(snapshot);
  const email = canonicalSalonEmail(snapshot);
  const hours = businessHours(snapshot);
  const exactAddress = snapshot.profile.location.exactAddress || null;
  const publicAddress = snapshot.profile.location.addressVisibility === 'public'
    ? exactAddress
    : null;
  const ownerPhone = identityPhone(identity, snapshot);
  await database.update(salonSchema).set({
    address: publicAddress,
    businessHours: hours,
    city: snapshot.profile.location.cityOrArea || null,
    email,
    name: snapshot.profile.businessName,
    onboardingCompletedAt: new Date(),
    onlineBookingEnabled: true,
    ownerClerkUserId: identity.clerkUserId,
    ownerEmail: identity.email.trim().toLowerCase(),
    ownerName: snapshot.profile.ownerName,
    ownerPhone,
    phone,
  }).where(eq(salonSchema.id, salonId));

  const [primaryLocation] = await database.select({ id: salonLocationSchema.id })
    .from(salonLocationSchema)
    .where(and(
      eq(salonLocationSchema.salonId, salonId),
      eq(salonLocationSchema.isPrimary, true),
    ))
    .limit(1);
  const locationId = primaryLocation?.id ?? crypto.randomUUID();
  if (primaryLocation) {
    await database.update(salonLocationSchema).set({
      address: exactAddress,
      businessHours: hours,
      city: snapshot.profile.location.cityOrArea || null,
      email,
      isActive: true,
      phone,
    }).where(and(
      eq(salonLocationSchema.id, primaryLocation.id),
      eq(salonLocationSchema.salonId, salonId),
    ));
  } else {
    await database.insert(salonLocationSchema).values({
      address: exactAddress,
      businessHours: hours,
      city: snapshot.profile.location.cityOrArea || null,
      email,
      id: locationId,
      isActive: true,
      isPrimary: true,
      name: 'Primary location',
      phone,
      salonId,
    });
  }

  const activeTechnicians = await database.select({ id: technicianSchema.id })
    .from(technicianSchema)
    .where(and(
      eq(technicianSchema.salonId, salonId),
      eq(technicianSchema.isActive, true),
    ))
    .limit(2);
  if (snapshot.profile.businessStructure !== 'solo') {
    return activeTechnicians.length === 1 ? activeTechnicians[0]!.id : null;
  }
  const technicianId = activeTechnicians[0]?.id ?? crypto.randomUUID();
  const values = {
    acceptingNewClients: snapshot.profile.bookingPreferences.newClientStatus === 'yes',
    bio: snapshot.profile.about.fullBio || snapshot.profile.about.shortBio || null,
    email: identity.email.trim().toLowerCase(),
    isActive: true,
    languages: snapshot.profile.about.languages,
    name: snapshot.profile.ownerName,
    onboardingStatus: 'completed',
    phone: ownerPhone,
    primaryLocationId: locationId,
    specialties: snapshot.profile.about.specialties,
    weeklySchedule: technicianHours(snapshot),
  };
  if (activeTechnicians.length === 0) {
    await database.insert(technicianSchema).values({
      ...values,
      id: technicianId,
      salonId,
    });
  } else if (activeTechnicians.length === 1) {
    await database.update(technicianSchema).set(values).where(and(
      eq(technicianSchema.id, technicianId),
      eq(technicianSchema.salonId, salonId),
    ));
  } else {
    // Never guess which member of an existing team represents the owner.
    return null;
  }
  return technicianId;
}

/**
 * A replace-draft claim is the one save path where absence can be proven to
 * mean removal: the immediately previous onboarding revision owned an exact
 * role row, while the replacement snapshot no longer references that role.
 * New drafts for existing businesses have no such prior role evidence and
 * therefore never clear pre-existing Product media merely because a field was
 * omitted. Published businesses cannot enter replace_draft, so their live
 * media remains unchanged until the explicit Booking Page Publish lifecycle.
 */
async function clearExplicitlyRemovedDraftIdentityMedia(input: {
  database: QueryDatabase;
  previousRevision: number;
  salonId: string;
  siteId: string;
  snapshot: OnboardingPersistedSnapshot;
  technicianId: string | null;
}): Promise<void> {
  const [previous] = await input.database.select({
    id: onboardingSiteRevisionSchema.id,
    snapshot: onboardingSiteRevisionSchema.snapshot,
  }).from(onboardingSiteRevisionSchema).where(and(
    eq(onboardingSiteRevisionSchema.salonId, input.salonId),
    eq(onboardingSiteRevisionSchema.siteId, input.siteId),
    eq(onboardingSiteRevisionSchema.revision, input.previousRevision),
  )).limit(1);
  if (!previous) {
    return;
  }

  const candidates = [
    {
      currentItemId: input.snapshot.profile.logoItemId,
      previousItemId: previous.snapshot.profile.logoItemId,
      role: 'logo' as const,
    },
    {
      currentItemId: input.snapshot.profile.profilePhotoItemId,
      previousItemId: previous.snapshot.profile.profilePhotoItemId,
      role: 'profile' as const,
    },
  ];
  for (const candidate of candidates) {
    if (candidate.currentItemId !== null || candidate.previousItemId === null) {
      continue;
    }
    const [owned] = await input.database.select({
      claimStatus: onboardingSiteMediaSchema.claimStatus,
      metadata: onboardingSiteMediaSchema.metadata,
    })
      .from(onboardingSiteMediaSchema).where(and(
        eq(onboardingSiteMediaSchema.salonId, input.salonId),
        eq(onboardingSiteMediaSchema.siteId, input.siteId),
        eq(onboardingSiteMediaSchema.revisionId, previous.id),
        eq(onboardingSiteMediaSchema.role, candidate.role),
        eq(onboardingSiteMediaSchema.localItemId, candidate.previousItemId),
      )).limit(1);
    const canonicalPublicUrl = owned?.claimStatus === 'ready'
      && typeof owned.metadata.canonicalPublicUrl === 'string'
      && typeof owned.metadata.canonicalStorageKey === 'string'
      && (
        owned.metadata.canonicalStorageProvider === 'cloudinary'
        || owned.metadata.canonicalStorageProvider === 'development_public'
      )
      ? owned.metadata.canonicalPublicUrl
      : null;
    if (!canonicalPublicUrl) {
      continue;
    }
    if (candidate.role === 'logo') {
      await input.database.update(salonSchema).set({ logoUrl: null })
        .where(and(
          eq(salonSchema.id, input.salonId),
          eq(salonSchema.logoUrl, canonicalPublicUrl),
        ));
    } else if (input.technicianId) {
      await input.database.update(technicianSchema).set({ avatarUrl: null })
        .where(and(
          eq(technicianSchema.id, input.technicianId),
          eq(technicianSchema.salonId, input.salonId),
          eq(technicianSchema.avatarUrl, canonicalPublicUrl),
          eq(technicianSchema.isActive, true),
        ));
    }
  }
}

function onboardingServicePrice(service: (typeof CANONICAL_SERVICES)[number]): {
  price: number;
  priceDisplayText: string | null;
} {
  if (service.price.behavior === 'fixed') {
    return { price: service.price.amountCents, priceDisplayText: null };
  }
  if (service.price.behavior === 'starts_at') {
    return { price: service.price.amountCents, priceDisplayText: `From $${service.price.amountCents / 100}` };
  }
  if (service.price.behavior === 'range') {
    return {
      price: service.price.minCents,
      priceDisplayText: `$${service.price.minCents / 100}–$${service.price.maxCents / 100}`,
    };
  }
  return {
    price: 0,
    priceDisplayText: service.price.behavior === 'free' ? 'Free' : 'Price varies',
  };
}

function onboardingServiceCategories(
  category: (typeof CANONICAL_SERVICES)[number]['category'],
): {
    bookingCategory: 'manicure' | 'pedicure' | 'combo';
    category: 'manicure' | 'builder_gel' | 'extensions' | 'pedicure' | 'combo';
  } {
  if (category === 'pedicure') {
    return { bookingCategory: 'pedicure', category: 'pedicure' };
  }
  if (category === 'combos') {
    return { bookingCategory: 'combo', category: 'combo' };
  }
  if (category === 'builder_gel') {
    return { bookingCategory: 'manicure', category: 'builder_gel' };
  }
  if (category === 'gel_x') {
    return { bookingCategory: 'manicure', category: 'extensions' };
  }
  return { bookingCategory: 'manicure', category: 'manicure' };
}

/**
 * Explicit onboarding selection authorizes a tenant-owned owner service when
 * there is no exact Product template. The canonical Lab record supplies the
 * initial values and its stable source ID is retained; no closest template is
 * silently substituted and no second catalogue is created.
 */
async function ensureOwnerServicesForUnmappedSelection(input: {
  database: QueryDatabase;
  salonId: string;
  snapshot: OnboardingPersistedSnapshot;
  technicianId: string | null;
}): Promise<string[]> {
  const selectedIds = new Set(input.snapshot.profile.serviceMenu.selectedServiceIds);
  const nonExactMappings = SERVICE_MENU_PRODUCTION_MAPPINGS.filter(mapping => (
    selectedIds.has(mapping.labServiceId) && mapping.mappingKind !== 'exact_template'
  ));
  const canonicalById = new Map(CANONICAL_SERVICES.map(service => [service.id, service]));
  const ownerServiceIds: string[] = [];

  for (const mapping of nonExactMappings) {
    const canonical = canonicalById.get(mapping.labServiceId);
    if (!canonical || canonical.category === 'add_ons') {
      continue;
    }
    const [existing] = await input.database.select({
      id: serviceSchema.id,
      isActive: serviceSchema.isActive,
    }).from(serviceSchema).where(and(
      eq(serviceSchema.salonId, input.salonId),
      eq(serviceSchema.onboardingSourceServiceId, canonical.id),
    )).limit(1);
    let serviceId = existing?.id;
    if (existing) {
      if (!existing.isActive) {
        await input.database.update(serviceSchema).set({ isActive: true }).where(and(
          eq(serviceSchema.id, existing.id),
          eq(serviceSchema.salonId, input.salonId),
        ));
      }
    } else {
      const override = input.snapshot.profile.serviceMenu.ownerOverridesByServiceId[canonical.id];
      const price = onboardingServicePrice(canonical);
      const categories = onboardingServiceCategories(canonical.category);
      serviceId = `svc_${input.salonId.replace(/[^a-z0-9]/gi, '_')}_onboarding_${canonical.id.replace(/[^a-z0-9]/gi, '_')}`;
      await input.database.insert(serviceSchema).values({
        bookingCategory: categories.bookingCategory,
        category: categories.category,
        description: canonical.longDescription ?? canonical.shortDescription,
        descriptionItems: canonical.shortDescription ? [canonical.shortDescription] : null,
        durationMinutes: override?.durationMinutes ?? canonical.durationMinutes,
        id: serviceId,
        imageUrl: null,
        isActive: true,
        name: canonical.name,
        onboardingSourceServiceId: canonical.id,
        price: override?.priceCents ?? price.price,
        priceDisplayText: override?.priceCents === undefined ? price.priceDisplayText : null,
        salonId: input.salonId,
        slug: `onboarding-${canonical.id.replace(/^svc-/, '')}`,
        sortOrder: CANONICAL_SERVICES.findIndex(service => service.id === canonical.id) + 1,
        templateKey: null,
      });
    }
    if (!serviceId) {
      continue;
    }
    ownerServiceIds.push(canonical.id);
    if (input.technicianId) {
      await input.database.insert(technicianServicesSchema).values({
        enabled: true,
        priority: CANONICAL_SERVICES.findIndex(service => service.id === canonical.id) + 1,
        serviceId,
        technicianId: input.technicianId,
      }).onConflictDoNothing();
    }
  }
  return ownerServiceIds;
}

type StarterSeedResult = Awaited<ReturnType<typeof seedStarterMenuForSalon>>;

/**
 * Mark only rows created or explicitly revived by this onboarding claim.
 * Existing active Product rows with the same template key remain owner-owned
 * and are never silently adopted by the onboarding updater.
 */
async function markSeededOnboardingMenuRows(input: {
  database: QueryDatabase;
  salonId: string;
  seed: StarterSeedResult;
  snapshot: OnboardingPersistedSnapshot;
}): Promise<void> {
  const selectedServiceIds = new Set(
    input.snapshot.profile.serviceMenu.selectedServiceIds,
  );
  const selectedAddOnIds = new Set(
    input.snapshot.profile.serviceMenu.selectedAddOnIds,
  );
  const serviceSourceIdForTemplate = (templateKey: string | null): string | null => {
    if (!templateKey) {
      return null;
    }
    return SERVICE_MENU_PRODUCTION_MAPPINGS.find(mapping => (
      mapping.mappingKind === 'exact_template'
      && mapping.productionCanonicalId === templateKey
      && selectedServiceIds.has(mapping.labServiceId)
    ))?.labServiceId ?? null;
  };
  const addOnSourceIdForTemplate = (templateKey: string | null): string | null => {
    if (!templateKey) {
      return null;
    }
    return ADD_ON_PRODUCTION_MAPPINGS.find(mapping => (
      mapping.mappingKind === 'exact_template'
      && mapping.productionCanonicalId === templateKey
      && selectedAddOnIds.has(mapping.labServiceId)
    ))?.labServiceId ?? null;
  };

  const seededServiceIds = [
    ...input.seed.createdServiceIds,
    ...input.seed.revivedServiceIds,
  ];
  if (seededServiceIds.length > 0) {
    const rows = await input.database.select({
      id: serviceSchema.id,
      onboardingSourceServiceId: serviceSchema.onboardingSourceServiceId,
      templateKey: serviceSchema.templateKey,
    }).from(serviceSchema).where(and(
      eq(serviceSchema.salonId, input.salonId),
      inArray(serviceSchema.id, seededServiceIds),
    ));
    for (const row of rows) {
      const sourceId = serviceSourceIdForTemplate(row.templateKey);
      if (!sourceId || row.onboardingSourceServiceId) {
        continue;
      }
      await input.database.update(serviceSchema)
        .set({ onboardingSourceServiceId: sourceId })
        .where(and(
          eq(serviceSchema.id, row.id),
          eq(serviceSchema.salonId, input.salonId),
          isNull(serviceSchema.onboardingSourceServiceId),
        ));
    }
  }

  const seededAddOnIds = [
    ...input.seed.createdAddOnIds,
    ...input.seed.revivedAddOnIds,
  ];
  if (seededAddOnIds.length > 0) {
    const rows = await input.database.select({
      id: addOnSchema.id,
      onboardingSourceAddOnId: addOnSchema.onboardingSourceAddOnId,
      templateKey: addOnSchema.templateKey,
    }).from(addOnSchema).where(and(
      eq(addOnSchema.salonId, input.salonId),
      inArray(addOnSchema.id, seededAddOnIds),
    ));
    for (const row of rows) {
      const sourceId = addOnSourceIdForTemplate(row.templateKey);
      if (!sourceId || row.onboardingSourceAddOnId) {
        continue;
      }
      await input.database.update(addOnSchema)
        .set({ onboardingSourceAddOnId: sourceId })
        .where(and(
          eq(addOnSchema.id, row.id),
          eq(addOnSchema.salonId, input.salonId),
          isNull(addOnSchema.onboardingSourceAddOnId),
        ));
    }
  }
}

/**
 * Exact draft-only reconciliation for records that onboarding itself owns.
 * Unrelated Product services/add-ons are deliberately outside this set.
 */
async function reconcileOnboardingOwnedMenu(input: {
  database: QueryDatabase;
  salonId: string;
  snapshot: OnboardingPersistedSnapshot;
  technicianId: string | null;
}): Promise<void> {
  const selectedServiceIds = new Set(
    input.snapshot.profile.serviceMenu.selectedServiceIds,
  );
  const selectedAddOnIds = new Set(
    input.snapshot.profile.serviceMenu.selectedAddOnIds,
  );
  const canonicalServiceById = new Map(
    CANONICAL_SERVICES.map(service => [service.id, service]),
  );
  const canonicalAddOnById = new Map(MOCK_ADD_ONS.map(addOn => [addOn.id, addOn]));
  const selectedServiceMapping = (sourceId: string, templateKey: string | null) => (
    SERVICE_MENU_PRODUCTION_MAPPINGS.find(mapping => (
      selectedServiceIds.has(mapping.labServiceId)
      && mapping.labServiceId === sourceId
    ))
    ?? SERVICE_MENU_PRODUCTION_MAPPINGS.find(mapping => (
      selectedServiceIds.has(mapping.labServiceId)
      && mapping.mappingKind === 'exact_template'
      && templateKey !== null
      && mapping.productionCanonicalId === templateKey
    ))
    ?? null
  );
  const selectedAddOnMapping = (sourceId: string, templateKey: string | null) => (
    ADD_ON_PRODUCTION_MAPPINGS.find(mapping => (
      selectedAddOnIds.has(mapping.labServiceId)
      && mapping.labServiceId === sourceId
    ))
    ?? ADD_ON_PRODUCTION_MAPPINGS.find(mapping => (
      selectedAddOnIds.has(mapping.labServiceId)
      && mapping.mappingKind === 'exact_template'
      && templateKey !== null
      && mapping.productionCanonicalId === templateKey
    ))
    ?? null
  );

  const services = await input.database.select({
    id: serviceSchema.id,
    onboardingSourceServiceId: serviceSchema.onboardingSourceServiceId,
    templateKey: serviceSchema.templateKey,
  }).from(serviceSchema).where(and(
    eq(serviceSchema.salonId, input.salonId),
    isNotNull(serviceSchema.onboardingSourceServiceId),
  ));
  for (const row of services) {
    if (!row.onboardingSourceServiceId) {
      continue;
    }
    const mapping = selectedServiceMapping(row.onboardingSourceServiceId, row.templateKey);
    const canonical = mapping ? canonicalServiceById.get(mapping.labServiceId) : null;
    const selected = Boolean(mapping && canonical);
    const override = mapping
      ? input.snapshot.profile.serviceMenu.ownerOverridesByServiceId[mapping.labServiceId]
      : undefined;
    const price = canonical ? onboardingServicePrice(canonical) : null;
    await input.database.update(serviceSchema).set({
      ...(selected && canonical && price
        ? {
            durationMinutes: override?.durationMinutes ?? canonical.durationMinutes,
            price: override?.priceCents ?? price.price,
            priceDisplayText: override?.priceCents === undefined ? price.priceDisplayText : null,
          }
        : {}),
      isActive: selected,
    }).where(and(
      eq(serviceSchema.id, row.id),
      eq(serviceSchema.salonId, input.salonId),
    ));
    if (selected && input.technicianId) {
      const [assignment] = await input.database.select({
        serviceId: technicianServicesSchema.serviceId,
      }).from(technicianServicesSchema).where(and(
        eq(technicianServicesSchema.serviceId, row.id),
        eq(technicianServicesSchema.technicianId, input.technicianId),
      )).limit(1);
      if (!assignment) {
        await input.database.insert(technicianServicesSchema).values({
          enabled: true,
          priority: 0,
          serviceId: row.id,
          technicianId: input.technicianId,
        });
      }
    }
  }

  const addOns = await input.database.select({
    id: addOnSchema.id,
    onboardingSourceAddOnId: addOnSchema.onboardingSourceAddOnId,
    templateKey: addOnSchema.templateKey,
  }).from(addOnSchema).where(and(
    eq(addOnSchema.salonId, input.salonId),
    isNotNull(addOnSchema.onboardingSourceAddOnId),
  ));
  for (const row of addOns) {
    if (!row.onboardingSourceAddOnId) {
      continue;
    }
    const mapping = selectedAddOnMapping(row.onboardingSourceAddOnId, row.templateKey);
    const canonical = mapping ? canonicalAddOnById.get(mapping.labServiceId) : null;
    const selected = Boolean(mapping && canonical);
    await input.database.update(addOnSchema).set({
      isActive: selected,
    }).where(and(
      eq(addOnSchema.id, row.id),
      eq(addOnSchema.salonId, input.salonId),
    ));
  }
}

async function existingClaimForToken(
  database: QueryDatabase,
  anonymousDraftTokenHash: string,
) {
  const [claim] = await database
    .select()
    .from(onboardingDraftClaimSchema)
    .where(eq(onboardingDraftClaimSchema.anonymousDraftTokenHash, anonymousDraftTokenHash))
    .limit(1);
  return claim ?? null;
}

async function claimSuccess(
  database: QueryDatabase,
  claim: typeof onboardingDraftClaimSchema.$inferSelect,
  created: boolean,
): Promise<OnboardingClaimSuccess> {
  const [[site], [revision], media] = await Promise.all([
    database.select().from(onboardingSiteSchema)
      .where(and(
        eq(onboardingSiteSchema.id, claim.siteId),
        eq(onboardingSiteSchema.salonId, claim.salonId),
      )).limit(1),
    database.select().from(onboardingSiteRevisionSchema)
      .where(and(
        eq(onboardingSiteRevisionSchema.id, claim.revisionId),
        eq(onboardingSiteRevisionSchema.salonId, claim.salonId),
      )).limit(1),
    database.select({ claimStatus: onboardingSiteMediaSchema.claimStatus })
      .from(onboardingSiteMediaSchema)
      .where(and(
        eq(onboardingSiteMediaSchema.siteId, claim.siteId),
        eq(onboardingSiteMediaSchema.revisionId, claim.revisionId),
        eq(onboardingSiteMediaSchema.salonId, claim.salonId),
      )),
  ]);
  const [salon] = await database.select({ slug: salonSchema.slug })
    .from(salonSchema)
    .where(eq(salonSchema.id, claim.salonId))
    .limit(1);
  if (!site || !revision || !salon) {
    throw new OnboardingPersistenceError('CLAIM_INCOMPLETE', 'The saved site record is incomplete.', 500);
  }
  if (!site.isCurrent || site.currentRevision !== revision.revision) {
    throw new OnboardingPersistenceError(
      'CLAIM_REVISION_STALE',
      'This browser saved an older website version. Reload the current saved site before continuing.',
      409,
    );
  }
  const selection = resolveProductionServiceSelection(revision.snapshot);
  const ownerServices = await database.select({
    onboardingSourceServiceId: serviceSchema.onboardingSourceServiceId,
  }).from(serviceSchema).where(and(
    eq(serviceSchema.salonId, claim.salonId),
    sql`${serviceSchema.onboardingSourceServiceId} IS NOT NULL`,
  ));
  const ownerCreatedServiceIds = site.serviceMenuApplied
    ? ownerServices.flatMap(item => (
      item.onboardingSourceServiceId ? [item.onboardingSourceServiceId] : []
    ))
    : [];
  const ownerCreated = new Set(ownerCreatedServiceIds);
  return {
    claimId: claim.id,
    created,
    dashboardUrl: `/admin?salon=${encodeURIComponent(salon.slug)}`,
    media: {
      failed: media.filter(item => item.claimStatus === 'failed').length,
      pending: media.filter(item => item.claimStatus === 'pending' || item.claimStatus === 'uploading').length,
      ready: media.filter(item => item.claimStatus === 'ready').length,
    },
    ownerCreatedServiceIds,
    payloadFingerprint: fingerprintOnboardingPayload(revision.snapshot),
    revision: revision.revision,
    revisionId: revision.id,
    salonId: site.salonId,
    salonSlug: salon.slug,
    serviceMenuApplied: site.serviceMenuApplied,
    serviceMappingIssues: selection.issues.filter(issue => !ownerCreated.has(issue.labServiceId)),
    siteId: site.id,
  };
}

async function assertClaimOwner(
  database: QueryDatabase,
  identity: AuthenticatedOnboardingIdentity,
  claim: typeof onboardingDraftClaimSchema.$inferSelect,
): Promise<void> {
  const admin = await resolveIdentityAdmin(database, identity);
  if (!admin || admin.id !== claim.claimedByAdminId) {
    throw new OnboardingPersistenceError(
      'DRAFT_ALREADY_CLAIMED',
      'This draft has already been saved to a different Luster account.',
      409,
    );
  }
}

async function claimSuccessForSnapshot(
  database: QueryDatabase,
  claim: typeof onboardingDraftClaimSchema.$inferSelect,
  created: boolean,
  snapshot: OnboardingPersistedSnapshot,
): Promise<OnboardingClaimSuccess> {
  const success = await claimSuccess(database, claim, created);
  if (success.payloadFingerprint !== fingerprintOnboardingPayload(snapshot)) {
    throw new OnboardingPersistenceError(
      'DRAFT_CONTENT_CHANGED_AFTER_CLAIM',
      'This setup changed after its first save. Your newer work is still safe on this device.',
      409,
    );
  }
  return success;
}

async function claimOnboardingDraftUnlocked(
  identity: AuthenticatedOnboardingIdentity,
  input: OnboardingDraftClaimRequest,
  database: QueryDatabase = db,
): Promise<OnboardingClaimResult> {
  const anonymousDraftTokenHash = hashOpaqueToken(input.anonymousDraftToken);
  const idempotencyKeyHash = hashOpaqueToken(input.idempotencyKey);
  const existing = await existingClaimForToken(database, anonymousDraftTokenHash);
  if (existing) {
    await assertClaimOwner(database, identity, existing);
    return {
      kind: 'success',
      data: await claimSuccessForSnapshot(database, existing, false, input.snapshot),
    };
  }

  const result = await database.transaction(async (tx) => {
    await tx.execute(sql`
      select id from ${onboardingDraftClaimSchema}
      where ${onboardingDraftClaimSchema.anonymousDraftTokenHash} = ${anonymousDraftTokenHash}
      for update
    `);
    const lockedExisting = await existingClaimForToken(tx as QueryDatabase, anonymousDraftTokenHash);
    if (lockedExisting) {
      await assertClaimOwner(tx as QueryDatabase, identity, lockedExisting);
      return { kind: 'existing' as const, claim: lockedExisting };
    }

    const existingAdmin = await resolveIdentityAdmin(tx as QueryDatabase, identity);
    const existingMemberships = existingAdmin
      ? await membershipsForAdmin(tx as QueryDatabase, existingAdmin.id)
      : [];
    if (!input.target && existingMemberships.length > 0) {
      return {
        kind: 'conflict' as const,
        conflict: await businessTargetConflict(tx as QueryDatabase, existingMemberships),
      };
    }

    let admin: IdentityAdmin;
    let salonId: string;
    let salonSlug: string;
    let technicianId: string | null = null;
    let currentSite: typeof onboardingSiteSchema.$inferSelect | null = null;
    let preserveExistingProductData = false;

    const target = input.target;
    if (target?.mode === 'existing_business') {
      const membership = existingMemberships.find(item => item.id === target.salonId);
      if (!membership) {
        throw new OnboardingPersistenceError(
          'BUSINESS_ACCESS_DENIED',
          'This Luster account does not have access to the selected business.',
          403,
        );
      }
      salonId = membership.id;
      salonSlug = membership.slug;
      const [existingSite] = await tx.select().from(onboardingSiteSchema)
        .where(and(
          eq(onboardingSiteSchema.salonId, salonId),
          eq(onboardingSiteSchema.isCurrent, true),
        )).limit(1);
      currentSite = existingSite ?? null;
      if (!target.existingSiteStrategy && (currentSite || membership.publicationStatus === 'published')) {
        return {
          kind: 'conflict' as const,
          conflict: {
            business: { id: membership.id, name: membership.name, slug: membership.slug },
            canReplaceDraft: currentSite?.status === 'draft'
              && membership.publicationStatus !== 'published',
            code: 'SITE_CONFLICT',
            existingSite: currentSite
              ? { id: currentSite.id, revision: currentSite.currentRevision, status: currentSite.status === 'published' ? 'published' : 'draft' }
              : { id: membership.id, revision: 0, status: 'published' },
          } satisfies OnboardingClaimConflict,
        };
      }
      if (
        target.existingSiteStrategy === 'replace_draft'
        && (
          !currentSite
          || currentSite.status !== 'draft'
          || membership.publicationStatus === 'published'
        )
      ) {
        return {
          kind: 'conflict' as const,
          conflict: {
            business: { id: membership.id, name: membership.name, slug: membership.slug },
            canReplaceDraft: false,
            code: 'SITE_CONFLICT',
            existingSite: currentSite
              ? { id: currentSite.id, revision: currentSite.currentRevision, status: currentSite.status === 'published' ? 'published' : 'draft' }
              : { id: membership.id, revision: 0, status: 'published' },
          } satisfies OnboardingClaimConflict,
        };
      }
      const continuingOnboardingDraft
        = target.existingSiteStrategy === 'continue_onboarding_draft';
      if (
        (
          continuingOnboardingDraft
          || target.existingSiteStrategy === 'replace_draft'
        )
        && (
          (continuingOnboardingDraft && currentSite?.status !== 'draft')
          || currentSite?.id !== target.expectedSiteId
          || currentSite?.currentRevision !== target.expectedRevision
        )
      ) {
        throw new OnboardingPersistenceError(
          'SITE_REVISION_CONFLICT',
          'That website changed after you opened it. Reload the current draft before replacing it.',
          409,
        );
      }
      if (continuingOnboardingDraft) {
        const [continuationClaim] = await tx.select({
          claimedByAdminId: onboardingDraftClaimSchema.claimedByAdminId,
          revisionId: onboardingDraftClaimSchema.revisionId,
        }).from(onboardingDraftClaimSchema).where(and(
          eq(onboardingDraftClaimSchema.id, target.continuationClaimId!),
          eq(onboardingDraftClaimSchema.salonId, salonId),
          eq(onboardingDraftClaimSchema.siteId, target.expectedSiteId!),
        )).limit(1);
        const [continuedRevision] = continuationClaim
          ? await tx.select({ revision: onboardingSiteRevisionSchema.revision })
            .from(onboardingSiteRevisionSchema)
            .where(and(
              eq(onboardingSiteRevisionSchema.id, continuationClaim.revisionId),
              eq(onboardingSiteRevisionSchema.salonId, salonId),
              eq(onboardingSiteRevisionSchema.siteId, target.expectedSiteId!),
            ))
            .limit(1)
          : [];
        if (
          !existingAdmin
          || continuationClaim?.claimedByAdminId !== existingAdmin.id
          || continuedRevision?.revision !== target.expectedRevision
        ) {
          throw new OnboardingPersistenceError(
            'SITE_REVISION_CONFLICT',
            'That website changed after you opened it. Reload the current draft before replacing it.',
            409,
          );
        }
      }
      preserveExistingProductData = (
        target.existingSiteStrategy === 'new_draft'
        && (currentSite !== null || membership.publicationStatus === 'published')
      ) || (
        continuingOnboardingDraft
        && membership.publicationStatus === 'published'
      );
      admin = await ensureIdentityAdmin(tx as QueryDatabase, identity, input.snapshot);
      if (!preserveExistingProductData) {
        technicianId = await syncExistingBusinessProfile({
          database: tx as QueryDatabase,
          identity,
          salonId,
          snapshot: input.snapshot,
        });
      }
    } else {
      admin = await ensureIdentityAdmin(tx as QueryDatabase, identity, input.snapshot);
      const created = await createBusiness(tx as QueryDatabase, admin, identity, input.snapshot);
      salonId = created.salonId;
      salonSlug = created.salonSlug;
      technicianId = created.technicianId;
    }

    if (!preserveExistingProductData) {
      await syncSharedSalonProfileContent({
        database: tx as QueryDatabase,
        salonId,
        snapshot: input.snapshot,
      });
      const selection = resolveProductionServiceSelection(input.snapshot);
      const seeded = await seedStarterMenuForSalon({
        db: tx,
        mode: 'initial',
        overrides: selection.overrides,
        salonId,
        technicianId,
        templateKeys: [...selection.serviceTemplateKeys, ...selection.addOnTemplateKeys],
      });
      await ensureOwnerServicesForUnmappedSelection({
        database: tx as QueryDatabase,
        salonId,
        snapshot: input.snapshot,
        technicianId,
      });
      await markSeededOnboardingMenuRows({
        database: tx as QueryDatabase,
        salonId,
        seed: seeded,
        snapshot: input.snapshot,
      });
      await reconcileOnboardingOwnedMenu({
        database: tx as QueryDatabase,
        salonId,
        snapshot: input.snapshot,
        technicianId,
      });
    }
    await syncQuickBookProfilePresentationDraft({
      database: tx as QueryDatabase,
      salonId,
      snapshot: input.snapshot,
    });

    const replaceTarget = target?.mode === 'existing_business'
      && (
        target.existingSiteStrategy === 'continue_onboarding_draft'
        || target.existingSiteStrategy === 'replace_draft'
      )
      ? target
      : null;
    const replacing = Boolean(replaceTarget && currentSite?.status === 'draft');
    const siteId = replacing ? currentSite!.id : crypto.randomUUID();
    const revision = replacing ? replaceTarget!.expectedRevision! + 1 : 1;
    if (replacing) {
      await clearExplicitlyRemovedDraftIdentityMedia({
        database: tx as QueryDatabase,
        previousRevision: replaceTarget!.expectedRevision!,
        salonId,
        siteId,
        snapshot: input.snapshot,
        technicianId,
      });
    }
    if (!replacing) {
      if (currentSite) {
        await tx.update(onboardingSiteSchema)
          .set({ isCurrent: false, updatedAt: new Date() })
          .where(and(
            eq(onboardingSiteSchema.id, currentSite.id),
            eq(onboardingSiteSchema.salonId, salonId),
          ));
      }
      await tx.insert(onboardingSiteSchema).values({
        createdByAdminId: admin.id,
        currentRevision: revision,
        id: siteId,
        isCurrent: true,
        palettePresetId: input.snapshot.site.palettePresetId,
        salonId,
        serviceMenuApplied: !preserveExistingProductData,
        status: 'draft',
        stylePresetId: input.snapshot.site.stylePresetId,
      });
    } else {
      const [updatedSite] = await tx.update(onboardingSiteSchema).set({
        currentRevision: revision,
        palettePresetId: input.snapshot.site.palettePresetId,
        serviceMenuApplied: !preserveExistingProductData,
        stylePresetId: input.snapshot.site.stylePresetId,
        updatedAt: new Date(),
      }).where(and(
        eq(onboardingSiteSchema.id, siteId),
        eq(onboardingSiteSchema.salonId, salonId),
        eq(onboardingSiteSchema.isCurrent, true),
        eq(onboardingSiteSchema.status, 'draft'),
        eq(onboardingSiteSchema.currentRevision, replaceTarget!.expectedRevision!),
      )).returning();
      if (!updatedSite) {
        throw new OnboardingPersistenceError(
          'SITE_REVISION_CONFLICT',
          'That website changed after you opened it. Reload the current draft before replacing it.',
          409,
        );
      }
    }

    const revisionId = crypto.randomUUID();
    const document = compileOnboardingToSiteDocument({
      revision,
      siteId,
      snapshot: input.snapshot,
    });
    await tx.insert(onboardingSiteRevisionSchema).values({
      createdByAdminId: admin.id,
      document,
      documentFingerprint: fingerprintOnboardingValue(document),
      documentVersion: document.schemaVersion,
      id: revisionId,
      revision,
      salonId,
      siteId,
      snapshot: input.snapshot,
      snapshotFingerprint: fingerprintOnboardingValue(input.snapshot),
      snapshotVersion: input.snapshot.version,
    });

    const inheritedMediaIds = input.media.flatMap(media => (
      media.existingMediaId ? [media.existingMediaId] : []
    ));
    const inheritedMediaById = new Map<string, typeof onboardingSiteMediaSchema.$inferSelect>();
    if (inheritedMediaIds.length > 0) {
      if (!replacing || !currentSite) {
        throw new OnboardingPersistenceError(
          'MEDIA_REFERENCE_INVALID',
          'Saved images can only be carried forward from the exact website draft being replaced.',
          409,
        );
      }
      const [sourceRevision] = await tx.select({ id: onboardingSiteRevisionSchema.id })
        .from(onboardingSiteRevisionSchema)
        .where(and(
          eq(onboardingSiteRevisionSchema.salonId, salonId),
          eq(onboardingSiteRevisionSchema.siteId, currentSite.id),
          eq(onboardingSiteRevisionSchema.revision, replaceTarget!.expectedRevision!),
        ))
        .limit(1);
      if (!sourceRevision) {
        throw new OnboardingPersistenceError(
          'MEDIA_REFERENCE_INVALID',
          'The saved images belong to an unavailable website revision.',
          409,
        );
      }
      const inheritedRows = await tx.select().from(onboardingSiteMediaSchema).where(and(
        eq(onboardingSiteMediaSchema.salonId, salonId),
        eq(onboardingSiteMediaSchema.siteId, currentSite.id),
        eq(onboardingSiteMediaSchema.revisionId, sourceRevision.id),
        inArray(onboardingSiteMediaSchema.id, inheritedMediaIds),
      ));
      for (const row of inheritedRows) {
        inheritedMediaById.set(row.id, row);
      }
    }

    for (const media of input.media) {
      const inherited = media.existingMediaId
        ? inheritedMediaById.get(media.existingMediaId)
        : null;
      if (
        media.existingMediaId
        && (
          !inherited
          || inherited.claimStatus !== 'ready'
          || !inherited.storageProvider
          || !inherited.storageKey
          || inherited.localItemId !== media.localItemId
          || inherited.mimeType !== media.mimeType
          || inherited.role !== media.role
        )
      ) {
        throw new OnboardingPersistenceError(
          'MEDIA_REFERENCE_INVALID',
          'One saved image changed before the website update. Reload the current draft and try again.',
          409,
        );
      }
      await tx.insert(onboardingSiteMediaSchema).values({
        accessibleSummary: media.accessibleSummary ?? null,
        altText: media.altText ?? null,
        claimStatus: inherited ? 'ready' : 'pending',
        decorative: media.decorative ?? null,
        displayMode: media.displayMode ?? null,
        fileName: media.fileName,
        fileSize: media.fileSize ?? inherited?.fileSize ?? null,
        height: media.height ?? inherited?.height ?? null,
        id: crypto.randomUUID(),
        imageItemId: media.imageItemId ?? null,
        localItemId: media.localItemId,
        metadata: inherited
          ? { ...inherited.metadata, inheritedFromMediaId: inherited.id }
          : {},
        mimeType: media.mimeType,
        publicUrl: inherited?.publicUrl ?? null,
        revisionId,
        role: media.role,
        salonId,
        siteId,
        sortOrder: media.order,
        storageKey: inherited?.storageKey ?? null,
        storageProvider: inherited?.storageProvider ?? null,
        width: media.width ?? inherited?.width ?? null,
      });
    }

    const [claim] = await tx.insert(onboardingDraftClaimSchema).values({
      anonymousDraftTokenHash,
      claimedByAdminId: admin.id,
      id: crypto.randomUUID(),
      lastIdempotencyKeyHash: idempotencyKeyHash,
      revisionId,
      salonId,
      siteId,
      status: 'claimed',
    }).returning();
    if (!claim) {
      throw new OnboardingPersistenceError('CLAIM_CREATE_FAILED', 'The site claim could not be recorded.', 500);
    }
    return { kind: 'created' as const, claim, salonSlug };
  });

  if (result.kind === 'conflict') {
    return { kind: 'conflict', conflict: result.conflict };
  }
  return {
    kind: 'success',
    data: await claimSuccessForSnapshot(
      database,
      result.claim,
      result.kind === 'created',
      input.snapshot,
    ),
  };
}

export async function claimOnboardingDraft(
  identity: AuthenticatedOnboardingIdentity,
  input: OnboardingDraftClaimRequest,
  database: QueryDatabase = db,
): Promise<OnboardingClaimResult> {
  const anonymousDraftTokenHash = hashOpaqueToken(input.anonymousDraftToken);
  try {
    return await withClaimTokenLock(
      anonymousDraftTokenHash,
      () => claimOnboardingDraftUnlocked(identity, input, database),
    );
  } catch (error) {
    const constraint = uniqueConstraint(error);
    if (constraint === null) {
      throw error;
    }
    // A different runtime may have committed the same opaque draft token
    // between our absent-row check and insert. The unique key prevents any
    // duplicate resources; reload the winner and apply the same owner check.
    const existing = await existingClaimForToken(database, anonymousDraftTokenHash);
    if (existing) {
      await assertClaimOwner(database, identity, existing);
      return { kind: 'success', data: await claimSuccess(database, existing, false) };
    }
    if (['salon_slug_unique', 'salon_slug_idx'].includes(constraint)) {
      throw new OnboardingPersistenceError(
        'SITE_SLUG_UNAVAILABLE',
        'That Luster URL is no longer available. Choose another URL and try again.',
        409,
      );
    }
    throw error;
  }
}

export async function getOnboardingDraftClaimStatus(
  identity: AuthenticatedOnboardingIdentity,
  anonymousDraftToken: string,
  database: QueryDatabase = db,
  savedSiteId?: string,
): Promise<OnboardingClaimSuccess | null> {
  const claim = await existingClaimForToken(database, hashOpaqueToken(anonymousDraftToken));
  if (claim) {
    await assertClaimOwner(database, identity, claim);
    return claimSuccess(database, claim, false);
  }
  if (!savedSiteId) {
    return null;
  }
  // Early-save rotates the local token before later onboarding steps. Legacy
  // drafts can still re-establish ownership through their saved site, never
  // through a browser-supplied salon/account identity.
  const admin = await resolveIdentityAdmin(database, identity);
  const owned = admin
    ? await getClaimedOnboardingSite({
      adminId: admin.id,
      database,
      ownerOnly: true,
      siteId: savedSiteId,
    })
    : null;
  if (!admin || !owned) {
    throw new OnboardingPersistenceError('BUSINESS_ACCESS_DENIED', 'Sign in to the account that saved this website.', 403);
  }
  const [savedClaim] = await database.select().from(onboardingDraftClaimSchema).where(and(
    eq(onboardingDraftClaimSchema.siteId, owned.site.id),
    eq(onboardingDraftClaimSchema.salonId, owned.site.salonId),
    eq(onboardingDraftClaimSchema.revisionId, owned.revision.id),
    eq(onboardingDraftClaimSchema.claimedByAdminId, admin.id),
  )).limit(1);
  if (!savedClaim) {
    throw new OnboardingPersistenceError('BUSINESS_ACCESS_DENIED', 'Sign in to the account that saved this website.', 403);
  }
  return claimSuccess(database, savedClaim, false);
}

export async function saveOnboardingPlanIntent(
  identity: AuthenticatedOnboardingIdentity,
  input: OnboardingPlanIntentRequest,
  database: QueryDatabase = db,
): Promise<{
    confirmationMessage: string;
    dashboardUrl: string;
    intent: OnboardingPlanIntentRequest['intent'];
    siteId: string;
  }> {
  const admin = await resolveIdentityAdmin(database, identity);
  if (!admin) {
    throw new OnboardingPersistenceError('OWNER_NOT_FOUND', 'Save the site to this Luster account first.', 409);
  }
  const [site] = await database
    .select({
      id: onboardingSiteSchema.id,
      planIntent: onboardingSiteSchema.planIntent,
      planIntentIdempotencyKeyHash: onboardingSiteSchema.planIntentIdempotencyKeyHash,
      salonId: onboardingSiteSchema.salonId,
      salonSlug: salonSchema.slug,
    })
    .from(onboardingSiteSchema)
    .innerJoin(
      adminSalonMembershipSchema,
      and(
        eq(adminSalonMembershipSchema.salonId, onboardingSiteSchema.salonId),
        eq(adminSalonMembershipSchema.adminId, admin.id),
        eq(adminSalonMembershipSchema.role, 'owner'),
      ),
    )
    .innerJoin(salonSchema, eq(salonSchema.id, onboardingSiteSchema.salonId))
    .where(and(
      eq(onboardingSiteSchema.id, input.siteId),
      eq(onboardingSiteSchema.isCurrent, true),
    ))
    .limit(1);
  if (!site) {
    throw new OnboardingPersistenceError('SITE_NOT_FOUND', 'The saved site was not found for this account.', 404);
  }
  const idempotencyKeyHash = hashOpaqueToken(input.idempotencyKey);
  if (
    site.planIntentIdempotencyKeyHash === idempotencyKeyHash
    && site.planIntent
    && site.planIntent !== input.intent
  ) {
    throw new OnboardingPersistenceError(
      'PLAN_INTENT_IDEMPOTENCY_CONFLICT',
      'Choose the plan again so Luster can save your latest selection.',
      409,
    );
  }
  let savedIntent = site.planIntent;
  if (site.planIntentIdempotencyKeyHash !== idempotencyKeyHash || !savedIntent) {
    const [updated] = await database.update(onboardingSiteSchema).set({
      planIntent: input.intent,
      planIntentIdempotencyKeyHash: idempotencyKeyHash,
      planIntentUpdatedAt: new Date(),
      updatedAt: new Date(),
    }).where(and(
      eq(onboardingSiteSchema.id, site.id),
      eq(onboardingSiteSchema.salonId, site.salonId),
      or(
        isNull(onboardingSiteSchema.planIntentIdempotencyKeyHash),
        ne(onboardingSiteSchema.planIntentIdempotencyKeyHash, idempotencyKeyHash),
      ),
    )).returning();
    if (updated?.planIntent) {
      savedIntent = updated.planIntent;
    } else {
      const [winner] = await database.select({ intent: onboardingSiteSchema.planIntent })
        .from(onboardingSiteSchema)
        .where(and(
          eq(onboardingSiteSchema.id, site.id),
          eq(onboardingSiteSchema.salonId, site.salonId),
          eq(onboardingSiteSchema.planIntentIdempotencyKeyHash, idempotencyKeyHash),
        ))
        .limit(1);
      savedIntent = winner?.intent ?? null;
    }
  }
  if (!savedIntent) {
    throw new OnboardingPersistenceError('PLAN_INTENT_SAVE_FAILED', 'Your plan choice could not be saved.', 500);
  }
  const confirmationMessage = savedIntent === 'free'
    ? 'Your free start is ready.'
    : savedIntent === 'founding_interest'
      ? 'Founding offer reserved. We’ll let you know when final details are ready. Nothing was charged today.'
      : 'Monthly interest saved. We’ll let you know when final details are ready. Nothing was charged today.';
  return {
    confirmationMessage,
    dashboardUrl: `/admin?salon=${encodeURIComponent(site.salonSlug)}`,
    intent: savedIntent,
    siteId: site.id,
  };
}

/**
 * Shared tenant-safe loader for the real Workspace, saved Preview, and media
 * APIs. A site id is never sufficient on its own: membership and salon scope
 * are part of the same query.
 */
export async function getClaimedOnboardingSite(input: {
  adminId: string;
  database?: QueryDatabase;
  expectedRevision?: number;
  ownerOnly?: boolean;
  requireUnpublishedDraft?: boolean;
  salonId?: string;
  siteId?: string;
}) {
  const database = input.database ?? db;
  const filters = [
    eq(adminSalonMembershipSchema.adminId, input.adminId),
    eq(onboardingSiteSchema.isCurrent, true),
    isNull(salonSchema.deletedAt),
  ];
  if (input.ownerOnly) {
    filters.push(eq(adminSalonMembershipSchema.role, 'owner'));
  }
  if (input.expectedRevision) {
    filters.push(eq(onboardingSiteSchema.currentRevision, input.expectedRevision));
  }
  if (input.requireUnpublishedDraft) {
    filters.push(
      eq(onboardingSiteSchema.status, 'draft'),
      eq(salonSchema.publicationStatus, 'draft'),
    );
  }
  if (input.salonId) {
    filters.push(eq(onboardingSiteSchema.salonId, input.salonId));
  }
  if (input.siteId) {
    filters.push(eq(onboardingSiteSchema.id, input.siteId));
  }

  const [site] = await database
    .select({
      createdByAdminId: onboardingSiteSchema.createdByAdminId,
      currentRevision: onboardingSiteSchema.currentRevision,
      dashboardTourCompletedAt: onboardingSiteSchema.dashboardTourCompletedAt,
      dashboardWelcomeDismissedAt: onboardingSiteSchema.dashboardWelcomeDismissedAt,
      id: onboardingSiteSchema.id,
      palettePresetId: onboardingSiteSchema.palettePresetId,
      planIntent: onboardingSiteSchema.planIntent,
      salonId: onboardingSiteSchema.salonId,
      salonName: salonSchema.name,
      salonPublicationStatus: salonSchema.publicationStatus,
      salonSlug: salonSchema.slug,
      status: onboardingSiteSchema.status,
      stylePresetId: onboardingSiteSchema.stylePresetId,
    })
    .from(onboardingSiteSchema)
    .innerJoin(
      adminSalonMembershipSchema,
      eq(adminSalonMembershipSchema.salonId, onboardingSiteSchema.salonId),
    )
    .innerJoin(salonSchema, eq(salonSchema.id, onboardingSiteSchema.salonId))
    .where(and(...filters))
    .limit(1);
  if (!site) {
    return null;
  }
  const [revision] = await database.select().from(onboardingSiteRevisionSchema)
    .where(and(
      eq(onboardingSiteRevisionSchema.siteId, site.id),
      eq(onboardingSiteRevisionSchema.salonId, site.salonId),
      eq(onboardingSiteRevisionSchema.revision, site.currentRevision),
    )).limit(1);
  if (!revision) {
    throw new OnboardingPersistenceError('SITE_REVISION_MISSING', 'The saved site revision is unavailable.', 500);
  }
  const media = await database.select().from(onboardingSiteMediaSchema)
    .where(and(
      eq(onboardingSiteMediaSchema.siteId, site.id),
      eq(onboardingSiteMediaSchema.salonId, site.salonId),
      eq(onboardingSiteMediaSchema.revisionId, revision.id),
    ));
  return { media, revision, site };
}
