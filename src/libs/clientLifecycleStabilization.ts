import 'server-only';

import { and, eq, type SQL, sql } from 'drizzle-orm';
import { z } from 'zod';

import { db } from '@/libs/DB';
import { normalizePhone } from '@/libs/phone';
import { notificationDeliverySchema } from '@/models/Schema';

export const CLIENT_LIFECYCLE_MAX_CHAIN_DEPTH = 16;
export const CLIENT_LIFECYCLE_RETRYABLE_SQLSTATES = new Set([
  '40P01',
  '40001',
]);
const CLIENT_EDIT_TRANSACTION_TIMEOUT_SQLSTATES = new Set([
  '55P03',
  '57014',
]);

export type ClientLifecycleErrorCode =
  | 'CLIENT_NOT_FOUND'
  | 'INVALID_CLIENT_STATE'
  | 'CLIENT_ARCHIVED'
  | 'UNSUPPORTED_CLIENT_IDENTITY';

export class ClientLifecycleStabilizationError extends Error {
  readonly code: ClientLifecycleErrorCode;

  constructor(code: ClientLifecycleErrorCode, message = 'Client not found.') {
    super(message);
    this.name = 'ClientLifecycleStabilizationError';
    this.code = code;
  }
}

export type LifecycleSqlHandle = {
  execute: (query: SQL) => Promise<unknown>;
};

export type TerminalSalonClient = {
  id: string;
  salonId: string;
  archivedAt: Date | null;
  redirectedFromClientId: string | null;
  lineagePath: string[];
};

export type OperationalSalonClientContact = TerminalSalonClient & {
  phone: string;
  email: string | null;
};

export type NormalizedClientIdentity = {
  kind: 'phone' | 'email';
  value: string;
};

export type SalonClientLineageIdentity = {
  terminal: OperationalSalonClientContact;
  clientIds: string[];
  phones: string[];
  emails: string[];
  externalClientId: string | null;
};

export type CanonicalSalonClientIdentity = SalonClientLineageIdentity & {
  matchedBy: NormalizedClientIdentity[];
};

export type CanonicalSalonClientIdentityOutcome =
  | {
    status: 'resolved_terminal';
    identity: CanonicalSalonClientIdentity;
  }
  | {
    status: 'zero_identity_candidates';
  }
  | {
    status: 'invalid_or_ambiguous_identity';
    reason: ClientLifecycleErrorCode;
  };

export type OperationalEmailRecipientUnavailableReason =
  | 'appointment_not_found'
  | 'client_identity_unavailable'
  | 'unsupported_client_identity'
  | 'invalid_terminal_email'
  | 'email_unavailable';

export type OperationalEmailRecipientResolution =
  | {
    status: 'terminal_current' | 'appointment_snapshot';
    email: string;
    terminalClientId: string;
  }
  | {
    status: 'appointment_snapshot';
    email: string;
    terminalClientId: null;
    identityResolution: 'zero_identity_candidates';
  }
  | {
    status: 'unavailable';
    reason: OperationalEmailRecipientUnavailableReason;
  };

export type OperationalEmailDeliveryResult = {
  status: 'sent' | 'failed' | 'unavailable' | 'duplicate';
  deliveryId: string | null;
  claimed: boolean;
};

type OperationalEmailContent = {
  subject: string;
  text: string;
  html: string;
};

export type SalonClientLifecycleLink = {
  id: string;
  archivedAt: Date | null;
  mergedIntoClientId: string | null;
};

export type SalonClientIdentityKind = 'phone' | 'email';

export type NormalizedSalonClientIdentity = {
  phone: string | null;
  email: string | null;
};

export type SalonClientIdentityLockKey = {
  salonId: string;
  kind: SalonClientIdentityKind;
  normalizedValue: string;
  advisoryKey: string;
};

export type SalonClientIdentityContactInput = {
  phone?: string | null;
  email?: string | null;
};

function normalizeSupportedPhone(value: string | null | undefined): string | null {
  if (value == null || !value.trim()) {
    return null;
  }
  const normalized = normalizePhone(value);
  if (normalized.length !== 10) {
    throw new TypeError('phone must normalize to 10 digits');
  }
  return normalized;
}

function normalizeEmail(value: string): string {
  const normalized = value.trim().toLowerCase();
  if (!z.string().email().max(320).safeParse(normalized).success) {
    throw new TypeError('email is invalid');
  }
  return normalized;
}

function normalizeSupportedEmail(value: string | null | undefined): string | null {
  if (value == null || !value.trim()) {
    return null;
  }
  return normalizeEmail(value);
}

function tryNormalizeSupportedPhone(
  value: string | null | undefined,
): string | null {
  try {
    return normalizeSupportedPhone(value);
  } catch {
    return null;
  }
}

function tryNormalizeSupportedEmail(
  value: string | null | undefined,
): string | null {
  try {
    return normalizeSupportedEmail(value);
  } catch {
    return null;
  }
}

export function normalizeSalonClientIdentity(input: {
  phone?: string | null;
  email?: string | null;
}): NormalizedSalonClientIdentity {
  return {
    phone: normalizeSupportedPhone(input.phone),
    email: normalizeSupportedEmail(input.email),
  };
}

/**
 * Produces transaction-scoped identity locks in one deterministic order.
 * The encoded advisory key is tenant scoped and includes the contact kind, so
 * the same value in another salon or in another namespace never coordinates.
 */
export function buildSalonClientIdentityLockKeys(input: {
  salonId: string;
  phone?: string | null;
  email?: string | null;
}): SalonClientIdentityLockKey[] {
  return buildSalonClientIdentityLockKeySet({
    salonId: input.salonId,
    contacts: [input],
  });
}

/**
 * Produces one globally sorted, de-duplicated lock set for every current and
 * proposed contact involved in a salon-scoped identity mutation.
 */
export function buildSalonClientIdentityLockKeySet(input: {
  salonId: string;
  contacts: SalonClientIdentityContactInput[];
}): SalonClientIdentityLockKey[] {
  const salonId = requireInput(input.salonId, 'salonId');
  const keysByAdvisoryKey = new Map<string, SalonClientIdentityLockKey>();

  for (const contact of input.contacts) {
    const normalized = normalizeSalonClientIdentity(contact);
    for (const [kind, normalizedValue] of [
      ['phone', normalized.phone],
      ['email', normalized.email],
    ] as const) {
      if (!normalizedValue) {
        continue;
      }
      const advisoryKey = JSON.stringify([salonId, kind, normalizedValue]);
      keysByAdvisoryKey.set(advisoryKey, {
        salonId,
        kind,
        normalizedValue,
        advisoryKey,
      });
    }
  }

  return [...keysByAdvisoryKey.values()].sort((left, right) =>
    left.advisoryKey.localeCompare(right.advisoryKey));
}

