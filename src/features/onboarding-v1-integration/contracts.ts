import { z } from 'zod';

import {
  CANONICAL_SERVICE_IDS,
  MOCK_ADD_ONS,
} from '../../../prototypes/site-builder-v2-booking-integration-lab/src/booking/data';
import { validateCustomDesignSettings } from '../../../prototypes/site-builder-v2-booking-integration-lab/src/custom-design/model/settings';
import type { CustomDesignSettings } from '../../../prototypes/site-builder-v2-booking-integration-lab/src/custom-design/model/types';
import type { SiteBuilderDocument } from '../../../prototypes/site-builder-v2-booking-integration-lab/src/model/types';
import { validateImportedDocumentValue } from '../../../prototypes/site-builder-v2-booking-integration-lab/src/model/validation';

export const ONBOARDING_SITE_SNAPSHOT_VERSION = 1 as const;
export const ONBOARDING_SITE_DOCUMENT_VERSION = 1 as const;

export const ONBOARDING_STYLE_PRESET_IDS = [
  'modern',
  'editorial',
  'soft',
  'minimal',
  'bold',
  'luxury',
] as const;

export const ONBOARDING_PALETTE_PRESET_IDS = [
  'luster_berry',
  'blush_cocoa',
  'terracotta_cream',
  'sage_stone',
  'lilac_plum',
  'navy_ivory',
  'monochrome',
  'black_champagne',
] as const;

export const ONBOARDING_PLAN_INTENTS = [
  'free',
  'founding_interest',
  'monthly_interest',
] as const;

export const ONBOARDING_SITE_MEDIA_ROLES = [
  'profile',
  'logo',
  'gallery',
  'custom_design',
] as const;

export const ONBOARDING_SITE_MEDIA_CLAIM_STATUSES = [
  'pending',
  'uploading',
  'ready',
  'failed',
] as const;

/**
 * Account persistence/storage guard. Builder documents may retain richer
 * active and restorable content, but one saved revision claims at most this
 * many image rows across every role.
 */
export const ONBOARDING_SITE_MEDIA_MAX_ITEMS = 80;

export const ONBOARDING_SITE_MEDIA_LIMIT_MESSAGE
  = 'Account save supports up to 80 website images across profile, logo, Gallery, and Custom Design sections. Remove or reduce images, including restorable sections, then try again.';

export type OnboardingStylePresetId = (typeof ONBOARDING_STYLE_PRESET_IDS)[number];
export type OnboardingPalettePresetId = (typeof ONBOARDING_PALETTE_PRESET_IDS)[number];
export type OnboardingPlanIntent = (typeof ONBOARDING_PLAN_INTENTS)[number];
export type OnboardingSiteMediaRole = (typeof ONBOARDING_SITE_MEDIA_ROLES)[number];

const text = (maximum: number) => z.string().trim().max(maximum);
const nonEmptyText = (maximum: number) => text(maximum).min(1);
const timeSchema = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/);
const optionalTimeSchema = z.union([timeSchema, z.literal('')]);
const optionalNullableString = (maximum: number) => text(maximum).nullable().optional();

const localMediaReferenceSchema = z.object({
  accessibleSummary: optionalNullableString(5_000),
  altText: optionalNullableString(300),
  decorative: z.boolean().optional(),
  fileName: nonEmptyText(240),
  fileSize: z.number().int().positive().max(15 * 1024 * 1024).optional(),
  height: z.number().int().positive().max(20_000).optional(),
  imageItemId: nonEmptyText(160).optional(),
  localItemId: nonEmptyText(160),
  mimeType: z.enum(['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif']),
  width: z.number().int().positive().max(20_000).optional(),
}).strict();

const dayHoursSchema = z.object({
  close: optionalTimeSchema,
  closed: z.boolean(),
  open: optionalTimeSchema,
}).strict();

