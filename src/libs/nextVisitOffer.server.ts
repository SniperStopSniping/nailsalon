import 'server-only';

import { and, desc, eq, inArray, isNull, sql } from 'drizzle-orm';

import { resolveCatalogDomainView } from '@/libs/bookingCatalog';
import { resolveBookingConfigFromSettings } from '@/libs/bookingConfig';
import { resolvePublicCatalogSnapshot } from '@/libs/catalogResolver.server';
import {
  getSalonClientLineageIdsWithHandle,
  type LifecycleSqlHandle,
  resolveOperationalSalonClientByPhoneWithHandle,
  resolveTerminalSalonClientWithHandle,
} from '@/libs/clientLifecycleStabilization';
import { db } from '@/libs/DB';
import {
  calculateNextVisitOfferDiscount,
  getNextVisitOfferDeadline,
  resolveNextVisitOfferSettings,
  toNextVisitRetentionPromotion,
} from '@/libs/nextVisitOffer';
import { projectPublicBookingCatalog } from '@/libs/publicBookingCatalog';
import { createRetentionCampaignToken, hashRetentionCampaignToken } from '@/libs/retentionCampaigns';
import { getPublicBookableServiceIds } from '@/libs/serviceAssignments';
import {
  type Appointment,
  appointmentSchema,
  nextVisitOfferEventSchema,
  nextVisitOfferSchema,
  retentionCampaignSchema,
  salonClientSchema,
  salonRetentionSettingsSchema,
  salonSchema,
  serviceSchema,
} from '@/models/Schema';
import type { SalonSettings } from '@/types/salonPolicy';

type Transaction = Parameters<Parameters<typeof db.transaction>[0]>[0];
export type NextVisitHandle = Transaction | typeof db;
export type NextVisitOfferReference = { campaignId: string; entitlementId: string };
export const NEXT_VISIT_DISCOUNT_TYPE = 'next_visit';
export const NEXT_VISIT_DISCOUNT_LABEL = 'Next Visit Offer';

export class NextVisitOfferError extends Error {
  readonly code = 'NEXT_VISIT_OFFER_CHANGED';
  constructor(message = 'Your next visit offer has changed. Review the service, date and price before confirming.') {
    super(message);
    this.name = 'NextVisitOfferError';
  }
}

/** Called only inside the successful authoritative completion transaction. */
export async function issueNextVisitOfferOnCompletion(handle: NextVisitHandle, appointment: Appointment): Promise<void> {
  if (appointment.status !== 'completed' || !appointment.completedAt || appointment.deletedAt
    || !appointment.salonClientId || !appointment.finalTaxSnapshot || (appointment.finalPriceCents ?? 0) <= 0
    || appointment.paymentStatus === 'comp') {
    return;
  }
  const [row] = await handle.select().from(salonRetentionSettingsSchema)
    .where(eq(salonRetentionSettingsSchema.salonId, appointment.salonId)).limit(1);
  const settings = resolveNextVisitOfferSettings(row?.nextVisitOffer);
  if (!settings.enabled || !row?.nextVisitOfferEnabledAt || appointment.completedAt < row.nextVisitOfferEnabledAt) {
    return;
  }
  const [salon] = await handle.select({ settings: salonSchema.settings }).from(salonSchema)
    .where(eq(salonSchema.id, appointment.salonId)).limit(1);
  if (!salon) {
    throw new NextVisitOfferError();
  }
  const config = resolveBookingConfigFromSettings(salon.settings as SalonSettings | null);
  const deadline = getNextVisitOfferDeadline({ completedAt: appointment.completedAt, windowDays: settings.windowDays, timeZone: config.timezone });
  // Completion already holds the appointment. Avoid waiting for the client FK
  // lock while a lifecycle writer holds the client and waits for this visit.
  await handle.execute(sql`SELECT id FROM salon_client WHERE salon_id = ${appointment.salonId} AND id = ${appointment.salonClientId} FOR KEY SHARE NOWAIT`);
  const [created] = await handle.insert(nextVisitOfferSchema).values({
    id: `next_visit_${crypto.randomUUID()}`,
    salonId: appointment.salonId,
    salonClientId: appointment.salonClientId,
    sourceAppointmentId: appointment.id,
    qualifiedAt: appointment.completedAt,
    timeZone: config.timezone,
    ...deadline,
    currency: appointment.invoiceCurrency ?? config.currency,
    settingsSnapshot: settings,
  }).onConflictDoNothing({ target: [nextVisitOfferSchema.salonId, nextVisitOfferSchema.sourceAppointmentId] }).returning();
  if (created) {
    await recordNextVisitEvent(handle, created, appointment.id, 'issued');
  }
}

