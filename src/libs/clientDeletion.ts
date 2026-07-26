import 'server-only';

import { sql } from 'drizzle-orm';

import { getActiveAppointmentsForCanonicalClientWithHandle } from '@/libs/activeAppointments';
import {
  ClientLifecycleStabilizationError,
  getSalonClientLineageIdentityWithHandle,
  getSalonClientLineageIdsWithHandle,
  isClientLifecycleTransactionTimeoutError,
  type LifecycleSqlHandle,
  lockSalonClientIdentityKeySetWithHandle,
  lockTerminalSalonClientWithHandle,
  normalizeSalonClientIdentity,
  resolveCanonicalSalonClientIdentityOutcomeWithHandle,
  withClientLifecycleTransactionRetry,
} from '@/libs/clientLifecycleStabilization';
import { db } from '@/libs/DB';

const CLIENT_VERSION_TOKEN_PATTERN
  = /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})(?:\.(\d{1,6}))?(Z|[+-]\d{2}:\d{2})$/;

const ARCHIVE_AUDIT_ACTION = 'client_archived';

export type ClientDeletionErrorCode =
  | 'CLIENT_NOT_FOUND'
  | 'CLIENT_ARCHIVE_CONFLICT'
  | 'CLIENT_HAS_ACTIVE_APPOINTMENT'
  | 'UNSUPPORTED_CLIENT_IDENTITY'
  | 'CLIENT_LIFECYCLE_BUSY';

export class ClientDeletionError extends Error {
  readonly code: ClientDeletionErrorCode;

  constructor(code: ClientDeletionErrorCode, message?: string) {
    super(message ?? clientDeletionErrorMessage(code));
    this.name = 'ClientDeletionError';
    this.code = code;
  }
}

export type ClientDeletionInput = {
  salonId: string;
  requestedClientId: string;
  expectedUpdatedAt: string;
  actorAdminId: string;
};

export type ArchiveSalonClientResult = {
  code: 'CLIENT_ARCHIVED' | 'CLIENT_ALREADY_ARCHIVED';
  terminalClientId: string;
  updatedAt: string;
  idempotent: boolean;
  redirectedFromStaleSource: boolean;
};

type ClientDeletionDb = LifecycleSqlHandle & {
  transaction: <T>(
    operation: (tx: LifecycleSqlHandle) => Promise<T>,
  ) => Promise<T>;
};

type SalonClientDeletionRow = {
  id: string;
  salonId: string;
  clientId: string | null;
  phone: string;
  email: string | null;
  archivedAt: Date | null;
  archivedBy: string | null;
  mergedIntoClientId: string | null;
  mergedAt: Date | null;
  mergedBy: string | null;
  updatedAt: string;
};

function clientDeletionErrorMessage(code: ClientDeletionErrorCode): string {
  switch (code) {
    case 'CLIENT_NOT_FOUND':
      return 'Client not found.';
    case 'CLIENT_ARCHIVE_CONFLICT':
      return 'This client changed. Refresh and try again.';
    case 'CLIENT_HAS_ACTIVE_APPOINTMENT':
      return 'This client has an active or upcoming appointment.';
    case 'UNSUPPORTED_CLIENT_IDENTITY':
      return 'This client can’t be changed right now.';
    case 'CLIENT_LIFECYCLE_BUSY':
      return 'This client is busy. Try again.';
  }
}

function requireInput(value: string, name: string): string {
  const normalized = value.trim();
  if (!normalized) {
    throw new TypeError(`${name} is required`);
  }
  return normalized;
}

export function canonicalizeClientVersionToken(value: string): string {
  const match = CLIENT_VERSION_TOKEN_PATTERN.exec(value);
  if (!match) {
    throw new TypeError('Invalid client version token');
  }

  const fraction = (match[2] ?? '').padEnd(6, '0');
  const parsed = new Date(`${match[1]}.${fraction.slice(0, 3)}${match[3]}`);
  if (Number.isNaN(parsed.getTime())) {
    throw new TypeError('Invalid client version token');
  }

  return `${parsed.toISOString().slice(0, 19)}.${fraction}Z`;
}

