import path from 'node:path';

import { PGlite } from '@electric-sql/pglite';
import { and, eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import * as schema from '@/models/Schema';

import { getClientInsightsDirectoryPage } from './clientInsights.server';
import {
  archiveSalonClient,
  collectClientContactAliases,
  editSalonClient,
  findPossibleClientDuplicates,
  getClientDependencySummary,
  getClientMergePreview,
  mergeSalonClients,
  permanentlyDeleteSalonClient,
  restoreSalonClient,
} from './clientLifecycle';
import { getFinancialBalanceSummary } from './financialReportingServer';
import { getSalonClients } from './queries';

vi.mock('server-only', () => ({}));

const holder = vi.hoisted(() => ({ db: null as unknown }));

vi.mock('@/libs/DB', () => ({
  get db() {
    return holder.db;
  },
}));

const SALON_ID = 'salon_lifecycle';
const OTHER_SALON_ID = 'salon_lifecycle_other';
const ACTOR = { id: 'admin_lifecycle', role: 'owner' as const };

let client: PGlite;
let db: ReturnType<typeof drizzle<typeof schema>>;

async function loadClient(id: string): Promise<schema.SalonClient> {
  const [row] = await db
    .select()
    .from(schema.salonClientSchema)
    .where(eq(schema.salonClientSchema.id, id));
  return row!;
}

beforeAll(async () => {
  client = new PGlite();
  await client.waitReady;
  db = drizzle(client, { schema });
  await migrate(db, { migrationsFolder: path.join(process.cwd(), 'migrations') });
  holder.db = db;

  await db.insert(schema.salonSchema).values([
    { id: SALON_ID, name: 'Lifecycle Salon', slug: 'lifecycle-salon' },
    { id: OTHER_SALON_ID, name: 'Other Salon', slug: 'lifecycle-other' },
  ]);
  await db.insert(schema.technicianSchema).values({
    id: 'tech_lifecycle',
    salonId: SALON_ID,
    name: 'Lifecycle Tech',
  });
  await db.insert(schema.technicianSchema).values({
    id: 'tech_lifecycle_other',
    salonId: OTHER_SALON_ID,
    name: 'Other Lifecycle Tech',
  });
  await db.insert(schema.clientSchema).values([
    {
      id: 'global_client_lifecycle',
      phone: '+14165550198',
    },
    {
      id: 'global_client_merge_deferred',
      phone: '+14165550192',
    },
    {
      id: 'global_client_unlinked_profile',
      phone: '+14165550189',
    },
    {
      id: 'global_client_proposed_phone',
      phone: '+14165550188',
    },
  ]);
  await db.insert(schema.salonClientSchema).values([
    {
      id: 'client_primary',
      salonId: SALON_ID,
      phone: '4165550101',
      fullName: 'Primary Person',
      email: 'primary@example.test',
      tags: ['primary'],
      notes: 'Primary note',
      nailPreferences: { shape: 'square' },
      totalVisits: 50,
      totalSpent: 900_000,
      loyaltyPoints: 25,
      lateCancelCount: 2,
    },
    {
      id: 'client_duplicate',
      salonId: SALON_ID,
      phone: '4165550102',
      fullName: 'Duplicate Person',
      email: 'duplicate@example.test',
      birthday: '1988-07-09',
      tags: ['duplicate'],
      notes: 'Duplicate note',
      nailPreferences: { shape: 'almond' },
      totalVisits: 20,
      totalSpent: 400_000,
      loyaltyPoints: 100,
      rebookIntervalDays: 30,
      isBlocked: true,
      blockedReason: 'Keep this safety flag',
      lateCancelCount: 3,
    },
    {
      id: 'client_other_salon',
      salonId: OTHER_SALON_ID,
      phone: '6475550101',
      email: 'primary.new@example.test',
    },
    {
      id: 'client_empty',
      salonId: SALON_ID,
      phone: '4165550199',
      fullName: 'Empty Person',
    },
    {
      id: 'client_linked_empty',
      salonId: SALON_ID,
      clientId: 'global_client_lifecycle',
      phone: '4165550198',
      fullName: 'Linked Empty Person',
    },
    {
      id: 'client_meaningful_empty',
      salonId: SALON_ID,
      phone: '4165550197',
      fullName: 'Meaningful Empty Person',
      notes: 'Safety note that must not be hard deleted',
    },
    {
      id: 'client_consent_empty',
      salonId: SALON_ID,
      phone: '4165550196',
      fullName: 'Consent Empty Person',
    },
    {
      id: 'client_shared_email_a',
      salonId: SALON_ID,
      phone: '4165550195',
      fullName: 'Shared Email A',
      email: 'shared@example.test',
    },
    {
      id: 'client_shared_email_b',
      salonId: SALON_ID,
      phone: '4165550194',
      fullName: 'Shared Email B',
      email: 'shared@example.test',
    },
    {
      id: 'client_auth_primary',
      salonId: SALON_ID,
      phone: '4165550193',
      fullName: 'Auth Primary',
    },
    {
      id: 'client_auth_duplicate',
      salonId: SALON_ID,
      clientId: 'global_client_merge_deferred',
      phone: '4165550192',
      fullName: 'Auth Duplicate',
    },
    {
      id: 'client_rollback_primary',
      salonId: SALON_ID,
      phone: '4165550191',
      fullName: 'Rollback Primary',
    },
    {
      id: 'client_rollback_duplicate',
      salonId: SALON_ID,
      phone: '4165550190',
      fullName: 'Rollback Duplicate',
    },
    {
      id: 'client_unlinked_auth_identity',
      salonId: SALON_ID,
      phone: '4165550189',
      fullName: 'Unlinked Auth Identity',
    },
  ]);
}, 60_000);

afterAll(async () => {
  await client.close();
});

describe('client lifecycle service', () => {
  it('normalizes edits, creates historic aliases, and isolates duplicate checks by salon', async () => {
    const before = await loadClient('client_primary');
    const updated = await editSalonClient({
      salonId: SALON_ID,
      clientId: before.id,
      expectedUpdatedAt: before.updatedAt,
      actor: ACTOR,
      changes: {
        fullName: 'Primary Updated',
        phone: '+1 (647) 555-0101',
        email: '  PRIMARY.NEW@Example.Test ',
        birthday: '1990-02-03',
      },
    });

    expect(updated.phone).toBe('6475550101');
    expect(updated.email).toBe('primary.new@example.test');
    expect(updated.birthday).toBe('1990-02-03');
    expect(await collectClientContactAliases({
      salonId: SALON_ID,
      clientId: updated.id,
    })).toEqual({
      phones: ['4165550101', '6475550101'],
      emails: ['primary.new@example.test', 'primary@example.test'],
    });

    expect(await findPossibleClientDuplicates({
      salonId: SALON_ID,
      phone: '(647) 555-0101',
      excludeClientId: updated.id,
    })).toEqual([]);
    expect(await findPossibleClientDuplicates({
      salonId: OTHER_SALON_ID,
      phone: '(647) 555-0101',
    })).toEqual([
      expect.objectContaining({ id: 'client_other_salon' }),
    ]);

    await expect(editSalonClient({
      salonId: SALON_ID,
      clientId: updated.id,
      expectedUpdatedAt: updated.updatedAt,
      actor: ACTOR,
      changes: { email: ' DUPLICATE@EXAMPLE.TEST ' },
    })).rejects.toMatchObject({
      code: 'POSSIBLE_DUPLICATE',
      duplicates: [expect.objectContaining({
        id: 'client_duplicate',
        matchedBy: ['email'],
      })],
    });

    await expect(editSalonClient({
      salonId: SALON_ID,
      clientId: updated.id,
      expectedUpdatedAt: updated.updatedAt,
      actor: ACTOR,
      changes: { phone: '4165550102' },
    })).rejects.toMatchObject({
      code: 'POSSIBLE_DUPLICATE',
      duplicates: [expect.objectContaining({ id: 'client_duplicate' })],
    });

    await expect(editSalonClient({
      salonId: SALON_ID,
      clientId: updated.id,
      expectedUpdatedAt: before.updatedAt,
      actor: ACTOR,
      changes: { fullName: 'Stale overwrite' },
    })).rejects.toMatchObject({ code: 'STALE_CLIENT' });

    const sharedEmailClient = await loadClient('client_shared_email_a');
    const renamedSharedEmailClient = await editSalonClient({
      salonId: SALON_ID,
      clientId: sharedEmailClient.id,
      expectedUpdatedAt: sharedEmailClient.updatedAt,
      actor: ACTOR,
      changes: { fullName: 'Shared Email Renamed' },
    });

    expect(renamedSharedEmailClient.fullName).toBe('Shared Email Renamed');
  });

  it('previews and transactionally merges canonical history without copying ledgers', async () => {
    const startTime = new Date('2026-07-20T15:00:00.000Z');
    await db.insert(schema.appointmentSchema).values({
      id: 'appt_duplicate',
      salonId: SALON_ID,
      salonClientId: 'client_duplicate',
      clientPhone: '+14165550102',
      clientName: 'Historic Duplicate Name',
      clientEmail: 'historic@example.test',
      startTime,
      endTime: new Date(startTime.getTime() + 3_600_000),
      totalDurationMinutes: 60,
      totalPrice: 7000,
      finalPriceCents: 8000,
      amountPaidCents: 3000,
      status: 'completed',
      paymentStatus: 'partially_paid',
    });
    await db.insert(schema.appointmentPaymentSchema).values({
      id: 'payment_duplicate',
      appointmentId: 'appt_duplicate',
      salonId: SALON_ID,
      amountCents: 3000,
      recordedByType: 'admin',
      recordedAt: new Date('2026-07-20T18:00:00.000Z'),
    });
    await db.insert(schema.appointmentPhotoSchema).values({
      id: 'photo_duplicate',
      appointmentId: 'appt_duplicate',
      salonId: SALON_ID,
      normalizedClientPhone: '4165550102',
      cloudinaryPublicId: 'lifecycle/photo',
      imageUrl: 'https://example.test/photo.jpg',
    });
    await db.insert(schema.reviewSchema).values({
      id: 'review_duplicate',
      appointmentId: 'appt_duplicate',
      salonId: SALON_ID,
      salonClientId: 'client_duplicate',
      clientNameSnapshot: 'Historic Duplicate Name',
      rating: 5,
    });
    await db.insert(schema.rewardSchema).values({
      id: 'reward_duplicate',
      salonId: SALON_ID,
      clientPhone: '4165550102',
      type: 'review',
      points: 100,
    });
    await db.insert(schema.clientPreferencesSchema).values({
      id: 'preferences_duplicate',
      salonId: SALON_ID,
      normalizedClientPhone: '4165550102',
      nailShape: 'almond',
    });
    await db.insert(schema.clientCommunicationSchema).values([
      {
        id: 'communication_primary',
        salonId: SALON_ID,
        salonClientId: 'client_primary',
        kind: 'rebook',
        status: 'prepared',
        destinationSnapshot: '+16475550101',
      },
      {
        id: 'communication_duplicate',
        salonId: SALON_ID,
        salonClientId: 'client_duplicate',
        kind: 'promo_6w',
        status: 'prepared',
        destinationSnapshot: '+14165550102',
      },
    ]);
    await db.insert(schema.retentionCampaignSchema).values({
      id: 'campaign_duplicate',
      salonId: SALON_ID,
      salonClientId: 'client_duplicate',
      tokenHash: 'campaign_duplicate_hash',
      stage: 'promo_6w',
      promotionSnapshot: {
        enabled: true,
        name: 'Come back',
        discountType: 'percent',
        value: 10,
        eligibleServiceIds: [],
        expiryDays: 14,
        code: null,
        messageTemplate: 'Come back',
        singleUse: true,
      },
      expiresAt: new Date('2026-08-24T00:00:00.000Z'),
    });
    await db.insert(schema.fraudSignalSchema).values({
      id: 'fraud_duplicate',
      salonId: SALON_ID,
      salonClientId: 'client_duplicate',
      appointmentId: 'appt_duplicate',
      type: 'HIGH_APPOINTMENT_FREQUENCY',
      reason: 'Test signal',
    });

    const beforePrimary = await loadClient('client_primary');
    const beforeDuplicate = await loadClient('client_duplicate');

    await db.insert(schema.salonClientNoteSchema).values({
      id: 'client_note_00000000-0000-4000-8000-000000000000',
      salonId: SALON_ID,
      salonClientId: beforePrimary.id,
      sourceClientId: beforePrimary.id,
      body: 'Existing immutable note',
      createdBy: ACTOR.id,
    });
    const randomUuid = vi
      .spyOn(globalThis.crypto, 'randomUUID')
      .mockReturnValue('00000000-0000-4000-8000-000000000000');

    await expect(mergeSalonClients({
      salonId: SALON_ID,
      primaryClientId: beforePrimary.id,
      duplicateClientId: beforeDuplicate.id,
      expectedPrimaryUpdatedAt: beforePrimary.updatedAt,
      expectedDuplicateUpdatedAt: beforeDuplicate.updatedAt,
      actor: ACTOR,
    })).rejects.toBeTruthy();

    randomUuid.mockRestore();

    expect((await loadClient(beforeDuplicate.id)).mergedIntoClientId).toBeNull();
    expect(await db
      .select()
      .from(schema.salonClientContactAliasSchema)
      .where(and(
        eq(schema.salonClientContactAliasSchema.salonId, SALON_ID),
        eq(schema.salonClientContactAliasSchema.kind, 'phone'),
        eq(schema.salonClientContactAliasSchema.normalizedValue, '4165550102'),
      ))).toEqual([]);

    const preview = await getClientMergePreview({
      salonId: SALON_ID,
      primaryClientId: beforePrimary.id,
      duplicateClientId: beforeDuplicate.id,
      now: new Date('2026-07-24T00:00:00.000Z'),
    });

    expect(preview.duplicate.records).toMatchObject({
      completedAppointments: 1,
      paymentRecords: 1,
      paymentsReceivedCents: 3000,
      completedOutstandingCents: 5000,
      photos: 1,
      preferences: 1,
      rewards: 1,
      reviews: 1,
      fraudSignals: 1,
    });

    const merged = await mergeSalonClients({
      salonId: SALON_ID,
      primaryClientId: beforePrimary.id,
      duplicateClientId: beforeDuplicate.id,
      expectedPrimaryUpdatedAt: beforePrimary.updatedAt,
      expectedDuplicateUpdatedAt: beforeDuplicate.updatedAt,
      actor: ACTOR,
      selections: {
        fullName: 'duplicate',
        phone: 'duplicate',
        email: 'duplicate',
        birthday: 'duplicate',
        nailPreferences: 'duplicate',
      },
    });

    expect(merged.idempotent).toBe(false);
    expect(merged.primary.fullName).toBe('Duplicate Person');
    expect(merged.primary.phone).toBe('4165550102');
    expect(merged.primary.email).toBe('duplicate@example.test');
    expect(merged.primary.birthday).toBe('1988-07-09');
    expect(merged.primary.tags).toEqual(['primary', 'duplicate']);
    expect(merged.primary.nailPreferences).toEqual({ shape: 'almond' });
    expect(merged.primary.isBlocked).toBe(true);
    expect(merged.primary.totalVisits).toBe(1);
    expect(merged.primary.totalSpent).toBe(0);
    expect(merged.primary.loyaltyPoints).toBe(100);
    expect(merged.primary.lateCancelCount).toBe(5);
    expect(merged.primary.rebookIntervalDays).toBe(30);
    expect(merged.duplicate.mergedIntoClientId).toBe(merged.primary.id);
    expect(merged.duplicate.archivedAt).not.toBeNull();
    expect(merged.duplicate.phone).toBe(`merged:${merged.duplicate.id}`);
    expect(merged.duplicate.loyaltyPoints).toBe(0);
    expect(await collectClientContactAliases({
      salonId: SALON_ID,
      clientId: merged.primary.id,
    })).toMatchObject({
      phones: ['4165550101', '4165550102', '6475550101'],
    });
    await expect(permanentlyDeleteSalonClient({
      salonId: SALON_ID,
      clientId: merged.duplicate.id,
      expectedUpdatedAt: merged.duplicate.updatedAt,
      actor: ACTOR,
    })).rejects.toMatchObject({ code: 'CLIENT_HAS_HISTORY' });
    await expect(getFinancialBalanceSummary({
      salonId: SALON_ID,
      salonClientId: merged.primary.id,
      clientPhoneVariants: [
        '4165550101',
        '+14165550101',
        '4165550102',
        '+14165550102',
      ],
    })).resolves.toMatchObject({
      completedOutstandingCents: 5000,
    });

    // A pre-stable-ID appointment using the merged source phone must resolve
    // through the private alias to the surviving primary exactly once.
    await db.insert(schema.appointmentSchema).values({
      id: 'appt_legacy_duplicate_alias',
      salonId: SALON_ID,
      salonClientId: null,
      clientPhone: '+14165550102',
      clientName: 'Historic Duplicate Name',
      startTime: new Date('2026-07-21T15:00:00.000Z'),
      endTime: new Date('2026-07-21T16:00:00.000Z'),
      totalDurationMinutes: 60,
      totalPrice: 2000,
      amountPaidCents: 0,
      status: 'completed',
      paymentStatus: 'unpaid',
    });
    const activeInsightsDirectory = await getClientInsightsDirectoryPage({
      salonId: SALON_ID,
      timeZone: 'America/Toronto',
      now: new Date('2026-07-24T16:00:00.000Z'),
      segment: 'active',
      search: 'Duplicate Person',
      sortBy: 'recent',
      sortOrder: 'desc',
      page: 1,
      limit: 50,
    });
    const mergedBalanceWithLegacyAlias = await getFinancialBalanceSummary({
      salonId: SALON_ID,
      salonClientId: merged.primary.id,
      clientPhoneVariants: [
        '4165550101',
        '+14165550101',
        '4165550102',
        '+14165550102',
      ],
    });

    expect(activeInsightsDirectory).toMatchObject({
      total: 1,
      clients: [expect.objectContaining({ id: merged.primary.id })],
    });
    expect(mergedBalanceWithLegacyAlias).toMatchObject({
      completedOutstandingCents: 7000,
    });

    const [appointment] = await db
      .select()
      .from(schema.appointmentSchema)
      .where(eq(schema.appointmentSchema.id, 'appt_duplicate'));

    expect(appointment).toMatchObject({
      salonClientId: 'client_primary',
      clientPhone: '+14165550102',
      clientName: 'Historic Duplicate Name',
      clientEmail: 'historic@example.test',
    });
    expect(await db.select().from(schema.appointmentPaymentSchema)).toHaveLength(1);
    expect(await db.select().from(schema.rewardSchema)).toHaveLength(1);
    expect(await db
      .select()
      .from(schema.appointmentPhotoSchema)
      .where(eq(schema.appointmentPhotoSchema.id, 'photo_duplicate'))).toHaveLength(1);
    expect(await db
      .select()
      .from(schema.reviewSchema)
      .where(and(
        eq(schema.reviewSchema.id, 'review_duplicate'),
        eq(schema.reviewSchema.salonClientId, 'client_primary'),
      ))).toHaveLength(1);
    expect(await db
      .select()
      .from(schema.clientPreferencesSchema)
      .where(eq(
        schema.clientPreferencesSchema.id,
        'preferences_duplicate',
      ))).toHaveLength(1);

    const mergedNotes = await db
      .select()
      .from(schema.salonClientNoteSchema)
      .where(eq(schema.salonClientNoteSchema.salonClientId, 'client_primary'));

    expect(mergedNotes.map(note => note.body)).toEqual(expect.arrayContaining([
      'Existing immutable note',
      'Primary note',
      'Duplicate note',
    ]));

    const communications = await db
      .select()
      .from(schema.clientCommunicationSchema)
      .where(eq(schema.clientCommunicationSchema.salonClientId, 'client_primary'));

    expect(communications).toHaveLength(2);
    expect(communications.find(row => row.id === 'communication_duplicate')?.status)
      .toBe('dismissed');
    expect(communications.find(row => row.id === 'communication_duplicate')?.destinationSnapshot)
      .toBe('+14165550102');
    expect(await db
      .select()
      .from(schema.retentionCampaignSchema)
      .where(and(
        eq(schema.retentionCampaignSchema.id, 'campaign_duplicate'),
        eq(schema.retentionCampaignSchema.salonClientId, 'client_primary'),
      ))).toHaveLength(1);
    expect(await db
      .select()
      .from(schema.fraudSignalSchema)
      .where(and(
        eq(schema.fraudSignalSchema.id, 'fraud_duplicate'),
        eq(schema.fraudSignalSchema.salonClientId, 'client_primary'),
      ))).toHaveLength(1);

    const [mergeAudit] = await db
      .select()
      .from(schema.auditLogSchema)
      .where(and(
        eq(schema.auditLogSchema.action, 'client_merged'),
        eq(schema.auditLogSchema.entityId, 'client_primary'),
      ));

    expect(mergeAudit).toMatchObject({
      actorId: ACTOR.id,
      salonId: SALON_ID,
      metadata: expect.objectContaining({
        primaryClientId: 'client_primary',
        duplicateClientId: 'client_duplicate',
        selectedFields: expect.objectContaining({
          fullName: 'duplicate',
          email: 'duplicate',
          nailPreferences: 'duplicate',
          phone: 'duplicate',
          birthday: 'duplicate',
          rebookIntervalDays: 'duplicate',
        }),
      }),
    });

    const repeated = await mergeSalonClients({
      salonId: SALON_ID,
      primaryClientId: beforePrimary.id,
      duplicateClientId: beforeDuplicate.id,
      expectedPrimaryUpdatedAt: beforePrimary.updatedAt,
      expectedDuplicateUpdatedAt: beforeDuplicate.updatedAt,
      actor: ACTOR,
    });

    expect(repeated.idempotent).toBe(true);

    // Simulate a stale writer that resolved the duplicate immediately before
    // the merge committed. The lifecycle trigger keeps the stable reference
    // on the primary while preserving the writer's historical phone snapshot.
    await db.insert(schema.appointmentSchema).values({
      id: 'appt_stale_merge_writer',
      salonId: SALON_ID,
      salonClientId: beforeDuplicate.id,
      clientPhone: '+14165550102',
      clientName: 'Historic Duplicate Name',
      technicianId: 'tech_lifecycle',
      startTime: new Date('2026-08-01T15:00:00.000Z'),
      endTime: new Date('2026-08-01T16:00:00.000Z'),
      totalDurationMinutes: 60,
      status: 'confirmed',
      totalPrice: 5500,
    });
    const [staleWriterAppointment] = await db
      .select({
        salonClientId: schema.appointmentSchema.salonClientId,
        clientPhone: schema.appointmentSchema.clientPhone,
      })
      .from(schema.appointmentSchema)
      .where(eq(schema.appointmentSchema.id, 'appt_stale_merge_writer'));

    expect(staleWriterAppointment).toEqual({
      salonClientId: beforePrimary.id,
      clientPhone: '+14165550102',
    });

    // A second stale writer may have resolved the duplicate itself before the
    // merge (for example, a loyalty refund or review-followup update). Once the
    // merge commits, no operational state may be recreated on that preserved
    // source.
    await expect(db
      .update(schema.salonClientSchema)
      .set({
        loyaltyPoints: 999,
        hasGoogleReview: true,
        updatedAt: new Date(),
      })
      .where(eq(schema.salonClientSchema.id, beforeDuplicate.id)))
      .rejects.toThrow(/merged salon client .* is immutable/i);

    expect(await loadClient(beforeDuplicate.id)).toMatchObject({
      loyaltyPoints: 0,
      hasGoogleReview: false,
      mergedIntoClientId: beforePrimary.id,
    });
  });

  it('rejects contact changes and merges that require external identity mutation', async () => {
    const primary = await loadClient('client_auth_primary');
    const duplicate = await loadClient('client_auth_duplicate');

    await expect(editSalonClient({
      salonId: SALON_ID,
      clientId: duplicate.id,
      expectedUpdatedAt: duplicate.updatedAt,
      actor: ACTOR,
      changes: { phone: '4165550188' },
    })).rejects.toMatchObject({ code: 'EXTERNAL_IDENTITY_CONFLICT' });

    const safelyEdited = await editSalonClient({
      salonId: SALON_ID,
      clientId: duplicate.id,
      expectedUpdatedAt: duplicate.updatedAt,
      actor: ACTOR,
      changes: {
        fullName: 'Auth Duplicate Renamed',
        email: 'auth.duplicate@example.test',
        birthday: '1991-04-05',
      },
    });

    expect(safelyEdited).toMatchObject({
      phone: duplicate.phone,
      fullName: 'Auth Duplicate Renamed',
      email: 'auth.duplicate@example.test',
      birthday: '1991-04-05',
    });

    await expect(mergeSalonClients({
      salonId: SALON_ID,
      primaryClientId: primary.id,
      duplicateClientId: duplicate.id,
      expectedPrimaryUpdatedAt: primary.updatedAt,
      expectedDuplicateUpdatedAt: safelyEdited.updatedAt,
      actor: ACTOR,
    })).rejects.toMatchObject({ code: 'EXTERNAL_IDENTITY_CONFLICT' });

    const primaryAfter = await loadClient(primary.id);
    const duplicateAfter = await loadClient(duplicate.id);

    expect(primaryAfter).toMatchObject({
      mergedIntoClientId: null,
      archivedAt: null,
      phone: primary.phone,
    });
    expect(duplicateAfter).toMatchObject({
      clientId: 'global_client_merge_deferred',
      mergedIntoClientId: null,
      archivedAt: null,
      phone: duplicate.phone,
    });
  });

  it('rejects a new contact phone that belongs to an unlinked customer login', async () => {
    const primary = await loadClient('client_auth_primary');

    await expect(editSalonClient({
      salonId: SALON_ID,
      clientId: primary.id,
      expectedUpdatedAt: primary.updatedAt,
      actor: ACTOR,
      changes: { phone: '4165550188' },
    })).rejects.toMatchObject({ code: 'EXTERNAL_IDENTITY_CONFLICT' });

    expect(await loadClient(primary.id)).toMatchObject({
      phone: primary.phone,
      updatedAt: primary.updatedAt,
    });
  });

  it('enforces same-salon terminal merge targets and rejects cycles in the database', async () => {
    await db.insert(schema.salonClientSchema).values([
      {
        id: 'client_cycle_a',
        salonId: SALON_ID,
        phone: '4165550187',
        fullName: 'Cycle A',
      },
      {
        id: 'client_cycle_b',
        salonId: SALON_ID,
        phone: '4165550186',
        fullName: 'Cycle B',
      },
    ]);

    await expect(db
      .update(schema.salonClientSchema)
      .set({ mergedIntoClientId: 'client_cycle_a' })
      .where(eq(schema.salonClientSchema.id, 'client_cycle_a')))
      .rejects.toThrow(/cyclic same-salon client merge/i);

    await expect(db
      .update(schema.salonClientSchema)
      .set({ mergedIntoClientId: 'client_other_salon' })
      .where(eq(schema.salonClientSchema.id, 'client_cycle_a')))
      .rejects.toThrow(/missing or foreign-salon client merge target/i);

    await db
      .update(schema.salonClientSchema)
      .set({
        mergedIntoClientId: 'client_cycle_b',
        mergedAt: new Date(),
        archivedAt: new Date(),
      })
      .where(eq(schema.salonClientSchema.id, 'client_cycle_a'));

    await expect(db
      .update(schema.salonClientSchema)
      .set({ mergedIntoClientId: 'client_cycle_a' })
      .where(eq(schema.salonClientSchema.id, 'client_cycle_b')))
      .rejects.toThrow(/cyclic same-salon client merge/i);
  });

  it('rolls every client and dependency change back when a late merge step fails', async () => {
    await db.insert(schema.appointmentSchema).values({
      id: 'appt_merge_rollback',
      salonId: SALON_ID,
      salonClientId: 'client_rollback_duplicate',
      clientPhone: '4165550190',
      clientName: 'Rollback Duplicate',
      technicianId: 'tech_lifecycle',
      startTime: new Date('2026-07-30T14:00:00.000Z'),
      endTime: new Date('2026-07-30T15:00:00.000Z'),
      totalDurationMinutes: 60,
      status: 'confirmed',
      totalPrice: 4500,
    });
    await db.insert(schema.auditLogSchema).values({
      id: 'audit_forced-rollback',
      salonId: SALON_ID,
      actorType: 'system',
      action: 'merge_rollback_test_sentinel',
    });

    const primaryBefore = await loadClient('client_rollback_primary');
    const duplicateBefore = await loadClient('client_rollback_duplicate');
    const randomUuid = vi
      .spyOn(crypto, 'randomUUID')
      .mockReturnValue('forced-rollback' as `${string}-${string}-${string}-${string}-${string}`);

    try {
      await expect(mergeSalonClients({
        salonId: SALON_ID,
        primaryClientId: primaryBefore.id,
        duplicateClientId: duplicateBefore.id,
        expectedPrimaryUpdatedAt: primaryBefore.updatedAt,
        expectedDuplicateUpdatedAt: duplicateBefore.updatedAt,
        actor: ACTOR,
      })).rejects.toThrow();
    } finally {
      randomUuid.mockRestore();
    }

    const primaryAfter = await loadClient(primaryBefore.id);
    const duplicateAfter = await loadClient(duplicateBefore.id);
    const [appointmentAfter] = await db
      .select()
      .from(schema.appointmentSchema)
      .where(eq(schema.appointmentSchema.id, 'appt_merge_rollback'));

    expect(primaryAfter).toMatchObject({
      phone: primaryBefore.phone,
      updatedAt: primaryBefore.updatedAt,
    });
    expect(duplicateAfter).toMatchObject({
      archivedAt: null,
      mergedIntoClientId: null,
      phone: duplicateBefore.phone,
      updatedAt: duplicateBefore.updatedAt,
    });
    expect(appointmentAfter?.salonClientId).toBe(duplicateBefore.id);
    expect(await db
      .select()
      .from(schema.salonClientContactAliasSchema)
      .where(and(
        eq(schema.salonClientContactAliasSchema.salonId, SALON_ID),
        eq(
          schema.salonClientContactAliasSchema.salonClientId,
          primaryBefore.id,
        ),
      ))).toEqual([]);
  });

  it('archives/restores history and only permanently deletes an empty archived client', async () => {
    const primary = await loadClient('client_primary');

    await expect(archiveSalonClient({
      salonId: SALON_ID,
      clientId: primary.id,
      expectedUpdatedAt: primary.updatedAt,
      actor: { id: 'staff_lifecycle', role: 'staff' },
    })).rejects.toMatchObject({ code: 'INVALID_CLIENT_STATE' });

    await expect(mergeSalonClients({
      salonId: SALON_ID,
      primaryClientId: primary.id,
      duplicateClientId: 'client_other_salon',
      expectedPrimaryUpdatedAt: primary.updatedAt,
      expectedDuplicateUpdatedAt: primary.updatedAt,
      actor: ACTOR,
    })).rejects.toMatchObject({ code: 'CLIENT_NOT_FOUND' });

    const archived = await archiveSalonClient({
      salonId: SALON_ID,
      clientId: primary.id,
      expectedUpdatedAt: primary.updatedAt,
      actor: ACTOR,
    });

    expect(archived.archivedAt).not.toBeNull();
    expect(await db
      .select({ status: schema.appointmentSchema.status })
      .from(schema.appointmentSchema)
      .where(eq(schema.appointmentSchema.id, 'appt_stale_merge_writer')))
      .toEqual([{ status: 'confirmed' }]);
    expect(await db
      .select({ status: schema.clientCommunicationSchema.status })
      .from(schema.clientCommunicationSchema)
      .where(and(
        eq(schema.clientCommunicationSchema.salonId, SALON_ID),
        eq(schema.clientCommunicationSchema.salonClientId, primary.id),
      ))).toEqual([
      { status: 'dismissed' },
      { status: 'dismissed' },
    ]);

    const activeDirectory = await getSalonClients(SALON_ID, {
      scope: 'active',
      limit: 100,
    });

    expect(activeDirectory.clients.map(row => row.id)).not.toContain(primary.id);
    expect(activeDirectory.clients.map(row => row.id)).not.toContain('client_duplicate');
    expect(await getClientInsightsDirectoryPage({
      salonId: SALON_ID,
      timeZone: 'America/Toronto',
      now: new Date('2026-07-24T16:00:00.000Z'),
      segment: 'active',
      search: 'Duplicate Person',
      sortBy: 'recent',
      sortOrder: 'desc',
      page: 1,
      limit: 50,
    })).toMatchObject({
      total: 0,
      clients: [],
    });

    const archivedDirectory = await getSalonClients(SALON_ID, {
      scope: 'archived',
      limit: 100,
    });

    expect(archivedDirectory.clients.map(row => row.id)).toContain(primary.id);
    expect(archivedDirectory.clients.map(row => row.id)).not.toContain('client_duplicate');
    expect((await getClientDependencySummary({
      salonId: SALON_ID,
      clientId: primary.id,
    })).hardDeleteEligible).toBe(false);

    await expect(permanentlyDeleteSalonClient({
      salonId: SALON_ID,
      clientId: primary.id,
      expectedUpdatedAt: archived.updatedAt,
      actor: ACTOR,
    })).rejects.toMatchObject({ code: 'CLIENT_HAS_HISTORY' });

    const restored = await restoreSalonClient({
      salonId: SALON_ID,
      clientId: primary.id,
      expectedUpdatedAt: archived.updatedAt,
      actor: ACTOR,
    });

    expect(restored.archivedAt).toBeNull();
    expect((await getSalonClients(SALON_ID, {
      scope: 'active',
      limit: 100,
    })).clients.map(row => row.id)).toContain(primary.id);
    expect(await getClientInsightsDirectoryPage({
      salonId: SALON_ID,
      timeZone: 'America/Toronto',
      now: new Date('2026-07-24T16:00:00.000Z'),
      segment: 'active',
      search: 'Duplicate Person',
      sortBy: 'recent',
      sortOrder: 'desc',
      page: 1,
      limit: 50,
    })).toMatchObject({
      total: 1,
      clients: [expect.objectContaining({ id: primary.id })],
    });

    const empty = await loadClient('client_empty');
    const emptyArchived = await archiveSalonClient({
      salonId: SALON_ID,
      clientId: empty.id,
      expectedUpdatedAt: empty.updatedAt,
      actor: ACTOR,
    });

    expect((await getClientDependencySummary({
      salonId: SALON_ID,
      clientId: empty.id,
    })).hardDeleteEligible).toBe(true);

    await permanentlyDeleteSalonClient({
      salonId: SALON_ID,
      clientId: empty.id,
      expectedUpdatedAt: emptyArchived.updatedAt,
      actor: ACTOR,
    });

    expect(await db
      .select()
      .from(schema.salonClientSchema)
      .where(and(
        eq(schema.salonClientSchema.salonId, SALON_ID),
        eq(schema.salonClientSchema.id, empty.id),
      ))).toEqual([]);

    const linked = await loadClient('client_linked_empty');
    const linkedArchived = await archiveSalonClient({
      salonId: SALON_ID,
      clientId: linked.id,
      expectedUpdatedAt: linked.updatedAt,
      actor: ACTOR,
    });
    const linkedDependencies = await getClientDependencySummary({
      salonId: SALON_ID,
      clientId: linked.id,
    });

    expect(linkedDependencies).toMatchObject({
      hasExternalClientIdentity: true,
      hardDeleteEligible: false,
    });
    await expect(permanentlyDeleteSalonClient({
      salonId: SALON_ID,
      clientId: linked.id,
      expectedUpdatedAt: linkedArchived.updatedAt,
      actor: ACTOR,
    })).rejects.toMatchObject({ code: 'CLIENT_HAS_HISTORY' });

    const unlinkedAuth = await loadClient('client_unlinked_auth_identity');
    const unlinkedAuthArchived = await archiveSalonClient({
      salonId: SALON_ID,
      clientId: unlinkedAuth.id,
      expectedUpdatedAt: unlinkedAuth.updatedAt,
      actor: ACTOR,
    });

    expect((await getClientDependencySummary({
      salonId: SALON_ID,
      clientId: unlinkedAuth.id,
    }))).toMatchObject({
      hasExternalClientIdentity: true,
      hardDeleteEligible: false,
    });
    await expect(permanentlyDeleteSalonClient({
      salonId: SALON_ID,
      clientId: unlinkedAuth.id,
      expectedUpdatedAt: unlinkedAuthArchived.updatedAt,
      actor: ACTOR,
    })).rejects.toMatchObject({ code: 'CLIENT_HAS_HISTORY' });

    const meaningful = await loadClient('client_meaningful_empty');
    const meaningfulArchived = await archiveSalonClient({
      salonId: SALON_ID,
      clientId: meaningful.id,
      expectedUpdatedAt: meaningful.updatedAt,
      actor: ACTOR,
    });

    expect((await getClientDependencySummary({
      salonId: SALON_ID,
      clientId: meaningful.id,
    }))).toMatchObject({
      counts: { profileState: 1 },
      hardDeleteEligible: false,
    });
    await expect(permanentlyDeleteSalonClient({
      salonId: SALON_ID,
      clientId: meaningful.id,
      expectedUpdatedAt: meaningfulArchived.updatedAt,
      actor: ACTOR,
    })).rejects.toMatchObject({ code: 'CLIENT_HAS_HISTORY' });

    await db.insert(schema.communicationConsentSchema).values({
      id: 'consent_empty_client',
      salonId: SALON_ID,
      recipient: '4165550196',
      channel: 'sms',
      purpose: 'appointment_transactional',
      status: 'granted',
      wordingVersion: 'test-v1',
      source: 'test',
      grantedAt: new Date('2026-07-24T00:00:00.000Z'),
    });
    const consentClient = await loadClient('client_consent_empty');
    const consentArchived = await archiveSalonClient({
      salonId: SALON_ID,
      clientId: consentClient.id,
      expectedUpdatedAt: consentClient.updatedAt,
      actor: ACTOR,
    });

    expect((await getClientDependencySummary({
      salonId: SALON_ID,
      clientId: consentClient.id,
    }))).toMatchObject({
      counts: { communicationConsents: 1 },
      hardDeleteEligible: false,
    });
    await expect(permanentlyDeleteSalonClient({
      salonId: SALON_ID,
      clientId: consentClient.id,
      expectedUpdatedAt: consentArchived.updatedAt,
      actor: ACTOR,
    })).rejects.toMatchObject({ code: 'CLIENT_HAS_HISTORY' });

    const sharedA = await loadClient('client_shared_email_a');
    const sharedB = await loadClient('client_shared_email_b');
    const sharedAArchived = await archiveSalonClient({
      salonId: SALON_ID,
      clientId: sharedA.id,
      expectedUpdatedAt: sharedA.updatedAt,
      actor: ACTOR,
    });
    await archiveSalonClient({
      salonId: SALON_ID,
      clientId: sharedB.id,
      expectedUpdatedAt: sharedB.updatedAt,
      actor: ACTOR,
    });
    const restoredWithOnlyArchivedMatch = await restoreSalonClient({
      salonId: SALON_ID,
      clientId: sharedA.id,
      expectedUpdatedAt: sharedAArchived.updatedAt,
      actor: ACTOR,
    });

    expect(restoredWithOnlyArchivedMatch.archivedAt).toBeNull();

    const archivedSharedB = await loadClient(sharedB.id);

    await expect(restoreSalonClient({
      salonId: SALON_ID,
      clientId: archivedSharedB.id,
      expectedUpdatedAt: archivedSharedB.updatedAt,
      actor: ACTOR,
    })).rejects.toMatchObject({
      code: 'POSSIBLE_DUPLICATE',
      duplicates: [expect.objectContaining({ id: sharedA.id })],
    });
  });
});