export async function recordNextVisitEvent(
  handle: NextVisitHandle,
  offer: { id: string; salonId: string },
  appointmentId: string | null,
  kind: string,
  amountCents?: number,
  reason?: string,
): Promise<void> {
  await handle.insert(nextVisitOfferEventSchema).values({
    id: crypto.randomUUID(),
    salonId: offer.salonId,
    offerId: offer.id,
    appointmentId,
    kind,
    amountCents: amountCents ?? null,
    reason: reason ?? null,
  });
}

/** A new opaque link references the SAME immutable source-visit offer. */
export async function mintNextVisitOfferLink(handle: NextVisitHandle, args: {
  salonId: string;
  sourceAppointmentId: string;
  now?: Date;
}): Promise<{ token: string; offer: typeof nextVisitOfferSchema.$inferSelect } | null> {
  const now = args.now ?? new Date();
  const [offer] = await handle.select().from(nextVisitOfferSchema).where(and(
    eq(nextVisitOfferSchema.salonId, args.salonId),
    eq(nextVisitOfferSchema.sourceAppointmentId, args.sourceAppointmentId),
  )).limit(1);
  if (!offer || offer.state !== 'available' || offer.expiresAt <= now) {
    return null;
  }
  // No new entitlement is issued here, and no message/provider is invoked.
  const token = createRetentionCampaignToken();
  await handle.insert(retentionCampaignSchema).values({
    id: `campaign_${crypto.randomUUID()}`,
    salonId: offer.salonId,
    salonClientId: offer.salonClientId,
    tokenHash: hashRetentionCampaignToken(token),
    stage: 'next_visit',
    nextVisitOfferId: offer.id,
    promotionSnapshot: toNextVisitRetentionPromotion(offer.settingsSnapshot),
    expiresAt: offer.expiresAt,
    singleUse: true,
  });
  return { token, offer };
}

/**
 * Returns an already-issued offer only when the current program is enabled and
 * its source visit still satisfies the same completion invariants used when a
 * campaign is later validated. This is intentionally a read-only helper: a
 * customer must still deliberately start a new booking before a campaign link
 * is minted.
 */