function readRows(result: unknown): Record<string, unknown>[] {
  const resultWithRows = result as { rows?: Record<string, unknown>[] };
  if (Array.isArray(resultWithRows?.rows)) {
    return resultWithRows.rows;
  }
  return Array.isArray(result) ? result as Record<string, unknown>[] : [];
}

function dateValue(value: unknown): Date | null {
  if (value == null) {
    return null;
  }
  const parsed = value instanceof Date ? value : new Date(String(value));
  if (Number.isNaN(parsed.getTime())) {
    throw new ClientDeletionError('UNSUPPORTED_CLIENT_IDENTITY');
  }
  return parsed;
}

function parseDeletionRow(
  row: Record<string, unknown> | undefined,
): SalonClientDeletionRow | null {
  if (!row) {
    return null;
  }
  if (
    typeof row.id !== 'string'
    || typeof row.salon_id !== 'string'
    || typeof row.phone !== 'string'
    || typeof row.updated_at_version !== 'string'
  ) {
    throw new ClientDeletionError('UNSUPPORTED_CLIENT_IDENTITY');
  }
  return {
    id: row.id,
    salonId: row.salon_id,
    clientId: typeof row.client_id === 'string' ? row.client_id : null,
    phone: row.phone,
    email: typeof row.email === 'string' ? row.email : null,
    archivedAt: dateValue(row.archived_at),
    archivedBy: typeof row.archived_by === 'string' ? row.archived_by : null,
    mergedIntoClientId:
      typeof row.merged_into_client_id === 'string'
        ? row.merged_into_client_id
        : null,
    mergedAt: dateValue(row.merged_at),
    mergedBy: typeof row.merged_by === 'string' ? row.merged_by : null,
    updatedAt: row.updated_at_version,
  };
}

function mapLifecycleError(error: unknown): never {
  if (error instanceof ClientDeletionError) {
    throw error;
  }
  if (error instanceof ClientLifecycleStabilizationError) {
    if (error.code === 'CLIENT_NOT_FOUND') {
      throw new ClientDeletionError('CLIENT_NOT_FOUND');
    }
    throw new ClientDeletionError('UNSUPPORTED_CLIENT_IDENTITY');
  }
  throw error;
}

function normalizedInput(input: ClientDeletionInput): ClientDeletionInput {
  return {
    salonId: requireInput(input.salonId, 'salonId'),
    requestedClientId: requireInput(
      input.requestedClientId,
      'requestedClientId',
    ),
    expectedUpdatedAt: canonicalizeClientVersionToken(
      requireInput(input.expectedUpdatedAt, 'expectedUpdatedAt'),
    ),
    actorAdminId: requireInput(input.actorAdminId, 'actorAdminId'),
  };
}

async function setArchiveTransactionBounds(
  handle: LifecycleSqlHandle,
): Promise<void> {
  await handle.execute(sql`set local lock_timeout = '2s'`);
  await handle.execute(sql`set local statement_timeout = '10s'`);
}

async function runArchiveTransaction<T>(
  operation: (tx: LifecycleSqlHandle) => Promise<T>,
): Promise<T> {
  try {
    return await withClientLifecycleTransactionRetry(() =>
      (db as unknown as ClientDeletionDb).transaction(async (tx) => {
        await setArchiveTransactionBounds(tx);
        return operation(tx);
      }));
  } catch (error) {
    if (isClientLifecycleTransactionTimeoutError(error)) {
      throw new ClientDeletionError('CLIENT_LIFECYCLE_BUSY');
    }
    return mapLifecycleError(error);
  }
}

async function loadDeletionRow(
  handle: LifecycleSqlHandle,
  input: {
    salonId: string;
    clientId: string;
  },
): Promise<SalonClientDeletionRow | null> {
  const result = await handle.execute(sql`
    select
      client.id,
      client.salon_id,
      client.client_id,
      client.phone,
      client.email,
      client.archived_at,
      client.archived_by,
      client.merged_into_client_id,
      client.merged_at,
      client.merged_by,
      to_char(
        client.updated_at,
        'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'
      ) as updated_at_version
    from salon_client as client
    where client.salon_id = ${input.salonId}
      and client.id = ${input.clientId}
    limit 1
  `);
  return parseDeletionRow(readRows(result)[0]);
}

