import 'server-only';

import type { SQL } from 'drizzle-orm';
import {
  and,
  eq,
  inArray,
  isNull,
  ne,
  or,
  sql,
} from 'drizzle-orm';

import { db } from '@/libs/DB';
import { resolveAppointmentBalance } from '@/libs/financialReporting';
import { normalizePhone } from '@/libs/phone';
import {
  appointmentPaymentSchema,
  appointmentPhotoSchema,
  appointmentSchema,
  auditLogSchema,
  clientCommunicationSchema,
  clientPreferencesSchema,
  clientSchema,
  clientSessionSchema,
  communicationConsentSchema,
  fraudSignalSchema,
  referralSchema,
  retentionCampaignSchema,
  reviewSchema,
  rewardSchema,
  type SalonClient,
  salonClientContactAliasSchema,
  salonClientNoteSchema,
  salonClientSchema,
  salonSchema,
  technicianSchema,
} from '@/models/Schema';

export type ClientLifecycleActor = {
  id: string;
  role: 'owner' | 'admin' | 'staff';
};

export type ClientLifecycleErrorCode =
  | 'CLIENT_NOT_FOUND'
  | 'POSSIBLE_DUPLICATE'
  | 'STALE_CLIENT'
  | 'INVALID_CLIENT_STATE'
  | 'SAME_CLIENT'
  | 'CLIENT_HAS_HISTORY'
  | 'CONTACT_ALIAS_CONFLICT'
  | 'EXTERNAL_IDENTITY_CONFLICT';

export type ClientDuplicateSummary = {
  id: string;
  fullName: string | null;
  phone: string;
  email: string | null;
  birthday: string | null;
  archivedAt: Date | null;
  updatedAt: Date;
  matchedBy: Array<'phone' | 'email'>;
  matchedAlias: boolean;
};

export type ClientDependencyCounts = {
  appointments: number;
  payments: number;
  communications: number;
  campaigns: number;
  communicationConsents: number;
  rewards: number;
  referrals: number;
  reviews: number;
  photos: number;
  preferences: number;
  notes: number;
  fraudSignals: number;
  contactAliases: number;
  mergedProfiles: number;
  profileState: number;
};

export type ClientDependencySummary = {
  clientId: string;
  hasExternalClientIdentity: boolean;
  counts: ClientDependencyCounts;
  hardDeleteEligible: boolean;
};

export class ClientLifecycleError extends Error {
  readonly code: ClientLifecycleErrorCode;
  readonly duplicates?: ClientDuplicateSummary[];
  readonly dependencies?: ClientDependencySummary;

  constructor(
    code: ClientLifecycleErrorCode,
    message: string,
    details?: {
      duplicates?: ClientDuplicateSummary[];
      dependencies?: ClientDependencySummary;
    },
  ) {
    super(message);
    this.name = 'ClientLifecycleError';
    this.code = code;
    this.duplicates = details?.duplicates;
    this.dependencies = details?.dependencies;
  }
}

export type ClientContactAliases = {
  phones: string[];
  emails: string[];
};

export type EditableSalonClientFields = {
  fullName: string | null;
  phone: string;
  email: string | null;
  birthday: string | null;
  preferredTechnicianId: string | null;
  notes: string | null;
  sensitivities: string | null;
  nailPreferences: SalonClient['nailPreferences'];
  tags: string[];
  rebookIntervalDays: number | null;
};

export type EditSalonClientInput = {
  salonId: string;
  clientId: string;
  expectedUpdatedAt: string | Date;
  actor: ClientLifecycleActor;
  changes: Partial<EditableSalonClientFields>;
};

export type ClientMergeField =
  | 'fullName'
  | 'phone'
  | 'email'
  | 'birthday'
  | 'preferredTechnicianId'
  | 'sensitivities'
  | 'nailPreferences'
  | 'rebookIntervalDays'
  | 'notes';

export type ClientMergeSelections = Partial<
  Record<ClientMergeField, 'primary' | 'duplicate'>
>;

export type ClientMergeRecordSummary = {
  upcomingAppointments: number;
  completedAppointments: number;
  otherAppointments: number;
  paymentRecords: number;
  paymentsReceivedCents: number;
  completedValueCents: number;
  completedOutstandingCents: number;
  unresolvedCompletedBalances: number;
  notes: number;
  photos: number;
  preferences: number;
  communications: number;
  campaigns: number;
  rewards: number;
  reviews: number;
  fraudSignals: number;
};

export type ClientMergePreviewSide = {
  client: Pick<
    SalonClient,
    | 'id'
    | 'fullName'
    | 'phone'
    | 'email'
    | 'birthday'
    | 'preferredTechnicianId'
    | 'notes'
    | 'sensitivities'
    | 'nailPreferences'
    | 'tags'
    | 'rebookIntervalDays'
    | 'adminFlags'
    | 'isBlocked'
    | 'blockedReason'
    | 'archivedAt'
    | 'updatedAt'
  >;
  aliases: ClientContactAliases;
  records: ClientMergeRecordSummary;
  externalPreferences: Array<{
    id: string;
    normalizedClientPhone: string;
    favoriteTechId: string | null;
    favoriteServices: string[] | null;
    nailShape: string | null;
    nailLength: string | null;
    finishes: string[] | null;
    colorFamilies: string[] | null;
    preferredBrands: string[] | null;
    sensitivities: string[] | null;
    musicPreference: string | null;
    conversationLevel: string | null;
    beveragePreference: string[] | null;
    techNotes: string | null;
    appointmentNotes: string | null;
  }>;
};

export type ClientMergeConflict = {
  field: ClientMergeField;
  primaryValue: unknown;
  duplicateValue: unknown;
  defaultSelection: 'primary';
};

export type ClientMergePreview = {
  primary: ClientMergePreviewSide;
  duplicate: ClientMergePreviewSide;
  conflicts: ClientMergeConflict[];
};

export type ClientMergeInput = {
  salonId: string;
  primaryClientId: string;
  duplicateClientId: string;
  expectedPrimaryUpdatedAt: string | Date;
  expectedDuplicateUpdatedAt: string | Date;
  actor: ClientLifecycleActor;
  selections?: ClientMergeSelections;
};

export type ClientMergeResult = {
  primary: SalonClient;
  duplicate: SalonClient;
  idempotent: boolean;
};

export type ClientStateChangeInput = {
  salonId: string;
  clientId: string;
  expectedUpdatedAt: string | Date;
  actor: ClientLifecycleActor;
};

type LifecycleDb = {
  select: typeof db.select;
  insert: typeof db.insert;
  update: typeof db.update;
  delete: typeof db.delete;
  execute: (query: ReturnType<typeof sql>) => Promise<unknown>;
};

type AliasValue = {
  kind: 'phone' | 'email';
  normalizedValue: string;
};

const ACTIVE_RETENTION_KINDS = ['rebook', 'promo_6w', 'promo_8w'];
const ACTIVE_RETENTION_STATUSES = ['prepared', 'snoozed'];

function assertNonEmpty(value: string, field: string): void {
  if (!value.trim()) {
    throw new TypeError(`${field} is required`);
  }
}

function assertPrivilegedActor(actor: ClientLifecycleActor): void {
  if (actor.role !== 'owner' && actor.role !== 'admin') {
    throw new ClientLifecycleError(
      'INVALID_CLIENT_STATE',
      'Owner or admin access is required for this client action.',
    );
  }
}

function normalizeExpectedTimestamp(value: string | Date): number {
  const parsed = value instanceof Date ? value : new Date(value);
  const timestamp = parsed.getTime();
  if (Number.isNaN(timestamp)) {
    throw new TypeError('expectedUpdatedAt must be a valid timestamp');
  }
  return timestamp;
}

function assertExpectedVersion(
  client: Pick<SalonClient, 'updatedAt'>,
  expectedUpdatedAt: string | Date,
): void {
  if (client.updatedAt.getTime() !== normalizeExpectedTimestamp(expectedUpdatedAt)) {
    throw new ClientLifecycleError(
      'STALE_CLIENT',
      'This client changed since it was loaded. Refresh and try again.',
    );
  }
}

function normalizedBirthday(value: string | null): string | null {
  if (value === null || value.trim() === '') {
    return null;
  }
  const trimmed = value.trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
    throw new TypeError('birthday must use YYYY-MM-DD');
  }
  const parsed = new Date(`${trimmed}T00:00:00.000Z`);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== trimmed) {
    throw new TypeError('birthday must be a real calendar date');
  }
  return trimmed;
}

export function normalizeClientEmail(value: string | null | undefined): string | null {
  const normalized = value?.trim().toLowerCase() ?? '';
  return normalized || null;
}

function normalizedPhoneOrThrow(value: string): string {
  const normalized = normalizePhone(value);
  if (normalized.length !== 10) {
    throw new TypeError('phone must normalize to exactly 10 digits');
  }
  return normalized;
}

