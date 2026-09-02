import path from 'node:path';

import { PGlite } from '@electric-sql/pglite';
import { and, asc, eq, isNotNull } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';

import type { DatabaseSessionHandle } from '@/libs/DB';
import * as schema from '@/models/Schema';

import { createDeterministicIdFactory } from '../../../prototypes/site-builder-v2-booking-integration-lab/src/model/ids';
import { initializeStarter } from '../../../prototypes/site-builder-v2-booking-integration-lab/src/model/starters';
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

const request = (
  suffix: string,
  options: {
    idempotencyKey?: string;
    localPhotoId?: string;
    ownerOverridesByServiceId?: Record<string, { durationMinutes?: number; priceCents?: number }>;
    selectedAddOnIds?: string[];
    selectedServiceIds?: string[];
    target?: { mode: 'create_business' } | {
      existingSiteStrategy?: 'new_draft' | 'replace_draft';
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
      socialLinks: schema.salonSchema.socialLinks,
    }).from(schema.salonSchema)
      .where(eq(schema.salonSchema.id, initial.data.salonId));

    expect(updatedSalon?.socialLinks).toEqual({
      facebook: 'https://facebook.example/isla',
      instagram: 'https://instagram.com/islanailstudio',
      tiktok: 'https://tiktok.example/@isla',
    });
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

  it('saves a new draft for a published business without mutating canonical Product data', async () => {
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

    const savedDraft = await claimOnboardingDraft(owner, request('published_new_draft', {
      target: {
        existingSiteStrategy: 'new_draft',
        mode: 'existing_business',
        salonId: initial.data.salonId,
      },
      token: opaque('draft_published_new_draft'),
    }), handle());

    expect(savedDraft).toMatchObject({
      data: {
        ownerCreatedServiceIds: [],
        serviceMenuApplied: false,
      },
      kind: 'success',
    });
    expect(await readCanonicalProductState()).toEqual(before);

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
    expect(await readCanonicalProductState()).toEqual(before);
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