const weeklyHoursSchema = z.object({
  days: z.object({
    monday: dayHoursSchema,
    tuesday: dayHoursSchema,
    wednesday: dayHoursSchema,
    thursday: dayHoursSchema,
    friday: dayHoursSchema,
    saturday: dayHoursSchema,
    sunday: dayHoursSchema,
  }).strict(),
  setupState: z.enum(['unset', 'configured', 'skipped']),
  showOnSite: z.boolean(),
}).strict().superRefine((value, context) => {
  if (value.setupState !== 'configured') {
    return;
  }
  for (const [day, hours] of Object.entries(value.days)) {
    if (hours.closed) {
      continue;
    }
    if (!hours.open || !hours.close || hours.close <= hours.open) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Configured hours need a valid opening and closing time.',
        path: ['days', day, 'close'],
      });
    }
  }
});

const policyCopySchema = z.object({
  suggestedWording: text(4_000),
  useSuggestedWording: z.boolean(),
  visible: z.boolean(),
  wordingOverride: text(4_000),
}).strict();

const depositSchema = z.object({
  amountCents: z.number().int().min(0).max(1_000_000).nullable(),
  mode: z.enum(['none', 'fixed']),
  refundable: z.boolean().nullable(),
  transferable: z.boolean().nullable(),
  wordingOverride: text(4_000),
}).strict();

const policiesSchema = z.object({
  cancellations: z.object({
    consequence: z.enum(['deposit_lost', 'cancellation_fee', 'full_service_charge', 'custom']).nullable(),
    customConsequence: text(1_000),
    customNotice: text(120),
    notice: z.enum(['same_day', '12_hours', '24_hours', '48_hours', '72_hours', 'custom']).nullable(),
  }).strict(),
  copy: z.object({
    cancellations: policyCopySchema,
    deposits: policyCopySchema,
    late_arrivals: policyCopySchema,
    no_shows: policyCopySchema,
    repairs: policyCopySchema,
    other: policyCopySchema,
  }).strict(),
  deposits: depositSchema,
  lateArrivals: z.object({
    gracePeriodMinutes: text(20),
    rescheduleAfterLimit: z.boolean().nullable(),
    shortenService: z.boolean().nullable(),
  }).strict(),
  noShows: z.object({
    custom: text(2_000),
    fullCharge: z.boolean(),
    loseDeposit: z.boolean(),
    paymentRequiredToRebook: z.boolean(),
  }).strict(),
  other: z.object({
    appointmentPreparation: text(2_000),
    children: text(500),
    custom: text(2_000),
    guests: text(500),
    outsideRemoval: text(2_000),
  }).strict(),
  repairs: z.object({
    conditions: text(2_000),
    freeRepairWindowDays: text(20),
    noRepairPolicy: z.boolean(),
  }).strict(),
}).strict();

const aboutVisibilityKeys = [
  'profile_photo',
  'owner_name',
  'salon_name',
  'bio',
  'specialties',
  'experience',
  'certifications',
  'languages',
  'appointment_status',
  'new_client_status',
  'policy_summary',
  'instagram',
  'book_button',
] as const;

const aboutVisibilityShape = Object.fromEntries(
  aboutVisibilityKeys.map(key => [key, z.boolean()]),
) as Record<(typeof aboutVisibilityKeys)[number], z.ZodBoolean>;

