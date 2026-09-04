import path from 'node:path';

import { PGlite } from '@electric-sql/pglite';
import { and, asc, eq, isNotNull } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';

import { resolvePublicQuickBookProfile } from '@/app/(unauth)/book/service/quickBookProfile';
import { resolveBookingExperience } from '@/libs/bookingExperience';
import {
  QUICK_BOOK_PROFILE_VISIBILITY_DEFAULTS,
  resolveBookingPageConfig,
} from '@/libs/bookingPageConfig';
import { resolveBookingPageContent } from '@/libs/bookingPageContent';
import type { DatabaseSessionHandle } from '@/libs/DB';
import { SERVICE_TEMPLATES } from '@/libs/serviceTemplateCatalog';
import { resolveSharedSalonProfile } from '@/libs/sharedSalonProfile';
import * as schema from '@/models/Schema';

import { switchBookingLayout } from '../../../prototypes/site-builder-v2-booking-integration-lab/src/booking/presentation';
import { createDeterministicIdFactory } from '../../../prototypes/site-builder-v2-booking-integration-lab/src/model/ids';
import { initializeStarter } from '../../../prototypes/site-builder-v2-booking-integration-lab/src/model/starters';
import {
  ADD_ON_PRODUCTION_MAPPINGS,
  SERVICE_MENU_PRODUCTION_MAPPINGS,
} from '../../../prototypes/site-builder-v2-booking-integration-lab/src/onboarding/integrations/contracts/service-menu-production-mapping';
import { createDefaultOnboardingState } from '../../../prototypes/site-builder-v2-booking-integration-lab/src/onboarding/model/defaults';

vi.mock('server-only', () => ({}));

/* eslint-disable import/first */
import { compileOnboardingToSiteDocument } from './compiler';
import { onboardingDraftClaimRequestSchema } from './contracts';
import {
  type AuthenticatedOnboardingIdentity,
  claimOnboardingDraft,
  getClaimedOnboardingSite,
  getOnboardingDraftClaimStatus,
  saveOnboardingPlanIntent,
} from './persistence.server';
import { createPersistableOnboardingDraft } from './snapshot';
/* eslint-enable import/first */

const identity = (suffix: string): AuthenticatedOnboardingIdentity => ({
  clerkUserId: `user_${suffix}`,
  email: `${suffix}@example.test`,
  name: 'Daniela',
  phoneE164: null,
});

const opaque = (prefix: string) => `${prefix}_${'x'.repeat(48)}`;

const QUICK_BOOK_PROFILE_VISIBLE = {
  showBio: true,
  showBookingPolicy: true,
  showCancellationPolicy: false,
  showEmail: true,
  showHours: true,
  showInstagram: true,
  showLocation: true,
  showPhone: true,
  showReviews: false,
  showTechName: true,
  showTechPhoto: true,
} as const;

const privateSnapshotVisibility = () => {
  const { version: _version, ...visibility }
    = QUICK_BOOK_PROFILE_VISIBILITY_DEFAULTS;
  return visibility;
};

const request = (
  suffix: string,
  options: {
    idempotencyKey?: string;
    includeProfilePhoto?: boolean;
    localPhotoId?: string;
    ownerOverridesByServiceId?: Record<string, { durationMinutes?: number; priceCents?: number }>;
    selectedAddOnIds?: string[];
    selectedServiceIds?: string[];
    target?: { mode: 'create_business' } | {
      continuationClaimId?: string;
      existingSiteStrategy?: 'continue_onboarding_draft' | 'new_draft' | 'replace_draft';
      expectedRevision?: number;
      expectedSiteId?: string;
      mode: 'existing_business';
      salonId: string;
    };
    token?: string;
  } = {},
) => {
  const state = createDefaultOnboardingState();
  state.profile.businessName = `Isla Nail Studio ${suffix}`;
  // Real onboarding saves the suggested URL before claiming. Use an explicit
  // unique fixture URL instead of relying on the retired collision suffixing.
  state.profile.siteSlug = suffix.replace(/_/g, '-');
  state.profile.businessStructure = 'solo';
  state.profile.ownerName = 'Daniela';
  state.profile.instagram = 'islanailstudio';
  state.profile.bookingOnlyContact = false;
  state.profile.clientContact.primaryNumber = '+14165550199';
  state.profile.clientContact.callEnabled = true;
  state.profile.location.cityOrArea = 'Toronto';
  state.profile.location.exactAddress = '123 Private Street';
  state.profile.location.addressVisibility = 'after_booking';
  state.profile.hours.setupState = 'configured';
  state.profile.hours.days.monday = { close: '19:00', closed: false, open: '10:00' };
  for (const day of ['tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'] as const) {
    state.profile.hours.days[day] = { close: '', closed: true, open: '' };
  }
  state.recipe.starter = 'one_page';
  state.recipe.starterDocumentSiteId = `site_${suffix}`;
  if (options.selectedServiceIds) {
    state.profile.serviceMenu.selectedServiceIds = options.selectedServiceIds;
  }
  if (options.selectedAddOnIds) {
    state.profile.serviceMenu.selectedAddOnIds = options.selectedAddOnIds;
  }
  if (options.ownerOverridesByServiceId) {
    state.profile.serviceMenu.ownerOverridesByServiceId = options.ownerOverridesByServiceId;
  }
  const localPhotoId = options.localPhotoId ?? `profile_${suffix}`;
  if (options.includeProfilePhoto !== false) {
    state.profile.profilePhoto = {
      altText: 'Daniela, owner of Isla Nail Studio',
      fileName: 'daniela.webp',
      height: 1_000,
      id: localPhotoId,
      mimeType: 'image/webp',
      previewUrl: 'blob:http://localhost/must-not-persist',
      source: 'indexed_db',
      storageId: `indexed_db_${suffix}_must_not_persist`,
      width: 800,
    };
  }
  const document = initializeStarter('one_page', {
    idFactory: createDeterministicIdFactory(suffix),
    siteId: `site_${suffix}`,
    siteName: state.profile.businessName,
  });
  const draft = createPersistableOnboardingDraft(state, 'luster_berry', null, document);
  return onboardingDraftClaimRequestSchema.parse({
    anonymousDraftToken: options.token ?? opaque(`draft_${suffix}`),
    idempotencyKey: options.idempotencyKey ?? opaque(`claim_${suffix}`),
    ...draft,
    ...(options.target ? { target: options.target } : {}),
  });
};

