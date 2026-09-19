import path from 'node:path';

import { PGlite } from '@electric-sql/pglite';
import { and, eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { DEFAULT_RETENTION_SETTINGS } from '@/libs/retentionAssistant';
import * as schema from '@/models/Schema';

vi.mock('server-only', () => ({}));

const holder = vi.hoisted(() => ({ db: null as unknown }));
vi.mock('@/libs/DB', () => ({
  get db() {
    return holder.db;
  },
  usesRuntimePostgres: false,
}));

let client: PGlite;
let db: ReturnType<typeof drizzle<typeof schema>>;
let sequence = 0;

const messageTemplate = 'Thanks {{firstName}} for visiting {{businessName}}: {{reviewLink}}';
const reviewUrl = 'https://g.page/r/luster-review';

beforeAll(async () => {
  client = new PGlite();
  db = drizzle(client, { schema });
  await migrate(db, { migrationsFolder: path.join(process.cwd(), 'migrations') });
  holder.db = db;
}, 30_000);

afterAll(async () => client.close());

async function seed(input: {
  mode?: 'manual' | 'marked_completed' | 'scheduled_end' | null;
  automaticEnabled?: boolean;
  cooldown?: 90 | 180 | 365 | null;
  googleReviewUrl?: string | null;
  enabledAt?: Date | null;
  revision?: number;
  smsEnabled?: boolean;
  active?: boolean;
} = {}) {
  sequence += 1;
  const salonId = `review-settings-salon-${sequence}`;
  const appointmentId = `review-settings-appointment-${sequence}`;
  const clientId = `review-settings-client-${sequence}`;
  await db.insert(schema.salonSchema).values({
    id: salonId,
    slug: salonId,
    name: `Review Settings ${sequence}`,
    isActive: input.active ?? true,
    settings: {
      communications: { sms: { enabled: input.smsEnabled ?? true } },
      booking: { timezone: 'America/Toronto' },
    } as never,
  });
  await db.insert(schema.salonClientSchema).values({
    id: clientId,
    salonId,
    fullName: 'Sarah Client',
    phone: `416555${String(1000 + sequence).padStart(4, '0')}`,
  });
  await db.insert(schema.communicationConsentSchema).values({
    id: `review-settings-consent-${sequence}`,
    salonId,
    recipient: `416555${String(1000 + sequence).padStart(4, '0')}`,
    channel: 'sms',
    purpose: 'appointment_transactional',
    status: 'granted',
    source: 'test',
    wordingVersion: 'test-v1',
  });
  await db.insert(schema.appointmentSchema).values({
    id: appointmentId,
    salonId,
    salonClientId: clientId,
    clientName: 'Sarah Client',
    clientPhone: `416555${String(1000 + sequence).padStart(4, '0')}`,
    startTime: new Date('2030-09-12T18:30:00.000Z'),
    endTime: new Date('2030-09-12T19:30:00.000Z'),
    status: 'completed',
    completedAt: new Date('2030-09-12T19:30:00.000Z'),
    totalPrice: 5000,
    totalDurationMinutes: 60,
  });
  await db.insert(schema.salonRetentionSettingsSchema).values({
    salonId,
    googleReviewUrl: input.googleReviewUrl === undefined ? reviewUrl : input.googleReviewUrl,
    automaticReviewRequests: input.automaticEnabled ?? true,
    reviewRequestAutomationMode: input.mode === undefined ? 'scheduled_end' : input.mode,
    reviewRequestsEnabledAt: input.enabledAt === undefined ? new Date('2029-01-01T00:00:00.000Z') : input.enabledAt,
    reviewRequestDelayMinutes: 60,
    reviewRequestRepeatCooldownDays: input.cooldown === undefined ? 90 : input.cooldown,
    reviewRequestPolicyRevision: input.revision ?? 4,
    reviewRequestMessage: messageTemplate,
  });
  return { salonId, appointmentId };
}

function explicit(mode: 'manual' | 'marked_completed' | 'scheduled_end', cooldown: 90 | 180 | 365 | 'never', overrides: Record<string, unknown> = {}) {
  return {
    googleReviewUrl: reviewUrl,
    automationMode: mode,
    delayMinutes: 60,
    repeatCooldownDays: cooldown,
    messageTemplate,
    ...overrides,
  };
}

function legacy(automaticEnabled: boolean, overrides: Record<string, unknown> = {}) {
  return { googleReviewUrl: reviewUrl, automaticEnabled, delayMinutes: 60, messageTemplate, ...overrides };
}

async function addReservation(salonId: string, appointmentId: string, automatic: boolean) {
  const { scheduleReviewRequest } = await import('./reviewRequests.server');
  await scheduleReviewRequest(db, salonId, appointmentId, automatic);
  const [request] = await db.select().from(schema.reviewRequestSchema)
    .where(and(eq(schema.reviewRequestSchema.salonId, salonId), eq(schema.reviewRequestSchema.appointmentId, appointmentId)));
  const [intent] = await db.select().from(schema.communicationIntentSchema)
    .where(eq(schema.communicationIntentSchema.id, request!.intentId));
  return { request: request!, intent: intent! };
}

async function addAppointmentForSalon(salonId: string, sourceAppointmentId: string, name: string) {
  sequence += 1;
  const appointmentId = `review-settings-appointment-${sequence}`;
  const clientId = `review-settings-client-${sequence}`;
  const phone = `416555${String(1000 + sequence).padStart(4, '0')}`;
  const [source] = await db.select().from(schema.appointmentSchema).where(eq(schema.appointmentSchema.id, sourceAppointmentId));
  await db.insert(schema.salonClientSchema).values({ id: clientId, salonId, fullName: name, phone });
  await db.insert(schema.communicationConsentSchema).values({ id: `${clientId}-consent`, salonId, recipient: phone, channel: 'sms', purpose: 'appointment_transactional', status: 'granted', source: 'test', wordingVersion: 'test' });
  await db.insert(schema.appointmentSchema).values({ ...source!, id: appointmentId, salonClientId: clientId, clientName: name, clientPhone: phone });
  return appointmentId;
}

describe('review automation settings persistence', () => {
  it.each([
    ['manual', 90],
    ['marked_completed', 180],
    ['scheduled_end', 365],
    ['scheduled_end', 'never'],
  ] as const)('persists explicit %s policy with %s-day repeat cooldown', async (mode, cooldown) => {
    const fixture = await seed();
    const { getReviewSettings, saveReviewSettings } = await import('./reviewRequests.server');

    await saveReviewSettings(fixture.salonId, explicit(mode, cooldown));
    const settings = await getReviewSettings(fixture.salonId);

    expect(settings.policy).toMatchObject({ mode, repeatCooldownDays: cooldown });
    expect(settings.automaticEnabled).toBe(mode !== 'manual');
  });

  it('keeps a paused legacy scheduled-end mode and restores it when the legacy boolean is enabled', async () => {
    const fixture = await seed({ mode: 'scheduled_end', automaticEnabled: true });
    const { getReviewSettings, saveReviewSettings } = await import('./reviewRequests.server');

    await saveReviewSettings(fixture.salonId, legacy(false));

    expect(await getReviewSettings(fixture.salonId)).toMatchObject({
      automaticEnabled: false,
      storedAutomationMode: 'scheduled_end',
      policy: { mode: 'manual' },
    });

    await saveReviewSettings(fixture.salonId, legacy(true));

    expect(await getReviewSettings(fixture.salonId)).toMatchObject({
      automaticEnabled: true,
      storedAutomationMode: 'scheduled_end',
      policy: { mode: 'scheduled_end' },
    });
  });

  it('upgrades an explicitly stored legacy manual mode on enable, then preserves its activation epoch on a repeated save', async () => {
    const fixture = await seed({ mode: 'manual', automaticEnabled: false, enabledAt: null, revision: 4 });
    const { getReviewSettings, saveReviewSettings } = await import('./reviewRequests.server');

    await saveReviewSettings(fixture.salonId, legacy(true));
    const enabled = await getReviewSettings(fixture.salonId);

    expect(enabled).toMatchObject({
      automaticEnabled: true,
      storedAutomationMode: 'marked_completed',
      policy: { mode: 'marked_completed' },
      policyRevision: 5,
    });
    expect(enabled.enabledAt).not.toBeNull();

    await saveReviewSettings(fixture.salonId, legacy(true));

    expect(await getReviewSettings(fixture.salonId)).toMatchObject({
      enabledAt: enabled.enabledAt,
      policyRevision: enabled.policyRevision,
      policy: { mode: 'marked_completed' },
    });
  });

  it('preserves a legacy cooldown and accepts a persisted custom 17-minute delay without changing legacy delay validation', async () => {
    const fixture = await seed({ cooldown: 180 });
    const { getReviewSettings, saveReviewSettings } = await import('./reviewRequests.server');

    await saveReviewSettings(fixture.salonId, legacy(true, { messageTemplate: `${messageTemplate} Again` }));

    expect((await getReviewSettings(fixture.salonId)).policy.repeatCooldownDays).toBe(180);

    await saveReviewSettings(fixture.salonId, explicit('scheduled_end', 180, { delayMinutes: 17 }));

    expect((await getReviewSettings(fixture.salonId)).policy.delayMinutes).toBe(17);
    await expect(saveReviewSettings(fixture.salonId, legacy(true, { delayMinutes: 17 }))).rejects.toThrow();
  });

  it('rejects mixed legacy and explicit payloads', async () => {
    const fixture = await seed();
    const { saveReviewSettings } = await import('./reviewRequests.server');

    await expect(saveReviewSettings(fixture.salonId, {
      ...explicit('scheduled_end', 90),
      automaticEnabled: true,
    })).rejects.toThrow();
  });

  it('does not retime pending work for a delay-only edit, but fences a mode switch without backfilling', async () => {
    const fixture = await seed({ mode: 'scheduled_end', revision: 4 });
    const { getReviewSettings, saveReviewSettings } = await import('./reviewRequests.server');
    const reservation = await addReservation(fixture.salonId, fixture.appointmentId, true);
    const before = await getReviewSettings(fixture.salonId);

    await saveReviewSettings(fixture.salonId, explicit('scheduled_end', 90, { delayMinutes: 17 }));
    const unchangedIntent = await db.select().from(schema.communicationIntentSchema).where(eq(schema.communicationIntentSchema.id, reservation.intent.id)).then(rows => rows[0]!);

    expect(unchangedIntent.availableAt).toEqual(reservation.intent.availableAt);
    expect(await getReviewSettings(fixture.salonId)).toMatchObject({ enabledAt: before.enabledAt, policyRevision: before.policyRevision });

    await saveReviewSettings(fixture.salonId, explicit('marked_completed', 90, { delayMinutes: 17 }));
    const [request] = await db.select().from(schema.reviewRequestSchema).where(eq(schema.reviewRequestSchema.id, reservation.request.id));
    const [intent] = await db.select().from(schema.communicationIntentSchema).where(eq(schema.communicationIntentSchema.id, reservation.intent.id));

    expect(request).toMatchObject({ status: 'cancelled' });
    expect(intent).toMatchObject({ status: 'canceled' });
    expect(await db.select().from(schema.reviewRequestTriggerSchema).where(eq(schema.reviewRequestTriggerSchema.salonId, fixture.salonId))).toHaveLength(0);
    expect((await getReviewSettings(fixture.salonId)).policyRevision).toBe(before.policyRevision + 1);
  });

  it('cancels automatic never-sent work on mode-off while retaining manual work', async () => {
    const fixture = await seed({ mode: 'scheduled_end' });
    const automatic = await addReservation(fixture.salonId, fixture.appointmentId, true);
    const secondAppointment = await addAppointmentForSalon(fixture.salonId, fixture.appointmentId, 'Manual Client');
    const manual = await addReservation(fixture.salonId, secondAppointment, false);
    const { saveReviewSettings } = await import('./reviewRequests.server');

    await saveReviewSettings(fixture.salonId, explicit('manual', 90));
    const [automaticRequest] = await db.select().from(schema.reviewRequestSchema).where(eq(schema.reviewRequestSchema.id, automatic.request.id));
    const [manualRequest] = await db.select().from(schema.reviewRequestSchema).where(eq(schema.reviewRequestSchema.id, manual.request.id));

    expect(automaticRequest!.status).toBe('cancelled');
    expect(manualRequest!.status).toBe('scheduled');
  });

  it('clearing a link cancels all never-sent work, restoring it creates a fresh active epoch, and sending or unknown states remain intact', async () => {
    const fixture = await seed({ mode: 'scheduled_end', revision: 4 });
    const automatic = await addReservation(fixture.salonId, fixture.appointmentId, true);
    const pendingAutomaticAppointment = await addAppointmentForSalon(fixture.salonId, fixture.appointmentId, 'Pending Automatic Client');
    const pendingAutomatic = await addReservation(fixture.salonId, pendingAutomaticAppointment, true);
    const manualAppointment = await addAppointmentForSalon(fixture.salonId, fixture.appointmentId, 'Manual Client');
    const manual = await addReservation(fixture.salonId, manualAppointment, false);
    const unknownAppointment = await addAppointmentForSalon(fixture.salonId, fixture.appointmentId, 'Unknown Client');
    const unknown = await addReservation(fixture.salonId, unknownAppointment, true);
    const evidencedAppointment = await addAppointmentForSalon(fixture.salonId, fixture.appointmentId, 'Evidenced Client');
    const evidenced = await addReservation(fixture.salonId, evidencedAppointment, true);
    const { getReviewSettings, saveReviewSettings } = await import('./reviewRequests.server');
    await db.update(schema.communicationIntentSchema).set({ status: 'sending' }).where(eq(schema.communicationIntentSchema.id, automatic.intent.id));
    await db.update(schema.communicationIntentSchema).set({ status: 'send_outcome_unknown' }).where(eq(schema.communicationIntentSchema.id, unknown.intent.id));
    await db.update(schema.communicationIntentSchema).set({ status: 'claimed' }).where(eq(schema.communicationIntentSchema.id, evidenced.intent.id));
    await db.insert(schema.notificationDeliverySchema).values({
      id: `review-settings-delivery-${sequence}`,
      salonId: fixture.salonId,
      appointmentId: evidencedAppointment,
      channel: 'sms',
      purpose: 'review_request',
      dedupeKey: `review-settings-delivery-${sequence}`,
      intentId: evidenced.intent.id,
      providerMessageId: 'SM-provider-evidence',
      status: 'sent',
    });
    const before = await getReviewSettings(fixture.salonId);

    await saveReviewSettings(fixture.salonId, explicit('scheduled_end', 90, { googleReviewUrl: null }));
    const [sendingRequest] = await db.select().from(schema.reviewRequestSchema).where(eq(schema.reviewRequestSchema.id, automatic.request.id));
    const [sendingIntent] = await db.select().from(schema.communicationIntentSchema).where(eq(schema.communicationIntentSchema.id, automatic.intent.id));
    const [pendingAutomaticRequest] = await db.select().from(schema.reviewRequestSchema).where(eq(schema.reviewRequestSchema.id, pendingAutomatic.request.id));
    const [manualRequest] = await db.select().from(schema.reviewRequestSchema).where(eq(schema.reviewRequestSchema.id, manual.request.id));
    const [unknownRequest] = await db.select().from(schema.reviewRequestSchema).where(eq(schema.reviewRequestSchema.id, unknown.request.id));
    const [unknownIntent] = await db.select().from(schema.communicationIntentSchema).where(eq(schema.communicationIntentSchema.id, unknown.intent.id));
    const [evidencedRequest] = await db.select().from(schema.reviewRequestSchema).where(eq(schema.reviewRequestSchema.id, evidenced.request.id));
    const [evidencedIntent] = await db.select().from(schema.communicationIntentSchema).where(eq(schema.communicationIntentSchema.id, evidenced.intent.id));

    expect(sendingRequest!.status).toBe('scheduled');
    expect(sendingIntent!.status).toBe('sending');
    expect(pendingAutomaticRequest!.status).toBe('cancelled');
    expect(manualRequest!.status).toBe('cancelled');
    expect(unknownRequest!.status).toBe('scheduled');
    expect(unknownIntent!.status).toBe('send_outcome_unknown');
    expect(evidencedRequest!.status).toBe('scheduled');
    expect(evidencedIntent!.status).toBe('claimed');

    await saveReviewSettings(fixture.salonId, explicit('scheduled_end', 90));
    const restored = await getReviewSettings(fixture.salonId);

    expect(restored.policyRevision).toBe(before.policyRevision + 1);
    expect(restored.enabledAt).not.toEqual(before.enabledAt);
  });

  it('reports configured readiness separately from delivery eligibility', async () => {
    const { getReviewSettings } = await import('./reviewRequests.server');
    const missingLink = await seed({ googleReviewUrl: null });
    const noSms = await seed({ smsEnabled: false });
    const inactive = await seed({ active: false });

    await expect(getReviewSettings(missingLink.salonId)).resolves.toMatchObject({ readiness: { status: 'needs_setup', reasons: ['Add a valid Google review link.'] } });
    await expect(getReviewSettings(noSms.salonId)).resolves.toMatchObject({ readiness: { status: 'needs_setup', reasons: ['Enable Luster SMS in Client communications.'] } });
    await expect(getReviewSettings(inactive.salonId)).resolves.toMatchObject({ readiness: { status: 'needs_setup', reasons: ['This business is unavailable.'] } });
  });

  it('applies the same review-link transition through retention PATCH without retiming unrelated retention changes', async () => {
    const fixture = await seed({ mode: 'scheduled_end', revision: 4 });
    const reservation = await addReservation(fixture.salonId, fixture.appointmentId, true);
    const { getReviewSettings } = await import('./reviewRequests.server');
    const { patchRetentionSettingsForSalon } = await import('./retentionSettings.server');
    const before = await getReviewSettings(fixture.salonId);

    await patchRetentionSettingsForSalon(fixture.salonId, { parkingInstructions: 'Use the rear entrance' });

    expect(await getReviewSettings(fixture.salonId)).toMatchObject({
      enabledAt: before.enabledAt,
      policyRevision: before.policyRevision,
    });

    await patchRetentionSettingsForSalon(fixture.salonId, { googleReviewUrl: null });
    const [cancelled] = await db.select().from(schema.reviewRequestSchema).where(eq(schema.reviewRequestSchema.id, reservation.request.id));

    expect(cancelled!.status).toBe('cancelled');

    await patchRetentionSettingsForSalon(fixture.salonId, { googleReviewUrl: reviewUrl });
    const restored = await getReviewSettings(fixture.salonId);

    expect(restored.policyRevision).toBe(before.policyRevision + 1);
    expect(restored.enabledAt).not.toEqual(before.enabledAt);
    expect(await db.select().from(schema.reviewRequestTriggerSchema).where(eq(schema.reviewRequestTriggerSchema.salonId, fixture.salonId))).toHaveLength(0);
  });

  it('applies the same clear-and-restore fence through a full retention save', async () => {
    const fixture = await seed({ mode: 'scheduled_end', revision: 4 });
    const reservation = await addReservation(fixture.salonId, fixture.appointmentId, true);
    const { getReviewSettings } = await import('./reviewRequests.server');
    const { saveRetentionSettingsForSalon } = await import('./retentionSettings.server');
    const before = await getReviewSettings(fixture.salonId);

    await saveRetentionSettingsForSalon(fixture.salonId, { ...DEFAULT_RETENTION_SETTINGS, googleReviewUrl: null });
    const [cancelled] = await db.select().from(schema.reviewRequestSchema).where(eq(schema.reviewRequestSchema.id, reservation.request.id));

    expect(cancelled!.status).toBe('cancelled');

    await saveRetentionSettingsForSalon(fixture.salonId, { ...DEFAULT_RETENTION_SETTINGS, googleReviewUrl: reviewUrl });

    expect(await getReviewSettings(fixture.salonId)).toMatchObject({
      policyRevision: before.policyRevision + 1,
    });
  });
});