const profileSchema = z.object({
  about: z.object({
    certifications: z.array(nonEmptyText(160)).max(20),
    clientAppreciation: text(2_000),
    fullBio: text(8_000),
    languages: z.array(nonEmptyText(100)).max(20),
    shortBio: text(1_000),
    specialties: z.array(nonEmptyText(160)).max(30),
    visibility: z.object(aboutVisibilityShape).strict(),
    yearsOfExperience: text(40),
  }).strict(),
  bookingOnlyContact: z.boolean(),
  bookingPreferences: z.object({
    minimumNoticeMinutes: z.number().int().min(0).max(525_600),
    newClientStatus: z.enum(['yes', 'no', 'ask_first', 'waitlist_only']).nullable(),
    visitMode: z.enum(['appointment_only', 'walk_ins_only', 'appointments_and_walk_ins']).nullable(),
  }).strict(),
  brand: z.object({
    accentPreference: text(160),
    styleNotes: text(2_000),
  }).strict(),
  businessName: nonEmptyText(80),
  businessStructure: z.enum(['solo', 'multi_tech']),
  clientContact: z.object({
    callEnabled: z.boolean(),
    differentTextNumber: text(64),
    primaryNumber: text(64),
    textEnabled: z.boolean(),
    useDifferentTextNumber: z.boolean(),
  }).strict(),
  email: text(320),
  instagram: text(30),
  location: z.object({
    addressVisibility: z.enum(['public', 'after_booking', 'hidden']),
    allowGeneralAreaDirections: z.boolean(),
    cityOrArea: text(160),
    entranceInstructions: text(2_000),
    exactAddress: text(300),
    locationType: z.enum(['home_studio', 'salon_suite', 'traditional_salon', 'mobile_service']).nullable(),
    parking: text(2_000),
    transitInformation: text(2_000),
  }).strict(),
  logoItemId: nonEmptyText(160).nullable(),
  ownerName: nonEmptyText(80),
  policies: policiesSchema,
  preferredContact: z.enum(['text', 'call', 'instagram', 'email']).nullable(),
  profilePhotoItemId: nonEmptyText(160).nullable(),
  serviceMenu: z.object({
    ownerOverridesByServiceId: z.record(z.object({
      durationMinutes: z.number().int().min(1).max(1_440).optional(),
      priceCents: z.number().int().min(0).max(1_000_000).optional(),
    }).strict()),
    reviewed: z.boolean(),
    selectedAddOnIds: z.array(nonEmptyText(100)).max(100),
    selectedServiceIds: z.array(nonEmptyText(100)).max(100),
  }).strict(),
  hours: weeklyHoursSchema,
}).strict();

// Runs the lab's schema upgrade before validation, so persisted v1 documents
// (earlier drafts, saved revisions) keep parsing losslessly as v2.
const siteBuilderDocumentSchema = z.custom<SiteBuilderDocument>(
  value => validateImportedDocumentValue(value).success,
  { message: 'The universal site document is invalid.' },
).transform((value, context) => {
  const result = validateImportedDocumentValue(value);
  if (!result.success) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: result.issues.join(' '),
    });
    return z.NEVER;
  }
  return result.document;
});

const siteRecipeSchema = z.object({
  aboutEnabled: z.boolean(),
  aboutPreset: z.enum(['photo_right', 'editorial_portrait', 'profile_quick_facts', 'about_before_you_book']),
  builderDocument: siteBuilderDocumentSchema.nullable().default(null),
  canvaEnabled: z.boolean(),
  galleryEnabled: z.boolean(),
  palettePresetId: z.enum(ONBOARDING_PALETTE_PRESET_IDS),
  policiesEnabled: z.boolean(),
  starter: z.enum(['quick_book', 'one_page', 'multi_page']),
  stylePresetId: z.enum(ONBOARDING_STYLE_PRESET_IDS),
}).strict();

const gallerySchema = z.object({
  imageItemIds: z.array(nonEmptyText(160)).max(60),
  layout: z.enum(['grid', 'carousel', 'editorial']),
  source: z.enum(['uploads', 'mock_luster']).nullable(),
}).strict();

const customDesignSettingsSchema = z.custom<CustomDesignSettings>(
  value => validateCustomDesignSettings(value).success,
  { message: 'Custom Design settings are invalid.' },
).transform((value, context) => {
  const result = validateCustomDesignSettings(value);
  if (!result.success) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: result.issues.join(' '),
    });
    return z.NEVER;
  }
  return result.value;
});

const customDesignSchema = z.object({
  customDesignSectionId: text(160).nullable(),
  displayMode: z.enum(['poster', 'contained', 'full_width']),
  imageItemIds: z.array(nonEmptyText(160)).max(10),
  placement: z.enum(['before_booking', 'after_booking']),
  settings: customDesignSettingsSchema.nullable(),
  status: z.enum(['empty', 'ready', 'invalid']),
}).strict();