type ValidatedLineage = {
  clientIds: string[];
  contacts: Array<{ phone?: string; email?: string }>;
};

function unsupportedIdentity(): never {
  throw new ClientDeletionError('UNSUPPORTED_CLIENT_IDENTITY');
}

function normalizedContact(input: {
  phone?: string | null;
  email?: string | null;
}): { phone: string | null; email: string | null } {
  try {
    return normalizeSalonClientIdentity(input);
  } catch {
    return unsupportedIdentity();
  }
}

async function validateSupportedLifecyclePath(
  handle: LifecycleSqlHandle,
  input: {
    salonId: string;
    lineagePath: string[];
    terminalClientId: string;
  },
): Promise<ValidatedLineage> {
  if (
    input.lineagePath.length === 0
    || input.lineagePath.at(-1) !== input.terminalClientId
  ) {
    return unsupportedIdentity();
  }

  let lineageIds: string[];
  try {
    lineageIds = await getSalonClientLineageIdsWithHandle(handle, {
      salonId: input.salonId,
      terminalClientId: input.terminalClientId,
    });
  } catch (error) {
    return mapLifecycleError(error);
  }

  const result = await handle.execute(sql`
    select
      id,
      client_id,
      phone,
      email,
      archived_at,
      archived_by,
      merged_into_client_id,
      merged_at,
      merged_by
    from salon_client
    where salon_id = ${input.salonId}
      and id in (
        ${sql.join(lineageIds.map(id => sql`${id}`), sql`, `)}
      )
    order by id
    for share
  `);
  const lineageRows = readRows(result);
  if (lineageRows.length !== lineageIds.length) {
    return unsupportedIdentity();
  }

  const rowsById = new Map(
    lineageRows.map(row => [String(row.id), row]),
  );
  const externalClientIds = new Set(
    lineageRows
      .map(row => row.client_id)
      .filter((clientId): clientId is string =>
        typeof clientId === 'string' && clientId.length > 0),
  );
  if (externalClientIds.size > 1) {
    return unsupportedIdentity();
  }

  const lineageIdSet = new Set(lineageIds);
  const contacts: ValidatedLineage['contacts'] = [];
  for (const id of lineageIds) {
    const row = rowsById.get(id);
    const actualTarget = typeof row?.merged_into_client_id === 'string'
      ? row.merged_into_client_id
      : null;
    if (
      !row
      || (
        id === input.terminalClientId
          ? actualTarget !== null
          : actualTarget == null || !lineageIdSet.has(actualTarget)
      )
    ) {
      return unsupportedIdentity();
    }
    if (
      id !== input.terminalClientId
      && (
        row.archived_at == null
        || typeof row.archived_by !== 'string'
        || row.merged_at == null
        || typeof row.merged_by !== 'string'
      )
    ) {
      return unsupportedIdentity();
    }

    const contact = normalizedContact({
      phone: typeof row.phone === 'string' ? row.phone : null,
      email: typeof row.email === 'string' ? row.email : null,
    });
    if (!contact.phone) {
      return unsupportedIdentity();
    }
    contacts.push({
      phone: contact.phone,
      ...(contact.email ? { email: contact.email } : {}),
    });
  }

  for (let index = 0; index < input.lineagePath.length - 1; index += 1) {
    const row = rowsById.get(input.lineagePath[index]!);
    if (row?.merged_into_client_id !== input.lineagePath[index + 1]) {
      return unsupportedIdentity();
    }
  }

  const aliasResult = await handle.execute(sql`
    select
      alias.salon_id,
      alias.salon_client_id,
      alias.kind,
      alias.normalized_value
    from salon_client_contact_alias as alias
    where alias.salon_client_id in (
      ${sql.join(lineageIds.map(id => sql`${id}`), sql`, `)}
    )
    order by
      alias.salon_id,
      alias.kind,
      alias.normalized_value,
      alias.salon_client_id
    for share
  `);
  for (const alias of readRows(aliasResult)) {
    if (
      alias.salon_id !== input.salonId
      || typeof alias.salon_client_id !== 'string'
      || !lineageIdSet.has(alias.salon_client_id)
      || typeof alias.normalized_value !== 'string'
    ) {
      return unsupportedIdentity();
    }
    if (alias.kind === 'phone') {
      const contact = normalizedContact({
        phone: alias.normalized_value,
      });
      if (
        !contact.phone
        || contact.phone !== alias.normalized_value
      ) {
        return unsupportedIdentity();
      }
      contacts.push({ phone: contact.phone });
    } else if (alias.kind === 'email') {
      const contact = normalizedContact({
        email: alias.normalized_value,
      });
      if (
        !contact.email
        || contact.email !== alias.normalized_value
      ) {
        return unsupportedIdentity();
      }
      contacts.push({ email: contact.email });
    } else {
      return unsupportedIdentity();
    }
  }

  return { clientIds: lineageIds, contacts };
}