export async function getAvailableNextVisitOfferForSourceAppointment(handle: NextVisitHandle, args: {
  salonId: string;
  sourceAppointmentId: string;
  now?: Date;
}): Promise<typeof nextVisitOfferSchema.$inferSelect | null> {
  const now = args.now ?? new Date();
  const [[retention], [offer], [source], [salon], activeServices] = await Promise.all([
    handle.select({ nextVisitOffer: salonRetentionSettingsSchema.nextVisitOffer })
      .from(salonRetentionSettingsSchema)
      .where(eq(salonRetentionSettingsSchema.salonId, args.salonId))
      .limit(1),
    handle.select().from(nextVisitOfferSchema).where(and(
      eq(nextVisitOfferSchema.salonId, args.salonId),
      eq(nextVisitOfferSchema.sourceAppointmentId, args.sourceAppointmentId),
    )).limit(1),
    handle.select({
      status: appointmentSchema.status,
      completedAt: appointmentSchema.completedAt,
      deletedAt: appointmentSchema.deletedAt,
    }).from(appointmentSchema).where(and(
      eq(appointmentSchema.salonId, args.salonId),
      eq(appointmentSchema.id, args.sourceAppointmentId),
    )).limit(1),
    handle.select({ settings: salonSchema.settings, features: salonSchema.features }).from(salonSchema)
      .where(eq(salonSchema.id, args.salonId)).limit(1),
    handle.select({ id: serviceSchema.id, priceCents: serviceSchema.price }).from(serviceSchema).where(and(
      eq(serviceSchema.salonId, args.salonId),
      eq(serviceSchema.isActive, true),
    )),
  ]);
  if (!resolveNextVisitOfferSettings(retention?.nextVisitOffer).enabled
    || !offer
    || offer.state !== 'available'
    || offer.expiresAt <= now
    || !source
    || source.status !== 'completed'
    || source.deletedAt
    || !source.completedAt
    || source.completedAt.getTime() !== offer.qualifiedAt.getTime()
    || !salon
    || offer.currency.toUpperCase() !== resolveBookingConfigFromSettings(salon.settings as SalonSettings | null).currency.toUpperCase()) {
    return null;
  }
  const publicBookableIds = await getPublicBookableServiceIds(args.salonId);
  let publicServices = activeServices.filter(service => publicBookableIds === null || publicBookableIds.has(service.id));
  if (resolveCatalogDomainView(salon.features) === 'l1') {
    const snapshot = await resolvePublicCatalogSnapshot({ salonId: args.salonId, requestedSource: 'live' });
    if (!snapshot.ok) {
      return null;
    }
    const l1ServiceIds = new Set(projectPublicBookingCatalog(snapshot.snapshot, publicBookableIds).services.map(service => service.id));
    publicServices = publicServices.filter(service => l1ServiceIds.has(service.id));
  }
  if (calculateNextVisitOfferDiscount({ settings: offer.settingsSnapshot, services: publicServices }).discountAmountCents <= 0) {
    return null;
  }
  try {
    const terminal = await resolveTerminalSalonClientWithHandle(handle as LifecycleSqlHandle, {
      salonId: args.salonId,
      clientId: offer.salonClientId,
    });
    const [client] = await handle.select({ isBlocked: salonClientSchema.isBlocked })
      .from(salonClientSchema)
      .where(and(
        eq(salonClientSchema.salonId, args.salonId),
        eq(salonClientSchema.id, terminal.id),
      ))
      .limit(1);
    if (!client || client.isBlocked) {
      return null;
    }
  } catch {
    return null;
  }
  return offer;
}

export type NextVisitOfferPreview = {
  reference: NextVisitOfferReference;
  status: 'eligible' | 'ineligible';
  reason: string;
  discountAmountCents: number;
  label: typeof NEXT_VISIT_DISCOUNT_LABEL;
  deadlineDate: string;
  timeZone: string;
  currency: string;
  promotion: ReturnType<typeof toNextVisitRetentionPromotion>;
};

/**
 * Bounded read model for conversational surfaces (and a future phone
 * receptionist). It intentionally contains no client, source appointment,
 * entitlement, campaign token, or raw reference.
 */
export type NextVisitOfferAssistantFacts = {
  kind: 'program' | 'bound';
  status: 'active' | 'eligible' | 'no_eligible_service' | 'outside_window' | 'already_attached_or_used' | 'expired' | 'unavailable';
  deadlineDate: string | null;
  currency: string;
  promotion: ReturnType<typeof toNextVisitRetentionPromotion>;
};