export const onboardingPersistedSnapshotSchema = z.object({
  customDesign: customDesignSchema,
  gallery: gallerySchema,
  previewTimestamp: z.string().datetime({ offset: true }),
  profile: profileSchema,
  site: siteRecipeSchema,
  version: z.literal(ONBOARDING_SITE_SNAPSHOT_VERSION),
}).strict().superRefine((value, context) => {
  const canonicalServiceIds = new Set<string>(CANONICAL_SERVICE_IDS);
  const canonicalAddOnIds = new Set(MOCK_ADD_ONS.map(item => item.id));
  const serviceIds = new Set<string>();
  for (const [index, serviceId] of value.profile.serviceMenu.selectedServiceIds.entries()) {
    if (!canonicalServiceIds.has(serviceId)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Selected services must use canonical Luster Library IDs.',
        path: ['profile', 'serviceMenu', 'selectedServiceIds', index],
      });
    }
    if (serviceIds.has(serviceId)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Selected service IDs must be unique.',
        path: ['profile', 'serviceMenu', 'selectedServiceIds', index],
      });
    }
    serviceIds.add(serviceId);
  }
  const addOnIds = new Set<string>();
  for (const [index, addOnId] of value.profile.serviceMenu.selectedAddOnIds.entries()) {
    if (!canonicalAddOnIds.has(addOnId)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Selected add-ons must use canonical Luster Library IDs.',
        path: ['profile', 'serviceMenu', 'selectedAddOnIds', index],
      });
    }
    if (addOnIds.has(addOnId)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Selected add-on IDs must be unique.',
        path: ['profile', 'serviceMenu', 'selectedAddOnIds', index],
      });
    }
    addOnIds.add(addOnId);
  }
  const overrideEntries = Object.entries(
    value.profile.serviceMenu.ownerOverridesByServiceId,
  );
  if (overrideEntries.length > 200) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'Service-menu overrides may contain at most 200 selected items.',
      path: ['profile', 'serviceMenu', 'ownerOverridesByServiceId'],
    });
  }
  for (const [itemId] of overrideEntries) {
    const isSelectedCanonicalService = canonicalServiceIds.has(itemId)
      && serviceIds.has(itemId);
    const isSelectedCanonicalAddOn = canonicalAddOnIds.has(itemId)
      && addOnIds.has(itemId);
    if (!isSelectedCanonicalService && !isSelectedCanonicalAddOn) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Owner overrides must belong to a selected canonical service or add-on.',
        path: ['profile', 'serviceMenu', 'ownerOverridesByServiceId', itemId],
      });
    }
  }
  if (value.site.canvaEnabled && value.customDesign.status === 'ready' && !value.customDesign.settings) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'Ready Custom Design content requires its validated settings.',
      path: ['customDesign', 'settings'],
    });
  }
  for (const [index, image] of (value.customDesign.settings?.images ?? []).entries()) {
    if (image.assetId !== image.id) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Saved Custom Design assets must use their stable logical image ID.',
        path: ['customDesign', 'settings', 'images', index, 'assetId'],
      });
    }
  }
  if (value.site.builderDocument) {
    const customSections = [
      ...value.site.builderDocument.pages.flatMap(page => page.sections),
      ...value.site.builderDocument.unusedSections,
    ]
      .filter(section => section.sectionType === 'custom_design');
    for (const section of customSections) {
      for (const [index, image] of section.settings.images.entries()) {
        if (image.assetId !== image.id) {
          context.addIssue({
            code: z.ZodIssueCode.custom,
            message: 'Universal Custom Design assets must use their stable logical image ID.',
            path: ['site', 'builderDocument', section.id, 'images', index, 'assetId'],
          });
        }
      }
    }
  }
});

export type OnboardingPersistedSnapshot = z.infer<typeof onboardingPersistedSnapshotSchema>;

export const onboardingMediaManifestItemSchema = localMediaReferenceSchema.extend({
  displayMode: z.enum(['cover', 'contain', 'poster', 'full_width']).optional(),
  existingMediaId: z.string().uuid().optional(),
  order: z.number().int().min(0).max(1_000),
  role: z.enum(ONBOARDING_SITE_MEDIA_ROLES),
}).strict();

export const onboardingMediaManifestSchema = z.array(onboardingMediaManifestItemSchema)
  .max(ONBOARDING_SITE_MEDIA_MAX_ITEMS, ONBOARDING_SITE_MEDIA_LIMIT_MESSAGE);