describe.sequential('account-backed onboarding persistence', () => {
  let client: PGlite;
  let database: ReturnType<typeof drizzle<typeof schema>>;

  beforeAll(async () => {
    client = new PGlite();
    await client.waitReady;
    database = drizzle(client, { schema });
    await migrate(database, { migrationsFolder: path.join(process.cwd(), 'migrations') });
  }, 60_000);

  afterAll(async () => {
    await client.close();
  });

  const handle = () => database as unknown as DatabaseSessionHandle;

  it.each([false, true])('rejects an occupied URL without renaming the salon (customized: %s)', async (customized) => {
    const suffix = customized ? 'custom_slug_collision' : 'suggested_slug_collision';
    const existingSalonId = crypto.randomUUID();
    const requestedSlug = customized ? 'taken-custom-url' : 'taken-suggested-url';
    await database.insert(schema.salonSchema).values({
      id: existingSalonId,
      name: 'Existing Business',
      slug: requestedSlug,
    });
    const owner = identity(suffix);
    const input = request(suffix);
    input.snapshot.profile.siteSlug = requestedSlug;
    input.snapshot.profile.siteSlugCustomized = customized;

    await expect(claimOnboardingDraft(owner, input, handle())).rejects.toMatchObject({
      code: 'SITE_SLUG_UNAVAILABLE',
      status: 409,
    });
    expect(await database.select({ id: schema.salonSchema.id }).from(schema.salonSchema)
      .where(eq(schema.salonSchema.slug, requestedSlug))).toEqual([{ id: existingSalonId }]);
    expect(await database.select({ id: schema.adminUserSchema.id }).from(schema.adminUserSchema)
      .where(eq(schema.adminUserSchema.clerkUserId, owner.clerkUserId))).toEqual([]);
    expect(input.snapshot.profile.siteSlug).toBe(requestedSlug);
  });

  it('allows independent owners with the same business name to choose distinct URLs', async () => {
    const firstInput = request('same_name_east');
    const secondInput = request('same_name_west');
    firstInput.snapshot.profile.businessName = 'Neighbourhood Nail Studio';
    firstInput.snapshot.profile.siteSlug = 'neighbourhood-nails-east';
    firstInput.snapshot.profile.siteSlugCustomized = true;
    secondInput.snapshot.profile.businessName = 'Neighbourhood Nail Studio';
    secondInput.snapshot.profile.siteSlug = 'neighbourhood-nails-west';
    secondInput.snapshot.profile.siteSlugCustomized = true;
    const first = await claimOnboardingDraft(identity('same_name_east'), firstInput, handle());
    const second = await claimOnboardingDraft(identity('same_name_west'), secondInput, handle());

    expect(first).toMatchObject({ kind: 'success', data: { salonSlug: 'neighbourhood-nails-east' } });
    expect(second).toMatchObject({ kind: 'success', data: { salonSlug: 'neighbourhood-nails-west' } });
    expect(await database.select({ name: schema.salonSchema.name, slug: schema.salonSchema.slug })
      .from(schema.salonSchema)
      .where(eq(schema.salonSchema.name, 'Neighbourhood Nail Studio'))
      .orderBy(asc(schema.salonSchema.slug))).toEqual([
      { name: 'Neighbourhood Nail Studio', slug: 'neighbourhood-nails-east' },
      { name: 'Neighbourhood Nail Studio', slug: 'neighbourhood-nails-west' },
    ]);
  });

  it('claims the complete Product library into tenant-owned rows and rejects another owner', async () => {
    const owner = identity('full_product_library');
    const selectedServiceIds = SERVICE_TEMPLATES.filter(template => template.serviceType !== 'addon')
      .map(template => SERVICE_MENU_PRODUCTION_MAPPINGS.find(mapping => (
        mapping.mappingKind === 'exact_template'
        && mapping.productionCanonicalId === template.systemKey
      ))!.labServiceId);
    const selectedAddOnIds = ADD_ON_PRODUCTION_MAPPINGS.map(mapping => mapping.labServiceId);
    const input = request('full_product_library', {
      ownerOverridesByServiceId: { 'svc-template-luster_manicure': { priceCents: 8100 } },
      selectedAddOnIds,
      selectedServiceIds,
    });
    const claim = await claimOnboardingDraft(owner, input, handle());
    if (claim.kind !== 'success') {
      throw new Error('Expected full library claim.');
    }
    const services = await database.select().from(schema.serviceSchema)
      .where(eq(schema.serviceSchema.salonId, claim.data.salonId));
    const addOns = await database.select().from(schema.addOnSchema)
      .where(eq(schema.addOnSchema.salonId, claim.data.salonId));

    expect(claim.data.serviceMappingIssues).toEqual([]);
    expect(services.map(service => service.templateKey).sort()).toEqual(
      SERVICE_TEMPLATES.filter(template => template.serviceType !== 'addon').map(template => template.systemKey).sort(),
    );
    expect(addOns.map(addOn => addOn.templateKey).sort()).toEqual(
      SERVICE_TEMPLATES.filter(template => template.serviceType === 'addon').map(template => template.systemKey).sort(),
    );
    expect(services.find(service => service.templateKey === 'luster_manicure')).toMatchObject({
      onboardingSourceServiceId: 'svc-template-luster_manicure',
      price: 8100,
    });

    const service = services.find(item => item.templateKey === 'shellac_gel_toes')!;
    const compatible = await database.select().from(schema.serviceAddOnSchema)
      .where(eq(schema.serviceAddOnSchema.serviceId, service.id));

    expect(compatible.map(link => link.addOnId)).toContain(
      addOns.find(item => item.templateKey === 'french_toes')!.id,
    );
    expect(compatible.map(link => link.addOnId)).not.toContain(
      addOns.find(item => item.templateKey === 'french_tips')!.id,
    );
    await expect(claimOnboardingDraft(identity('foreign_library_owner'), request('foreign_library_owner', {
      selectedAddOnIds: [],
      selectedServiceIds: ['svc-template-luster_manicure'],
      target: {
        existingSiteStrategy: 'replace_draft',
        expectedRevision: claim.data.revision,
        expectedSiteId: claim.data.siteId,
        mode: 'existing_business',
        salonId: claim.data.salonId,
      },
    }), handle())).rejects.toMatchObject({ code: 'BUSINESS_ACCESS_DENIED', status: 403 });
    expect(await database.select().from(schema.serviceSchema)
      .where(eq(schema.serviceSchema.salonId, claim.data.salonId))).toEqual(services);
  });

  it('creates one tenant, exact revision, media manifest, and complete canonical service selection', async () => {
    const owner = identity('first_claim');
    const input = request('first_claim');

    await expect(getOnboardingDraftClaimStatus(
      owner,
      input.anonymousDraftToken,
      handle(),
    )).resolves.toBeNull();

    const first = await claimOnboardingDraft(owner, input, handle());
    const replay = await claimOnboardingDraft(owner, input, handle());

    expect(first).toMatchObject({
      kind: 'success',
      data: {
        created: true,
        dashboardUrl: expect.stringMatching(/^\/admin\?salon=/),
        media: { failed: 0, pending: 1, ready: 0 },
        ownerCreatedServiceIds: expect.arrayContaining(
          input.snapshot.profile.serviceMenu.selectedServiceIds,
        ),
        revision: 1,
        serviceMenuApplied: true,
        serviceMappingIssues: [],
      },
    });

    if (first.kind === 'success') {
      expect(first.data.ownerCreatedServiceIds).toHaveLength(
        input.snapshot.profile.serviceMenu.selectedServiceIds.length,
      );
    }

    expect(replay).toMatchObject({
      kind: 'success',
      data: {
        claimId: first.kind === 'success' ? first.data.claimId : '',
        created: false,
        siteId: first.kind === 'success' ? first.data.siteId : '',
      },
    });

    if (first.kind !== 'success') {
      throw new Error('Expected a saved site.');
    }

    await expect(getOnboardingDraftClaimStatus(
      owner,
      input.anonymousDraftToken,
      handle(),
    )).resolves.toMatchObject({
      claimId: first.data.claimId,
      created: false,
      revisionId: first.data.revisionId,
      siteId: first.data.siteId,
    });

    const [revision] = await database.select().from(schema.onboardingSiteRevisionSchema)
      .where(eq(schema.onboardingSiteRevisionSchema.id, first.data.revisionId));
    const expectedCompiledDocument = compileOnboardingToSiteDocument({
      revision: first.data.revision,
      siteId: first.data.siteId,
      snapshot: input.snapshot,
    });

    expect(revision?.snapshot.site.builderDocument).toEqual(input.snapshot.site.builderDocument);
    expect(revision?.document).toEqual(expectedCompiledDocument);
    expect(JSON.stringify(revision)).not.toContain('indexed_db_first_claim_must_not_persist');
    expect(JSON.stringify(revision)).not.toContain('blob:http');

    const media = await database.select().from(schema.onboardingSiteMediaSchema)
      .where(eq(schema.onboardingSiteMediaSchema.revisionId, first.data.revisionId));

    expect(media).toHaveLength(1);
    expect(media[0]).toMatchObject({
      localItemId: 'profile_first_claim',
      role: 'profile',
    });

    const [accountOwner] = await database.select({
      phoneE164: schema.adminUserSchema.phoneE164,
    }).from(schema.adminUserSchema)
      .where(eq(schema.adminUserSchema.clerkUserId, owner.clerkUserId));

    expect(input.snapshot.profile.clientContact.primaryNumber).not.toBe('');
    expect(accountOwner?.phoneE164).toBeNull();

    const services = await database.select().from(schema.serviceSchema)
      .where(and(
        eq(schema.serviceSchema.salonId, first.data.salonId),
        eq(schema.serviceSchema.isActive, true),
      ));

    expect(services).toHaveLength(6);
    expect(services.find(item => item.onboardingSourceServiceId === 'svc-manicure-russian'))
      .toMatchObject({ name: 'Russian Manicure', templateKey: null });

    const [salon] = await database.select().from(schema.salonSchema)
      .where(eq(schema.salonSchema.id, first.data.salonId));

    expect(salon).toMatchObject({
      address: null,
      city: 'Toronto',
      ownerClerkUserId: owner.clerkUserId,
    });
  });

  it('persists onboarding routing and booking rules into canonical salon settings', async () => {
    const owner = identity('canonical_booking_settings');
    const input = request('canonical_booking_settings');
    input.snapshot.profile.businessType = 'home_based';
    input.snapshot.profile.bookingPreferences.minimumNoticeMinutes = 480;
    input.snapshot.profile.siteSlug = 'daniela-private-studio';
    input.snapshot.profile.siteSlugCustomized = true;
    input.snapshot.profile.timeZone = 'America/Vancouver';

    const claim = await claimOnboardingDraft(owner, input, handle());
    if (claim.kind !== 'success') {
      throw new Error('Expected the canonical-settings draft to save.');
    }

    const [salon] = await database.select({
      settings: schema.salonSchema.settings,
      slug: schema.salonSchema.slug,
    }).from(schema.salonSchema)
      .where(eq(schema.salonSchema.id, claim.data.salonId));

    expect(salon).toMatchObject({
      settings: {
        booking: {
          minimumNoticeMinutes: 480,
          timezone: 'America/Vancouver',
        },
        sharedProfile: {
          businessType: 'home_based',
        },
      },
      slug: 'daniela-private-studio',
    });
  });

  it('preserves booking-only canonical contact while private and can display it after an explicit visibility change', async () => {
    const owner = identity('private_contact_preserved');
    const input = request('private_contact_preserved');
    input.snapshot.site.starter = 'quick_book';
    input.snapshot.site.quickBookProfile = privateSnapshotVisibility();
    input.snapshot.profile.bookingOnlyContact = true;
    input.snapshot.profile.clientContact.callEnabled = true;
    input.snapshot.profile.clientContact.textEnabled = false;
    input.snapshot.profile.clientContact.primaryNumber = '+14165550177';
    input.snapshot.profile.email = 'private-contact@islanails.example';

    const initial = await claimOnboardingDraft(owner, input, handle());
    if (initial.kind !== 'success') {
      throw new Error('Expected the private-contact draft to save.');
    }

    const [privateSalon] = await database.select({
      email: schema.salonSchema.email,
      phone: schema.salonSchema.phone,
      settings: schema.salonSchema.settings,
    }).from(schema.salonSchema)
      .where(eq(schema.salonSchema.id, initial.data.salonId));
    const [privateLocation] = await database.select({
      email: schema.salonLocationSchema.email,
      phone: schema.salonLocationSchema.phone,
    }).from(schema.salonLocationSchema)
      .where(and(
        eq(schema.salonLocationSchema.salonId, initial.data.salonId),
        eq(schema.salonLocationSchema.isPrimary, true),
      ));

    expect(privateSalon).toMatchObject({
      email: 'private-contact@islanails.example',
      phone: '+14165550177',
    });
    expect(privateLocation).toEqual({
      email: 'private-contact@islanails.example',
      phone: '+14165550177',
    });
    expect(resolveBookingPageConfig(privateSalon?.settings).draft.quickBookProfile)
      .toEqual(QUICK_BOOK_PROFILE_VISIBILITY_DEFAULTS);

    const visibleInput = request('private_contact_visible', {
      target: {
        existingSiteStrategy: 'replace_draft',
        expectedRevision: initial.data.revision,
        expectedSiteId: initial.data.siteId,
        mode: 'existing_business',
        salonId: initial.data.salonId,
      },
      token: opaque('draft_private_contact_visible'),
    });
    visibleInput.snapshot.site.starter = 'quick_book';
    visibleInput.snapshot.site.quickBookProfile = {
      ...privateSnapshotVisibility(),
      showEmail: true,
      showPhone: true,
    };
    visibleInput.snapshot.profile.bookingOnlyContact = false;
    visibleInput.snapshot.profile.clientContact.callEnabled = true;
    visibleInput.snapshot.profile.clientContact.textEnabled = false;
    visibleInput.snapshot.profile.clientContact.primaryNumber = '+14165550177';
    visibleInput.snapshot.profile.email = 'private-contact@islanails.example';

    const visible = await claimOnboardingDraft(owner, visibleInput, handle());
    if (visible.kind !== 'success') {
      throw new Error('Expected the visible-contact replacement to save.');
    }

    const [visibleSalon] = await database.select({
      address: schema.salonSchema.address,
      businessHours: schema.salonSchema.businessHours,
      city: schema.salonSchema.city,
      email: schema.salonSchema.email,
      logoUrl: schema.salonSchema.logoUrl,
      name: schema.salonSchema.name,
      phone: schema.salonSchema.phone,
      settings: schema.salonSchema.settings,
      state: schema.salonSchema.state,
      zipCode: schema.salonSchema.zipCode,
    }).from(schema.salonSchema)
      .where(eq(schema.salonSchema.id, initial.data.salonId));
    const [visibleLocation] = await database.select({
      address: schema.salonLocationSchema.address,
      businessHours: schema.salonLocationSchema.businessHours,
      city: schema.salonLocationSchema.city,
      email: schema.salonLocationSchema.email,
      isPrimary: schema.salonLocationSchema.isPrimary,
      name: schema.salonLocationSchema.name,
      phone: schema.salonLocationSchema.phone,
      state: schema.salonLocationSchema.state,
      zipCode: schema.salonLocationSchema.zipCode,
    }).from(schema.salonLocationSchema)
      .where(and(
        eq(schema.salonLocationSchema.salonId, initial.data.salonId),
        eq(schema.salonLocationSchema.isPrimary, true),
      ));
    if (!visibleSalon || !visibleLocation) {
      throw new Error('Expected canonical salon and primary-location contact.');
    }
    const visibleConfig = resolveBookingPageConfig(visibleSalon.settings);
    const sharedProfile = resolveSharedSalonProfile(visibleSalon.settings);
    const view = resolvePublicQuickBookProfile({
      bio: null,
      bookingExperience: resolveBookingExperience(visibleSalon.settings),
      locationDisplayMode: 'city_only',
      locations: [visibleLocation],
      now: new Date('2026-09-02T16:00:00.000Z'),
      parkingInstructions: null,
      publicContactPreferences: {
        callEnabled: sharedProfile.callEnabled ?? false,
        textEnabled: sharedProfile.textEnabled ?? false,
        textNumber: sharedProfile.textNumber,
      },
      reviewUrl: null,
      salon: visibleSalon,
      sharedProfile,
      technicians: [],
      timeZone: 'America/Toronto',
      visibility: visibleConfig.draft.quickBookProfile,
    });

    expect(visibleConfig.draft.quickBookProfile).toMatchObject({
      showEmail: true,
      showPhone: true,
    });
    expect(view.contact).toEqual({
      email: {
        display: 'private-contact@islanails.example',
        href: 'mailto:private-contact@islanails.example',
      },
      phone: {
        actionLabel: 'Call',
        display: '+14165550177',
        href: 'tel:+14165550177',
      },
    });
  });

  it('claims Quick Book visibility into the unpublished draft without exposing live or faking media URLs', async () => {
    const owner = identity('quick_book_profile_draft');
    const input = request('quick_book_profile_draft');
    input.snapshot.site.starter = 'quick_book';
    input.snapshot.site.palettePresetId = 'black_champagne';
    input.snapshot.site.quickBookLayout = 'profile_story';
    input.snapshot.site.quickBookProfile = { ...QUICK_BOOK_PROFILE_VISIBLE };
    input.snapshot.site.stylePresetId = 'luxury';
    const bookingSection = input.snapshot.site.builderDocument?.pages
      .flatMap(page => page.sections)
      .find(section => section.sectionType === 'booking');
    if (bookingSection?.sectionType === 'booking') {
      bookingSection.settings = switchBookingLayout(
        bookingSection.settings,
        'editorial_cards',
      );
    }
    input.snapshot.site.policiesEnabled = true;
    input.snapshot.profile.instagram = '@isla.nails';
    input.snapshot.profile.clientContact.textEnabled = true;
    input.snapshot.profile.clientContact.useDifferentTextNumber = false;
    input.snapshot.profile.about.shortBio = 'Healthy nails, flawless results.';
    input.snapshot.profile.bookingPreferences.visitMode = 'appointment_only';
    input.snapshot.profile.location.addressVisibility = 'public';
    input.snapshot.profile.location.entranceInstructions = 'Inside TB Nails · Back entrance';
    input.snapshot.profile.location.parking = 'Use the rear lot';
    input.snapshot.profile.location.transitInformation = 'Near Ellesmere station';
    input.snapshot.profile.policies.deposits = {
      amountCents: 1500,
      mode: 'fixed',
      refundable: false,
      transferable: false,
      wordingOverride: '',
    };
    input.snapshot.profile.policies.cancellations.notice = '24_hours';
    input.snapshot.profile.policies.cancellations.consequence = 'deposit_lost';

    const claim = await claimOnboardingDraft(owner, input, handle());
    if (claim.kind !== 'success') {
      throw new Error('Expected Quick Book claim.');
    }

    const [salon] = await database.select({
      logoUrl: schema.salonSchema.logoUrl,
      name: schema.salonSchema.name,
      phone: schema.salonSchema.phone,
      publicationStatus: schema.salonSchema.publicationStatus,
      settings: schema.salonSchema.settings,
    }).from(schema.salonSchema)
      .where(eq(schema.salonSchema.id, claim.data.salonId));
    const [technician] = await database.select({
      avatarUrl: schema.technicianSchema.avatarUrl,
    }).from(schema.technicianSchema)
      .where(eq(schema.technicianSchema.salonId, claim.data.salonId));

    const bookingPage = resolveBookingPageConfig(salon?.settings);
    const bookingPageContent = resolveBookingPageContent(salon?.settings);
    const bookingExperience = resolveBookingExperience(salon?.settings);
    const sharedProfile = resolveSharedSalonProfile(salon?.settings);

    expect(bookingPage.draft.quickBookProfile).toEqual({
      ...QUICK_BOOK_PROFILE_VISIBLE,
      version: 1,
    });
    expect(bookingPage.draft.quickBookLayout).toBe('profile_story');
    expect(bookingPage.draft.serviceMenuLayout).toBe('editorial_cards');
    expect(bookingPage.draft.sitePalettePreset).toBe('black_champagne');
    expect(bookingPage.draft.siteStylePreset).toBe('luxury');
    expect(bookingPage.live.quickBookProfile).toEqual(QUICK_BOOK_PROFILE_VISIBILITY_DEFAULTS);
    expect(bookingPage.live.sitePalettePreset).toBeUndefined();
    expect(bookingPage.live.siteStylePreset).toBeUndefined();
    expect(bookingPageContent.draft).toMatchObject({
      bio: 'Healthy nails, flawless results.',
      heroImageUrl: null,
      locationDisplayMode: 'full_address',
      specialtyLine: null,
    });
    expect(bookingPageContent.live.bio).toBeNull();
    expect(bookingExperience).toMatchObject({
      policy: {
        enabled: true,
        showOnServicePage: true,
        title: 'Deposits & cancellations',
      },
      quickFacts: {
        appointmentOnly: { enabled: true, label: 'Appointment only' },
        cancellationNotice: { enabled: true, label: '24 hours’ cancellation notice' },
        depositNotice: { enabled: true, label: '$15 deposit required' },
      },
      socialLinks: {
        instagram: 'https://www.instagram.com/isla.nails/',
      },
    });
    expect(bookingExperience.policy.text).toContain('A $15 deposit is required to book.');
    expect(bookingExperience.policy.text).toContain('24 hours’ notice');
    expect(sharedProfile).toEqual({
      bookingOnlyContact: false,
      businessType: null,
      callEnabled: true,
      entranceInstructions: 'Inside TB Nails · Back entrance',
      textEnabled: true,
      textNumber: '+14165550199',
      transitInformation: 'Near Ellesmere station',
    });

    const [retentionSettings] = await database.select({
      parkingInstructions: schema.salonRetentionSettingsSchema.parkingInstructions,
    }).from(schema.salonRetentionSettingsSchema)
      .where(eq(schema.salonRetentionSettingsSchema.salonId, claim.data.salonId));

    expect(retentionSettings?.parkingInstructions).toBe('Use the rear lot');
    expect(salon).toMatchObject({
      logoUrl: null,
      name: input.snapshot.profile.businessName,
      phone: '+14165550199',
      publicationStatus: 'draft',
    });
    expect(technician?.avatarUrl).toBeNull();

    const [profileMedia] = await database.select({
      claimStatus: schema.onboardingSiteMediaSchema.claimStatus,
      publicUrl: schema.onboardingSiteMediaSchema.publicUrl,
    }).from(schema.onboardingSiteMediaSchema)
      .where(and(
        eq(schema.onboardingSiteMediaSchema.revisionId, claim.data.revisionId),
        eq(schema.onboardingSiteMediaSchema.role, 'profile'),
      ));

    expect(profileMedia).toEqual({ claimStatus: 'pending', publicUrl: null });
  });

  it('does not publish a cancellation quick fact when that shared policy is hidden', async () => {
    const owner = identity('quick_book_hidden_cancellation');
    const input = request('quick_book_hidden_cancellation');
    input.snapshot.site.starter = 'quick_book';
    input.snapshot.site.policiesEnabled = true;
    input.snapshot.profile.policies.copy.cancellations.visible = false;
    input.snapshot.profile.policies.cancellations.notice = '24_hours';
    input.snapshot.profile.policies.cancellations.consequence = 'cancellation_fee';

    const claim = await claimOnboardingDraft(owner, input, handle());
    if (claim.kind !== 'success') {
      throw new Error('Expected Quick Book claim.');
    }

    const [salon] = await database.select({ settings: schema.salonSchema.settings })
      .from(schema.salonSchema)
      .where(eq(schema.salonSchema.id, claim.data.salonId));
    const bookingExperience = resolveBookingExperience(salon?.settings);

    expect(bookingExperience.quickFacts.cancellationNotice).toEqual({
      enabled: false,
      label: null,
    });
  });

  it('updates unpublished replacement/new drafts while preserving live Quick Book visibility', async () => {
    const owner = identity('quick_book_profile_replace');
    const initialInput = request('quick_book_profile_replace_initial');
    initialInput.snapshot.site.quickBookProfile = { ...QUICK_BOOK_PROFILE_VISIBLE };
    const initial = await claimOnboardingDraft(owner, initialInput, handle());
    if (initial.kind !== 'success') {
      throw new Error('Expected initial Quick Book claim.');
    }

    const [stored] = await database.select({ settings: schema.salonSchema.settings })
      .from(schema.salonSchema)
      .where(eq(schema.salonSchema.id, initial.data.salonId));
    const firstConfig = resolveBookingPageConfig(stored?.settings);
    const publishedVisibility = {
      ...QUICK_BOOK_PROFILE_VISIBILITY_DEFAULTS,
      showInstagram: true,
    };
    await database.update(schema.salonSchema).set({
      settings: {
        ...(stored?.settings ?? {}),
        bookingPage: {
          ...firstConfig,
          live: {
            ...firstConfig.live,
            quickBookProfile: publishedVisibility,
          },
        },
      } as never,
    }).where(eq(schema.salonSchema.id, initial.data.salonId));

    const replacementInput = request('quick_book_profile_replace_next', {
      target: {
        existingSiteStrategy: 'replace_draft',
        expectedRevision: initial.data.revision,
        expectedSiteId: initial.data.siteId,
        mode: 'existing_business',
        salonId: initial.data.salonId,
      },
      token: opaque('draft_quick_book_profile_replace_next'),
    });
    replacementInput.snapshot.site.quickBookProfile = {
      ...privateSnapshotVisibility(),
      showBio: true,
      showTechName: true,
    };

    const replacement = await claimOnboardingDraft(owner, replacementInput, handle());

    expect(replacement).toMatchObject({ kind: 'success' });

    const [updated] = await database.select({ settings: schema.salonSchema.settings })
      .from(schema.salonSchema)
      .where(eq(schema.salonSchema.id, initial.data.salonId));
    const updatedConfig = resolveBookingPageConfig(updated?.settings);

    expect(updatedConfig.draft.quickBookProfile).toEqual({
      ...replacementInput.snapshot.site.quickBookProfile,
      version: 1,
    });
    expect(updatedConfig.live.quickBookProfile).toEqual(publishedVisibility);

    const newDraftInput = request('quick_book_profile_new_draft', {
      target: {
        existingSiteStrategy: 'new_draft',
        mode: 'existing_business',
        salonId: initial.data.salonId,
      },
      token: opaque('draft_quick_book_profile_new_draft'),
    });
    newDraftInput.snapshot.site.quickBookProfile = {
      ...privateSnapshotVisibility(),
      showPhone: true,
    };
    const newDraft = await claimOnboardingDraft(owner, newDraftInput, handle());

    expect(newDraft).toMatchObject({
      data: { serviceMenuApplied: false },
      kind: 'success',
    });

    const [afterNewDraft] = await database.select({ settings: schema.salonSchema.settings })
      .from(schema.salonSchema)
      .where(eq(schema.salonSchema.id, initial.data.salonId));
    const newDraftConfig = resolveBookingPageConfig(afterNewDraft?.settings);

    expect(newDraftConfig.draft.quickBookProfile).toEqual({
      ...newDraftInput.snapshot.site.quickBookProfile,
      version: 1,
    });
    expect(newDraftConfig.live.quickBookProfile).toEqual(publishedVisibility);
  });

  it('rejects a changed snapshot when an anonymous claim token is replayed', async () => {
    const owner = identity('changed_claim_replay');
    const input = request('changed_claim_replay');
    const first = await claimOnboardingDraft(owner, input, handle());

    expect(first.kind).toBe('success');

    const changed = structuredClone(input);
    changed.snapshot.profile.businessName = 'Edited after the core save';

    await expect(claimOnboardingDraft(owner, changed, handle())).rejects.toMatchObject({
      code: 'DRAFT_CONTENT_CHANGED_AFTER_CLAIM',
      status: 409,
    });

    const revisions = await database.select().from(schema.onboardingSiteRevisionSchema)
      .where(eq(
        schema.onboardingSiteRevisionSchema.siteId,
        first.kind === 'success' ? first.data.siteId : '',
      ));

    expect(revisions).toHaveLength(1);
    expect(revisions[0]?.snapshot.profile.businessName).toBe(
      input.snapshot.profile.businessName,
    );
  });

  it('serializes a two-tab claim race and returns the same winning claim', async () => {
    const owner = identity('race');
    const input = request('race');
    const [left, right] = await Promise.all([
      claimOnboardingDraft(owner, input, handle()),
      claimOnboardingDraft(owner, input, handle()),
    ]);

    expect(left.kind).toBe('success');
    expect(right.kind).toBe('success');

    if (left.kind !== 'success' || right.kind !== 'success') {
      return;
    }

    expect(left.data.claimId).toBe(right.data.claimId);
    expect(left.data.siteId).toBe(right.data.siteId);
    expect([left.data.created, right.data.created].sort()).toEqual([false, true]);

    const claims = await database.select().from(schema.onboardingDraftClaimSchema)
      .where(eq(schema.onboardingDraftClaimSchema.siteId, left.data.siteId));

    expect(claims).toHaveLength(1);
  });

  it('rejects another Clerk owner attempting to reuse the claimed opaque token', async () => {
    const input = request('tenant_owner');
    await claimOnboardingDraft(identity('tenant_owner'), input, handle());

    await expect(claimOnboardingDraft(identity('wrong_owner'), input, handle()))
      .rejects.toMatchObject({
        code: 'DRAFT_ALREADY_CLAIMED',
        status: 409,
      });
  });

  it('does not return a claimed site status to another Clerk owner', async () => {
    const owner = identity('status_owner');
    const input = request('status_owner');
    const claim = await claimOnboardingDraft(owner, input, handle());
    if (claim.kind !== 'success') {
      throw new Error('Expected initial claim.');
    }

    await expect(getOnboardingDraftClaimStatus(identity('status_foreign_owner'), input.anonymousDraftToken, handle()))
      .rejects.toMatchObject({ code: 'DRAFT_ALREADY_CLAIMED', status: 409 });
    await expect(getOnboardingDraftClaimStatus(owner, input.anonymousDraftToken, handle()))
      .resolves.toMatchObject({ salonId: claim.data.salonId, siteId: claim.data.siteId });
    await expect(getOnboardingDraftClaimStatus(owner, opaque('rotated_status'), handle(), claim.data.siteId))
      .resolves.toMatchObject({ salonId: claim.data.salonId, siteId: claim.data.siteId, claimId: claim.data.claimId });
    await expect(getOnboardingDraftClaimStatus(identity('status_foreign_owner'), opaque('rotated_foreign_status'), handle(), claim.data.siteId))
      .rejects.toMatchObject({ code: 'BUSINESS_ACCESS_DENIED', status: 403 });
    await expect(getOnboardingDraftClaimStatus(identity('status_foreign_owner'), input.anonymousDraftToken, handle(), claim.data.siteId))
      .rejects.toMatchObject({ code: 'DRAFT_ALREADY_CLAIMED', status: 409 });
  });

  it('lists only the signed-in account’s non-deleted owner memberships in save choices', async () => {
    const owner = identity('picker_scope');
    const initial = await claimOnboardingDraft(owner, request('picker_scope_initial'), handle());
    if (initial.kind !== 'success') {
      throw new Error('Expected initial claim.');
    }
    const [ownerAdmin] = await database.select({ id: schema.adminUserSchema.id })
      .from(schema.adminUserSchema)
      .where(eq(schema.adminUserSchema.clerkUserId, owner.clerkUserId));
    const foreignAdminId = crypto.randomUUID();
    const foreignSalonId = crypto.randomUUID();
    const adminOnlySalonId = crypto.randomUUID();
    const deletedSalonId = crypto.randomUUID();
    await database.insert(schema.adminUserSchema).values({
      clerkUserId: 'user_picker_foreign',
      email: 'picker_foreign@example.test',
      id: foreignAdminId,
    });
    await database.insert(schema.salonSchema).values([
      { id: foreignSalonId, name: 'Foreign owner salon', slug: 'picker-foreign' },
      { id: adminOnlySalonId, name: 'Admin membership only', slug: 'picker-admin-only' },
      { deletedAt: new Date(), id: deletedSalonId, name: 'Deleted owned salon', slug: 'picker-deleted' },
    ]);
    await database.insert(schema.adminSalonMembershipSchema).values([
      { adminId: foreignAdminId, role: 'owner', salonId: foreignSalonId },
      { adminId: ownerAdmin!.id, role: 'admin', salonId: adminOnlySalonId },
      { adminId: ownerAdmin!.id, role: 'owner', salonId: deletedSalonId },
    ]);
    const result = await claimOnboardingDraft(owner, request('picker_scope_next'), handle());

    expect(result).toEqual({
      kind: 'conflict',
      conflict: {
        businesses: [{
          hasSite: true,
          id: initial.data.salonId,
          name: 'Isla Nail Studio picker_scope_initial',
          slug: initial.data.salonSlug,
        }],
        code: 'BUSINESS_TARGET_REQUIRED',
      },
    });
  });

  it('returns structured business/site conflicts and creates a revision-scoped replacement', async () => {
    const owner = identity('conflict');
    const initial = await claimOnboardingDraft(owner, request('conflict_initial'), handle());
    if (initial.kind !== 'success') {
      throw new Error('Expected initial claim.');
    }

    const needsBusiness = await claimOnboardingDraft(
      owner,
      request('conflict_business', { token: opaque('draft_conflict_business') }),
      handle(),
    );

    expect(needsBusiness).toMatchObject({
      conflict: { code: 'BUSINESS_TARGET_REQUIRED' },
      kind: 'conflict',
    });

    const needsStrategy = await claimOnboardingDraft(owner, request('conflict_strategy', {
      target: { mode: 'existing_business', salonId: initial.data.salonId },
      token: opaque('draft_conflict_strategy'),
    }), handle());

    expect(needsStrategy).toMatchObject({
      conflict: { canReplaceDraft: true, code: 'SITE_CONFLICT' },
      kind: 'conflict',
    });

    await database.update(schema.salonSchema).set({
      socialLinks: {
        facebook: 'https://facebook.example/isla',
        instagram: 'old-instagram',
        tiktok: 'https://tiktok.example/@isla',
      },
    }).where(eq(schema.salonSchema.id, initial.data.salonId));

    const replacement = await claimOnboardingDraft(owner, request('conflict_replacement', {
      localPhotoId: 'profile_conflict_initial',
      target: {
        existingSiteStrategy: 'replace_draft',
        expectedRevision: initial.data.revision,
        expectedSiteId: initial.data.siteId,
        mode: 'existing_business',
        salonId: initial.data.salonId,
      },
      token: opaque('draft_conflict_replacement'),
    }), handle());

    expect(replacement).toMatchObject({
      data: { revision: 2, siteId: initial.data.siteId },
      kind: 'success',
    });

    if (replacement.kind !== 'success') {
      throw new Error('Expected replacement.');
    }
    const media = await database.select().from(schema.onboardingSiteMediaSchema)
      .where(eq(schema.onboardingSiteMediaSchema.siteId, initial.data.siteId));

    expect(media).toHaveLength(2);
    expect(new Set(media.map(item => item.revisionId))).toEqual(new Set([
      initial.data.revisionId,
      replacement.data.revisionId,
    ]));
    expect(new Set(media.map(item => item.localItemId)))
      .toEqual(new Set(['profile_conflict_initial']));

    const [updatedSalon] = await database.select({
      settings: schema.salonSchema.settings,
      socialLinks: schema.salonSchema.socialLinks,
    }).from(schema.salonSchema)
      .where(eq(schema.salonSchema.id, initial.data.salonId));

    expect(updatedSalon?.socialLinks).toEqual({
      facebook: 'https://facebook.example/isla',
      instagram: 'old-instagram',
      tiktok: 'https://tiktok.example/@isla',
    });
    expect(resolveBookingExperience(updatedSalon?.settings).socialLinks.instagram)
      .toBe('https://www.instagram.com/islanailstudio/');
    await expect(claimOnboardingDraft(owner, request('conflict_stale_replacement', {
      target: {
        existingSiteStrategy: 'replace_draft',
        expectedRevision: initial.data.revision,
        expectedSiteId: initial.data.siteId,
        mode: 'existing_business',
        salonId: initial.data.salonId,
      },
      token: opaque('draft_conflict_stale_replacement'),
    }), handle())).rejects.toMatchObject({
      code: 'SITE_REVISION_CONFLICT',
      status: 409,
    });
    await expect(getOnboardingDraftClaimStatus(
      owner,
      request('conflict_initial').anonymousDraftToken,
      handle(),
    )).rejects.toMatchObject({ code: 'CLAIM_REVISION_STALE', status: 409 });
  });

  it('continues its exact onboarding draft for a published business without mutating canonical Product data', async () => {
    const owner = identity('published_new_draft');
    const initial = await claimOnboardingDraft(
      owner,
      request('published_existing'),
      handle(),
    );
    if (initial.kind !== 'success') {
      throw new Error('Expected initial claim.');
    }

    await database.update(schema.salonSchema).set({
      address: '88 Existing Avenue',
      city: 'Ottawa',
      name: 'Existing Published Studio',
      publicationStatus: 'published',
      publishedAt: new Date('2026-08-30T12:00:00.000Z'),
    }).where(eq(schema.salonSchema.id, initial.data.salonId));
    await database.update(schema.onboardingSiteSchema).set({
      status: 'published',
    }).where(eq(schema.onboardingSiteSchema.id, initial.data.siteId));

    const readCanonicalProductState = async () => ({
      locations: await database.select().from(schema.salonLocationSchema)
        .where(eq(schema.salonLocationSchema.salonId, initial.data.salonId))
        .orderBy(asc(schema.salonLocationSchema.id)),
      salon: await database.select().from(schema.salonSchema)
        .where(eq(schema.salonSchema.id, initial.data.salonId)),
      services: await database.select().from(schema.serviceSchema)
        .where(eq(schema.serviceSchema.salonId, initial.data.salonId))
        .orderBy(asc(schema.serviceSchema.id)),
      technicianServices: await database.select({
        enabled: schema.technicianServicesSchema.enabled,
        priority: schema.technicianServicesSchema.priority,
        serviceId: schema.technicianServicesSchema.serviceId,
        technicianId: schema.technicianServicesSchema.technicianId,
      }).from(schema.technicianServicesSchema)
        .innerJoin(
          schema.technicianSchema,
          eq(schema.technicianSchema.id, schema.technicianServicesSchema.technicianId),
        )
        .where(eq(schema.technicianSchema.salonId, initial.data.salonId))
        .orderBy(
          asc(schema.technicianServicesSchema.technicianId),
          asc(schema.technicianServicesSchema.serviceId),
        ),
      technicians: await database.select().from(schema.technicianSchema)
        .where(eq(schema.technicianSchema.salonId, initial.data.salonId))
        .orderBy(asc(schema.technicianSchema.id)),
    });
    const before = await readCanonicalProductState();

    const publishedDraftInput = request('published_new_draft', {
      target: {
        existingSiteStrategy: 'new_draft',
        mode: 'existing_business',
        salonId: initial.data.salonId,
      },
      token: opaque('draft_published_new_draft'),
    });
    publishedDraftInput.snapshot.site.quickBookProfile = {
      ...privateSnapshotVisibility(),
      showEmail: true,
      showLocation: true,
      showPhone: true,
    };
    const savedDraft = await claimOnboardingDraft(owner, publishedDraftInput, handle());

    expect(savedDraft).toMatchObject({
      data: {
        ownerCreatedServiceIds: [],
        serviceMenuApplied: false,
      },
      kind: 'success',
    });

    const afterDraftSave = await readCanonicalProductState();

    expect(afterDraftSave.locations).toEqual(before.locations);
    expect(afterDraftSave.services).toEqual(before.services);
    expect(afterDraftSave.technicians).toEqual(before.technicians);
    expect(afterDraftSave.technicianServices).toEqual(before.technicianServices);

    const beforeSalon = before.salon[0];
    const afterSalon = afterDraftSave.salon[0];

    if (!beforeSalon || !afterSalon) {
      throw new Error('Expected the published salon state.');
    }

    const {
      settings: beforeSettings,
      updatedAt: _beforeUpdatedAt,
      ...beforeCanonicalSalon
    } = beforeSalon;
    const {
      settings: afterSettings,
      updatedAt: _afterUpdatedAt,
      ...afterCanonicalSalon
    } = afterSalon;

    expect(afterCanonicalSalon).toEqual(beforeCanonicalSalon);
    expect(resolveBookingPageConfig(afterSettings).live).toEqual(
      resolveBookingPageConfig(beforeSettings).live,
    );
    expect(resolveBookingPageContent(afterSettings).live).toEqual(
      resolveBookingPageContent(beforeSettings).live,
    );
    expect(resolveBookingPageConfig(afterSettings).draft.quickBookProfile).toEqual({
      ...publishedDraftInput.snapshot.site.quickBookProfile,
      version: 1,
    });

    if (savedDraft.kind !== 'success') {
      throw new Error('Expected saved draft.');
    }
    const publishedReplacement = await claimOnboardingDraft(owner, request('published_replace_blocked', {
      target: {
        existingSiteStrategy: 'replace_draft',
        expectedRevision: savedDraft.data.revision,
        expectedSiteId: savedDraft.data.siteId,
        mode: 'existing_business',
        salonId: initial.data.salonId,
      },
      token: opaque('draft_published_replace_blocked'),
    }), handle());

    expect(publishedReplacement).toMatchObject({
      conflict: { canReplaceDraft: false, code: 'SITE_CONFLICT' },
      kind: 'conflict',
    });
    expect(await readCanonicalProductState()).toEqual(afterDraftSave);

    await expect(claimOnboardingDraft(owner, request('published_wrong_continuation', {
      target: {
        continuationClaimId: '11111111-1111-4111-8111-111111111111',
        existingSiteStrategy: 'continue_onboarding_draft',
        expectedRevision: savedDraft.data.revision,
        expectedSiteId: savedDraft.data.siteId,
        mode: 'existing_business',
        salonId: initial.data.salonId,
      },
      token: opaque('draft_published_wrong_continuation'),
    }), handle())).rejects.toMatchObject({
      code: 'SITE_REVISION_CONFLICT',
      status: 409,
    });

    const continuationInput = request('published_continuation', {
      target: {
        continuationClaimId: savedDraft.data.claimId,
        existingSiteStrategy: 'continue_onboarding_draft',
        expectedRevision: savedDraft.data.revision,
        expectedSiteId: savedDraft.data.siteId,
        mode: 'existing_business',
        salonId: initial.data.salonId,
      },
      token: opaque('draft_published_continuation'),
    });
    continuationInput.snapshot.site.quickBookProfile = {
      ...privateSnapshotVisibility(),
      showHours: true,
      showInstagram: true,
    };
    const continued = await claimOnboardingDraft(owner, continuationInput, handle());

    expect(continued).toMatchObject({
      data: {
        ownerCreatedServiceIds: [],
        revision: savedDraft.data.revision + 1,
        serviceMenuApplied: false,
        siteId: savedDraft.data.siteId,
      },
      kind: 'success',
    });

    const afterContinuation = await readCanonicalProductState();

    expect(afterContinuation.locations).toEqual(afterDraftSave.locations);
    expect(afterContinuation.services).toEqual(afterDraftSave.services);
    expect(afterContinuation.technicians).toEqual(afterDraftSave.technicians);
    expect(afterContinuation.technicianServices).toEqual(afterDraftSave.technicianServices);

    const afterContinuationSalon = afterContinuation.salon[0];
    if (!afterContinuationSalon) {
      throw new Error('Expected the continued published salon state.');
    }
    const {
      settings: continuationSettings,
      updatedAt: _continuationUpdatedAt,
      ...continuationCanonicalSalon
    } = afterContinuationSalon;

    expect(continuationCanonicalSalon).toEqual(beforeCanonicalSalon);
    expect(resolveBookingPageConfig(continuationSettings).live).toEqual(
      resolveBookingPageConfig(beforeSettings).live,
    );
    expect(resolveBookingPageContent(continuationSettings).live).toEqual(
      resolveBookingPageContent(beforeSettings).live,
    );
    expect(resolveBookingPageConfig(continuationSettings).draft.quickBookProfile).toEqual({
      ...continuationInput.snapshot.site.quickBookProfile,
      version: 1,
    });
  });

  it('reconciles only onboarding-owned services when replacing an unpublished draft', async () => {
    const owner = identity('menu_reconcile');
    const initial = await claimOnboardingDraft(owner, request('menu_reconcile_initial'), handle());
    if (initial.kind !== 'success') {
      throw new Error('Expected initial claim.');
    }
    const selectedServiceIds = [
      'svc-manicure-russian',
      'svc-manicure-gel',
      'svc-art-tier-one',
      'svc-art-tier-two',
    ];
    const selectedAddOnIds = [
      'addon-french',
      'addon-chrome',
      'addon-simple-art',
      'addon-detailed-art',
    ];
    const replacement = await claimOnboardingDraft(owner, request('menu_reconcile_replace', {
      ownerOverridesByServiceId: {
        'svc-manicure-gel': { durationMinutes: 111, priceCents: 7777 },
      },
      selectedAddOnIds,
      selectedServiceIds,
      target: {
        existingSiteStrategy: 'replace_draft',
        expectedRevision: initial.data.revision,
        expectedSiteId: initial.data.siteId,
        mode: 'existing_business',
        salonId: initial.data.salonId,
      },
      token: opaque('draft_menu_reconcile_replace'),
    }), handle());

    expect(replacement).toMatchObject({
      data: { revision: 2, serviceMenuApplied: true },
      kind: 'success',
    });

    const ownedRows = await database.select({
      durationMinutes: schema.serviceSchema.durationMinutes,
      isActive: schema.serviceSchema.isActive,
      onboardingSourceServiceId: schema.serviceSchema.onboardingSourceServiceId,
      price: schema.serviceSchema.price,
    }).from(schema.serviceSchema).where(and(
      eq(schema.serviceSchema.salonId, initial.data.salonId),
      isNotNull(schema.serviceSchema.onboardingSourceServiceId),
    ));

    expect(ownedRows.filter(row => row.isActive).map(row => row.onboardingSourceServiceId).sort())
      .toEqual([...selectedServiceIds].sort());
    expect(ownedRows.find(row => row.onboardingSourceServiceId === 'svc-manicure-gel'))
      .toMatchObject({ durationMinutes: 111, price: 7777 });

    const ownedAddOns = await database.select({
      isActive: schema.addOnSchema.isActive,
      onboardingSourceAddOnId: schema.addOnSchema.onboardingSourceAddOnId,
    }).from(schema.addOnSchema).where(and(
      eq(schema.addOnSchema.salonId, initial.data.salonId),
      isNotNull(schema.addOnSchema.onboardingSourceAddOnId),
    ));

    expect(ownedAddOns.filter(row => row.isActive).map(
      row => row.onboardingSourceAddOnId,
    ).sort()).toEqual([...selectedAddOnIds].sort());
  });

  it('clears an explicitly removed draft profile before owner Preview without publishing', async () => {
    const owner = identity('draft_profile_remove');
    const initial = await claimOnboardingDraft(
      owner,
      request('draft_profile_remove_initial'),
      handle(),
    );
    if (initial.kind !== 'success') {
      throw new Error('Expected initial profile draft.');
    }
    const [technician] = await database.select({ id: schema.technicianSchema.id })
      .from(schema.technicianSchema)
      .where(eq(schema.technicianSchema.salonId, initial.data.salonId));
    const canonicalProfileUrl = 'https://images.example/profile/initial.webp';
    await database.update(schema.onboardingSiteMediaSchema).set({
      claimStatus: 'ready',
      metadata: {
        canonicalPublicUrl: canonicalProfileUrl,
        canonicalStorageKey: 'canonical/profile/initial',
        canonicalStorageProvider: 'cloudinary',
      },
      storageKey: 'private/profile-initial.webp',
      storageProvider: 'development_local',
    }).where(and(
      eq(schema.onboardingSiteMediaSchema.revisionId, initial.data.revisionId),
      eq(schema.onboardingSiteMediaSchema.role, 'profile'),
    ));
    await database.update(schema.technicianSchema).set({
      avatarUrl: canonicalProfileUrl,
    }).where(eq(schema.technicianSchema.id, technician!.id));

    const replacementInput = request('draft_profile_remove_replacement', {
      includeProfilePhoto: false,
      target: {
        existingSiteStrategy: 'replace_draft',
        expectedRevision: initial.data.revision,
        expectedSiteId: initial.data.siteId,
        mode: 'existing_business',
        salonId: initial.data.salonId,
      },
      token: opaque('draft_profile_remove_replacement'),
    });
    replacementInput.snapshot.site.starter = 'quick_book';
    replacementInput.snapshot.site.quickBookProfile = {
      ...privateSnapshotVisibility(),
      showTechName: true,
      showTechPhoto: true,
    };
    const replacement = await claimOnboardingDraft(owner, replacementInput, handle());

    expect(replacement).toMatchObject({ data: { revision: 2 }, kind: 'success' });

    const [salon] = await database.select().from(schema.salonSchema)
      .where(eq(schema.salonSchema.id, initial.data.salonId));
    const [updatedTechnician] = await database.select().from(schema.technicianSchema)
      .where(eq(schema.technicianSchema.id, technician!.id));

    expect(salon?.publicationStatus).toBe('draft');
    expect(updatedTechnician?.avatarUrl).toBeNull();

    const config = resolveBookingPageConfig(salon?.settings);
    const sharedProfile = resolveSharedSalonProfile(salon?.settings);
    const preview = resolvePublicQuickBookProfile({
      bio: null,
      bookingExperience: resolveBookingExperience(salon?.settings),
      locationDisplayMode: 'city_only',
      locations: [],
      now: new Date('2026-09-02T16:00:00.000Z'),
      parkingInstructions: null,
      publicContactPreferences: null,
      reviewUrl: null,
      salon: salon!,
      sharedProfile,
      technicians: [{
        imageUrl: updatedTechnician?.avatarUrl ?? null,
        name: updatedTechnician!.name,
        rating: null,
        reviewCount: 0,
      }],
      timeZone: 'America/Toronto',
      visibility: config.draft.quickBookProfile,
    });

    expect(preview.identity.technicianName).toBe('Daniela');
    expect(preview.identity.technicianPhotoUrl).toBeNull();
  });

  it('preserves a manual draft profile replacement after onboarding-managed history', async () => {
    const owner = identity('draft_profile_manual_replacement');
    const initial = await claimOnboardingDraft(
      owner,
      request('draft_profile_manual_replacement_initial'),
      handle(),
    );
    if (initial.kind !== 'success') {
      throw new Error('Expected initial profile draft.');
    }
    const [technician] = await database.select({ id: schema.technicianSchema.id })
      .from(schema.technicianSchema)
      .where(eq(schema.technicianSchema.salonId, initial.data.salonId));
    const onboardingProjectionUrl = 'https://images.example/profile/onboarding-owned.webp';
    const manualReplacementUrl = 'https://manual.example/profile/replacement.webp';
    await database.update(schema.onboardingSiteMediaSchema).set({
      claimStatus: 'ready',
      metadata: {
        canonicalPublicUrl: onboardingProjectionUrl,
        canonicalStorageKey: 'canonical/profile/onboarding-owned',
        canonicalStorageProvider: 'cloudinary',
      },
      storageKey: 'private/profile-onboarding-owned.webp',
      storageProvider: 'development_local',
    }).where(and(
      eq(schema.onboardingSiteMediaSchema.revisionId, initial.data.revisionId),
      eq(schema.onboardingSiteMediaSchema.role, 'profile'),
    ));
    await database.update(schema.technicianSchema).set({
      avatarUrl: manualReplacementUrl,
    }).where(eq(schema.technicianSchema.id, technician!.id));

    const replacement = await claimOnboardingDraft(owner, request(
      'draft_profile_manual_replacement_next',
      {
        includeProfilePhoto: false,
        target: {
          existingSiteStrategy: 'replace_draft',
          expectedRevision: initial.data.revision,
          expectedSiteId: initial.data.siteId,
          mode: 'existing_business',
          salonId: initial.data.salonId,
        },
        token: opaque('draft_profile_manual_replacement_next'),
      },
    ), handle());

    expect(replacement).toMatchObject({ data: { revision: 2 }, kind: 'success' });

    const [updatedTechnician] = await database.select({
      avatarUrl: schema.technicianSchema.avatarUrl,
    }).from(schema.technicianSchema)
      .where(eq(schema.technicianSchema.id, technician!.id));

    expect(updatedTechnician?.avatarUrl).toBe(manualReplacementUrl);
  });

  it.each(['pending', 'failed'] as const)(
    'does not treat a %s draft media row as canonical ownership',
    async (claimStatus) => {
      const suffix = `draft_profile_${claimStatus}_history`;
      const owner = identity(suffix);
      const initial = await claimOnboardingDraft(owner, request(`${suffix}_initial`), handle());
      if (initial.kind !== 'success') {
        throw new Error('Expected initial profile draft.');
      }
      const [technician] = await database.select({ id: schema.technicianSchema.id })
        .from(schema.technicianSchema)
        .where(eq(schema.technicianSchema.salonId, initial.data.salonId));
      const existingProfileUrl = `https://existing.example/profile/${claimStatus}.webp`;
      await database.update(schema.onboardingSiteMediaSchema).set({
        claimStatus,
        metadata: {
          canonicalPublicUrl: existingProfileUrl,
          canonicalStorageKey: `canonical/profile/${claimStatus}`,
          canonicalStorageProvider: 'cloudinary',
        },
      }).where(and(
        eq(schema.onboardingSiteMediaSchema.revisionId, initial.data.revisionId),
        eq(schema.onboardingSiteMediaSchema.role, 'profile'),
      ));
      await database.update(schema.technicianSchema).set({
        avatarUrl: existingProfileUrl,
      }).where(eq(schema.technicianSchema.id, technician!.id));

      const replacement = await claimOnboardingDraft(owner, request(`${suffix}_next`, {
        includeProfilePhoto: false,
        target: {
          existingSiteStrategy: 'replace_draft',
          expectedRevision: initial.data.revision,
          expectedSiteId: initial.data.siteId,
          mode: 'existing_business',
          salonId: initial.data.salonId,
        },
        token: opaque(`${suffix}_next`),
      }), handle());

      expect(replacement).toMatchObject({ data: { revision: 2 }, kind: 'success' });

      const [updatedTechnician] = await database.select({
        avatarUrl: schema.technicianSchema.avatarUrl,
      }).from(schema.technicianSchema)
        .where(eq(schema.technicianSchema.id, technician!.id));

      expect(updatedTechnician?.avatarUrl).toBe(existingProfileUrl);
    },
  );

  it('requires an owner membership before an existing-business claim can mutate Product data', async () => {
    const owner = identity('membership_owner');
    const initial = await claimOnboardingDraft(owner, request('membership_owner'), handle());
    if (initial.kind !== 'success') {
      throw new Error('Expected initial claim.');
    }
    const memberIdentity = identity('membership_admin');
    const [member] = await database.insert(schema.adminUserSchema).values({
      clerkUserId: memberIdentity.clerkUserId,
      email: memberIdentity.email,
      id: crypto.randomUUID(),
      name: memberIdentity.name,
    }).returning();
    await database.insert(schema.adminSalonMembershipSchema).values({
      adminId: member!.id,
      role: 'admin',
      salonId: initial.data.salonId,
    });

    await expect(claimOnboardingDraft(memberIdentity, request('membership_admin_attempt', {
      target: {
        existingSiteStrategy: 'replace_draft',
        expectedRevision: initial.data.revision,
        expectedSiteId: initial.data.siteId,
        mode: 'existing_business',
        salonId: initial.data.salonId,
      },
      token: opaque('draft_membership_admin_attempt'),
    }), handle())).rejects.toMatchObject({
      code: 'BUSINESS_ACCESS_DENIED',
      status: 403,
    });
    await expect(getOnboardingDraftClaimStatus(memberIdentity, opaque('rotated_admin_status'), handle(), initial.data.siteId))
      .rejects.toMatchObject({ code: 'BUSINESS_ACCESS_DENIED', status: 403 });

    await database.update(schema.salonSchema).set({ deletedAt: new Date() }).where(eq(schema.salonSchema.id, initial.data.salonId));

    await expect(getOnboardingDraftClaimStatus(owner, opaque('rotated_deleted_status'), handle(), initial.data.siteId))
      .rejects.toMatchObject({ code: 'BUSINESS_ACCESS_DENIED', status: 403 });
  });

  it('stores plan intent only, with stable idempotency and tenant-scoped loading', async () => {
    const owner = identity('plan');
    const claim = await claimOnboardingDraft(owner, request('plan'), handle());
    if (claim.kind !== 'success') {
      throw new Error('Expected claim.');
    }
    const planKey = opaque('plan_same_key');
    const free = await saveOnboardingPlanIntent(owner, {
      idempotencyKey: planKey,
      intent: 'free',
      siteId: claim.data.siteId,
    }, handle());

    await expect(saveOnboardingPlanIntent(owner, {
      idempotencyKey: planKey,
      intent: 'monthly_interest',
      siteId: claim.data.siteId,
    }, handle())).rejects.toMatchObject({
      code: 'PLAN_INTENT_IDEMPOTENCY_CONFLICT',
      status: 409,
    });

    const changed = await saveOnboardingPlanIntent(owner, {
      idempotencyKey: opaque('plan_new_key'),
      intent: 'founding_interest',
      siteId: claim.data.siteId,
    }, handle());

    expect(free).toMatchObject({ dashboardUrl: expect.stringMatching(/^\/admin/), intent: 'free' });
    expect(changed.intent).toBe('founding_interest');

    const [admin] = await database.select({ id: schema.adminUserSchema.id })
      .from(schema.adminUserSchema)
      .where(eq(schema.adminUserSchema.clerkUserId, owner.clerkUserId));
    const loaded = await getClaimedOnboardingSite({
      adminId: admin!.id,
      database: handle(),
      siteId: claim.data.siteId,
    });

    expect(loaded).toMatchObject({
      media: [expect.objectContaining({ revisionId: claim.data.revisionId })],
      revision: { id: claim.data.revisionId },
      site: { planIntent: 'founding_interest' },
    });

    const [salon] = await database.select({ plan: schema.salonSchema.plan })
      .from(schema.salonSchema)
      .where(eq(schema.salonSchema.id, claim.data.salonId));

    expect(salon?.plan).toBe('single_salon');

    const memberIdentity = identity('plan_admin_member');
    const [member] = await database.insert(schema.adminUserSchema).values({
      clerkUserId: memberIdentity.clerkUserId,
      email: memberIdentity.email,
      id: crypto.randomUUID(),
      name: memberIdentity.name,
    }).returning();
    await database.insert(schema.adminSalonMembershipSchema).values({
      adminId: member!.id,
      role: 'admin',
      salonId: claim.data.salonId,
    });

    await expect(saveOnboardingPlanIntent(memberIdentity, {
      idempotencyKey: opaque('plan_admin_member_key'),
      intent: 'monthly_interest',
      siteId: claim.data.siteId,
    }, handle())).rejects.toMatchObject({
      code: 'SITE_NOT_FOUND',
      status: 404,
    });

    const [wrongAdmin] = await database.insert(schema.adminUserSchema).values({
      clerkUserId: 'user_wrong_loader',
      email: 'wrong-loader@example.test',
      id: crypto.randomUUID(),
    }).returning({ id: schema.adminUserSchema.id });

    await expect(getClaimedOnboardingSite({
      adminId: wrongAdmin!.id,
      database: handle(),
      siteId: claim.data.siteId,
    })).resolves.toBeNull();
  });

  it('loads setup rehydration only for an owner, exact revision, and unpublished draft', async () => {
    const owner = identity('resume_owner');
    const claim = await claimOnboardingDraft(owner, request('resume_owner'), handle());
    if (claim.kind !== 'success') {
      throw new Error('Expected claim.');
    }
    const [ownerAdmin] = await database.select({ id: schema.adminUserSchema.id })
      .from(schema.adminUserSchema)
      .where(eq(schema.adminUserSchema.clerkUserId, owner.clerkUserId));
    const [memberAdmin] = await database.insert(schema.adminUserSchema).values({
      clerkUserId: 'user_resume_member',
      email: 'resume-member@example.test',
      id: crypto.randomUUID(),
    }).returning({ id: schema.adminUserSchema.id });
    await database.insert(schema.adminSalonMembershipSchema).values({
      adminId: memberAdmin!.id,
      role: 'admin',
      salonId: claim.data.salonId,
    });
    const setupQuery = {
      database: handle(),
      expectedRevision: claim.data.revision,
      ownerOnly: true,
      requireUnpublishedDraft: true,
      siteId: claim.data.siteId,
    } as const;

    await expect(getClaimedOnboardingSite({
      ...setupQuery,
      adminId: ownerAdmin!.id,
    })).resolves.toMatchObject({
      revision: { revision: claim.data.revision },
      site: { id: claim.data.siteId },
    });
    await expect(getClaimedOnboardingSite({
      ...setupQuery,
      adminId: memberAdmin!.id,
    })).resolves.toBeNull();
    await expect(getClaimedOnboardingSite({
      ...setupQuery,
      adminId: ownerAdmin!.id,
      expectedRevision: claim.data.revision + 1,
    })).resolves.toBeNull();

    await database.update(schema.salonSchema).set({
      publicationStatus: 'published',
      publishedAt: new Date(),
    }).where(eq(schema.salonSchema.id, claim.data.salonId));

    await expect(getClaimedOnboardingSite({
      ...setupQuery,
      adminId: ownerAdmin!.id,
    })).resolves.toBeNull();
  });
});