export async function getNextVisitOfferAssistantFacts(args: {
  salonId: string;
  reference?: NextVisitOfferReference;
  services: Array<{ id: string; priceCents: number }>;
  startTime?: string;
}): Promise<NextVisitOfferAssistantFacts | null> {
  if (args.reference) {
    const preview = await resolveNextVisitOfferPreview({
      salonId: args.salonId,
      reference: args.reference,
      services: args.services,
      ...(args.startTime ? { startTime: args.startTime } : {}),
    });
    if (!preview) {
      return null;
    }
    const status: NextVisitOfferAssistantFacts['status'] = preview.status === 'eligible'
      ? 'eligible'
      : preview.reason === 'NO_ELIGIBLE_SERVICE'
        ? 'no_eligible_service'
        : preview.reason === 'OUTSIDE_WINDOW'
          ? 'outside_window'
          : preview.reason === 'ALREADY_USED'
            ? 'already_attached_or_used'
            : preview.reason === 'EXPIRED'
              ? 'expired'
              : 'unavailable';
    return { kind: 'bound', status, deadlineDate: preview.deadlineDate, currency: preview.currency, promotion: preview.promotion };
  }

  const [[retention], [salon]] = await Promise.all([
    db.select({ nextVisitOffer: salonRetentionSettingsSchema.nextVisitOffer }).from(salonRetentionSettingsSchema)
      .where(eq(salonRetentionSettingsSchema.salonId, args.salonId)).limit(1),
    db.select({ settings: salonSchema.settings }).from(salonSchema).where(eq(salonSchema.id, args.salonId)).limit(1),
  ]);
  const settings = resolveNextVisitOfferSettings(retention?.nextVisitOffer);
  if (!settings.enabled || !salon) {
    return null;
  }
  const config = resolveBookingConfigFromSettings(salon.settings as SalonSettings | null);
  return {
    kind: 'program',
    status: 'active',
    deadlineDate: null,
    currency: config.currency,
    promotion: toNextVisitRetentionPromotion(settings),
  };
}