async function assertUnambiguousLineageIdentity(
  handle: LifecycleSqlHandle,
  input: {
    salonId: string;
    terminalClientId: string;
    lineage: ValidatedLineage;
  },
): Promise<void> {
  let identity;
  try {
    identity = await getSalonClientLineageIdentityWithHandle(handle, {
      salonId: input.salonId,
      terminalClientId: input.terminalClientId,
      allowArchived: true,
    });
  } catch (error) {
    if (error instanceof ClientLifecycleStabilizationError) {
      return mapLifecycleError(error);
    }
    return unsupportedIdentity();
  }

  if (
    identity.terminal.id !== input.terminalClientId
    || identity.clientIds.length !== input.lineage.clientIds.length
    || identity.clientIds.some(id => !input.lineage.clientIds.includes(id))
  ) {
    return unsupportedIdentity();
  }

  let lockedKeys;
  try {
    lockedKeys = await lockSalonClientIdentityKeySetWithHandle(handle, {
      salonId: input.salonId,
      contacts: input.lineage.contacts,
    });
  } catch {
    return unsupportedIdentity();
  }

  for (const key of lockedKeys) {
    const outcome
      = await resolveCanonicalSalonClientIdentityOutcomeWithHandle(handle, {
        salonId: input.salonId,
        [key.kind]: key.normalizedValue,
        allowArchived: true,
      });
    if (
      outcome.status !== 'resolved_terminal'
      || outcome.identity.terminal.id !== input.terminalClientId
    ) {
      return unsupportedIdentity();
    }
  }
}

async function matchingArchiveAuditExists(
  handle: LifecycleSqlHandle,
  input: {
    salonId: string;
    terminalClientId: string;
    originalExpectedUpdatedAt: string;
    archivedUpdatedAt: string;
  },
): Promise<boolean> {
  const result = await handle.execute(sql`
    select count(*)::int as audit_count
    from audit_log
    where salon_id = ${input.salonId}
      and action = ${ARCHIVE_AUDIT_ACTION}
      and entity_type = 'salon_client'
      and entity_id = ${input.terminalClientId}
      and metadata ->> 'originalExpectedUpdatedAt'
        = ${input.originalExpectedUpdatedAt}
      and metadata ->> 'archivedUpdatedAt' = ${input.archivedUpdatedAt}
  `);
  const count = Number(readRows(result)[0]?.audit_count);
  if (!Number.isInteger(count)) {
    return unsupportedIdentity();
  }
  return count === 1;
}