export type OnboardingMediaManifestItem = z.infer<typeof onboardingMediaManifestItemSchema>;

const compiledSectionTypeSchema = z.enum([
  'hero',
  'about',
  'services',
  'booking',
  'policies',
  'gallery',
  'reviews',
  'custom_design',
  'visit',
  'contact',
  'content',
  'footer',
  // V1 section library types (additive; 'services'/'visit'/'content' remain
  // accepted for previously persisted compiled documents only).
  'announcement_bar',
  'quick_info',
  'section_navigation',
  'featured_services',
  'offers',
  'team',
  'deposits_cancellations',
  'faq',
  'hours',
  'visit_us',
  'final_cta',
]);

const compiledSectionSchema = z.object({
  customDesignSettings: customDesignSettingsSchema.optional(),
  id: nonEmptyText(200),
  order: z.number().int().min(0),
  presentation: z.record(z.union([z.string(), z.number(), z.boolean(), z.null()])),
  source: z.enum([
    'business_profile',
    'service_menu',
    'policies',
    'gallery',
    'custom_design',
    'starter_presentation',
    'site_content',
  ]),
  type: compiledSectionTypeSchema,
  visible: z.boolean(),
}).strict();

const compiledPageSchema = z.object({
  id: nonEmptyText(200),
  isHome: z.boolean(),
  label: nonEmptyText(100),
  order: z.number().int().min(0),
  sections: z.array(compiledSectionSchema).max(30),
  slug: text(100),
  visible: z.boolean(),
  visibleInNavigation: z.boolean(),
}).strict();

export const onboardingCompiledSiteDocumentSchema = z.object({
  builderDocument: siteBuilderDocumentSchema,
  compilerVersion: z.literal(1).default(1),
  navigation: z.array(z.object({
    label: nonEmptyText(100),
    order: z.number().int().min(0),
    pageId: nonEmptyText(200),
  }).strict()).max(10),
  navigationEnabled: z.boolean(),
  pages: z.array(compiledPageSchema).min(1).max(10),
  palettePresetId: z.enum(ONBOARDING_PALETTE_PRESET_IDS),
  recipeMigrationResult: z.enum([
    'fresh_v1',
    'migrated_legacy_recipe',
    'preserved_manual_edits',
  ]).default('preserved_manual_edits'),
  recipeVersion: z.literal(1).default(1),
  revision: z.number().int().positive(),
  schemaVersion: z.literal(ONBOARDING_SITE_DOCUMENT_VERSION),
  serviceSelection: z.object({
    selectedAddOnIds: z.array(nonEmptyText(100)).max(100),
    selectedServiceIds: z.array(nonEmptyText(100)).max(100),
  }).strict(),
  siteId: nonEmptyText(160),
  siteName: nonEmptyText(80),
  sourceSnapshotVersion: z.literal(ONBOARDING_SITE_SNAPSHOT_VERSION),
  starter: z.enum(['quick_book', 'one_page', 'multi_page']),
  stylePresetId: z.enum(ONBOARDING_STYLE_PRESET_IDS),
}).strict();

export type OnboardingCompiledSiteDocument = z.infer<typeof onboardingCompiledSiteDocumentSchema>;

const opaqueTokenSchema = z.string().min(32).max(256).regex(/^[\w-]+$/);

const targetSchema = z.union([
  z.object({ mode: z.literal('create_business') }).strict(),
  z.object({
    existingSiteStrategy: z.enum(['new_draft', 'replace_draft']).optional(),
    expectedRevision: z.number().int().positive().optional(),
    expectedSiteId: z.string().uuid().optional(),
    mode: z.literal('existing_business'),
    salonId: nonEmptyText(160),
  }).strict().superRefine((value, context) => {
    if (
      value.existingSiteStrategy === 'replace_draft'
      && (!value.expectedSiteId || !value.expectedRevision)
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Replacing a draft requires the exact site and revision that the owner confirmed.',
        path: ['expectedRevision'],
      });
    }
  }),
]);