/** Public read: opaque capability + tenant scope; never exposes client/history. */
export async function resolveNextVisitOfferPreview(args: {
  salonId: string;
  token?: string | null;
  reference?: NextVisitOfferReference;
  clientPhone?: string;
  clientId?: string;
  startTime?: string | Date;
  services: Array<{ id: string; priceCents: number }>;
  now?: Date;
  handle?: NextVisitHandle;
  reservedAppointmentId?: string;
}): Promise<NextVisitOfferPreview | null> {
  if (!args.token && !args.reference) {
    return null;
  }
  if (args.token && !/^[\w-]{32,200}$/.test(args.token)) {
    return null;
  }
  const handle = args.handle ?? db;
  const [campaign] = await handle.select().from(retentionCampaignSchema).where(and(
    eq(retentionCampaignSchema.salonId, args.salonId),
    eq(retentionCampaignSchema.stage, 'next_visit'),
    args.reference
      ? eq(retentionCampaignSchema.id, args.reference.campaignId)
      : eq(retentionCampaignSchema.tokenHash, hashRetentionCampaignToken(args.token!)),
  )).limit(1);
  if (!campaign?.nextVisitOfferId || (args.reference && campaign.nextVisitOfferId !== args.reference.entitlementId)) {
    return null;
  }
  const [offer] = await handle.select().from(nextVisitOfferSchema).where(and(
    eq(nextVisitOfferSchema.salonId, args.salonId),
    eq(nextVisitOfferSchema.id, campaign.nextVisitOfferId),
  )).limit(1);
  if (!offer) {
    return null;
  }
  let reason = 'ELIGIBLE';
  const now = args.now ?? new Date();
  const [source] = await handle.select({ status: appointmentSchema.status, completedAt: appointmentSchema.completedAt, deletedAt: appointmentSchema.deletedAt })
    .from(appointmentSchema).where(and(eq(appointmentSchema.salonId, args.salonId), eq(appointmentSchema.id, offer.sourceAppointmentId))).limit(1);
  if (!source || source.status !== 'completed' || source.deletedAt || source.completedAt?.getTime() !== offer.qualifiedAt.getTime() || offer.state === 'revoked') {
    reason = 'SOURCE_INVALID';
  } else if (offer.state === 'consumed' || (offer.state === 'reserved' && offer.reservedAppointmentId !== args.reservedAppointmentId)) {
    reason = 'ALREADY_USED';
  } else if (offer.expiresAt <= now && !args.reservedAppointmentId) {
    reason = 'EXPIRED';
  }
  if (reason === 'ELIGIBLE' && args.startTime) {
    const start = new Date(args.startTime);
    if (!Number.isFinite(start.getTime()) || start <= offer.qualifiedAt || start >= offer.expiresAt) {
      reason = 'OUTSIDE_WINDOW';
    }
  }
  try {
    const terminal = await resolveTerminalSalonClientWithHandle(handle as LifecycleSqlHandle, { salonId: args.salonId, clientId: offer.salonClientId });
    const [client] = await handle.select({ isBlocked: salonClientSchema.isBlocked }).from(salonClientSchema)
      .where(and(eq(salonClientSchema.salonId, args.salonId), eq(salonClientSchema.id, terminal.id))).limit(1);
    if (!client || client.isBlocked) {
      reason = 'CLIENT_UNAVAILABLE';
    }
    if (args.clientId || args.clientPhone) {
      const bookingClient = args.clientId
        ? await resolveTerminalSalonClientWithHandle(handle as LifecycleSqlHandle, { salonId: args.salonId, clientId: args.clientId })
        : await resolveOperationalSalonClientByPhoneWithHandle(handle as LifecycleSqlHandle, { salonId: args.salonId, phone: args.clientPhone! });
      if (!bookingClient || bookingClient.id !== terminal.id) {
        reason = 'CLIENT_MISMATCH';
      }
    }
  } catch {
    reason = 'CLIENT_UNAVAILABLE';
  }
  const calculated = calculateNextVisitOfferDiscount({ settings: offer.settingsSnapshot, services: args.services });
  if (reason === 'ELIGIBLE' && calculated.discountAmountCents <= 0) {
    reason = 'NO_ELIGIBLE_SERVICE';
  }
  return {
    reference: { campaignId: campaign.id, entitlementId: offer.id },
    status: reason === 'ELIGIBLE' ? 'eligible' : 'ineligible',
    reason,
    discountAmountCents: reason === 'ELIGIBLE' ? calculated.discountAmountCents : 0,
    label: NEXT_VISIT_DISCOUNT_LABEL,
    deadlineDate: offer.deadlineDate,
    timeZone: offer.timeZone,
    currency: offer.currency,
    promotion: toNextVisitRetentionPromotion(offer.settingsSnapshot),
  };
}

/** Called inside the existing serialized booking transaction, before pricing finalization. */
export async function lockNextVisitOfferForBooking(handle: NextVisitHandle, args: {
  salonId: string;
  reference: NextVisitOfferReference;
  clientId: string;
  startTime: Date;
  services: Array<{ id: string; priceCents: number }>;
  currency: string;
  now?: Date;
  reservedAppointmentId?: string;
}): Promise<NextVisitOfferPreview> {
  await handle.execute(sql`SELECT id FROM next_visit_offer WHERE salon_id = ${args.salonId} AND id = ${args.reference.entitlementId} FOR UPDATE NOWAIT`);
  const [offer] = await handle.select().from(nextVisitOfferSchema).where(and(
    eq(nextVisitOfferSchema.salonId, args.salonId),
    eq(nextVisitOfferSchema.id, args.reference.entitlementId),
  )).limit(1);
  if (!offer) {
    throw new NextVisitOfferError();
  }
  // Source lock never waits behind an appointment-first writer.
  await handle.execute(sql`SELECT id FROM appointment WHERE salon_id = ${args.salonId} AND id = ${offer.sourceAppointmentId} FOR SHARE NOWAIT`);
  const preview = await resolveNextVisitOfferPreview({ ...args, handle });
  if (!preview || ['CLIENT_MISMATCH', 'CLIENT_UNAVAILABLE', 'SOURCE_INVALID', 'ALREADY_USED', 'EXPIRED'].includes(preview.reason) || preview.currency.toUpperCase() !== args.currency.toUpperCase()) {
    throw new NextVisitOfferError();
  }
  return preview;
}

