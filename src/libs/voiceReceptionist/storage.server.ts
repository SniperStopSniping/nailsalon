import 'server-only';

import { and, asc, desc, eq, gt, isNull, lt, or, sql } from 'drizzle-orm';

import { db } from '@/libs/DB';
import {
  voiceCallSchema,
  voiceNumberRouteSchema,
  voiceReceptionistSettingsSchema,
} from '@/models/Schema';

import {
  VOICE_RECEPTIONIST_SUMMARY_RETENTION_DAYS,
  type VoiceReceptionistAnswerMode,
  type VoiceReceptionistLanguage,
  type VoiceReceptionistVoice,
} from './settings';

export type VoiceReceptionistSettingsInput = Partial<{
  enabled: boolean;
  bookingEnabled: boolean;
  greeting: string | null;
  voice: VoiceReceptionistVoice;
  language: VoiceReceptionistLanguage;
  answerMode: VoiceReceptionistAnswerMode;
  callbackEnabled: boolean;
}>;

export type CreateVoiceCallInput = {
  id: string;
  salonId: string;
  provider: 'twilio' | 'browser';
  providerCallId: string;
  providerAccountSid?: string | null;
  callerNumber?: string | null;
  routeTokenHash: string;
  routeExpiresAt: Date;
};

const MAX_ACTIVE_CALLS_PER_SALON = 2;
const MAX_DAILY_CALLS_PER_SALON = 32;
const MAX_ACTIVE_CALL_MS = 12 * 60 * 1000;
const MAX_CALL_DURATION_MS = 10 * 60 * 1000;

function defaultSettings(salonId: string) {
  return {
    salonId,
    enabled: false,
    bookingEnabled: false,
    greeting: null,
    voice: 'marin' as const,
    language: 'auto' as const,
    answerMode: 'always' as const,
    callbackEnabled: true,
    summaryRetentionDays: VOICE_RECEPTIONIST_SUMMARY_RETENTION_DAYS,
  };
}

/** Removes dialogue and media; terminal drafts also lose contact data. */
export function redactVoiceDraft(value: unknown, finalized = false): unknown {
  if (!value || typeof value !== 'object') {
    return value ?? null;
  }
  const omitted = new Set([
    'messages',
    'dialogue',
    'transcript',
    'transcripts',
    'audio',
    'recording',
    'recordings',
  ]);
  const terminalOmitted = new Set(['callerNumber', 'phone', 'email', 'clientEmail', 'contact', 'contactDetails']);
  if (Array.isArray(value)) {
    return value.map(item => redactVoiceDraft(item, finalized));
  }
  return Object.fromEntries(Object.entries(value as Record<string, unknown>)
    .filter(([key]) => !omitted.has(key) && (!finalized || !terminalOmitted.has(key)))
    .filter(([key]) => !(finalized && ['name', 'clientName', 'firstName', 'lastName'].includes(key)))
    .map(([key, item]) => [key, redactVoiceDraft(item, finalized)]));
}

export async function getVoiceSettings(salonId: string) {
  const [settings] = await db.select().from(voiceReceptionistSettingsSchema)
    .where(eq(voiceReceptionistSettingsSchema.salonId, salonId)).limit(1);
  return settings ?? defaultSettings(salonId);
}

export async function updateVoiceSettings(salonId: string, input: VoiceReceptionistSettingsInput) {
  const values = {
    ...input,
    greeting: input.greeting === undefined ? undefined : input.greeting?.trim() || null,
    summaryRetentionDays: VOICE_RECEPTIONIST_SUMMARY_RETENTION_DAYS,
    updatedAt: new Date(),
  };
  const [saved] = await db.insert(voiceReceptionistSettingsSchema).values({
    ...defaultSettings(salonId),
    ...values,
  }).onConflictDoUpdate({
    target: voiceReceptionistSettingsSchema.salonId,
    set: values,
  }).returning();
  return saved!;
}

export async function resolveVoiceNumber(accountSid: string, phoneNumber: string, forwardedFrom: string) {
  const [route] = await db.select().from(voiceNumberRouteSchema).where(and(
    eq(voiceNumberRouteSchema.accountSid, accountSid),
    eq(voiceNumberRouteSchema.phoneNumber, phoneNumber),
    eq(voiceNumberRouteSchema.forwardedFrom, forwardedFrom),
  )).limit(1);
  return route ?? null;
}

export async function listVoiceNumberRoutes(salonId: string) {
  return db.select().from(voiceNumberRouteSchema).where(eq(voiceNumberRouteSchema.salonId, salonId));
}