export async function lockSalonClientIdentityKeySetWithHandle(
  handle: LifecycleSqlHandle,
  input: {
    salonId: string;
    contacts: SalonClientIdentityContactInput[];
  },
): Promise<SalonClientIdentityLockKey[]> {
  const keys = buildSalonClientIdentityLockKeySet(input);
  if (keys.length === 0) {
    throw new TypeError('at least one supported client identity is required');
  }

  for (const key of keys) {
    await handle.execute(sql`
      select pg_advisory_xact_lock(
        hashtextextended(${key.advisoryKey}, 0)
      )
    `);
  }
  return keys;
}

export async function lockSalonClientIdentityKeysWithHandle(
  handle: LifecycleSqlHandle,
  input: {
    salonId: string;
    phone?: string | null;
    email?: string | null;
  },
): Promise<NormalizedSalonClientIdentity> {
  const keys = await lockSalonClientIdentityKeySetWithHandle(handle, {
    salonId: input.salonId,
    contacts: [input],
  });

  return {
    phone: keys.find(key => key.kind === 'phone')?.normalizedValue ?? null,
    email: keys.find(key => key.kind === 'email')?.normalizedValue ?? null,
  };
}

/**
 * Builds one tenant's source-to-active-terminal map without issuing queries.
 * Invalid, cyclic, missing-target, archived-terminal, and over-depth chains
 * intentionally have no mapping.
 */
export function buildActiveTerminalSalonClientMap(
  rows: SalonClientLifecycleLink[],
): Map<string, string> {
  const rowsById = new Map(rows.map(row => [row.id, row]));
  const terminalBySource = new Map<string, string>();

  for (const source of rows) {
    const visited = new Set<string>();
    let current: SalonClientLifecycleLink | undefined = source;

    for (
      let depth = 0;
      current && depth < CLIENT_LIFECYCLE_MAX_CHAIN_DEPTH;
      depth += 1
    ) {
      if (visited.has(current.id)) {
        current = undefined;
        break;
      }
      visited.add(current.id);

      if (!current.mergedIntoClientId) {
        if (!current.archivedAt) {
          terminalBySource.set(source.id, current.id);
        }
        break;
      }
      current = rowsById.get(current.mergedIntoClientId);
    }
  }

  return terminalBySource;
}

type ClientRow = {
  id: unknown;
  salon_id: unknown;
  merged_into_client_id: unknown;
  archived_at: unknown;
};

function readRows(result: unknown): Record<string, unknown>[] {
  const resultWithRows = result as { rows?: Record<string, unknown>[] };
  if (Array.isArray(resultWithRows?.rows)) {
    return resultWithRows.rows;
  }
  return Array.isArray(result) ? result as Record<string, unknown>[] : [];
}

function asClientRow(value: Record<string, unknown> | undefined): ClientRow | null {
  if (!value || typeof value.id !== 'string' || typeof value.salon_id !== 'string') {
    return null;
  }
  return value as ClientRow;
}