export async function reserveNextVisitOffer(handle: NextVisitHandle, args: {
  salonId: string;
  reference: NextVisitOfferReference;
  appointmentId: string;
  amountCents: number;
}): Promise<void> {
  const [offer] = await handle.update(nextVisitOfferSchema).set({ state: 'reserved', reservedAppointmentId: args.appointmentId, updatedAt: new Date() }).where(and(
    eq(nextVisitOfferSchema.salonId, args.salonId),
    eq(nextVisitOfferSchema.id, args.reference.entitlementId),
    eq(nextVisitOfferSchema.state, 'available'),
    isNull(nextVisitOfferSchema.reservedAppointmentId),
  )).returning();
  if (!offer) {
    throw new NextVisitOfferError();
  }
  await recordNextVisitEvent(handle, offer, args.appointmentId, 'reserved', args.amountCents);
}

export async function getNextVisitOfferForAppointment(handle: NextVisitHandle, salonId: string, appointmentId: string) {
  const [offer] = await handle.select().from(nextVisitOfferSchema).where(and(
    eq(nextVisitOfferSchema.salonId, salonId),
    eq(nextVisitOfferSchema.reservedAppointmentId, appointmentId),
    inArray(nextVisitOfferSchema.state, ['reserved', 'consumed']),
  )).limit(1);
  return offer ?? null;
}

export async function getNextVisitOfferSettingsData(salonId: string) {
  const [row] = await db.select().from(salonRetentionSettingsSchema).where(eq(salonRetentionSettingsSchema.salonId, salonId)).limit(1);
  const counts = await db.select({ state: nextVisitOfferSchema.state, count: sql<number>`count(*)::int` }).from(nextVisitOfferSchema)
    .where(eq(nextVisitOfferSchema.salonId, salonId)).groupBy(nextVisitOfferSchema.state);
  return {
    settings: resolveNextVisitOfferSettings(row?.nextVisitOffer),
    status: { enabledSince: row?.nextVisitOfferEnabledAt?.toISOString() ?? null, issued: counts.reduce((sum, item) => sum + item.count, 0), reserved: counts.find(item => item.state === 'reserved')?.count ?? 0, used: counts.find(item => item.state === 'consumed')?.count ?? 0 },
  };
}

export async function getLatestNextVisitOfferForClient(handle: NextVisitHandle, salonId: string, clientId: string) {
  const terminal = await resolveTerminalSalonClientWithHandle(handle as LifecycleSqlHandle, { salonId, clientId });
  const lineage = await getSalonClientLineageIdsWithHandle(handle as LifecycleSqlHandle, { salonId, terminalClientId: terminal.id });
  const offers = await handle.select().from(nextVisitOfferSchema).where(and(eq(nextVisitOfferSchema.salonId, salonId), inArray(nextVisitOfferSchema.salonClientId, lineage), eq(nextVisitOfferSchema.state, 'available'))).orderBy(desc(nextVisitOfferSchema.qualifiedAt)).limit(20);
  for (const offer of offers) {
    const owner = await resolveTerminalSalonClientWithHandle(handle as LifecycleSqlHandle, { salonId, clientId: offer.salonClientId });
    if (owner.id === terminal.id && offer.expiresAt > new Date()) {
      return offer;
    }
  }
  return null;
}