export const onboardingDraftClaimRequestSchema = z.object({
  anonymousDraftToken: opaqueTokenSchema,
  idempotencyKey: opaqueTokenSchema,
  media: onboardingMediaManifestSchema,
  snapshot: onboardingPersistedSnapshotSchema,
  target: targetSchema.optional(),
}).strict().superRefine((value, context) => {
  if (!value.snapshot.site.builderDocument) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'The accepted universal site document is required.',
      path: ['snapshot', 'site', 'builderDocument'],
    });
  }
  const customDesignImageIds = new Set([
    ...(value.snapshot.customDesign.settings?.images.map(image => image.id) ?? []),
    ...(value.snapshot.site.builderDocument
      ? [
          ...value.snapshot.site.builderDocument.pages.flatMap(page => page.sections),
          ...value.snapshot.site.builderDocument.unusedSections,
        ].flatMap(section => (
          section.sectionType === 'custom_design'
            ? section.settings.images.map(image => image.id)
            : []
        ))
      : []),
  ]);
  const identities = new Set<string>();
  const expectedByRole = {
    custom_design: customDesignImageIds,
    gallery: new Set(value.snapshot.gallery.source === 'uploads'
      ? value.snapshot.gallery.imageItemIds
      : []),
    logo: new Set(value.snapshot.profile.logoItemId ? [value.snapshot.profile.logoItemId] : []),
    profile: new Set(value.snapshot.profile.profilePhotoItemId
      ? [value.snapshot.profile.profilePhotoItemId]
      : []),
  } satisfies Record<OnboardingSiteMediaRole, Set<string>>;
  for (const [index, item] of value.media.entries()) {
    const identity = `${item.role}:${item.localItemId}`;
    if (identities.has(identity)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Each role-specific media item must be unique.',
        path: ['media', index, 'localItemId'],
      });
    }
    identities.add(identity);
    if (!expectedByRole[item.role].has(item.localItemId)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Media must reference a stable logical image item in the saved site.',
        path: ['media', index, 'localItemId'],
      });
    }
    if (
      item.role === 'custom_design'
      && item.imageItemId !== item.localItemId
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Custom Design media must use the same stable logical image ID.',
        path: ['media', index, 'imageItemId'],
      });
    }
  }
  for (const [role, expected] of Object.entries(expectedByRole) as Array<[
    OnboardingSiteMediaRole,
    Set<string>,
  ]>) {
    const declared = new Set(
      value.media.filter(item => item.role === role).map(item => item.localItemId),
    );
    for (const localItemId of expected) {
      if (!declared.has(localItemId)) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'Every account-owned image must have one media claim row.',
          path: ['media'],
        });
      }
    }
  }
});

export type OnboardingDraftClaimRequest = z.infer<typeof onboardingDraftClaimRequestSchema>;

export const onboardingDraftStatusRequestSchema = z.object({
  anonymousDraftToken: opaqueTokenSchema,
}).strict();

export const onboardingPlanIntentRequestSchema = z.object({
  idempotencyKey: opaqueTokenSchema,
  intent: z.enum(ONBOARDING_PLAN_INTENTS),
  siteId: z.string().uuid(),
}).strict();

export type OnboardingPlanIntentRequest = z.infer<typeof onboardingPlanIntentRequestSchema>;

export type OnboardingClaimConflict =
  | {
    code: 'BUSINESS_TARGET_REQUIRED';
    businesses: Array<{ id: string; name: string; slug: string; hasSite: boolean }>;
  }
  | {
    code: 'SITE_CONFLICT';
    business: { id: string; name: string; slug: string };
    existingSite: { id: string; revision: number; status: 'draft' | 'published' };
    canReplaceDraft: boolean;
  };

export type OnboardingClaimSuccess = {
  claimId: string;
  created: boolean;
  dashboardUrl: string;
  media: { failed: number; pending: number; ready: number };
  ownerCreatedServiceIds: string[];
  payloadFingerprint: string;
  revision: number;
  revisionId: string;
  salonId: string;
  salonSlug: string;
  serviceMenuApplied: boolean;
  serviceMappingIssues: Array<{
    labServiceId: string;
    mappingKind: 'closest_template' | 'production_gap';
    productionCanonicalId: string;
  }>;
  siteId: string;
};