function phoneVariants(phones: string[]): string[] {
  const variants = new Set<string>();
  for (const rawPhone of phones) {
    const normalized = normalizePhone(rawPhone);
    if (!normalized) {
      continue;
    }
    variants.add(normalized);
    variants.add(`1${normalized}`);
    variants.add(`+1${normalized}`);
    variants.add(rawPhone);
    variants.add(rawPhone.replace(/\D/g, ''));
  }
  return [...variants];
}

function uniqueAliasValues(values: AliasValue[]): AliasValue[] {
  const seen = new Set<string>();
  return values.filter((value) => {
    const key = `${value.kind}:${value.normalizedValue}`;
    if (!value.normalizedValue || seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
}

function numberValue(value: unknown): number {
  const parsed = Number(value ?? 0);
  return Number.isSafeInteger(parsed) ? parsed : 0;
}

function latestDate(
  left: Date | null | undefined,
  right: Date | null | undefined,
): Date | null {
  if (!left) {
    return right ?? null;
  }
  if (!right) {
    return left;
  }
  return left >= right ? left : right;
}

function earliestDate(
  left: Date | null | undefined,
  right: Date | null | undefined,
): Date | null {
  if (!left) {
    return right ?? null;
  }
  if (!right) {
    return left;
  }
  return left <= right ? left : right;
}

function valuesConflict(left: unknown, right: unknown): boolean {
  if (!hasMeaningfulValue(left) || !hasMeaningfulValue(right)) {
    return false;
  }
  return JSON.stringify(left) !== JSON.stringify(right);
}

function hasMeaningfulValue(value: unknown): boolean {
  if (value == null) {
    return false;
  }
  if (typeof value === 'string') {
    return value.trim().length > 0;
  }
  if (Array.isArray(value)) {
    return value.length > 0;
  }
  if (typeof value === 'object') {
    return Object.keys(value).length > 0;
  }
  return true;
}

function hasMeaningfulProfileState(client: SalonClient): boolean {
  const flags = client.adminFlags;
  return Boolean(
    client.notes?.trim()
    || client.sensitivities?.trim()
    || client.preferredTechnicianId
    || hasMeaningfulValue(client.nailPreferences)
    || (client.tags ?? []).some(tag => tag.trim().length > 0)
    || client.rebookIntervalDays
    || client.nextRebookDueAt
    || client.lastContactAt
    || client.lastVisitAt
    || (client.totalVisits ?? 0) > 0
    || (client.totalSpent ?? 0) > 0
    || (client.noShowCount ?? 0) > 0
    || (client.loyaltyPoints ?? 0) > 0
    || client.welcomeBonusGrantedAt
    || client.hasGoogleReview
    || client.googleReviewMarkedAt
    || client.isBlocked
    || client.blockedReason?.trim()
    || flags?.isProblemClient
    || flags?.flagReason?.trim()
    || (client.lateCancelCount ?? 0) > 0
    || client.lastLateCancelAt,
  );
}

async function loadScopedClient(
  handle: LifecycleDb,
  salonId: string,
  clientId: string,
): Promise<SalonClient | null> {
  const [client] = await handle
    .select()
    .from(salonClientSchema)
    .where(
      and(
        eq(salonClientSchema.salonId, salonId),
        eq(salonClientSchema.id, clientId),
      ),
    )
    .limit(1);
  return client ?? null;
}

async function requireScopedClient(
  handle: LifecycleDb,
  salonId: string,
  clientId: string,
): Promise<SalonClient> {
  const client = await loadScopedClient(handle, salonId, clientId);
  if (!client) {
    // Deliberately identical for missing and foreign-salon IDs.
    throw new ClientLifecycleError('CLIENT_NOT_FOUND', 'Client not found.');
  }
  return client;
}

async function lockSalonLifecycle(
  handle: LifecycleDb,
  salonId: string,
): Promise<void> {
  await handle.execute(sql`
    select ${salonSchema.id}
    from ${salonSchema}
    where ${salonSchema.id} = ${salonId}
    for update
  `);
}

async function lockClients(
  handle: LifecycleDb,
  salonId: string,
  clientIds: string[],
): Promise<void> {
  const sortedIds = [...new Set(clientIds)].sort();
  if (sortedIds.length === 0) {
    return;
  }
  await handle.execute(sql`
    select ${salonClientSchema.id}
    from ${salonClientSchema}
    where ${salonClientSchema.salonId} = ${salonId}
      and ${salonClientSchema.id} in (${sql.join(
        sortedIds.map(id => sql`${id}`),
        sql`, `,
      )})
    order by ${salonClientSchema.id}
    for update
  `);
}

async function insertAudit(
  handle: LifecycleDb,
  input: {
    salonId: string;
    actor: ClientLifecycleActor;
    action: string;
    entityId: string;
    metadata: Record<string, unknown>;
  },
): Promise<void> {
  await handle.insert(auditLogSchema).values({
    id: `audit_${crypto.randomUUID()}`,
    salonId: input.salonId,
    actorType: 'admin',
    actorId: input.actor.id,
    actorPhone: null,
    action: input.action,
    entityType: 'salon_client',
    entityId: input.entityId,
    metadata: {
      actorRole: input.actor.role,
      ...input.metadata,
    },
  });
}

async function collectAliasesWithHandle(
  handle: LifecycleDb,
  salonId: string,
  clientId: string,
): Promise<ClientContactAliases> {
  const client = await requireScopedClient(handle, salonId, clientId);
  const aliases = await handle
    .select({
      kind: salonClientContactAliasSchema.kind,
      normalizedValue: salonClientContactAliasSchema.normalizedValue,
    })
    .from(salonClientContactAliasSchema)
    .where(
      and(
        eq(salonClientContactAliasSchema.salonId, salonId),
        eq(salonClientContactAliasSchema.salonClientId, clientId),
      ),
    );

  const phones = new Set<string>([normalizePhone(client.phone)]);
  const emails = new Set<string>();
  const currentEmail = normalizeClientEmail(client.email);
  if (currentEmail) {
    emails.add(currentEmail);
  }
  for (const alias of aliases) {
    if (alias.kind === 'phone') {
      phones.add(normalizePhone(alias.normalizedValue));
    } else {
      const normalized = normalizeClientEmail(alias.normalizedValue);
      if (normalized) {
        emails.add(normalized);
      }
    }
  }
  return {
    phones: [...phones].filter(Boolean).sort(),
    emails: [...emails].sort(),
  };
}

async function hasUnsupportedExternalIdentityWithHandle(
  handle: LifecycleDb,
  input: {
    salonId: string;
    client: SalonClient;
    additionalPhones?: string[];
  },
): Promise<boolean> {
  if (input.client.clientId !== null) {
    return true;
  }

  const aliases = await collectAliasesWithHandle(
    handle,
    input.salonId,
    input.client.id,
  );
  const phoneKeys = phoneVariants([
    ...aliases.phones,
    ...(input.additionalPhones ?? []),
  ]);
  if (phoneKeys.length === 0) {
    return false;
  }

  const [externalClientRows, clientSessionRows] = await Promise.all([
    handle
      .select({ id: clientSchema.id })
      .from(clientSchema)
      .where(inArray(clientSchema.phone, phoneKeys))
      .limit(1),
    handle
      .select({ id: clientSessionSchema.id })
      .from(clientSessionSchema)
      .where(inArray(clientSessionSchema.clientPhone, phoneKeys))
      .limit(1),
  ]);

  return externalClientRows.length > 0 || clientSessionRows.length > 0;
}

function externalIdentityConflict(): ClientLifecycleError {
  return new ClientLifecycleError(
    'EXTERNAL_IDENTITY_CONFLICT',
    'This client has a customer login identity. Contact changes and profile merges require a separate identity-safe workflow.',
  );
}

export async function collectClientContactAliases(input: {
  salonId: string;
  clientId: string;
}): Promise<ClientContactAliases> {
  assertNonEmpty(input.salonId, 'salonId');
  assertNonEmpty(input.clientId, 'clientId');
  return collectAliasesWithHandle(db as LifecycleDb, input.salonId, input.clientId);
}

async function findDuplicatesWithHandle(
  handle: LifecycleDb,
  input: {
    salonId: string;
    phone?: string | null;
    email?: string | null;
    excludeClientId?: string;
  },
): Promise<ClientDuplicateSummary[]> {
  const phone = input.phone ? normalizedPhoneOrThrow(input.phone) : null;
  const email = normalizeClientEmail(input.email);
  if (!phone && !email) {
    return [];
  }

  const currentPredicates: SQL[] = [];
  if (phone) {
    currentPredicates.push(eq(salonClientSchema.phone, phone));
  }
  if (email) {
    currentPredicates.push(
      sql`lower(btrim(${salonClientSchema.email})) = ${email}`,
    );
  }

  const currentRows = await handle
    .select({
      id: salonClientSchema.id,
      fullName: salonClientSchema.fullName,
      phone: salonClientSchema.phone,
      email: salonClientSchema.email,
      birthday: salonClientSchema.birthday,
      archivedAt: salonClientSchema.archivedAt,
      updatedAt: salonClientSchema.updatedAt,
    })
    .from(salonClientSchema)
    .where(
      and(
        eq(salonClientSchema.salonId, input.salonId),
        isNull(salonClientSchema.mergedIntoClientId),
        input.excludeClientId
          ? ne(salonClientSchema.id, input.excludeClientId)
          : undefined,
        or(...currentPredicates),
      ),
    );

  const aliasPredicates: SQL[] = [];
  if (phone) {
    aliasPredicates.push(
      and(
        eq(salonClientContactAliasSchema.kind, 'phone'),
        eq(salonClientContactAliasSchema.normalizedValue, phone),
      )!,
    );
  }
  if (email) {
    aliasPredicates.push(
      and(
        eq(salonClientContactAliasSchema.kind, 'email'),
        eq(salonClientContactAliasSchema.normalizedValue, email),
      )!,
    );
  }

  const aliasRows = await handle
    .select({
      id: salonClientSchema.id,
      fullName: salonClientSchema.fullName,
      phone: salonClientSchema.phone,
      email: salonClientSchema.email,
      birthday: salonClientSchema.birthday,
      archivedAt: salonClientSchema.archivedAt,
      updatedAt: salonClientSchema.updatedAt,
      matchedKind: salonClientContactAliasSchema.kind,
    })
    .from(salonClientContactAliasSchema)
    .innerJoin(
      salonClientSchema,
      and(
        eq(salonClientSchema.id, salonClientContactAliasSchema.salonClientId),
        eq(salonClientSchema.salonId, salonClientContactAliasSchema.salonId),
      ),
    )
    .where(
      and(
        eq(salonClientContactAliasSchema.salonId, input.salonId),
        isNull(salonClientSchema.mergedIntoClientId),
        input.excludeClientId
          ? ne(salonClientSchema.id, input.excludeClientId)
          : undefined,
        or(...aliasPredicates),
      ),
    );

  const matches = new Map<string, ClientDuplicateSummary>();
  for (const row of currentRows) {
    const matchedBy: Array<'phone' | 'email'> = [];
    if (phone && row.phone === phone) {
      matchedBy.push('phone');
    }
    if (email && normalizeClientEmail(row.email) === email) {
      matchedBy.push('email');
    }
    matches.set(row.id, { ...row, matchedBy, matchedAlias: false });
  }
  for (const row of aliasRows) {
    const existing = matches.get(row.id);
    const matchedBy = new Set(existing?.matchedBy ?? []);
    matchedBy.add(row.matchedKind);
    matches.set(row.id, {
      id: row.id,
      fullName: row.fullName,
      phone: row.phone,
      email: row.email,
      birthday: row.birthday,
      archivedAt: row.archivedAt,
      updatedAt: row.updatedAt,
      matchedBy: [...matchedBy],
      matchedAlias: true,
    });
  }
  return [...matches.values()].sort((left, right) => left.id.localeCompare(right.id));
}

export async function findPossibleClientDuplicates(input: {
  salonId: string;
  phone?: string | null;
  email?: string | null;
  excludeClientId?: string;
}): Promise<ClientDuplicateSummary[]> {
  assertNonEmpty(input.salonId, 'salonId');
  return findDuplicatesWithHandle(db as LifecycleDb, input);
}

async function assertAliasesClaimable(
  handle: LifecycleDb,
  salonId: string,
  ownerClientId: string,
  aliases: AliasValue[],
  allowedClientIds: string[],
): Promise<void> {
  const uniqueAliases = uniqueAliasValues(aliases);
  if (uniqueAliases.length === 0) {
    return;
  }
  const allowed = new Set(allowedClientIds);
  const phoneValues = uniqueAliases
    .filter(alias => alias.kind === 'phone')
    .map(alias => alias.normalizedValue);
  const emailValues = uniqueAliases
    .filter(alias => alias.kind === 'email')
    .map(alias => alias.normalizedValue);

  const aliasPredicates: SQL[] = [];
  if (phoneValues.length > 0) {
    aliasPredicates.push(
      and(
        eq(salonClientContactAliasSchema.kind, 'phone'),
        inArray(salonClientContactAliasSchema.normalizedValue, phoneValues),
      )!,
    );
  }
  if (emailValues.length > 0) {
    aliasPredicates.push(
      and(
        eq(salonClientContactAliasSchema.kind, 'email'),
        inArray(salonClientContactAliasSchema.normalizedValue, emailValues),
      )!,
    );
  }
  const existingAliases = await handle
    .select({
      salonClientId: salonClientContactAliasSchema.salonClientId,
    })
    .from(salonClientContactAliasSchema)
    .where(
      and(
        eq(salonClientContactAliasSchema.salonId, salonId),
        or(...aliasPredicates),
      ),
    );
  if (existingAliases.some(alias => !allowed.has(alias.salonClientId))) {
    throw new ClientLifecycleError(
      'CONTACT_ALIAS_CONFLICT',
      'A contact alias belongs to another client in this salon.',
    );
  }

  const currentPredicates: SQL[] = [];
  if (phoneValues.length > 0) {
    currentPredicates.push(inArray(salonClientSchema.phone, phoneValues));
  }
  if (emailValues.length > 0) {
    currentPredicates.push(
      sql`lower(btrim(${salonClientSchema.email})) in (${sql.join(
        emailValues.map(value => sql`${value}`),
        sql`, `,
      )})`,
    );
  }
  const currentOwners = await handle
    .select({ id: salonClientSchema.id })
    .from(salonClientSchema)
    .where(
      and(
        eq(salonClientSchema.salonId, salonId),
        isNull(salonClientSchema.mergedIntoClientId),
        or(...currentPredicates),
      ),
    );
  if (currentOwners.some(client => !allowed.has(client.id))) {
    throw new ClientLifecycleError(
      'CONTACT_ALIAS_CONFLICT',
      'A contact value belongs to another client in this salon.',
    );
  }

  for (const alias of uniqueAliases) {
    await handle
      .insert(salonClientContactAliasSchema)
      .values({
        salonId,
        salonClientId: ownerClientId,
        kind: alias.kind,
        normalizedValue: alias.normalizedValue,
      })
      .onConflictDoUpdate({
        target: [
          salonClientContactAliasSchema.salonId,
          salonClientContactAliasSchema.kind,
          salonClientContactAliasSchema.normalizedValue,
        ],
        set: { salonClientId: ownerClientId },
      });
  }
}

async function validatePreferredTechnician(
  handle: LifecycleDb,
  salonId: string,
  technicianId: string | null | undefined,
): Promise<void> {
  if (!technicianId) {
    return;
  }
  const [technician] = await handle
    .select({ id: technicianSchema.id })
    .from(technicianSchema)
    .where(
      and(
        eq(technicianSchema.salonId, salonId),
        eq(technicianSchema.id, technicianId),
      ),
    )
    .limit(1);
  if (!technician) {
    throw new ClientLifecycleError(
      'INVALID_CLIENT_STATE',
      'Preferred technician is not available in this salon.',
    );
  }
}

export async function editSalonClient(
  input: EditSalonClientInput,
): Promise<SalonClient> {
  assertNonEmpty(input.salonId, 'salonId');
  assertNonEmpty(input.clientId, 'clientId');
  assertNonEmpty(input.actor.id, 'actor.id');

  return db.transaction(async (transaction) => {
    const tx = transaction as LifecycleDb;
    await lockSalonLifecycle(tx, input.salonId);
    await lockClients(tx, input.salonId, [input.clientId]);
    const existing = await requireScopedClient(tx, input.salonId, input.clientId);
    if (existing.mergedIntoClientId) {
      throw new ClientLifecycleError(
        'INVALID_CLIENT_STATE',
        'Merged profiles cannot be edited directly.',
      );
    }
    assertExpectedVersion(existing, input.expectedUpdatedAt);

    const changes = input.changes;
    const update: Partial<EditableSalonClientFields> & {
      nextRebookDueAt?: Date | null;
      updatedAt: Date;
    } = {
      updatedAt: new Date(),
    };
    if (changes.fullName !== undefined) {
      update.fullName = changes.fullName?.trim() || null;
    }
    if (changes.phone !== undefined) {
      update.phone = normalizedPhoneOrThrow(changes.phone);
    }
    if (changes.email !== undefined) {
      update.email = normalizeClientEmail(changes.email);
    }
    if (changes.birthday !== undefined) {
      update.birthday = normalizedBirthday(changes.birthday);
    }
    if (changes.preferredTechnicianId !== undefined) {
      update.preferredTechnicianId = changes.preferredTechnicianId || null;
    }
    if (changes.notes !== undefined) {
      update.notes = changes.notes?.trim() || null;
    }
    if (changes.sensitivities !== undefined) {
      update.sensitivities = changes.sensitivities?.trim() || null;
    }
    if (changes.nailPreferences !== undefined) {
      update.nailPreferences = changes.nailPreferences;
    }
    if (changes.tags !== undefined) {
      update.tags = [...new Set(
        changes.tags.map(tag => tag.trim()).filter(Boolean),
      )];
    }
    if (changes.rebookIntervalDays !== undefined) {
      if (
        changes.rebookIntervalDays !== null
        && (
          !Number.isInteger(changes.rebookIntervalDays)
          || changes.rebookIntervalDays < 1
          || changes.rebookIntervalDays > 365
        )
      ) {
        throw new TypeError('rebookIntervalDays must be between 1 and 365');
      }
      update.rebookIntervalDays = changes.rebookIntervalDays;
      update.nextRebookDueAt = existing.lastVisitAt && changes.rebookIntervalDays
        ? new Date(
          existing.lastVisitAt.getTime()
          + changes.rebookIntervalDays * 86_400_000,
        )
        : null;
    }
    await validatePreferredTechnician(
      tx,
      input.salonId,
      update.preferredTechnicianId,
    );

    const phoneChanged = update.phone !== undefined && update.phone !== existing.phone;
    const emailChanged = update.email !== undefined
      && normalizeClientEmail(update.email) !== normalizeClientEmail(existing.email);
    if (phoneChanged || emailChanged) {
      const duplicates = await findDuplicatesWithHandle(tx, {
        salonId: input.salonId,
        phone: phoneChanged ? update.phone : null,
        email: emailChanged ? update.email : null,
        excludeClientId: existing.id,
      });
      if (duplicates.length > 0) {
        throw new ClientLifecycleError(
          'POSSIBLE_DUPLICATE',
          'Another client in this salon has the same contact details.',
          { duplicates },
        );
      }
    }
    if (
      phoneChanged
      && await hasUnsupportedExternalIdentityWithHandle(tx, {
        salonId: input.salonId,
        client: existing,
        additionalPhones: update.phone ? [update.phone] : [],
      })
    ) {
      throw externalIdentityConflict();
    }

    const oldAliases: AliasValue[] = [];
    if (phoneChanged && update.phone) {
      oldAliases.push({
        kind: 'phone',
        normalizedValue: normalizePhone(existing.phone),
      });
    }
    if (
      emailChanged
      && normalizeClientEmail(existing.email)
    ) {
      oldAliases.push({
        kind: 'email',
        normalizedValue: normalizeClientEmail(existing.email)!,
      });
    }
    await assertAliasesClaimable(
      tx,
      input.salonId,
      existing.id,
      oldAliases,
      [existing.id],
    );

    if (
      update.notes !== undefined
      && update.notes !== existing.notes
      && existing.notes?.trim()
    ) {
      await tx.insert(salonClientNoteSchema).values({
        id: `client_note_${crypto.randomUUID()}`,
        salonId: input.salonId,
        salonClientId: existing.id,
        sourceClientId: existing.id,
        body: existing.notes.trim(),
        createdBy: input.actor.id,
      });
    }

    const changedFields = Object.keys(update).filter(field => field !== 'updatedAt');
    if (changedFields.length === 0) {
      return existing;
    }
    const [updated] = await tx
      .update(salonClientSchema)
      .set(update)
      .where(
        and(
          eq(salonClientSchema.salonId, input.salonId),
          eq(salonClientSchema.id, existing.id),
        ),
      )
      .returning();
    if (!updated) {
      throw new ClientLifecycleError(
        'STALE_CLIENT',
        'This client changed since it was loaded. Refresh and try again.',
      );
    }
    await insertAudit(tx, {
      salonId: input.salonId,
      actor: input.actor,
      action: 'client_edited',
      entityId: existing.id,
      metadata: {
        changedFields,
        previousVersion: existing.updatedAt.toISOString(),
        nextVersion: updated.updatedAt.toISOString(),
      },
    });
    return updated;
  });
}

function appointmentOwnershipPredicate(
  clientId: string,
  aliases: ClientContactAliases,
): SQL {
  const variants = phoneVariants(aliases.phones);
  return or(
    eq(appointmentSchema.salonClientId, clientId),
    variants.length > 0
      ? and(
        isNull(appointmentSchema.salonClientId),
        inArray(appointmentSchema.clientPhone, variants),
      )
      : undefined,
  )!;
}

async function dependencySummaryWithHandle(
  handle: LifecycleDb,
  input: { salonId: string; clientId: string },
): Promise<ClientDependencySummary> {
  const client = await requireScopedClient(handle, input.salonId, input.clientId);
  const aliases = await collectAliasesWithHandle(
    handle,
    input.salonId,
    input.clientId,
  );
  const appointments = await handle
    .select({ id: appointmentSchema.id })
    .from(appointmentSchema)
    .where(
      and(
        eq(appointmentSchema.salonId, input.salonId),
        appointmentOwnershipPredicate(input.clientId, aliases),
      ),
    );
  const appointmentIds = appointments.map(appointment => appointment.id);
  const phoneKeys = phoneVariants(aliases.phones);
  const consentRecipients = [...new Set([...phoneKeys, ...aliases.emails])];

  const paymentRows = appointmentIds.length > 0
    ? await handle
      .select({ id: appointmentPaymentSchema.id })
      .from(appointmentPaymentSchema)
      .where(
        and(
          eq(appointmentPaymentSchema.salonId, input.salonId),
          inArray(appointmentPaymentSchema.appointmentId, appointmentIds),
        ),
      )
    : [];
  const photoPredicates: SQL[] = [];
  if (appointmentIds.length > 0) {
    photoPredicates.push(inArray(appointmentPhotoSchema.appointmentId, appointmentIds));
  }
  if (aliases.phones.length > 0) {
    photoPredicates.push(
      inArray(appointmentPhotoSchema.normalizedClientPhone, aliases.phones),
    );
  }
  const photoRows = photoPredicates.length > 0
    ? await handle
      .select({ id: appointmentPhotoSchema.id })
      .from(appointmentPhotoSchema)
      .where(
        and(
          eq(appointmentPhotoSchema.salonId, input.salonId),
          or(...photoPredicates),
        ),
      )
    : [];

  const [
    communicationRows,
    campaignRows,
    communicationConsentRows,
    externalClientRows,
    clientSessionRows,
    rewardRows,
    referralRows,
    reviewRows,
    preferenceRows,
    noteRows,
    fraudRows,
    contactAliasRows,
    mergedProfileRows,
  ] = await Promise.all([
    handle
      .select({ id: clientCommunicationSchema.id })
      .from(clientCommunicationSchema)
      .where(and(
        eq(clientCommunicationSchema.salonId, input.salonId),
        eq(clientCommunicationSchema.salonClientId, input.clientId),
      )),
    handle
      .select({ id: retentionCampaignSchema.id })
      .from(retentionCampaignSchema)
      .where(and(
        eq(retentionCampaignSchema.salonId, input.salonId),
        eq(retentionCampaignSchema.salonClientId, input.clientId),
      )),
    consentRecipients.length > 0
      ? handle
        .select({ id: communicationConsentSchema.id })
        .from(communicationConsentSchema)
        .where(and(
          eq(communicationConsentSchema.salonId, input.salonId),
          inArray(communicationConsentSchema.recipient, consentRecipients),
        ))
      : Promise.resolve([]),
    phoneKeys.length > 0
      ? handle
        .select({ id: clientSchema.id })
        .from(clientSchema)
        .where(inArray(clientSchema.phone, phoneKeys))
      : Promise.resolve([]),
    phoneKeys.length > 0
      ? handle
        .select({ id: clientSessionSchema.id })
        .from(clientSessionSchema)
        .where(inArray(clientSessionSchema.clientPhone, phoneKeys))
      : Promise.resolve([]),
    phoneKeys.length > 0
      ? handle
        .select({ id: rewardSchema.id })
        .from(rewardSchema)
        .where(and(
          eq(rewardSchema.salonId, input.salonId),
          inArray(rewardSchema.clientPhone, phoneKeys),
        ))
      : Promise.resolve([]),
    phoneKeys.length > 0
      ? handle
        .select({ id: referralSchema.id })
        .from(referralSchema)
        .where(and(
          eq(referralSchema.salonId, input.salonId),
          or(
            inArray(referralSchema.referrerPhone, phoneKeys),
            inArray(referralSchema.refereePhone, phoneKeys),
          ),
        ))
      : Promise.resolve([]),
    handle
      .select({ id: reviewSchema.id })
      .from(reviewSchema)
      .where(and(
        eq(reviewSchema.salonId, input.salonId),
        eq(reviewSchema.salonClientId, input.clientId),
      )),
    aliases.phones.length > 0
      ? handle
        .select({ id: clientPreferencesSchema.id })
        .from(clientPreferencesSchema)
        .where(and(
          eq(clientPreferencesSchema.salonId, input.salonId),
          inArray(clientPreferencesSchema.normalizedClientPhone, aliases.phones),
        ))
      : Promise.resolve([]),
    handle
      .select({ id: salonClientNoteSchema.id })
      .from(salonClientNoteSchema)
      .where(and(
        eq(salonClientNoteSchema.salonId, input.salonId),
        eq(salonClientNoteSchema.salonClientId, input.clientId),
      )),
    handle
      .select({ id: fraudSignalSchema.id })
      .from(fraudSignalSchema)
      .where(and(
        eq(fraudSignalSchema.salonId, input.salonId),
        eq(fraudSignalSchema.salonClientId, input.clientId),
      )),
    handle
      .select({ value: salonClientContactAliasSchema.normalizedValue })
      .from(salonClientContactAliasSchema)
      .where(and(
        eq(salonClientContactAliasSchema.salonId, input.salonId),
        eq(salonClientContactAliasSchema.salonClientId, input.clientId),
      )),
    handle
      .select({ id: salonClientSchema.id })
      .from(salonClientSchema)
      .where(and(
        eq(salonClientSchema.salonId, input.salonId),
        eq(salonClientSchema.mergedIntoClientId, input.clientId),
      )),
  ]);

  const counts: ClientDependencyCounts = {
    appointments: new Set(appointmentIds).size,
    payments: new Set(paymentRows.map(row => row.id)).size,
    communications: new Set(communicationRows.map(row => row.id)).size,
    campaigns: new Set(campaignRows.map(row => row.id)).size,
    communicationConsents:
      new Set(communicationConsentRows.map(row => row.id)).size,
    rewards: new Set(rewardRows.map(row => row.id)).size,
    referrals: new Set(referralRows.map(row => row.id)).size,
    reviews: new Set(reviewRows.map(row => row.id)).size,
    photos: new Set(photoRows.map(row => row.id)).size,
    preferences: new Set(preferenceRows.map(row => row.id)).size,
    notes: new Set(noteRows.map(row => row.id)).size,
    fraudSignals: new Set(fraudRows.map(row => row.id)).size,
    contactAliases: contactAliasRows.length,
    mergedProfiles: mergedProfileRows.length,
    profileState: hasMeaningfulProfileState(client) ? 1 : 0,
  };
  const hasDependencies = Object.values(counts).some(count => count > 0);
  const hasExternalClientIdentity = client.clientId !== null
    || externalClientRows.length > 0
    || clientSessionRows.length > 0;
  return {
    clientId: client.id,
    hasExternalClientIdentity,
    counts,
    hardDeleteEligible:
      client.archivedAt !== null
      && client.mergedIntoClientId === null
      && !hasExternalClientIdentity
      && !hasDependencies,
  };
}

export async function getClientDependencySummary(input: {
  salonId: string;
  clientId: string;
}): Promise<ClientDependencySummary> {
  assertNonEmpty(input.salonId, 'salonId');
  assertNonEmpty(input.clientId, 'clientId');
  return dependencySummaryWithHandle(db as LifecycleDb, input);
}

async function mergePreviewSide(
  handle: LifecycleDb,
  salonId: string,
  client: SalonClient,
  now: Date,
): Promise<ClientMergePreviewSide> {
  const aliases = await collectAliasesWithHandle(handle, salonId, client.id);
  const appointments = await handle
    .select({
      id: appointmentSchema.id,
      status: appointmentSchema.status,
      startTime: appointmentSchema.startTime,
      deletedAt: appointmentSchema.deletedAt,
      totalPrice: appointmentSchema.totalPrice,
      finalPriceCents: appointmentSchema.finalPriceCents,
      taxAmountCents: appointmentSchema.taxAmountCents,
      tipCents: appointmentSchema.tipCents,
      paymentStatus: appointmentSchema.paymentStatus,
      amountPaidCents: appointmentSchema.amountPaidCents,
    })
    .from(appointmentSchema)
    .where(and(
      eq(appointmentSchema.salonId, salonId),
      appointmentOwnershipPredicate(client.id, aliases),
    ));
  const appointmentIds = appointments.map(appointment => appointment.id);
  const payments = appointmentIds.length > 0
    ? await handle
      .select({
        id: appointmentPaymentSchema.id,
        appointmentId: appointmentPaymentSchema.appointmentId,
        amountCents: appointmentPaymentSchema.amountCents,
        voidedAt: appointmentPaymentSchema.voidedAt,
      })
      .from(appointmentPaymentSchema)
      .where(and(
        eq(appointmentPaymentSchema.salonId, salonId),
        inArray(appointmentPaymentSchema.appointmentId, appointmentIds),
      ))
    : [];
  const paymentsByAppointment = new Map<string, number>();
  const paymentHistory = new Set<string>();
  let paymentsReceivedCents = 0;
  for (const payment of payments) {
    paymentHistory.add(payment.appointmentId);
    if (payment.voidedAt || payment.amountCents <= 0) {
      continue;
    }
    paymentsReceivedCents += payment.amountCents;
    paymentsByAppointment.set(
      payment.appointmentId,
      (paymentsByAppointment.get(payment.appointmentId) ?? 0) + payment.amountCents,
    );
  }

  let upcomingAppointments = 0;
  let completedAppointments = 0;
  let otherAppointments = 0;
  let completedValueCents = 0;
  let completedOutstandingCents = 0;
  let unresolvedCompletedBalances = 0;
  for (const appointment of appointments) {
    if (
      appointment.deletedAt === null
      && ['pending', 'confirmed'].includes(appointment.status)
      && appointment.startTime >= now
    ) {
      upcomingAppointments += 1;
    } else if (appointment.deletedAt === null && appointment.status === 'completed') {
      completedAppointments += 1;
      completedValueCents += Math.max(
        appointment.finalPriceCents ?? appointment.totalPrice,
        0,
      );
    } else {
      otherAppointments += 1;
    }

    if (appointment.status !== 'completed') {
      continue;
    }
    const trackingKnown = appointment.amountPaidCents === 0
      || paymentHistory.has(appointment.id);
    const settledByLegacyStatus = !trackingKnown
      && appointment.paymentStatus === 'paid';
    const totalDue = Math.max(
      (appointment.finalPriceCents ?? appointment.totalPrice)
      + Math.max(appointment.taxAmountCents ?? 0, 0)
      + Math.max(appointment.tipCents ?? 0, 0),
      0,
    );
    const balance = resolveAppointmentBalance({
      status: appointment.status,
      deletedAt: appointment.deletedAt,
      paymentStatus: appointment.paymentStatus,
      startTime: appointment.startTime,
      now,
      finalPriceCents: appointment.finalPriceCents,
      legacyBookedTotalCents: appointment.totalPrice,
      taxAmountCents: appointment.taxAmountCents,
      tipCents: appointment.tipCents,
      nonVoidedPaymentsCents: settledByLegacyStatus
        ? totalDue
        : trackingKnown
          ? paymentsByAppointment.get(appointment.id) ?? 0
          : null,
      legacyPaymentDataReliable: trackingKnown || settledByLegacyStatus,
    });
    if (balance.category === 'completed_outstanding') {
      completedOutstandingCents += balance.amountCents;
    } else if (balance.category === 'unresolved') {
      unresolvedCompletedBalances += 1;
    }
  }

  const dependencies = await dependencySummaryWithHandle(handle, {
    salonId,
    clientId: client.id,
  });
  const externalPreferences = aliases.phones.length > 0
    ? await handle
      .select({
        id: clientPreferencesSchema.id,
        normalizedClientPhone: clientPreferencesSchema.normalizedClientPhone,
        favoriteTechId: clientPreferencesSchema.favoriteTechId,
        favoriteServices: clientPreferencesSchema.favoriteServices,
        nailShape: clientPreferencesSchema.nailShape,
        nailLength: clientPreferencesSchema.nailLength,
        finishes: clientPreferencesSchema.finishes,
        colorFamilies: clientPreferencesSchema.colorFamilies,
        preferredBrands: clientPreferencesSchema.preferredBrands,
        sensitivities: clientPreferencesSchema.sensitivities,
        musicPreference: clientPreferencesSchema.musicPreference,
        conversationLevel: clientPreferencesSchema.conversationLevel,
        beveragePreference: clientPreferencesSchema.beveragePreference,
        techNotes: clientPreferencesSchema.techNotes,
        appointmentNotes: clientPreferencesSchema.appointmentNotes,
      })
      .from(clientPreferencesSchema)
      .where(and(
        eq(clientPreferencesSchema.salonId, salonId),
        inArray(clientPreferencesSchema.normalizedClientPhone, aliases.phones),
      ))
    : [];

  return {
    client: {
      id: client.id,
      fullName: client.fullName,
      phone: client.phone,
      email: client.email,
      birthday: client.birthday,
      preferredTechnicianId: client.preferredTechnicianId,
      notes: client.notes,
      sensitivities: client.sensitivities,
      nailPreferences: client.nailPreferences,
      tags: client.tags,
      rebookIntervalDays: client.rebookIntervalDays,
      adminFlags: client.adminFlags,
      isBlocked: client.isBlocked,
      blockedReason: client.blockedReason,
      archivedAt: client.archivedAt,
      updatedAt: client.updatedAt,
    },
    aliases,
    records: {
      upcomingAppointments,
      completedAppointments,
      otherAppointments,
      paymentRecords: payments.length,
      paymentsReceivedCents,
      completedValueCents,
      completedOutstandingCents,
      unresolvedCompletedBalances,
      notes: dependencies.counts.notes + (client.notes?.trim() ? 1 : 0),
      photos: dependencies.counts.photos,
      preferences: dependencies.counts.preferences,
      communications: dependencies.counts.communications,
      campaigns: dependencies.counts.campaigns,
      rewards: dependencies.counts.rewards,
      reviews: dependencies.counts.reviews,
      fraudSignals: dependencies.counts.fraudSignals,
    },
    externalPreferences,
  };
}

export async function getClientMergePreview(input: {
  salonId: string;
  primaryClientId: string;
  duplicateClientId: string;
  now?: Date;
}): Promise<ClientMergePreview> {
  assertNonEmpty(input.salonId, 'salonId');
  if (input.primaryClientId === input.duplicateClientId) {
    throw new ClientLifecycleError(
      'SAME_CLIENT',
      'Choose two different client profiles.',
    );
  }
  const primary = await requireScopedClient(
    db as LifecycleDb,
    input.salonId,
    input.primaryClientId,
  );
  const duplicate = await requireScopedClient(
    db as LifecycleDb,
    input.salonId,
    input.duplicateClientId,
  );
  if (primary.mergedIntoClientId || duplicate.mergedIntoClientId) {
    throw new ClientLifecycleError(
      'INVALID_CLIENT_STATE',
      'A selected client has already been merged.',
    );
  }
  const now = input.now ?? new Date();
  const [primarySide, duplicateSide] = await Promise.all([
    mergePreviewSide(db as LifecycleDb, input.salonId, primary, now),
    mergePreviewSide(db as LifecycleDb, input.salonId, duplicate, now),
  ]);
  const conflictFields: ClientMergeField[] = [
    'fullName',
    'phone',
    'email',
    'birthday',
    'preferredTechnicianId',
    'sensitivities',
    'nailPreferences',
    'rebookIntervalDays',
    'notes',
  ];
  const conflicts = conflictFields
    .filter(field => valuesConflict(primary[field], duplicate[field]))
    .map(field => ({
      field,
      primaryValue: primary[field],
      duplicateValue: duplicate[field],
      defaultSelection: 'primary' as const,
    }));
  return { primary: primarySide, duplicate: duplicateSide, conflicts };
}

function mergeAdminFlags(
  primary: SalonClient['adminFlags'],
  duplicate: SalonClient['adminFlags'],
): SalonClient['adminFlags'] {
  if (!primary) {
    return duplicate;
  }
  if (!duplicate) {
    return primary;
  }
  return {
    isProblemClient:
      primary.isProblemClient === true || duplicate.isProblemClient === true,
    flagReason: [primary.flagReason, duplicate.flagReason]
      .filter((value, index, values) => value && values.indexOf(value) === index)
      .join(' | ') || undefined,
    flaggedAt: primary.flaggedAt ?? duplicate.flaggedAt,
    flaggedBy: primary.flaggedBy ?? duplicate.flaggedBy,
  };
}

async function recalculateClientStats(
  handle: LifecycleDb,
  salonId: string,
  clientId: string,
  aliases: ClientContactAliases,
  rebookIntervalDays: number | null,
  updatedAt: Date,
): Promise<void> {
  const [stats] = await handle
    .select({
      totalVisits: sql<number>`count(*) filter (
        where ${appointmentSchema.status} = 'completed'
          and ${appointmentSchema.deletedAt} is null
      )::int`,
      totalSpent: sql<number>`coalesce(sum(
        coalesce(${appointmentSchema.finalPriceCents}, ${appointmentSchema.totalPrice})
      ) filter (
        where ${appointmentSchema.status} = 'completed'
          and ${appointmentSchema.paymentStatus} = 'paid'
          and ${appointmentSchema.deletedAt} is null
      ), 0)::int`,
      noShowCount: sql<number>`count(*) filter (
        where ${appointmentSchema.status} = 'no_show'
          and ${appointmentSchema.deletedAt} is null
      )::int`,
      lastVisitAt: sql<Date | null>`max(${appointmentSchema.startTime}) filter (
        where ${appointmentSchema.status} = 'completed'
          and ${appointmentSchema.deletedAt} is null
      )`,
    })
    .from(appointmentSchema)
    .where(and(
      eq(appointmentSchema.salonId, salonId),
      appointmentOwnershipPredicate(clientId, aliases),
    ));
  const rawLastVisitAt = stats?.lastVisitAt ?? null;
  const lastVisitAt = rawLastVisitAt ? new Date(rawLastVisitAt) : null;
  const nextRebookDueAt = lastVisitAt && rebookIntervalDays
    ? new Date(lastVisitAt.getTime() + rebookIntervalDays * 86_400_000)
    : null;
  await handle
    .update(salonClientSchema)
    .set({
      totalVisits: numberValue(stats?.totalVisits),
      totalSpent: numberValue(stats?.totalSpent),
      noShowCount: numberValue(stats?.noShowCount),
      lastVisitAt,
      nextRebookDueAt,
      updatedAt,
    })
    .where(and(
      eq(salonClientSchema.salonId, salonId),
      eq(salonClientSchema.id, clientId),
    ));
}

function selectedValue<K extends ClientMergeField>(
  field: K,
  primary: SalonClient,
  duplicate: SalonClient,
  selections: ClientMergeSelections,
): SalonClient[K] {
  return selectedSource(field, primary, duplicate, selections) === 'duplicate'
    ? duplicate[field]
    : primary[field];
}

function selectedSource(
  field: ClientMergeField,
  primary: SalonClient,
  duplicate: SalonClient,
  selections: ClientMergeSelections,
): 'primary' | 'duplicate' {
  if (selections[field]) {
    return selections[field];
  }
  if (hasMeaningfulValue(primary[field])) {
    return 'primary';
  }
  return hasMeaningfulValue(duplicate[field]) ? 'duplicate' : 'primary';
}

export async function mergeSalonClients(
  input: ClientMergeInput,
): Promise<ClientMergeResult> {
  assertNonEmpty(input.salonId, 'salonId');
  assertNonEmpty(input.primaryClientId, 'primaryClientId');
  assertNonEmpty(input.duplicateClientId, 'duplicateClientId');
  assertNonEmpty(input.actor.id, 'actor.id');
  assertPrivilegedActor(input.actor);
  if (input.primaryClientId === input.duplicateClientId) {
    throw new ClientLifecycleError(
      'SAME_CLIENT',
      'Choose two different client profiles.',
    );
  }

  return db.transaction(async (transaction) => {
    const tx = transaction as LifecycleDb;
    await lockSalonLifecycle(tx, input.salonId);
    await lockClients(tx, input.salonId, [
      input.primaryClientId,
      input.duplicateClientId,
    ]);
    const primary = await requireScopedClient(
      tx,
      input.salonId,
      input.primaryClientId,
    );
    const duplicate = await requireScopedClient(
      tx,
      input.salonId,
      input.duplicateClientId,
    );

    if (duplicate.mergedIntoClientId === primary.id) {
      return { primary, duplicate, idempotent: true };
    }
    if (primary.mergedIntoClientId || duplicate.mergedIntoClientId) {
      throw new ClientLifecycleError(
        'INVALID_CLIENT_STATE',
        'A selected client has already been merged into a different profile.',
      );
    }
    if (primary.archivedAt) {
      throw new ClientLifecycleError(
        'INVALID_CLIENT_STATE',
        'The profile being kept must be active.',
      );
    }
    assertExpectedVersion(primary, input.expectedPrimaryUpdatedAt);
    assertExpectedVersion(duplicate, input.expectedDuplicateUpdatedAt);

    const [primaryHasExternalIdentity, duplicateHasExternalIdentity] = await Promise.all([
      hasUnsupportedExternalIdentityWithHandle(tx, {
        salonId: input.salonId,
        client: primary,
      }),
      hasUnsupportedExternalIdentityWithHandle(tx, {
        salonId: input.salonId,
        client: duplicate,
      }),
    ]);
    if (primaryHasExternalIdentity || duplicateHasExternalIdentity) {
      throw externalIdentityConflict();
    }

    const selections = input.selections ?? {};
    const selectedPreferredTechnicianId = selectedValue(
      'preferredTechnicianId',
      primary,
      duplicate,
      selections,
    );
    await validatePreferredTechnician(
      tx,
      input.salonId,
      selectedPreferredTechnicianId,
    );

    const primaryAliases = await collectAliasesWithHandle(
      tx,
      input.salonId,
      primary.id,
    );
    const duplicateAliases = await collectAliasesWithHandle(
      tx,
      input.salonId,
      duplicate.id,
    );
    const aliasClaims = uniqueAliasValues([
      ...primaryAliases.phones.map(normalizedValue => ({
        kind: 'phone' as const,
        normalizedValue,
      })),
      ...primaryAliases.emails.map(normalizedValue => ({
        kind: 'email' as const,
        normalizedValue,
      })),
      ...duplicateAliases.phones.map(normalizedValue => ({
        kind: 'phone' as const,
        normalizedValue,
      })),
      ...duplicateAliases.emails.map(normalizedValue => ({
        kind: 'email' as const,
        normalizedValue,
      })),
    ]);
    await assertAliasesClaimable(
      tx,
      input.salonId,
      primary.id,
      aliasClaims,
      [primary.id, duplicate.id],
    );

    const now = new Date();
    for (const client of [primary, duplicate]) {
      if (client.notes?.trim()) {
        await tx.insert(salonClientNoteSchema).values({
          id: `client_note_${crypto.randomUUID()}`,
          salonId: input.salonId,
          salonClientId: client.id,
          sourceClientId: client.id,
          body: client.notes.trim(),
          createdBy: input.actor.id,
        });
      }
    }

    const primaryActiveRetention = await tx
      .select({ id: clientCommunicationSchema.id })
      .from(clientCommunicationSchema)
      .where(and(
        eq(clientCommunicationSchema.salonId, input.salonId),
        eq(clientCommunicationSchema.salonClientId, primary.id),
        inArray(clientCommunicationSchema.kind, ACTIVE_RETENTION_KINDS),
        inArray(clientCommunicationSchema.status, ACTIVE_RETENTION_STATUSES),
      ))
      .limit(1);
    if (primaryActiveRetention.length > 0) {
      await tx
        .update(clientCommunicationSchema)
        .set({
          status: 'dismissed',
          dismissedAt: now,
          snoozedUntil: null,
          metadata: sql`coalesce(${clientCommunicationSchema.metadata}, '{}'::jsonb)
            || jsonb_build_object('mergeDismissed', true)`,
          updatedAt: now,
        })
        .where(and(
          eq(clientCommunicationSchema.salonId, input.salonId),
          eq(clientCommunicationSchema.salonClientId, duplicate.id),
          inArray(clientCommunicationSchema.kind, ACTIVE_RETENTION_KINDS),
          inArray(clientCommunicationSchema.status, ACTIVE_RETENTION_STATUSES),
        ));
    }

    // Keep the released full salon+phone unique index for migration-first
    // compatibility with v1.33. The merged row is not a contact identity, so
    // replace its current phone with a non-contact tombstone while preserving
    // every real number in aliases and immutable historical snapshots.
    await tx
      .update(salonClientSchema)
      .set({
        phone: `merged:${duplicate.id}`,
        archivedAt: duplicate.archivedAt ?? now,
        archivedBy: duplicate.archivedBy ?? input.actor.id,
        mergedIntoClientId: primary.id,
        mergedAt: now,
        mergedBy: input.actor.id,
        // The primary becomes the only operational loyalty balance. Reward
        // ledger rows remain untouched and are resolved through aliases.
        loyaltyPoints: 0,
        updatedAt: now,
      })
      .where(and(
        eq(salonClientSchema.salonId, input.salonId),
        eq(salonClientSchema.id, duplicate.id),
        isNull(salonClientSchema.mergedIntoClientId),
      ));

    const duplicateAppointmentPredicate = appointmentOwnershipPredicate(
      duplicate.id,
      duplicateAliases,
    );
    await tx
      .update(appointmentSchema)
      .set({ salonClientId: primary.id })
      .where(and(
        eq(appointmentSchema.salonId, input.salonId),
        duplicateAppointmentPredicate,
      ));
    await tx
      .update(reviewSchema)
      .set({ salonClientId: primary.id })
      .where(and(
        eq(reviewSchema.salonId, input.salonId),
        eq(reviewSchema.salonClientId, duplicate.id),
      ));
    await tx
      .update(clientCommunicationSchema)
      .set({ salonClientId: primary.id, updatedAt: now })
      .where(and(
        eq(clientCommunicationSchema.salonId, input.salonId),
        eq(clientCommunicationSchema.salonClientId, duplicate.id),
      ));
    await tx
      .update(retentionCampaignSchema)
      .set({ salonClientId: primary.id, updatedAt: now })
      .where(and(
        eq(retentionCampaignSchema.salonId, input.salonId),
        eq(retentionCampaignSchema.salonClientId, duplicate.id),
      ));
    await tx
      .update(fraudSignalSchema)
      .set({ salonClientId: primary.id })
      .where(and(
        eq(fraudSignalSchema.salonId, input.salonId),
        eq(fraudSignalSchema.salonClientId, duplicate.id),
      ));
    await tx
      .update(salonClientNoteSchema)
      .set({
        salonClientId: primary.id,
        sourceClientId: sql`coalesce(
          ${salonClientNoteSchema.sourceClientId},
          ${duplicate.id}
        )`,
      })
      .where(and(
        eq(salonClientNoteSchema.salonId, input.salonId),
        eq(salonClientNoteSchema.salonClientId, duplicate.id),
      ));
    await tx
      .update(salonClientContactAliasSchema)
      .set({ salonClientId: primary.id })
      .where(and(
        eq(salonClientContactAliasSchema.salonId, input.salonId),
        eq(salonClientContactAliasSchema.salonClientId, duplicate.id),
      ));

    const tags = [...new Set([
      ...(primary.tags ?? []),
      ...(duplicate.tags ?? []),
    ].map(tag => tag.trim()).filter(Boolean))];
    const isBlocked = primary.isBlocked === true || duplicate.isBlocked === true;
    const blockedReason = [primary.blockedReason, duplicate.blockedReason]
      .filter((value, index, values) => value && values.indexOf(value) === index)
      .join(' | ') || null;
    const rebookIntervalDays = selectedValue(
      'rebookIntervalDays',
      primary,
      duplicate,
      selections,
    );
    await tx
      .update(salonClientSchema)
      .set({
        fullName: selectedValue('fullName', primary, duplicate, selections),
        phone: normalizedPhoneOrThrow(
          selectedValue('phone', primary, duplicate, selections),
        ),
        email: normalizeClientEmail(
          selectedValue('email', primary, duplicate, selections),
        ),
        birthday: selectedValue('birthday', primary, duplicate, selections),
        preferredTechnicianId: selectedPreferredTechnicianId,
        sensitivities: selectedValue(
          'sensitivities',
          primary,
          duplicate,
          selections,
        ),
        nailPreferences: selectedValue(
          'nailPreferences',
          primary,
          duplicate,
          selections,
        ),
        rebookIntervalDays,
        notes: selectedValue('notes', primary, duplicate, selections),
        tags,
        adminFlags: mergeAdminFlags(primary.adminFlags, duplicate.adminFlags),
        isBlocked,
        blockedReason,
        hasGoogleReview:
          primary.hasGoogleReview || duplicate.hasGoogleReview,
        googleReviewMarkedAt:
          primary.googleReviewMarkedAt ?? duplicate.googleReviewMarkedAt,
        googleReviewMarkedBy:
          primary.googleReviewMarkedBy ?? duplicate.googleReviewMarkedBy,
        welcomeBonusGrantedAt: earliestDate(
          primary.welcomeBonusGrantedAt,
          duplicate.welcomeBonusGrantedAt,
        ),
        lastContactAt: latestDate(primary.lastContactAt, duplicate.lastContactAt),
        // These caches came from two distinct profiles. Adding them preserves
        // the full accountability history; taking the maximum would silently
        // weaken the merged record.
        lateCancelCount:
          Math.max(primary.lateCancelCount ?? 0, 0)
          + Math.max(duplicate.lateCancelCount ?? 0, 0),
        lastLateCancelAt: latestDate(
          primary.lastLateCancelAt,
          duplicate.lastLateCancelAt,
        ),
        loyaltyPoints: Math.max(
          primary.loyaltyPoints ?? 0,
          duplicate.loyaltyPoints ?? 0,
        ),
        updatedAt: now,
      })
      .where(and(
        eq(salonClientSchema.salonId, input.salonId),
        eq(salonClientSchema.id, primary.id),
      ));

    const combinedAliases: ClientContactAliases = {
      phones: [...new Set([
        ...primaryAliases.phones,
        ...duplicateAliases.phones,
      ])],
      emails: [...new Set([
        ...primaryAliases.emails,
        ...duplicateAliases.emails,
      ])],
    };
    await recalculateClientStats(
      tx,
      input.salonId,
      primary.id,
      combinedAliases,
      rebookIntervalDays,
      now,
    );
    await insertAudit(tx, {
      salonId: input.salonId,
      actor: input.actor,
      action: 'client_merged',
      entityId: primary.id,
      metadata: {
        primaryClientId: primary.id,
        duplicateClientId: duplicate.id,
        selectedFields: Object.fromEntries(
          ([
            'fullName',
            'phone',
            'email',
            'birthday',
            'preferredTechnicianId',
            'sensitivities',
            'nailPreferences',
            'rebookIntervalDays',
            'notes',
          ] satisfies ClientMergeField[]).map(field => [
            field,
            selectedSource(field, primary, duplicate, selections),
          ]),
        ),
        primaryVersion: primary.updatedAt.toISOString(),
        duplicateVersion: duplicate.updatedAt.toISOString(),
      },
    });
    const mergedPrimary = await requireScopedClient(
      tx,
      input.salonId,
      primary.id,
    );
    const mergedDuplicate = await requireScopedClient(
      tx,
      input.salonId,
      duplicate.id,
    );
    return {
      primary: mergedPrimary,
      duplicate: mergedDuplicate,
      idempotent: false,
    };
  });
}

async function dismissActiveRetention(
  handle: LifecycleDb,
  salonId: string,
  clientId: string,
  now: Date,
): Promise<void> {
  await handle
    .update(clientCommunicationSchema)
    .set({
      status: 'dismissed',
      dismissedAt: now,
      snoozedUntil: null,
      metadata: sql`coalesce(${clientCommunicationSchema.metadata}, '{}'::jsonb)
        || jsonb_build_object('clientArchived', true)`,
      updatedAt: now,
    })
    .where(and(
      eq(clientCommunicationSchema.salonId, salonId),
      eq(clientCommunicationSchema.salonClientId, clientId),
      inArray(clientCommunicationSchema.kind, ACTIVE_RETENTION_KINDS),
      inArray(clientCommunicationSchema.status, ACTIVE_RETENTION_STATUSES),
    ));
}

export async function archiveSalonClient(
  input: ClientStateChangeInput,
): Promise<SalonClient> {
  assertNonEmpty(input.salonId, 'salonId');
  assertNonEmpty(input.clientId, 'clientId');
  assertNonEmpty(input.actor.id, 'actor.id');
  assertPrivilegedActor(input.actor);
  return db.transaction(async (transaction) => {
    const tx = transaction as LifecycleDb;
    await lockSalonLifecycle(tx, input.salonId);
    await lockClients(tx, input.salonId, [input.clientId]);
    const client = await requireScopedClient(tx, input.salonId, input.clientId);
    if (client.mergedIntoClientId) {
      throw new ClientLifecycleError(
        'INVALID_CLIENT_STATE',
        'Merged profiles are already archived by their merge record.',
      );
    }
    assertExpectedVersion(client, input.expectedUpdatedAt);
    if (client.archivedAt) {
      return client;
    }
    const now = new Date();
    await dismissActiveRetention(tx, input.salonId, client.id, now);
    const [archived] = await tx
      .update(salonClientSchema)
      .set({
        archivedAt: now,
        archivedBy: input.actor.id,
        updatedAt: now,
      })
      .where(and(
        eq(salonClientSchema.salonId, input.salonId),
        eq(salonClientSchema.id, client.id),
        isNull(salonClientSchema.archivedAt),
      ))
      .returning();
    if (!archived) {
      throw new ClientLifecycleError(
        'STALE_CLIENT',
        'This client changed since it was loaded. Refresh and try again.',
      );
    }
    await insertAudit(tx, {
      salonId: input.salonId,
      actor: input.actor,
      action: 'client_archived',
      entityId: client.id,
      metadata: { previousVersion: client.updatedAt.toISOString() },
    });
    return archived;
  });
}

export async function restoreSalonClient(
  input: ClientStateChangeInput,
): Promise<SalonClient> {
  assertNonEmpty(input.salonId, 'salonId');
  assertNonEmpty(input.clientId, 'clientId');
  assertNonEmpty(input.actor.id, 'actor.id');
  assertPrivilegedActor(input.actor);
  return db.transaction(async (transaction) => {
    const tx = transaction as LifecycleDb;
    await lockSalonLifecycle(tx, input.salonId);
    await lockClients(tx, input.salonId, [input.clientId]);
    const client = await requireScopedClient(tx, input.salonId, input.clientId);
    if (client.mergedIntoClientId) {
      throw new ClientLifecycleError(
        'INVALID_CLIENT_STATE',
        'A merged source profile cannot be restored.',
      );
    }
    assertExpectedVersion(client, input.expectedUpdatedAt);
    if (!client.archivedAt) {
      return client;
    }
    const duplicates = (await findDuplicatesWithHandle(tx, {
      salonId: input.salonId,
      phone: client.phone,
      email: client.email,
      excludeClientId: client.id,
    })).filter(duplicate => duplicate.archivedAt === null);
    if (duplicates.length > 0) {
      throw new ClientLifecycleError(
        'POSSIBLE_DUPLICATE',
        'Resolve the matching active profile before restoring this client.',
        { duplicates },
      );
    }
    const now = new Date();
    const [restored] = await tx
      .update(salonClientSchema)
      .set({
        archivedAt: null,
        archivedBy: null,
        updatedAt: now,
      })
      .where(and(
        eq(salonClientSchema.salonId, input.salonId),
        eq(salonClientSchema.id, client.id),
      ))
      .returning();
    if (!restored) {
      throw new ClientLifecycleError(
        'STALE_CLIENT',
        'This client changed since it was loaded. Refresh and try again.',
      );
    }
    await insertAudit(tx, {
      salonId: input.salonId,
      actor: input.actor,
      action: 'client_restored',
      entityId: client.id,
      metadata: { previousVersion: client.updatedAt.toISOString() },
    });
    return restored;
  });
}

export async function permanentlyDeleteSalonClient(
  input: ClientStateChangeInput,
): Promise<{ deletedClientId: string }> {
  assertNonEmpty(input.salonId, 'salonId');
  assertNonEmpty(input.clientId, 'clientId');
  assertNonEmpty(input.actor.id, 'actor.id');
  assertPrivilegedActor(input.actor);
  return db.transaction(async (transaction) => {
    const tx = transaction as LifecycleDb;
    await lockSalonLifecycle(tx, input.salonId);
    await lockClients(tx, input.salonId, [input.clientId]);
    const client = await requireScopedClient(tx, input.salonId, input.clientId);
    assertExpectedVersion(client, input.expectedUpdatedAt);
    const dependencies = await dependencySummaryWithHandle(tx, {
      salonId: input.salonId,
      clientId: client.id,
    });
    if (!dependencies.hardDeleteEligible) {
      throw new ClientLifecycleError(
        'CLIENT_HAS_HISTORY',
        'This client has history and can only remain archived.',
        { dependencies },
      );
    }
    const [deleted] = await tx
      .delete(salonClientSchema)
      .where(and(
        eq(salonClientSchema.salonId, input.salonId),
        eq(salonClientSchema.id, client.id),
        isNull(salonClientSchema.mergedIntoClientId),
      ))
      .returning();
    if (!deleted) {
      throw new ClientLifecycleError(
        'STALE_CLIENT',
        'This client changed since it was loaded. Refresh and try again.',
      );
    }
    await insertAudit(tx, {
      salonId: input.salonId,
      actor: input.actor,
      action: 'client_permanently_deleted',
      entityId: deleted.id,
      metadata: { previousVersion: client.updatedAt.toISOString() },
    });
    return { deletedClientId: deleted.id };
  });
}

export async function resolveSalonClient(input: {
  salonId: string;
  clientId: string;
}): Promise<{
    client: SalonClient;
    redirectedFromClientId: string | null;
  }> {
  assertNonEmpty(input.salonId, 'salonId');
  assertNonEmpty(input.clientId, 'clientId');
  let client = await requireScopedClient(
    db as LifecycleDb,
    input.salonId,
    input.clientId,
  );
  const visited = new Set<string>();
  while (client.mergedIntoClientId) {
    if (visited.has(client.id) || visited.size >= 16) {
      throw new ClientLifecycleError(
        'INVALID_CLIENT_STATE',
        'Client merge history contains a cycle.',
      );
    }
    visited.add(client.id);
    client = await requireScopedClient(
      db as LifecycleDb,
      input.salonId,
      client.mergedIntoClientId,
    );
  }
  return {
    client,
    redirectedFromClientId: client.id === input.clientId ? null : input.clientId,
  };
}