/** Reprice a held incentive without releasing its single-use reservation. */
export async function resolveReservedNextVisitDiscount(handle: NextVisitHandle, args: {
  appointment: Appointment;
  startTime: Date;
  services: Array<{ id: string; priceCents: number }>;
}): Promise<{ offerId: string; discountAmountCents: number; deadlineDate: string } | null> {
  await handle.execute(sql`SELECT id FROM next_visit_offer WHERE salon_id = ${args.appointment.salonId} AND reserved_appointment_id = ${args.appointment.id} AND state = 'reserved' FOR UPDATE NOWAIT`);
  const [offer] = await handle.select().from(nextVisitOfferSchema).where(and(
    eq(nextVisitOfferSchema.salonId, args.appointment.salonId),
    eq(nextVisitOfferSchema.reservedAppointmentId, args.appointment.id),
    eq(nextVisitOfferSchema.state, 'reserved'),
  )).limit(1);
  if (!offer) {
    if (args.appointment.discountType === NEXT_VISIT_DISCOUNT_TYPE) {
      throw new NextVisitOfferError('This appointment no longer holds its Next Visit Offer. Review it before making changes.');
    }
    return null;
  }
  await handle.execute(sql`SELECT id FROM appointment WHERE salon_id = ${offer.salonId} AND id = ${offer.sourceAppointmentId} FOR SHARE NOWAIT`);
  const [source] = await handle.select().from(appointmentSchema).where(and(
    eq(appointmentSchema.salonId, offer.salonId),
    eq(appointmentSchema.id, offer.sourceAppointmentId),
  )).limit(1);
  if (!source || source.status !== 'completed' || source.completedAt?.getTime() !== offer.qualifiedAt.getTime() || source.deletedAt
    || offer.currency.toUpperCase() !== args.appointment.invoiceCurrency?.toUpperCase()) {
    throw new NextVisitOfferError();
  }
  const inWindow = args.startTime > offer.qualifiedAt && args.startTime < offer.expiresAt;
  const amount = inWindow ? calculateNextVisitOfferDiscount({ settings: offer.settingsSnapshot, services: args.services }).discountAmountCents : 0;
  return { offerId: offer.id, discountAmountCents: amount, deadlineDate: offer.deadlineDate };
}

/** Internal quote context from a bearer link. Never return this phone to a browser/model. */
export async function getNextVisitOfferQuoteIdentity(salonId: string, token: string): Promise<{ phone: string } | null> {
  if (!/^[\w-]{32,200}$/.test(token)) {
    return null;
  }
  const [campaign] = await db.select().from(retentionCampaignSchema).where(and(
    eq(retentionCampaignSchema.salonId, salonId),
    eq(retentionCampaignSchema.stage, 'next_visit'),
    eq(retentionCampaignSchema.tokenHash, hashRetentionCampaignToken(token)),
  )).limit(1);
  if (!campaign?.nextVisitOfferId) {
    return null;
  }
  const terminal = await resolveTerminalSalonClientWithHandle(db as LifecycleSqlHandle, { salonId, clientId: campaign.salonClientId });
  const [client] = await db.select({ phone: salonClientSchema.phone, blocked: salonClientSchema.isBlocked }).from(salonClientSchema)
    .where(and(eq(salonClientSchema.salonId, salonId), eq(salonClientSchema.id, terminal.id))).limit(1);
  return client && !client.blocked ? { phone: client.phone } : null;
}

export async function getNextVisitReschedulePreview(args: {
  salonId: string;
  appointmentId: string;
  manageToken: string;
  startTime: Date;
  services: Array<{ id: string; priceCents: number }>;
}) {
  const { verifyAppointmentAccessToken } = await import('@/libs/appointmentAccess');
  const capability = await verifyAppointmentAccessToken(args.manageToken, { salonId: args.salonId, appointmentId: args.appointmentId });
  if (!capability) {
    return null;
  }
  return db.transaction(tx => resolveReservedNextVisitDiscount(tx, { appointment: capability.appointment, startTime: args.startTime, services: args.services }));
}