export async function archiveSalonClient(
  rawInput: ClientDeletionInput,
): Promise<ArchiveSalonClientResult> {
  const input = normalizedInput(rawInput);

  return runArchiveTransaction(async (tx) => {
    const terminal = await lockTerminalSalonClientWithHandle(tx, {
      salonId: input.salonId,
      clientId: input.requestedClientId,
      allowArchived: true,
    });
    const lineage = await validateSupportedLifecyclePath(tx, {
      salonId: input.salonId,
      lineagePath: terminal.lineagePath,
      terminalClientId: terminal.id,
    });
    await assertUnambiguousLineageIdentity(tx, {
      salonId: input.salonId,
      terminalClientId: terminal.id,
      lineage,
    });

    const client = await loadDeletionRow(tx, {
      salonId: input.salonId,
      clientId: terminal.id,
    });
    if (!client || client.mergedIntoClientId) {
      return unsupportedIdentity();
    }
    if (
      (client.archivedAt == null) !== (client.archivedBy == null)
      || client.mergedAt != null
      || client.mergedBy != null
    ) {
      return unsupportedIdentity();
    }

    const redirectedFromStaleSource
      = input.requestedClientId !== terminal.id;
    if (client.archivedAt) {
      const idempotent = await matchingArchiveAuditExists(tx, {
        salonId: input.salonId,
        terminalClientId: terminal.id,
        originalExpectedUpdatedAt: input.expectedUpdatedAt,
        archivedUpdatedAt: client.updatedAt,
      });
      if (!idempotent) {
        throw new ClientDeletionError('CLIENT_ARCHIVE_CONFLICT');
      }
      return {
        code: 'CLIENT_ALREADY_ARCHIVED',
        terminalClientId: terminal.id,
        updatedAt: client.updatedAt,
        idempotent: true,
        redirectedFromStaleSource,
      };
    }

    if (client.updatedAt !== input.expectedUpdatedAt) {
      throw new ClientDeletionError('CLIENT_ARCHIVE_CONFLICT');
    }

    const activeAppointments
      = await getActiveAppointmentsForCanonicalClientWithHandle(tx, {
        salonId: input.salonId,
        terminalClientId: terminal.id,
        horizon: 'lineage-active',
        allowArchived: true,
      });
    if (activeAppointments.length > 0) {
      throw new ClientDeletionError('CLIENT_HAS_ACTIVE_APPOINTMENT');
    }

    const updateResult = await tx.execute(sql`
      with archive_moment as (
        select clock_timestamp() as archived_at
      )
      update salon_client as client
      set
        archived_at = greatest(
          archive_moment.archived_at,
          (
            client.updated_at + interval '1 microsecond'
          ) at time zone 'UTC'
        ),
        archived_by = ${input.actorAdminId},
        updated_at = greatest(
          archive_moment.archived_at at time zone 'UTC',
          client.updated_at + interval '1 microsecond'
        )
      from archive_moment
      where client.salon_id = ${input.salonId}
        and client.id = ${terminal.id}
        and client.merged_into_client_id is null
        and client.archived_at is null
        and client.archived_by is null
        and to_char(
          client.updated_at,
          'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'
        ) = ${input.expectedUpdatedAt}
      returning to_char(
        client.updated_at,
        'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'
      ) as updated_at_version
    `);
    const updatedRows = readRows(updateResult);
    if (
      updatedRows.length !== 1
      || typeof updatedRows[0]?.updated_at_version !== 'string'
    ) {
      throw new ClientDeletionError('CLIENT_ARCHIVE_CONFLICT');
    }
    const archivedUpdatedAt = String(updatedRows[0].updated_at_version);

    await tx.execute(sql`
      insert into audit_log (
        id,
        salon_id,
        actor_type,
        actor_id,
        actor_phone,
        action,
        entity_type,
        entity_id,
        metadata,
        ip,
        user_agent
      )
      values (
        ${`audit_${crypto.randomUUID()}`},
        ${input.salonId},
        'admin',
        ${input.actorAdminId},
        null,
        ${ARCHIVE_AUDIT_ACTION},
        'salon_client',
        ${terminal.id},
        jsonb_build_object(
          'terminalClientId', ${terminal.id}::text,
          'redirectedFromStaleSource',
            ${redirectedFromStaleSource}::boolean,
          'originalExpectedUpdatedAt', ${input.expectedUpdatedAt}::text,
          'archivedUpdatedAt', ${archivedUpdatedAt}::text
        ),
        null,
        null
      )
    `);

    return {
      code: 'CLIENT_ARCHIVED',
      terminalClientId: terminal.id,
      updatedAt: archivedUpdatedAt,
      idempotent: false,
      redirectedFromStaleSource,
    };
  });
}