function dateValue(value: unknown): Date | null {
  if (value == null) {
    return null;
  }
  const parsed = value instanceof Date ? value : new Date(String(value));
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function requireInput(value: string, name: string): string {
  const normalized = value.trim();
  if (!normalized) {
    throw new TypeError(`${name} is required`);
  }
  return normalized;
}

export function normalizeClientIdentityInput(input: {
  phone?: string | null;
  email?: string | null;
}): NormalizedClientIdentity[] {
  const identities: NormalizedClientIdentity[] = [];
  if (input.phone != null && input.phone.trim() !== '') {
    const phone = normalizePhone(input.phone);
    if (phone.length !== 10) {
      throw new TypeError('phone is invalid');
    }
    identities.push({ kind: 'phone', value: phone });
  }
  if (input.email != null && input.email.trim() !== '') {
    identities.push({ kind: 'email', value: normalizeEmail(input.email) });
  }
  return identities.sort((left, right) =>
    left.kind.localeCompare(right.kind) || left.value.localeCompare(right.value));
}

async function loadClientRow(
  handle: LifecycleSqlHandle,
  salonId: string,
  clientId: string,
): Promise<ClientRow | null> {
  const result = await handle.execute(sql`
    select
      id,
      salon_id,
      merged_into_client_id,
      archived_at
    from salon_client
    where salon_id = ${salonId}
      and id = ${clientId}
    limit 1
  `);
  return asClientRow(readRows(result)[0]);
}

export async function resolveTerminalSalonClientWithHandle(
  handle: LifecycleSqlHandle,
  input: {
    salonId: string;
    clientId: string;
    allowArchived?: boolean;
  },
): Promise<TerminalSalonClient> {
  const salonId = requireInput(input.salonId, 'salonId');
  const requestedClientId = requireInput(input.clientId, 'clientId');
  const lineagePath: string[] = [];
  const visited = new Set<string>();
  let currentId = requestedClientId;

  for (let depth = 0; depth < CLIENT_LIFECYCLE_MAX_CHAIN_DEPTH; depth += 1) {
    if (visited.has(currentId)) {
      throw new ClientLifecycleStabilizationError(
        'INVALID_CLIENT_STATE',
        'Client lifecycle state is unavailable.',
      );
    }
    visited.add(currentId);
    lineagePath.push(currentId);

    const row = await loadClientRow(handle, salonId, currentId);
    if (!row) {
      throw new ClientLifecycleStabilizationError('CLIENT_NOT_FOUND');
    }

    const mergedIntoClientId = typeof row.merged_into_client_id === 'string'
      ? row.merged_into_client_id
      : null;
    if (mergedIntoClientId) {
      currentId = mergedIntoClientId;
      continue;
    }

    const archivedAt = dateValue(row.archived_at);
    if (archivedAt && !input.allowArchived) {
      throw new ClientLifecycleStabilizationError(
        'CLIENT_ARCHIVED',
        'Client is unavailable.',
      );
    }

    return {
      id: String(row.id),
      salonId: String(row.salon_id),
      archivedAt,
      redirectedFromClientId:
        requestedClientId === row.id ? null : requestedClientId,
      lineagePath,
    };
  }

  throw new ClientLifecycleStabilizationError(
    'INVALID_CLIENT_STATE',
    'Client lifecycle state is unavailable.',
  );
}

export function resolveTerminalSalonClient(input: {
  salonId: string;
  clientId: string;
  allowArchived?: boolean;
}): Promise<TerminalSalonClient> {
  return resolveTerminalSalonClientWithHandle(db as LifecycleSqlHandle, input);
}

async function loadOperationalSalonClientContact(
  handle: LifecycleSqlHandle,
  terminal: TerminalSalonClient,
): Promise<OperationalSalonClientContact> {
  const result = await handle.execute(sql`
    select phone, email
    from salon_client
    where salon_id = ${terminal.salonId}
      and id = ${terminal.id}
    limit 1
  `);
  const row = readRows(result)[0];
  if (!row || typeof row.phone !== 'string') {
    throw new ClientLifecycleStabilizationError('CLIENT_NOT_FOUND');
  }
  return {
    ...terminal,
    phone: row.phone,
    email: typeof row.email === 'string' ? row.email : null,
  };
}

export async function resolveOperationalSalonClientContactWithHandle(
  handle: LifecycleSqlHandle,
  input: {
    salonId: string;
    clientId: string;
    allowArchived?: boolean;
  },
): Promise<OperationalSalonClientContact> {
  const terminal = await resolveTerminalSalonClientWithHandle(handle, input);
  return loadOperationalSalonClientContact(handle, terminal);
}

export function resolveOperationalSalonClientContact(input: {
  salonId: string;
  clientId: string;
  allowArchived?: boolean;
}): Promise<OperationalSalonClientContact> {
  return resolveOperationalSalonClientContactWithHandle(
    db as LifecycleSqlHandle,
    input,
  );
}

export async function lockOperationalSalonClientContactWithHandle(
  handle: LifecycleSqlHandle,
  input: {
    salonId: string;
    clientId: string;
    allowArchived?: boolean;
  },
): Promise<OperationalSalonClientContact> {
  const terminal = await lockTerminalSalonClientWithHandle(handle, input);
  return loadOperationalSalonClientContact(handle, terminal);
}

/**
 * Resolves a phone snapshot for an authenticated operational writer. This
 * deliberately remains separate from customer authentication: historical
 * contact aliases are continuity hints for existing salon records, never
 * login aliases.
 */
export async function resolveOperationalSalonClientByPhoneWithHandle(
  handle: LifecycleSqlHandle,
  input: {
    salonId: string;
    phone: string;
    allowArchived?: boolean;
  },
): Promise<TerminalSalonClient | null> {
  const salonId = requireInput(input.salonId, 'salonId');
  const normalizedPhone = normalizePhone(input.phone);
  if (normalizedPhone.length !== 10) {
    return null;
  }

  const candidateResult = await handle.execute(sql`
    select candidate.id
    from (
      select client.id
      from salon_client as client
      where client.salon_id = ${salonId}
        and client.phone = ${normalizedPhone}

      union

      select alias.salon_client_id as id
      from salon_client_contact_alias as alias
      where alias.salon_id = ${salonId}
        and alias.kind = 'phone'
        and alias.normalized_value = ${normalizedPhone}
    ) as candidate
    order by candidate.id
  `);
  const candidateIds = [...new Set(
    readRows(candidateResult)
      .map(row => row.id)
      .filter((id): id is string => typeof id === 'string'),
  )];
  if (candidateIds.length === 0) {
    return null;
  }

  const terminals: TerminalSalonClient[] = [];
  for (const clientId of candidateIds) {
    terminals.push(await resolveTerminalSalonClientWithHandle(handle, {
      salonId,
      clientId,
      allowArchived: input.allowArchived,
    }));
  }
  const terminalIds = new Set(terminals.map(terminal => terminal.id));
  if (terminalIds.size !== 1) {
    throw new ClientLifecycleStabilizationError(
      'INVALID_CLIENT_STATE',
      'Client lifecycle state is unavailable.',
    );
  }

  return terminals[0] ?? null;
}

export async function resolveOperationalSalonClientContactByPhoneWithHandle(
  handle: LifecycleSqlHandle,
  input: {
    salonId: string;
    phone: string;
    allowArchived?: boolean;
  },
): Promise<OperationalSalonClientContact | null> {
  const terminal = await resolveOperationalSalonClientByPhoneWithHandle(
    handle,
    input,
  );
  return terminal
    ? loadOperationalSalonClientContact(handle, terminal)
    : null;
}

export function resolveOperationalSalonClientContactByPhone(input: {
  salonId: string;
  phone: string;
  allowArchived?: boolean;
}): Promise<OperationalSalonClientContact | null> {
  return resolveOperationalSalonClientContactByPhoneWithHandle(
    db as LifecycleSqlHandle,
    input,
  );
}

export async function getSalonClientLineageIdentityWithHandle(
  handle: LifecycleSqlHandle,
  input: {
    salonId: string;
    terminalClientId: string;
    allowArchived?: boolean;
  },
): Promise<SalonClientLineageIdentity> {
  const terminal = await resolveOperationalSalonClientContactWithHandle(
    handle,
    {
      salonId: input.salonId,
      clientId: input.terminalClientId,
      allowArchived: input.allowArchived,
    },
  );
  if (terminal.id !== input.terminalClientId) {
    throw new ClientLifecycleStabilizationError(
      'INVALID_CLIENT_STATE',
      'Client lifecycle state is unavailable.',
    );
  }

  const clientIds = await getSalonClientLineageIdsWithHandle(handle, {
    salonId: terminal.salonId,
    terminalClientId: terminal.id,
  });
  const lineageRowsResult = await handle.execute(sql`
    select id, phone, lower(email) as email, client_id
    from salon_client
    where salon_id = ${terminal.salonId}
      and id in (
        ${sql.join(clientIds.map(id => sql`${id}`), sql`, `)}
      )
    order by id
  `);
  const lineageRows = readRows(lineageRowsResult);
  if (lineageRows.length !== clientIds.length) {
    throw new ClientLifecycleStabilizationError(
      'INVALID_CLIENT_STATE',
      'Client lifecycle state is unavailable.',
    );
  }

  const sourceWithExternalIdentity = lineageRows.some(row =>
    row.id !== terminal.id && typeof row.client_id === 'string');
  const externalClientIds = [...new Set(
    lineageRows
      .map(row => row.client_id)
      .filter((id): id is string => typeof id === 'string'),
  )];
  if (sourceWithExternalIdentity || externalClientIds.length > 1) {
    throw new ClientLifecycleStabilizationError(
      'INVALID_CLIENT_STATE',
      'Client lifecycle state is unavailable.',
    );
  }

  const aliasesResult = await handle.execute(sql`
    select kind, normalized_value
    from salon_client_contact_alias
    where salon_id = ${terminal.salonId}
      and salon_client_id in (
        ${sql.join(clientIds.map(id => sql`${id}`), sql`, `)}
      )
    order by salon_id, kind, normalized_value, salon_client_id
  `);
  const aliases = readRows(aliasesResult);
  const phones = new Set<string>();
  const emails = new Set<string>();
  for (const row of lineageRows) {
    if (typeof row.phone === 'string') {
      const phone = normalizePhone(row.phone);
      if (phone.length === 10) {
        phones.add(phone);
      }
    }
    if (typeof row.email === 'string' && row.email.trim()) {
      emails.add(row.email.trim().toLowerCase());
    }
  }
  for (const alias of aliases) {
    if (alias.kind === 'phone' && typeof alias.normalized_value === 'string') {
      const phone = normalizePhone(alias.normalized_value);
      if (phone.length === 10) {
        phones.add(phone);
      }
    }
    if (alias.kind === 'email' && typeof alias.normalized_value === 'string') {
      emails.add(alias.normalized_value.trim().toLowerCase());
    }
  }

  return {
    terminal,
    clientIds,
    phones: [...phones].sort(),
    emails: [...emails].sort(),
    externalClientId: externalClientIds[0] ?? null,
  };
}

export async function resolveCanonicalSalonClientIdentityOutcomeWithHandle(
  handle: LifecycleSqlHandle,
  input: {
    salonId: string;
    phone?: string | null;
    email?: string | null;
    allowArchived?: boolean;
  },
): Promise<CanonicalSalonClientIdentityOutcome> {
  const salonId = requireInput(input.salonId, 'salonId');
  const identities = normalizeClientIdentityInput(input);
  if (identities.length === 0) {
    return {
      status: 'invalid_or_ambiguous_identity',
      reason: 'INVALID_CLIENT_STATE',
    };
  }

  const phone = identities.find(identity => identity.kind === 'phone')?.value;
  const email = identities.find(identity => identity.kind === 'email')?.value;
  const candidateResult = await handle.execute(sql`
    select distinct candidate.id
    from (
      select client.id
      from salon_client as client
      where client.salon_id = ${salonId}
        and (
          (${phone ?? null}::text is not null and client.phone = ${phone ?? null})
          or (
            ${email ?? null}::text is not null
            and lower(btrim(client.email)) = ${email ?? null}
          )
        )

      union

      select alias.salon_client_id as id
      from salon_client_contact_alias as alias
      where alias.salon_id = ${salonId}
        and (
          (
            ${phone ?? null}::text is not null
            and alias.kind = 'phone'
            and alias.normalized_value = ${phone ?? null}
          )
          or (
            ${email ?? null}::text is not null
            and alias.kind = 'email'
            and alias.normalized_value = ${email ?? null}
          )
        )
    ) as candidate
    order by candidate.id
  `);
  const candidateIds = [...new Set(
    readRows(candidateResult)
      .map(row => row.id)
      .filter((id): id is string => typeof id === 'string'),
  )];
  if (candidateIds.length === 0) {
    return { status: 'zero_identity_candidates' };
  }

  try {
    const terminals = await Promise.all(candidateIds.map(clientId =>
      resolveTerminalSalonClientWithHandle(handle, {
        salonId,
        clientId,
        allowArchived: input.allowArchived,
      })));
    const terminalIds = [...new Set(terminals.map(terminal => terminal.id))];
    if (terminalIds.length !== 1) {
      return {
        status: 'invalid_or_ambiguous_identity',
        reason: 'INVALID_CLIENT_STATE',
      };
    }

    const lineage = await getSalonClientLineageIdentityWithHandle(handle, {
      salonId,
      terminalClientId: terminalIds[0]!,
      allowArchived: input.allowArchived,
    });
    const matchedBy = identities.filter(identity =>
      identity.kind === 'phone'
        ? lineage.phones.includes(identity.value)
        : lineage.emails.includes(identity.value));
    if (matchedBy.length === 0) {
      return {
        status: 'invalid_or_ambiguous_identity',
        reason: 'INVALID_CLIENT_STATE',
      };
    }
    return {
      status: 'resolved_terminal',
      identity: { ...lineage, matchedBy },
    };
  } catch (error) {
    if (error instanceof ClientLifecycleStabilizationError) {
      return {
        status: 'invalid_or_ambiguous_identity',
        reason: error.code,
      };
    }
    throw error;
  }
}

export async function resolveCanonicalSalonClientIdentityWithHandle(
  handle: LifecycleSqlHandle,
  input: {
    salonId: string;
    phone?: string | null;
    email?: string | null;
    allowArchived?: boolean;
  },
): Promise<CanonicalSalonClientIdentity | null> {
  if (normalizeClientIdentityInput(input).length === 0) {
    return null;
  }
  const outcome = await resolveCanonicalSalonClientIdentityOutcomeWithHandle(
    handle,
    input,
  );
  if (outcome.status === 'zero_identity_candidates') {
    return null;
  }
  if (outcome.status === 'invalid_or_ambiguous_identity') {
    throw new ClientLifecycleStabilizationError(
      outcome.reason,
      'Client lifecycle state is unavailable.',
    );
  }
  return outcome.identity;
}

export function resolveCanonicalSalonClientIdentity(input: {
  salonId: string;
  phone?: string | null;
  email?: string | null;
  allowArchived?: boolean;
}): Promise<CanonicalSalonClientIdentity | null> {
  return resolveCanonicalSalonClientIdentityWithHandle(
    db as LifecycleSqlHandle,
    input,
  );
}

export function resolveCanonicalSalonClientIdentityOutcome(input: {
  salonId: string;
  phone?: string | null;
  email?: string | null;
  allowArchived?: boolean;
}): Promise<CanonicalSalonClientIdentityOutcome> {
  return resolveCanonicalSalonClientIdentityOutcomeWithHandle(
    db as LifecycleSqlHandle,
    input,
  );
}

async function hasUnsupportedGlobalClientIdentityWithHandle(
  handle: LifecycleSqlHandle,
  identities: NormalizedClientIdentity[],
): Promise<boolean> {
  const phone = identities.find(identity => identity.kind === 'phone')?.value;
  const email = identities.find(identity => identity.kind === 'email')?.value;
  if (!phone && !email) {
    return true;
  }
  const phoneVariants = phone
    ? [phone, `1${phone}`, `+1${phone}`, `+${phone}`]
    : [];
  const globalPhoneMatch = phone
    ? sql`client.phone in (
        ${sql.join(phoneVariants.map(value => sql`${value}`), sql`, `)}
      )`
    : sql`false`;
  const sessionPhoneMatch = phone
    ? sql`client_session.client_phone in (
        ${sql.join(phoneVariants.map(value => sql`${value}`), sql`, `)}
      )`
    : sql`false`;
  const result = await handle.execute(sql`
    select (
      exists (
        select 1
        from client
        where (
          ${globalPhoneMatch}
        )
        or (
          ${email ?? null}::text is not null
          and lower(btrim(client.email)) = ${email ?? null}
        )
      )
      or exists (
        select 1
        from client_session
        where ${sessionPhoneMatch}
      )
    ) as has_unsupported_identity
  `);
  const row = readRows(result)[0];
  if (!row || typeof row.has_unsupported_identity !== 'boolean') {
    throw new TypeError('GLOBAL_CLIENT_IDENTITY_CHECK_INVALID');
  }
  return row.has_unsupported_identity;
}

export type ZeroCandidateOrphanRecoveryAppointment = {
  id: string;
  startTime: Date;
  endTime: Date;
};

export async function getZeroCandidateOrphanRecoveryAppointmentsWithHandle(
  handle: LifecycleSqlHandle,
  input: {
    salonId: string;
    phone?: string | null;
    email?: string | null;
    now?: Date;
  },
): Promise<ZeroCandidateOrphanRecoveryAppointment[]> {
  const salonId = requireInput(input.salonId, 'salonId');
  const outcome = await resolveCanonicalSalonClientIdentityOutcomeWithHandle(
    handle,
    {
      salonId,
      phone: input.phone,
      email: input.email,
      allowArchived: true,
    },
  );
  if (outcome.status !== 'zero_identity_candidates') {
    return [];
  }

  const identities = normalizeClientIdentityInput(input);
  const phone = identities.find(identity => identity.kind === 'phone')?.value;
  const email = identities.find(identity => identity.kind === 'email')?.value;
  if (!phone && !email) {
    return [];
  }
  if (await hasUnsupportedGlobalClientIdentityWithHandle(handle, identities)) {
    return [];
  }
  const now = input.now ?? new Date();
  const result = await handle.execute(sql`
    select appointment.id, appointment.start_time, appointment.end_time
    from appointment
    where appointment.salon_id = ${salonId}
      and appointment.salon_client_id is null
      and appointment.status in ('pending', 'confirmed', 'in_progress')
      and appointment.deleted_at is null
      and appointment.end_time > ${now}
      and (
        (
          ${phone ?? null}::text is not null
          and case
            when length(regexp_replace(
              appointment.client_phone,
              '[^0-9]',
              '',
              'g'
            )) = 10
            then regexp_replace(
              appointment.client_phone,
              '[^0-9]',
              '',
              'g'
            )
            when length(regexp_replace(
              appointment.client_phone,
              '[^0-9]',
              '',
              'g'
            )) = 11
              and left(regexp_replace(
                appointment.client_phone,
                '[^0-9]',
                '',
                'g'
              ), 1) = '1'
            then right(regexp_replace(
              appointment.client_phone,
              '[^0-9]',
              '',
              'g'
            ), 10)
            else null
          end = ${phone ?? null}
        )
        or (
          ${email ?? null}::text is not null
          and lower(btrim(appointment.client_email)) = ${email ?? null}
        )
      )
    order by appointment.start_time, appointment.id
    limit 26
  `);

  const rows = readRows(result);
  if (rows.length > 25) {
    return [];
  }
  return rows.map((row) => {
    const startTime = dateValue(row.start_time);
    const endTime = dateValue(row.end_time);
    if (
      typeof row.id !== 'string'
      || !startTime
      || !endTime
    ) {
      throw new TypeError('ORPHAN_RECOVERY_APPOINTMENT_ROW_INVALID');
    }
    return {
      id: row.id,
      startTime,
      endTime,
    };
  });
}

export function getZeroCandidateOrphanRecoveryAppointments(input: {
  salonId: string;
  phone?: string | null;
  email?: string | null;
  now?: Date;
}): Promise<ZeroCandidateOrphanRecoveryAppointment[]> {
  return getZeroCandidateOrphanRecoveryAppointmentsWithHandle(
    db as LifecycleSqlHandle,
    input,
  );
}

type AppointmentOperationalContactRow = {
  salonClientId: string | null;
  clientPhone: string;
  clientEmail: string | null;
};

async function loadAppointmentOperationalContact(
  handle: LifecycleSqlHandle,
  input: {
    salonId: string;
    appointmentId: string;
  },
): Promise<AppointmentOperationalContactRow | null> {
  const result = await handle.execute(sql`
    select
      salon_client_id,
      client_phone,
      client_email
    from appointment
    where salon_id = ${input.salonId}
      and id = ${input.appointmentId}
    limit 1
  `);
  const row = readRows(result)[0];
  if (!row || typeof row.client_phone !== 'string') {
    return null;
  }
  return {
    salonClientId:
      typeof row.salon_client_id === 'string' ? row.salon_client_id : null,
    clientPhone: row.client_phone,
    clientEmail: typeof row.client_email === 'string' ? row.client_email : null,
  };
}

/**
 * Selects the current operational email for an existing appointment without
 * changing any historical appointment or communication snapshots.
 *
 * Historical contact values may locate an unlinked legacy appointment's
 * same-salon client lineage, but they never become an authentication identity.
 * A stable salon_client_id always owns the appointment when one is present.
 */
export async function resolveAppointmentOperationalEmailRecipientWithHandle(
  handle: LifecycleSqlHandle,
  input: {
    salonId: string;
    appointmentId: string;
  },
): Promise<OperationalEmailRecipientResolution> {
  const salonId = requireInput(input.salonId, 'salonId');
  const appointmentId = requireInput(input.appointmentId, 'appointmentId');
  const appointment = await loadAppointmentOperationalContact(handle, {
    salonId,
    appointmentId,
  });
  if (!appointment) {
    return {
      status: 'unavailable',
      reason: 'appointment_not_found',
    };
  }

  try {
    let lineage: SalonClientLineageIdentity | null;
    if (appointment.salonClientId) {
      const terminal = await resolveTerminalSalonClientWithHandle(handle, {
        salonId,
        clientId: appointment.salonClientId,
        allowArchived: true,
      });
      lineage = await getSalonClientLineageIdentityWithHandle(handle, {
        salonId,
        terminalClientId: terminal.id,
        allowArchived: true,
      });
    } else {
      const phone = tryNormalizeSupportedPhone(appointment.clientPhone);
      const email = tryNormalizeSupportedEmail(appointment.clientEmail);
      if (!phone && !email) {
        return {
          status: 'unavailable',
          reason: 'client_identity_unavailable',
        };
      }
      const outcome = await resolveCanonicalSalonClientIdentityOutcomeWithHandle(
        handle,
        {
          salonId,
          phone,
          email,
          allowArchived: true,
        },
      );
      if (outcome.status === 'zero_identity_candidates') {
        const identities = normalizeClientIdentityInput({ phone, email });
        if (
          await hasUnsupportedGlobalClientIdentityWithHandle(
            handle,
            identities,
          )
        ) {
          return {
            status: 'unavailable',
            reason: 'unsupported_client_identity',
          };
        }
        const snapshotEmail = tryNormalizeSupportedEmail(
          appointment.clientEmail,
        );
        if (!snapshotEmail) {
          return {
            status: 'unavailable',
            reason: 'email_unavailable',
          };
        }
        return {
          status: 'appointment_snapshot',
          email: snapshotEmail,
          terminalClientId: null,
          identityResolution: 'zero_identity_candidates',
        };
      }
      if (outcome.status === 'invalid_or_ambiguous_identity') {
        return {
          status: 'unavailable',
          reason: 'client_identity_unavailable',
        };
      }
      lineage = outcome.identity;
    }

    if (lineage.externalClientId !== null) {
      return {
        status: 'unavailable',
        reason: 'unsupported_client_identity',
      };
    }

    const currentEmail = lineage.terminal.email;
    if (currentEmail != null && currentEmail.trim() !== '') {
      const normalizedCurrentEmail = tryNormalizeSupportedEmail(currentEmail);
      if (!normalizedCurrentEmail) {
        return {
          status: 'unavailable',
          reason: 'invalid_terminal_email',
        };
      }
      return {
        status: 'terminal_current',
        email: normalizedCurrentEmail,
        terminalClientId: lineage.terminal.id,
      };
    }

    const snapshotEmail = tryNormalizeSupportedEmail(appointment.clientEmail);
    if (!snapshotEmail) {
      return {
        status: 'unavailable',
        reason: 'email_unavailable',
      };
    }
    return {
      status: 'appointment_snapshot',
      email: snapshotEmail,
      terminalClientId: lineage.terminal.id,
    };
  } catch (error) {
    if (
      error instanceof ClientLifecycleStabilizationError
      || error instanceof TypeError
    ) {
      return {
        status: 'unavailable',
        reason: 'client_identity_unavailable',
      };
    }
    throw error;
  }
}

export function resolveAppointmentOperationalEmailRecipient(input: {
  salonId: string;
  appointmentId: string;
}): Promise<OperationalEmailRecipientResolution> {
  return resolveAppointmentOperationalEmailRecipientWithHandle(
    db as LifecycleSqlHandle,
    input,
  );
}

/**
 * Claims one appointment-scoped customer email business event before doing
 * any delivery work. The recipient is resolved only after content and private
 * links are ready, immediately before the provider call.
 *
 * The dedupe identity deliberately excludes the recipient address so changing
 * contact details cannot resend an event that was already delivered.
 */
export async function sendAppointmentOperationalEmailOnce(input: {
  salonId: string;
  appointmentId: string;
  purpose: string;
  eventVersion: string;
  prepare: () => Promise<OperationalEmailContent> | OperationalEmailContent;
  retryFailed?: boolean;
}): Promise<OperationalEmailDeliveryResult> {
  const salonId = requireInput(input.salonId, 'salonId');
  const appointmentId = requireInput(input.appointmentId, 'appointmentId');
  const purpose = requireInput(input.purpose, 'purpose');
  const eventVersion = requireInput(input.eventVersion, 'eventVersion');
  const dedupeKey = `email:operational:${purpose}:${appointmentId}:${eventVersion}`;
  let deliveryId = crypto.randomUUID();
  const inserted = await db.insert(notificationDeliverySchema).values({
    id: deliveryId,
    salonId,
    appointmentId,
    channel: 'email',
    purpose,
    dedupeKey,
    status: 'queued',
  }).onConflictDoNothing().returning();

  if (!inserted.length && input.retryFailed) {
    const [reclaimed] = await db.update(notificationDeliverySchema).set({
      status: 'queued',
      errorCode: null,
      errorMessage: null,
      retryable: null,
      updatedAt: new Date(),
    }).where(and(
      eq(notificationDeliverySchema.salonId, salonId),
      eq(notificationDeliverySchema.appointmentId, appointmentId),
      eq(notificationDeliverySchema.dedupeKey, dedupeKey),
      eq(notificationDeliverySchema.status, 'failed'),
      eq(notificationDeliverySchema.retryable, true),
    )).returning();
    if (reclaimed) {
      deliveryId = reclaimed.id;
    } else {
      const [existing] = await db.select({
        id: notificationDeliverySchema.id,
        status: notificationDeliverySchema.status,
      }).from(notificationDeliverySchema).where(and(
        eq(notificationDeliverySchema.salonId, salonId),
        eq(notificationDeliverySchema.appointmentId, appointmentId),
        eq(notificationDeliverySchema.dedupeKey, dedupeKey),
      )).limit(1);
      return existing?.status === 'sent'
        ? { status: 'sent', deliveryId: existing.id, claimed: false }
        : {
            status: 'duplicate',
            deliveryId: existing?.id ?? null,
            claimed: false,
          };
    }
  } else if (!inserted.length) {
    const [existing] = await db.select({
      id: notificationDeliverySchema.id,
      status: notificationDeliverySchema.status,
    }).from(notificationDeliverySchema).where(and(
      eq(notificationDeliverySchema.salonId, salonId),
      eq(notificationDeliverySchema.appointmentId, appointmentId),
      eq(notificationDeliverySchema.dedupeKey, dedupeKey),
    )).limit(1);
    return existing?.status === 'sent'
      ? { status: 'sent', deliveryId: existing.id, claimed: false }
      : {
          status: 'duplicate',
          deliveryId: existing?.id ?? null,
          claimed: false,
        };
  }

  let content: OperationalEmailContent;
  try {
    content = await input.prepare();
  } catch {
    await db.update(notificationDeliverySchema).set({
      status: 'failed',
      errorCode: 'OPERATIONAL_EMAIL_PREPARATION_FAILED',
      retryable: input.retryFailed === true,
    }).where(and(
      eq(notificationDeliverySchema.id, deliveryId),
      eq(notificationDeliverySchema.salonId, salonId),
      eq(notificationDeliverySchema.status, 'queued'),
    ));
    return { status: 'failed', deliveryId, claimed: true };
  }

  const { sendTransactionalEmailDetailed } = await import('@/libs/email');
  let recipient: OperationalEmailRecipientResolution;
  try {
    recipient = await resolveAppointmentOperationalEmailRecipient({
      salonId,
      appointmentId,
    });
  } catch {
    await db.update(notificationDeliverySchema).set({
      status: 'failed',
      errorCode: 'OPERATIONAL_EMAIL_RESOLUTION_FAILED',
      retryable: input.retryFailed === true,
    }).where(and(
      eq(notificationDeliverySchema.id, deliveryId),
      eq(notificationDeliverySchema.salonId, salonId),
      eq(notificationDeliverySchema.status, 'queued'),
    ));
    return { status: 'failed', deliveryId, claimed: true };
  }
  if (recipient.status === 'unavailable') {
    await db.update(notificationDeliverySchema).set({
      status: 'failed',
      errorCode: 'OPERATIONAL_EMAIL_UNAVAILABLE',
      retryable: false,
    }).where(and(
      eq(notificationDeliverySchema.id, deliveryId),
      eq(notificationDeliverySchema.salonId, salonId),
      eq(notificationDeliverySchema.status, 'queued'),
    ));
    return { status: 'unavailable', deliveryId, claimed: true };
  }

  let providerResult;
  try {
    providerResult = await sendTransactionalEmailDetailed({
      to: recipient.email,
      subject: content.subject,
      text: content.text,
      html: content.html,
    });
  } catch {
    await db.update(notificationDeliverySchema).set({
      status: 'failed',
      errorCode: 'EMAIL_DELIVERY_STATE_UNKNOWN',
      retryable: false,
    }).where(and(
      eq(notificationDeliverySchema.id, deliveryId),
      eq(notificationDeliverySchema.salonId, salonId),
      eq(notificationDeliverySchema.status, 'queued'),
    ));
    return { status: 'failed', deliveryId, claimed: true };
  }

  const providerOutcomeIsAmbiguous
    = !providerResult.ok && providerResult.errorCode === 'RESEND_NETWORK_ERROR';
  try {
    await db.update(notificationDeliverySchema).set({
      status: providerResult.ok ? 'sent' : 'failed',
      providerMessageId: providerResult.providerMessageId,
      errorCode: providerResult.errorCode,
      retryable:
        input.retryFailed === true
        && !providerResult.ok
        && !providerOutcomeIsAmbiguous,
    }).where(and(
      eq(notificationDeliverySchema.id, deliveryId),
      eq(notificationDeliverySchema.salonId, salonId),
      eq(notificationDeliverySchema.status, 'queued'),
    ));
  } catch {
    // Once the provider may have accepted a message, never turn a local
    // bookkeeping failure into another provider attempt. The queued claim
    // continues to block the same business event from being sent again.
  }
  return {
    status: providerResult.ok ? 'sent' : 'failed',
    deliveryId,
    claimed: true,
  };
}

export async function getSalonClientLineageIdsWithHandle(
  handle: LifecycleSqlHandle,
  input: {
    salonId: string;
    terminalClientId: string;
  },
): Promise<string[]> {
  const salonId = requireInput(input.salonId, 'salonId');
  const terminalClientId = requireInput(
    input.terminalClientId,
    'terminalClientId',
  );
  const result = await handle.execute(sql`
    with recursive lineage as (
      select
        client.id,
        array[client.id]::text[] as path,
        0 as depth
      from salon_client as client
      where client.salon_id = ${salonId}
        and client.id = ${terminalClientId}
        and client.merged_into_client_id is null

      union all

      select
        source.id,
        lineage.path || source.id,
        lineage.depth + 1
      from lineage
      inner join salon_client as source
        on source.salon_id = ${salonId}
       and source.merged_into_client_id = lineage.id
      where lineage.depth < ${CLIENT_LIFECYCLE_MAX_CHAIN_DEPTH - 1}
        and not source.id = any(lineage.path)
    )
    select
      id,
      depth,
      exists (
        select 1
        from salon_client as child
        where child.salon_id = ${salonId}
          and child.merged_into_client_id = lineage.id
          and not child.id = any(lineage.path)
      ) as has_unvisited_child,
      exists (
        select 1
        from salon_client as child
        where child.salon_id = ${salonId}
          and child.merged_into_client_id = lineage.id
          and child.id = any(lineage.path)
      ) as has_cycle
    from lineage
    order by id
  `);
  const rows = readRows(result);
  if (rows.some(row =>
    row.has_cycle === true
    || (
      Number(row.depth) === CLIENT_LIFECYCLE_MAX_CHAIN_DEPTH - 1
      && row.has_unvisited_child === true
    ))) {
    throw new ClientLifecycleStabilizationError(
      'INVALID_CLIENT_STATE',
      'Client lifecycle state is unavailable.',
    );
  }
  const ids = rows
    .map(row => row.id)
    .filter((id): id is string => typeof id === 'string');
  if (!ids.includes(terminalClientId)) {
    throw new ClientLifecycleStabilizationError('CLIENT_NOT_FOUND');
  }
  return ids;
}

export async function getSalonClientPhoneAliasesWithHandle(
  handle: LifecycleSqlHandle,
  input: {
    salonId: string;
    clientIds: string[];
  },
): Promise<string[]> {
  const salonId = requireInput(input.salonId, 'salonId');
  const clientIds = [...new Set(input.clientIds)].sort();
  if (clientIds.length === 0) {
    return [];
  }
  const result = await handle.execute(sql`
    select normalized_value
    from salon_client_contact_alias
    where salon_id = ${salonId}
      and kind = 'phone'
      and salon_client_id in (
        ${sql.join(clientIds.map(id => sql`${id}`), sql`, `)}
      )
    order by salon_id, kind, normalized_value, salon_client_id
  `);
  return [...new Set(
    readRows(result)
      .map(row => row.normalized_value)
      .filter((value): value is string => typeof value === 'string'),
  )];
}

/**
 * Returns every valid same-salon phone snapshot in a terminal lineage plus its
 * private lookup aliases. These values are operational history hints only;
 * customer authentication continues to use the global client's current phone.
 */
export async function getSalonClientHistoricalPhoneHintsWithHandle(
  handle: LifecycleSqlHandle,
  input: {
    salonId: string;
    clientId: string;
    allowArchived?: boolean;
  },
): Promise<{
    terminal: TerminalSalonClient;
    phones: string[];
  }> {
  const terminal = await resolveTerminalSalonClientWithHandle(handle, input);
  const clientIds = await getSalonClientLineageIdsWithHandle(handle, {
    salonId: terminal.salonId,
    terminalClientId: terminal.id,
  });
  const result = await handle.execute(sql`
    select phone
    from salon_client
    where salon_id = ${terminal.salonId}
      and id in (
        ${sql.join(clientIds.map(id => sql`${id}`), sql`, `)}
      )
    order by id
  `);
  const rows = readRows(result);
  if (rows.length !== clientIds.length) {
    throw new ClientLifecycleStabilizationError(
      'INVALID_CLIENT_STATE',
      'Client lifecycle state is unavailable.',
    );
  }
  const aliases = await getSalonClientPhoneAliasesWithHandle(handle, {
    salonId: terminal.salonId,
    clientIds,
  });
  const phones = new Set<string>();
  for (const value of [
    ...rows.map(row => row.phone),
    ...aliases,
  ]) {
    if (typeof value !== 'string') {
      continue;
    }
    const normalized = tryNormalizeSupportedPhone(value);
    if (normalized) {
      phones.add(normalized);
    }
  }
  if (phones.size === 0) {
    throw new ClientLifecycleStabilizationError(
      'INVALID_CLIENT_STATE',
      'Client lifecycle state is unavailable.',
    );
  }
  return {
    terminal,
    phones: [...phones].sort(),
  };
}

export function getSalonClientHistoricalPhoneHints(input: {
  salonId: string;
  clientId: string;
  allowArchived?: boolean;
}): Promise<{
    terminal: TerminalSalonClient;
    phones: string[];
  }> {
  return getSalonClientHistoricalPhoneHintsWithHandle(
    db as LifecycleSqlHandle,
    input,
  );
}

/**
 * Bounds waits inside an interactive contact edit without changing the
 * timeout behavior of non-contact client edits or other lifecycle callers.
 * These settings are transaction-local and disappear on commit or rollback.
 */
export async function setClientContactEditTransactionTimeoutsWithHandle(
  handle: LifecycleSqlHandle,
): Promise<void> {
  await handle.execute(sql`
    set local lock_timeout = '3s'
  `);
  await handle.execute(sql`
    set local statement_timeout = '10s'
  `);
}

/**
 * Stabilizes the global customer/login identity tables for the duration of a
 * contact-edit transaction. Call this before taking any salon-client row lock
 * so identity writers and owner edits share one deadlock-safe lock order.
 */
export async function lockGlobalClientIdentityTablesWithHandle(
  handle: LifecycleSqlHandle,
): Promise<void> {
  await handle.execute(sql`
    lock table client, client_session in share mode
  `);
}

/**
 * Detects any global customer/login ownership touching a salon lineage. This
 * is intentionally broader than authentication lookup: aliases are inspected
 * only as risk signals and are never promoted to login identities.
 */
export async function hasUnsafeSalonClientExternalIdentityWithHandle(
  handle: LifecycleSqlHandle,
  input: {
    salonId: string;
    terminalClientId: string;
    proposedContact?: SalonClientIdentityContactInput;
  },
): Promise<boolean> {
  const salonId = requireInput(input.salonId, 'salonId');
  const terminalClientId = requireInput(
    input.terminalClientId,
    'terminalClientId',
  );
  const clientIds = await getSalonClientLineageIdsWithHandle(handle, {
    salonId,
    terminalClientId,
  });
  const lineageResult = await handle.execute(sql`
    select id, phone, lower(btrim(email)) as email, client_id
    from salon_client
    where salon_id = ${salonId}
      and id in (
        ${sql.join(clientIds.map(id => sql`${id}`), sql`, `)}
      )
    order by id
    for share
  `);
  const rows = readRows(lineageResult);
  if (rows.length !== clientIds.length) {
    throw new ClientLifecycleStabilizationError(
      'INVALID_CLIENT_STATE',
      'Client lifecycle state is unavailable.',
    );
  }
  if (rows.some(row => typeof row.client_id === 'string')) {
    return true;
  }

  // Global customer and session writers do not share the salon-scoped
  // advisory-lock namespace. A transaction-level SHARE table lock lets their
  // pending writes finish before the identity read and prevents a new login
  // relationship from appearing until this contact edit commits.
  await lockGlobalClientIdentityTablesWithHandle(handle);

  const aliasesResult = await handle.execute(sql`
    select kind, normalized_value
    from salon_client_contact_alias
    where salon_id = ${salonId}
      and salon_client_id in (
        ${sql.join(clientIds.map(id => sql`${id}`), sql`, `)}
      )
    order by kind, normalized_value, salon_client_id
  `);
  const phones = new Set<string>();
  const emails = new Set<string>();
  for (const row of rows) {
    const phone = typeof row.phone === 'string'
      ? tryNormalizeSupportedPhone(row.phone)
      : null;
    const email = typeof row.email === 'string'
      ? tryNormalizeSupportedEmail(row.email)
      : null;
    if (phone) {
      phones.add(phone);
    }
    if (email) {
      emails.add(email);
    }
  }
  for (const alias of readRows(aliasesResult)) {
    if (
      alias.kind === 'phone'
      && typeof alias.normalized_value === 'string'
    ) {
      const phone = tryNormalizeSupportedPhone(alias.normalized_value);
      if (phone) {
        phones.add(phone);
      }
    }
    if (
      alias.kind === 'email'
      && typeof alias.normalized_value === 'string'
    ) {
      const email = tryNormalizeSupportedEmail(alias.normalized_value);
      if (email) {
        emails.add(email);
      }
    }
  }
  if (input.proposedContact) {
    const proposed = normalizeSalonClientIdentity(input.proposedContact);
    if (proposed.phone) {
      phones.add(proposed.phone);
    }
    if (proposed.email) {
      emails.add(proposed.email);
    }
  }
  if (phones.size === 0 && emails.size === 0) {
    return true;
  }

  const phoneVariants = [...phones].flatMap(phone => [
    phone,
    `1${phone}`,
    `+1${phone}`,
    `+${phone}`,
  ]);
  const phoneMatch = phoneVariants.length > 0
    ? sql`client.phone in (
        ${sql.join(phoneVariants.map(value => sql`${value}`), sql`, `)}
      )`
    : sql`false`;
  const emailMatch = emails.size > 0
    ? sql`lower(btrim(client.email)) in (
        ${sql.join([...emails].map(value => sql`${value}`), sql`, `)}
      )`
    : sql`false`;
  const sessionMatch = phoneVariants.length > 0
    ? sql`client_session.client_phone in (
        ${sql.join(phoneVariants.map(value => sql`${value}`), sql`, `)}
      )`
    : sql`false`;
  const externalResult = await handle.execute(sql`
    select (
      exists (
        select 1
        from client
        where ${phoneMatch} or ${emailMatch}
      )
      or exists (
        select 1
        from client_session
        where ${sessionMatch}
      )
    ) as has_unsafe_identity
  `);
  const row = readRows(externalResult)[0];
  if (!row || typeof row.has_unsafe_identity !== 'boolean') {
    throw new TypeError('GLOBAL_CLIENT_IDENTITY_CHECK_INVALID');
  }
  return row.has_unsafe_identity;
}

export async function lockTerminalSalonClientsWithHandle(
  handle: LifecycleSqlHandle,
  input: {
    salonId: string;
    clientIds: string[];
    allowArchived?: boolean;
  },
): Promise<TerminalSalonClient[]> {
  const salonId = requireInput(input.salonId, 'salonId');
  const resolved = await Promise.all(
    [...new Set(input.clientIds)].map(clientId =>
      resolveTerminalSalonClientWithHandle(handle, {
        salonId,
        clientId,
        allowArchived: input.allowArchived,
      })),
  );
  const terminalIds = [...new Set(resolved.map(client => client.id))].sort();

  if (terminalIds.length === 0) {
    return [];
  }

  await handle.execute(sql`
    select id
    from salon_client
    where salon_id = ${salonId}
      and id in (${sql.join(terminalIds.map(id => sql`${id}`), sql`, `)})
    order by id
    for update
  `);

  const locked = await Promise.all(
    terminalIds.map(clientId =>
      resolveTerminalSalonClientWithHandle(handle, {
        salonId,
        clientId,
        allowArchived: input.allowArchived,
      })),
  );
  if (locked.length !== terminalIds.length) {
    throw new ClientLifecycleStabilizationError(
      'INVALID_CLIENT_STATE',
      'Client lifecycle state is unavailable.',
    );
  }
  return locked;
}

export async function lockTerminalSalonClientWithHandle(
  handle: LifecycleSqlHandle,
  input: {
    salonId: string;
    clientId: string;
    allowArchived?: boolean;
  },
): Promise<TerminalSalonClient> {
  const [client] = await lockTerminalSalonClientsWithHandle(handle, {
    ...input,
    clientIds: [input.clientId],
  });
  if (!client) {
    throw new ClientLifecycleStabilizationError('CLIENT_NOT_FOUND');
  }
  return client;
}

function sqlState(error: unknown): string | null {
  if (!error || typeof error !== 'object') {
    return null;
  }
  const candidate = error as { code?: unknown; cause?: unknown };
  if (typeof candidate.code === 'string') {
    return candidate.code;
  }
  return candidate.cause === error ? null : sqlState(candidate.cause);
}

export function isClientLifecycleTransactionTimeoutError(
  error: unknown,
): boolean {
  const state = sqlState(error);
  return state != null
    && CLIENT_EDIT_TRANSACTION_TIMEOUT_SQLSTATES.has(state);
}

export function isRetryableClientLifecycleError(error: unknown): boolean {
  const state = sqlState(error);
  return state != null && CLIENT_LIFECYCLE_RETRYABLE_SQLSTATES.has(state);
}

type RetryDependencies = {
  sleep?: (milliseconds: number) => Promise<void>;
  random?: () => number;
};

function defaultSleep(milliseconds: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, milliseconds));
}

export async function withClientLifecycleTransactionRetry<T>(
  operation: (attempt: number) => Promise<T>,
  dependencies: RetryDependencies = {},
): Promise<T> {
  const sleep = dependencies.sleep ?? defaultSleep;
  const random = dependencies.random ?? Math.random;

  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      return await operation(attempt);
    } catch (error) {
      if (attempt === 3 || !isRetryableClientLifecycleError(error)) {
        throw error;
      }
      const minimum = attempt === 1 ? 25 : 75;
      const spread = attempt === 1 ? 50 : 150;
      const jitter = Math.min(1, Math.max(0, random()));
      await sleep(minimum + Math.floor(jitter * spread));
    }
  }

  throw new Error('Unreachable client lifecycle retry state.');
}