export async function createVoiceCall(input: CreateVoiceCallInput) {
  return db.transaction(async (tx) => {
    // PGlite does not implement PostgreSQL advisory locks; its test database
    // has a single process/connection. Production uses this transaction lock
    // to make retries and admission caps atomic across function instances.
    if (process.env.NODE_ENV !== 'test') {
      await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`voice-receptionist:${input.salonId}`}))`);
    }
    const [existing] = await tx.select().from(voiceCallSchema).where(and(
      eq(voiceCallSchema.provider, input.provider),
      eq(voiceCallSchema.providerCallId, input.providerCallId),
    )).limit(1);
    if (existing) {
      if (existing.salonId !== input.salonId) {
        throw new Error('VOICE_CALL_ROUTE_CONFLICT');
      }
      return { call: existing, created: false };
    }
    const now = new Date();
    const activeSince = new Date(now.getTime() - MAX_ACTIVE_CALL_MS);
    const dayStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
    const [active, today] = await Promise.all([
      tx.select({ count: sql<number>`count(*)::int` }).from(voiceCallSchema).where(and(
        eq(voiceCallSchema.salonId, input.salonId),
        sql`${voiceCallSchema.status} in ('created', 'accepting', 'connected', 'in_progress', 'awaiting_confirmation')`,
        gt(voiceCallSchema.createdAt, activeSince),
      )),
      tx.select({ count: sql<number>`count(*)::int` }).from(voiceCallSchema).where(and(
        eq(voiceCallSchema.salonId, input.salonId),
        gt(voiceCallSchema.createdAt, dayStart),
      )),
    ]);
    if ((active[0]?.count ?? 0) >= MAX_ACTIVE_CALLS_PER_SALON) {
      throw new Error('VOICE_ACTIVE_CALL_LIMIT');
    }
    if ((today[0]?.count ?? 0) >= MAX_DAILY_CALLS_PER_SALON) {
      throw new Error('VOICE_DAILY_CALL_LIMIT');
    }
    const [call] = await tx.insert(voiceCallSchema).values(input).returning();
    return { call: call!, created: true };
  });
}

export async function getVoiceCall(id: string, salonId?: string) {
  const conditions = [eq(voiceCallSchema.id, id)];
  if (salonId) {
    conditions.push(eq(voiceCallSchema.salonId, salonId));
  }
  const [call] = await db.select().from(voiceCallSchema).where(and(...conditions)).limit(1);
  return call ?? null;
}

export async function getVoiceCallByProvider(providerAccountSid: string, providerCallId: string) {
  const [call] = await db.select().from(voiceCallSchema).where(and(
    eq(voiceCallSchema.provider, 'twilio'),
    eq(voiceCallSchema.providerAccountSid, providerAccountSid),
    eq(voiceCallSchema.providerCallId, providerCallId),
  )).limit(1);
  return call ?? null;
}

export async function claimVoiceLease(id: string, leaseToken: string, leaseMs = 30_000) {
  const now = new Date();
  const expiresAt = new Date(now.getTime() + leaseMs);
  const [call] = await db.update(voiceCallSchema).set({ leaseToken, leaseExpiresAt: expiresAt, updatedAt: now })
    .where(and(
      eq(voiceCallSchema.id, id),
      sql`${voiceCallSchema.status} not in ('completed', 'failed', 'dropped')`,
      or(isNull(voiceCallSchema.leaseExpiresAt), lt(voiceCallSchema.leaseExpiresAt, now), eq(voiceCallSchema.leaseToken, leaseToken)),
    ))
    .returning();
  return call ?? null;
}

export type VoiceLeaseOwner =
  | { liveSessionId: string; checkpointId?: never }
  | { checkpointId: string; liveSessionId?: never };

/**
 * Extends an already-held lease only for the current Live or checkpoint owner.
 * Renewal never turns an expired/released lease into a new claim.
 */
export async function renewVoiceLease(
  id: string,
  salonId: string,
  leaseToken: string,
  leaseMs = 90_000,
  owner?: VoiceLeaseOwner,
) {
  if (!owner) {
    return null;
  }
  const now = new Date();
  const ownerCondition = typeof owner.liveSessionId === 'string'
    ? and(
      eq(voiceCallSchema.liveSessionId, owner.liveSessionId),
      sql`${voiceCallSchema.status} in ('connected', 'in_progress')`,
    )
    : typeof owner.checkpointId === 'string'
      ? and(
        eq(voiceCallSchema.status, 'awaiting_confirmation'),
        sql`${voiceCallSchema.draft}->'confirmation'->>'id' = ${owner.checkpointId}`,
        sql`${voiceCallSchema.draft}->'confirmation'->>'stage' in ('committing', 'resuming')`,
      )
      : null;
  if (!ownerCondition) {
    return null;
  }
  const [call] = await db.update(voiceCallSchema).set({
    leaseExpiresAt: new Date(now.getTime() + leaseMs),
    updatedAt: now,
  }).where(and(
    eq(voiceCallSchema.id, id),
    eq(voiceCallSchema.salonId, salonId),
    eq(voiceCallSchema.leaseToken, leaseToken),
    gt(voiceCallSchema.leaseExpiresAt, now),
    isNull(voiceCallSchema.endedAt),
    ownerCondition,
  )).returning();
  return call ?? null;
}

export async function saveVoiceCall(id: string, salonId: string, leaseToken: string, patch: Partial<{
  callerNumber: string | null;
  status: string;
  outcome: string | null;
  draft: unknown;
  summary: string | null;
  appointmentId: string | null;
  callbackRequested: boolean;
  durationSeconds: number;
  voiceSeconds: number;
  metrics: Record<string, unknown> | null;
  endedAt: Date | null;
}>) {
  const finalized = patch.endedAt !== undefined || ['completed', 'failed', 'dropped'].includes(patch.status ?? '');
  const values = { ...patch, draft: patch.draft === undefined ? undefined : redactVoiceDraft(patch.draft, finalized), updatedAt: new Date() };
  const [call] = await db.update(voiceCallSchema).set(values).where(and(
    eq(voiceCallSchema.id, id),
    eq(voiceCallSchema.salonId, salonId),
    eq(voiceCallSchema.leaseToken, leaseToken),
    gt(voiceCallSchema.leaseExpiresAt, new Date()),
  )).returning();
  return call ?? null;
}

export async function releaseVoiceLease(id: string, salonId: string, leaseToken: string) {
  const [call] = await db.update(voiceCallSchema).set({ leaseToken: null, leaseExpiresAt: null, updatedAt: new Date() }).where(and(
    eq(voiceCallSchema.id, id),
    eq(voiceCallSchema.salonId, salonId),
    eq(voiceCallSchema.leaseToken, leaseToken),
  )).returning();
  return call ?? null;
}

export async function bindLiveSession(id: string, salonId: string, routeTokenHash: string, liveSessionId: string) {
  const call = await getVoiceCall(id, salonId);
  if (!call || call.routeTokenHash !== routeTokenHash) {
    return null;
  }
  if (call.liveSessionId === liveSessionId) {
    return call;
  }
  if (call.liveSessionId || call.routeExpiresAt <= new Date() || ['completed', 'failed', 'dropped'].includes(call.status)) {
    throw new Error('VOICE_LIVE_SESSION_CONFLICT');
  }
  const [bound] = await db.update(voiceCallSchema).set({ liveSessionId, status: 'accepting', updatedAt: new Date() }).where(and(
    eq(voiceCallSchema.id, id),
    eq(voiceCallSchema.salonId, salonId),
    eq(voiceCallSchema.routeTokenHash, routeTokenHash),
    gt(voiceCallSchema.routeExpiresAt, new Date()),
    sql`${voiceCallSchema.status} not in ('completed', 'failed', 'dropped')`,
    isNull(voiceCallSchema.liveSessionId),
  )).returning();
  if (bound) {
    return bound;
  }
  const replay = await getVoiceCall(id, salonId);
  if (replay?.liveSessionId === liveSessionId) {
    return replay;
  }
  throw new Error('VOICE_LIVE_SESSION_CONFLICT');
}

export async function setVoiceCallTransportState(id: string, salonId: string, liveSessionId: string, status: 'connected' | 'dropped') {
  const now = new Date();
  const [call] = await db.update(voiceCallSchema).set({
    status,
    ...(status === 'dropped' ? { outcome: 'provider_unavailable', endedAt: now, draft: null, leaseToken: null, leaseExpiresAt: null } : {}),
    updatedAt: now,
  }).where(and(
    eq(voiceCallSchema.id, id),
    eq(voiceCallSchema.salonId, salonId),
    eq(voiceCallSchema.liveSessionId, liveSessionId),
    sql`${voiceCallSchema.status} in ('created', 'accepting', 'connected')`,
  )).returning();
  return call ?? null;
}

export async function listVoiceCalls(salonId: string, limit = 50) {
  return db.select().from(voiceCallSchema).where(eq(voiceCallSchema.salonId, salonId))
    .orderBy(desc(voiceCallSchema.createdAt)).limit(Math.min(Math.max(limit, 1), 100));
}

/** A scheduler can call this after the V1 rollout; no automatic deletion is enabled yet. */
export async function cleanupExpiredVoiceCallData(now = new Date()) {
  const cutoff = new Date(now.getTime() - VOICE_RECEPTIONIST_SUMMARY_RETENTION_DAYS * 24 * 60 * 60 * 1000);
  const rows = await db.select().from(voiceCallSchema).where(and(
    lt(voiceCallSchema.endedAt, cutoff),
    or(sql`${voiceCallSchema.summary} is not null`, sql`${voiceCallSchema.callerNumber} is not null`, sql`${voiceCallSchema.draft} is not null`, sql`${voiceCallSchema.metrics} is not null`),
  ));
  if (rows.length === 0) {
    return [];
  }
  return db.transaction(async tx => Promise.all(rows.map(call => tx.update(voiceCallSchema).set({
    callerNumber: null,
    summary: null,
    metrics: null,
    draft: null,
    updatedAt: now,
  }).where(and(eq(voiceCallSchema.id, call.id), eq(voiceCallSchema.salonId, call.salonId))).returning())));
}

/** Recovery only sees active calls inside the 12-minute admission window. */
export async function listExpiredVoiceCallsForRecovery(now = new Date()) {
  const activeSince = new Date(now.getTime() - MAX_ACTIVE_CALL_MS);
  return db.select().from(voiceCallSchema).where(and(
    sql`${voiceCallSchema.status} in ('created', 'connected', 'in_progress')`,
    gt(voiceCallSchema.createdAt, activeSince),
    sql`${voiceCallSchema.liveSessionId} is not null`,
    or(isNull(voiceCallSchema.leaseExpiresAt), lt(voiceCallSchema.leaseExpiresAt, now)),
  )).orderBy(asc(voiceCallSchema.createdAt));
}

/** Fences every active call after its original maximum duration plus grace. */
export async function expireOverdueVoiceCalls(now = new Date(), graceMs = 30_000) {
  const cutoff = new Date(now.getTime() - MAX_CALL_DURATION_MS - graceMs);
  const overdue = await db.select().from(voiceCallSchema).where(and(
    lt(voiceCallSchema.createdAt, cutoff),
    sql`${voiceCallSchema.status} in ('created', 'accepting', 'connected', 'in_progress', 'awaiting_confirmation')`,
  ));
  return db.transaction(async (tx) => {
    const updated = [];
    for (const candidate of overdue) {
      const [call] = await tx.select().from(voiceCallSchema).where(eq(voiceCallSchema.id, candidate.id)).for('update').limit(1);
      if (!call || call.createdAt >= cutoff || !['created', 'accepting', 'connected', 'in_progress', 'awaiting_confirmation'].includes(call.status) || call.endedAt) {
        continue;
      }
      const confirmation = (call.draft as { confirmation?: { stage?: unknown } } | null)?.confirmation;
      const preserveRecovery = confirmation?.stage === 'committing' || confirmation?.stage === 'revoked';
      const [expired] = await tx.update(voiceCallSchema).set({
        status: 'dropped',
        outcome: 'call_ended',
        // The canonical operation reference survives a terminal deadline only
        // when recovery may still observe its result. It remains redacted and
        // is cleared by the normal 30-day retention job.
        draft: preserveRecovery ? redactVoiceDraft(call.draft, true) : null,
        leaseToken: null,
        leaseExpiresAt: null,
        endedAt: now,
        updatedAt: now,
      }).where(and(
        eq(voiceCallSchema.id, call.id),
        sql`${voiceCallSchema.status} in ('created', 'accepting', 'connected', 'in_progress', 'awaiting_confirmation')`,
        isNull(voiceCallSchema.endedAt),
      )).returning();
      if (expired) {
        updated.push(expired);
      }
    }
    return updated;
  });
}

/** Provider callbacks finish a call even after its realtime lease is gone. */
export async function finishVoiceCallFromProvider(
  providerAccountSid: string,
  providerCallId: string,
  durationSeconds: number,
) {
  const now = new Date();
  return db.transaction(async (tx) => {
    const [existing] = await tx.select().from(voiceCallSchema).where(and(
      eq(voiceCallSchema.provider, 'twilio'),
      eq(voiceCallSchema.providerAccountSid, providerAccountSid),
      eq(voiceCallSchema.providerCallId, providerCallId),
    )).for('update').limit(1);
    if (!existing || ['completed', 'failed', 'dropped'].includes(existing.status)) {
      return existing ?? null;
    }
    const [call] = await tx.update(voiceCallSchema).set({
      status: 'completed',
      durationSeconds: Math.max(existing.durationSeconds, durationSeconds, 0),
      draft: redactVoiceDraft(existing.draft, true),
      endedAt: now,
      leaseToken: null,
      leaseExpiresAt: null,
      updatedAt: now,
    }).where(and(eq(voiceCallSchema.id, existing.id), sql`${voiceCallSchema.status} not in ('completed', 'failed', 'dropped')`)).returning();
    return call ?? existing;
  });
}
