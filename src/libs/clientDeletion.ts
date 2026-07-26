import 'server-only';

import { type SQL, sql } from 'drizzle-orm';

import { getActiveAppointmentsForCanonicalClientWithHandle } from '@/libs/activeAppointments';
import {
  ClientLifecycleStabilizationError,
  getSalonClientLineageIdentityWithHandle,
  getSalonClientLineageIdsWithHandle,
  isClientLifecycleTransactionTimeoutError,
  type LifecycleSqlHandle,
  lockGlobalClientIdentityTablesWithHandle,
  lockSalonClientIdentityKeySetWithHandle,
  lockTerminalSalonClientWithHandle,
  normalizeSalonClientIdentity,
  resolveTerminalSalonClientWithHandle,
  withClientLifecycleTransactionRetry,
} from '@/libs/clientLifecycleStabilization';
import { db } from '@/libs/DB';

const CLIENT_VERSION_TOKEN_PATTERN
  = /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})(?:\.(\d{1,6}))?(Z|[+-]\d{2}:\d{2})$/;

const ARCHIVE_AUDIT_ACTION = 'client_archived';
const PERMANENT_DELETE_AUDIT_ACTION = 'client_permanently_deleted';

const EXPECTED_SALON_CLIENT_FOREIGN_KEYS = [
  'appointment|salon_client_id|id|r',
  'client_communication|salon_client_id|id|c',
  'fraud_signal|salon_client_id|id|r',
  'retention_campaign|salon_client_id|id|c',
  'review|salon_client_id|id|a',
  'salon_client|salon_id,merged_into_client_id|salon_id,id|r',
  'salon_client_contact_alias|salon_client_id|id|c',
  'salon_client_note|salon_client_id|id|c',
].sort();

export type ClientDeletionErrorCode =
  | 'CLIENT_NOT_FOUND'
  | 'CLIENT_ARCHIVE_CONFLICT'
  | 'CLIENT_HAS_ACTIVE_APPOINTMENT'
  | 'CLIENT_PERMANENT_DELETE_NOT_ALLOWED'
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

export type PermanentlyDeleteSalonClientResult = {
  code: 'CLIENT_PERMANENTLY_DELETED';
  terminalClientId: string;
  idempotent: boolean;
};

export type PermanentDeleteEligibility = {
  eligible: boolean;
  terminalClientId: string | null;
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

type PermanentDeleteCandidate = SalonClientDeletionRow & {
  ownProfileIsEmpty: boolean;
};

function clientDeletionErrorMessage(code: ClientDeletionErrorCode): string {
  switch (code) {
    case 'CLIENT_NOT_FOUND':
      return 'Client not found.';
    case 'CLIENT_ARCHIVE_CONFLICT':
      return 'This client changed. Refresh and try again.';
    case 'CLIENT_HAS_ACTIVE_APPOINTMENT':
      return 'This client has an active or upcoming appointment.';
    case 'CLIENT_PERMANENT_DELETE_NOT_ALLOWED':
      return 'This client has history and can’t be permanently deleted. Delete them from the active list instead.';
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

function booleanValue(value: unknown): boolean {
  if (typeof value === 'boolean') {
    return value;
  }
  if (value === 't' || value === 1 || value === '1') {
    return true;
  }
  if (value === 'f' || value === 0 || value === '0') {
    return false;
  }
  throw new ClientDeletionError('UNSUPPORTED_CLIENT_IDENTITY');
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

function databaseSqlState(error: unknown): string | null {
  if (!error || typeof error !== 'object') {
    return null;
  }
  const candidate = error as { code?: unknown; cause?: unknown };
  if (typeof candidate.code === 'string') {
    return candidate.code;
  }
  return candidate.cause === error
    ? null
    : databaseSqlState(candidate.cause);
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

async function setDeletionTransactionBounds(
  handle: LifecycleSqlHandle,
): Promise<void> {
  await handle.execute(sql`set local lock_timeout = '2s'`);
  await handle.execute(sql`set local statement_timeout = '10s'`);
}

async function runDeletionTransaction<T>(
  operation: (tx: LifecycleSqlHandle) => Promise<T>,
): Promise<T> {
  try {
    return await withClientLifecycleTransactionRetry(() =>
      (db as unknown as ClientDeletionDb).transaction(async (tx) => {
        await setDeletionTransactionBounds(tx);
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
    lock?: boolean;
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
    ${input.lock ? sql`for update` : sql``}
  `);
  return parseDeletionRow(readRows(result)[0]);
}

async function assertSupportedLifecyclePath(
  handle: LifecycleSqlHandle,
  input: {
    salonId: string;
    lineagePath: string[];
    terminalClientId: string;
  },
): Promise<void> {
  if (
    input.lineagePath.length === 0
    || input.lineagePath.at(-1) !== input.terminalClientId
  ) {
    throw new ClientDeletionError('UNSUPPORTED_CLIENT_IDENTITY');
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
  const rows = readRows(result);
  if (rows.length !== lineageIds.length) {
    throw new ClientDeletionError('UNSUPPORTED_CLIENT_IDENTITY');
  }
  const rowsById = new Map(rows.map(row => [String(row.id), row]));
  const externalClientIds = new Set(
    rows
      .map(row => row.client_id)
      .filter((clientId): clientId is string =>
        typeof clientId === 'string' && clientId.length > 0),
  );
  if (externalClientIds.size > 1) {
    throw new ClientDeletionError('UNSUPPORTED_CLIENT_IDENTITY');
  }
  const lineageIdSet = new Set(lineageIds);
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
      throw new ClientDeletionError('UNSUPPORTED_CLIENT_IDENTITY');
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
      throw new ClientDeletionError('UNSUPPORTED_CLIENT_IDENTITY');
    }
  }
  for (let index = 0; index < input.lineagePath.length - 1; index += 1) {
    const row = rowsById.get(input.lineagePath[index]!);
    if (
      row?.merged_into_client_id !== input.lineagePath[index + 1]
    ) {
      throw new ClientDeletionError('UNSUPPORTED_CLIENT_IDENTITY');
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
    throw new ClientDeletionError('UNSUPPORTED_CLIENT_IDENTITY');
  }
  return count === 1;
}

export async function archiveSalonClient(
  rawInput: ClientDeletionInput,
): Promise<ArchiveSalonClientResult> {
  const input = normalizedInput(rawInput);

  return runDeletionTransaction(async (tx) => {
    const terminal = await lockTerminalSalonClientWithHandle(tx, {
      salonId: input.salonId,
      clientId: input.requestedClientId,
      allowArchived: true,
    });
    await assertSupportedLifecyclePath(tx, {
      salonId: input.salonId,
      lineagePath: terminal.lineagePath,
      terminalClientId: terminal.id,
    });
    try {
      await getSalonClientLineageIdentityWithHandle(tx, {
        salonId: input.salonId,
        terminalClientId: terminal.id,
        allowArchived: true,
      });
    } catch (error) {
      if (error instanceof ClientLifecycleStabilizationError) {
        return mapLifecycleError(error);
      }
      throw new ClientDeletionError('UNSUPPORTED_CLIENT_IDENTITY');
    }
    const client = await loadDeletionRow(tx, {
      salonId: input.salonId,
      clientId: terminal.id,
    });
    if (!client || client.mergedIntoClientId) {
      throw new ClientDeletionError('UNSUPPORTED_CLIENT_IDENTITY');
    }
    if (
      (client.archivedAt == null) !== (client.archivedBy == null)
      || client.mergedAt != null
      || client.mergedBy != null
    ) {
      throw new ClientDeletionError('UNSUPPORTED_CLIENT_IDENTITY');
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

async function assertExactSalonClientForeignKeyAllowlist(
  handle: LifecycleSqlHandle,
): Promise<void> {
  const result = await handle.execute(sql`
    select
      child.relname as child_table,
      array_agg(
        child_attribute.attname
        order by key_columns.ordinality
      )::text[] as child_columns,
      array_agg(
        parent_attribute.attname
        order by key_columns.ordinality
      )::text[] as parent_columns,
      constraint_row.confdeltype::text as delete_action
    from pg_constraint as constraint_row
    inner join pg_class as parent
      on parent.oid = constraint_row.confrelid
    inner join pg_namespace as parent_namespace
      on parent_namespace.oid = parent.relnamespace
    inner join pg_class as child
      on child.oid = constraint_row.conrelid
    cross join lateral unnest(
      constraint_row.conkey,
      constraint_row.confkey
    ) with ordinality as key_columns(
      child_attribute_number,
      parent_attribute_number,
      ordinality
    )
    inner join pg_attribute as child_attribute
      on child_attribute.attrelid = child.oid
     and child_attribute.attnum = key_columns.child_attribute_number
    inner join pg_attribute as parent_attribute
      on parent_attribute.attrelid = parent.oid
     and parent_attribute.attnum = key_columns.parent_attribute_number
    where constraint_row.contype = 'f'
      and parent_namespace.nspname = current_schema()
      and parent.relname = 'salon_client'
    group by
      constraint_row.oid,
      child.relname,
      constraint_row.confdeltype
    order by child.relname, constraint_row.oid
  `);
  const actual = readRows(result).map((row) => {
    if (
      typeof row.child_table !== 'string'
      || !Array.isArray(row.child_columns)
      || !Array.isArray(row.parent_columns)
      || typeof row.delete_action !== 'string'
    ) {
      throw new ClientDeletionError('UNSUPPORTED_CLIENT_IDENTITY');
    }
    return [
      row.child_table,
      row.child_columns.join(','),
      row.parent_columns.join(','),
      row.delete_action,
    ].join('|');
  }).sort();
  if (
    actual.length !== EXPECTED_SALON_CLIENT_FOREIGN_KEYS.length
    || actual.some(
      (signature, index) =>
        signature !== EXPECTED_SALON_CLIENT_FOREIGN_KEYS[index],
    )
  ) {
    throw new ClientDeletionError('UNSUPPORTED_CLIENT_IDENTITY');
  }
}

async function loadPermanentDeleteCandidate(
  handle: LifecycleSqlHandle,
  input: {
    salonId: string;
    clientId: string;
    lock?: boolean;
  },
): Promise<PermanentDeleteCandidate | null> {
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
      ) as updated_at_version,
      (
        client.birthday is null
        and client.preferred_technician_id is null
        and nullif(btrim(client.notes), '') is null
        and nullif(btrim(client.sensitivities), '') is null
        and coalesce(client.nail_preferences, '{}'::jsonb) = '{}'::jsonb
        and coalesce(client.tags, '[]'::jsonb) = '[]'::jsonb
        and client.rebook_interval_days is null
        and client.next_rebook_due_at is null
        and client.last_contact_at is null
        and client.last_visit_at is null
        and coalesce(client.total_visits, 0) = 0
        and coalesce(client.total_spent, 0) = 0
        and coalesce(client.no_show_count, 0) = 0
        and coalesce(client.loyalty_points, 0) = 0
        and client.welcome_bonus_granted_at is null
        and coalesce(client.has_google_review, false) = false
        and client.google_review_marked_at is null
        and client.google_review_marked_by is null
        and coalesce(client.late_cancel_count, 0) = 0
        and client.last_late_cancel_at is null
        and (
          client.admin_flags is null
          or client.admin_flags = '{}'::jsonb
        )
        and coalesce(client.is_blocked, false) = false
        and nullif(btrim(client.blocked_reason), '') is null
      ) as own_profile_is_empty
    from salon_client as client
    where client.salon_id = ${input.salonId}
      and client.id = ${input.clientId}
    limit 1
    ${input.lock ? sql`for update` : sql``}
  `);
  const row = readRows(result)[0];
  const parsed = parseDeletionRow(row);
  if (!parsed) {
    return null;
  }
  return {
    ...parsed,
    ownProfileIsEmpty: booleanValue(row?.own_profile_is_empty),
  };
}

function phoneMatchSql(column: SQL, normalizedPhone: string): SQL {
  return sql`
    (
      case
        when length(regexp_replace(${column}, '[^0-9]', '', 'g')) = 11
          and left(regexp_replace(${column}, '[^0-9]', '', 'g'), 1) = '1'
        then substring(
          regexp_replace(${column}, '[^0-9]', '', 'g')
          from 2
        )
        else regexp_replace(${column}, '[^0-9]', '', 'g')
      end
    ) = ${normalizedPhone}
  `;
}

async function hasPermanentDeleteHistory(
  handle: LifecycleSqlHandle,
  candidate: PermanentDeleteCandidate,
): Promise<boolean> {
  let identity: ReturnType<typeof normalizeSalonClientIdentity>;
  try {
    identity = normalizeSalonClientIdentity({
      phone: candidate.phone,
      email: candidate.email,
    });
  } catch {
    throw new ClientDeletionError('UNSUPPORTED_CLIENT_IDENTITY');
  }
  if (!identity.phone) {
    throw new ClientDeletionError('UNSUPPORTED_CLIENT_IDENTITY');
  }
  const phone = identity.phone;
  const email = identity.email;
  const phoneVariants = [
    phone,
    `1${phone}`,
    `+1${phone}`,
    `+${phone}`,
  ];
  const globalEmailMatch = email
    ? sql`lower(btrim(global_client.email)) = ${email}`
    : sql`false`;
  const calendarEmailMatch = email
    ? sql`lower(btrim(calendar_event.attendee_email)) = ${email}`
    : sql`false`;

  const result = await handle.execute(sql`
    select (
      not ${candidate.ownProfileIsEmpty}
      or ${candidate.clientId}::text is not null
      or ${candidate.archivedAt}::timestamptz is not null
      or ${candidate.archivedBy}::text is not null
      or ${candidate.mergedIntoClientId}::text is not null
      or ${candidate.mergedAt}::timestamptz is not null
      or ${candidate.mergedBy}::text is not null

      or exists (
        select 1
        from salon_client as descendant
        where descendant.merged_into_client_id = ${candidate.id}
      )
      or exists (
        select 1
        from salon_client_contact_alias as alias
        where alias.salon_client_id = ${candidate.id}
      )
      or exists (
        select 1
        from salon_client_note as note
        where note.salon_client_id = ${candidate.id}
          or note.source_client_id = ${candidate.id}
      )
      or exists (
        select 1
        from appointment
        where appointment.salon_client_id = ${candidate.id}
          or (
            appointment.salon_id = ${candidate.salonId}
            and appointment.salon_client_id is null
            and ${phoneMatchSql(
              sql`appointment.client_phone`,
              phone,
            )}
          )
      )
      or exists (
        select 1
        from fraud_signal
        where fraud_signal.salon_client_id = ${candidate.id}
      )
      or exists (
        select 1
        from review
        where review.salon_client_id = ${candidate.id}
      )
      or exists (
        select 1
        from client_communication
        where client_communication.salon_client_id = ${candidate.id}
      )
      or exists (
        select 1
        from retention_campaign
        where retention_campaign.salon_client_id = ${candidate.id}
      )
      or exists (
        select 1
        from appointment_photo
        where appointment_photo.salon_id = ${candidate.salonId}
          and ${phoneMatchSql(
            sql`appointment_photo.normalized_client_phone`,
            phone,
          )}
      )
      or exists (
        select 1
        from client_preferences
        where client_preferences.salon_id = ${candidate.salonId}
          and ${phoneMatchSql(
            sql`client_preferences.normalized_client_phone`,
            phone,
          )}
      )
      or exists (
        select 1
        from reward
        where reward.salon_id = ${candidate.salonId}
          and ${phoneMatchSql(sql`reward.client_phone`, phone)}
      )
      or exists (
        select 1
        from referral
        where referral.salon_id = ${candidate.salonId}
          and (
            ${phoneMatchSql(sql`referral.referrer_phone`, phone)}
            or (
              referral.referee_phone is not null
              and ${phoneMatchSql(sql`referral.referee_phone`, phone)}
            )
          )
      )
      or exists (
        select 1
        from communication_consent
        where communication_consent.salon_id = ${candidate.salonId}
          and ${phoneMatchSql(sql`communication_consent.recipient`, phone)}
      )
      or exists (
        select 1
        from google_calendar_event as calendar_event
        where calendar_event.salon_id = ${candidate.salonId}
          and (
            (
              calendar_event.attendee_phone is not null
              and ${phoneMatchSql(sql`calendar_event.attendee_phone`, phone)}
            )
            or ${calendarEmailMatch}
          )
      )
      or exists (
        select 1
        from salon_google_calendar_connection as calendar_connection
        where calendar_connection.salon_id = ${candidate.salonId}
          and calendar_connection.status = 'active'
          and calendar_connection.inbound_sync_enabled = true
      )
      or exists (
        select 1
        from client as global_client
        where global_client.phone in (
          ${sql.join(phoneVariants.map(value => sql`${value}`), sql`, `)}
        )
        or ${globalEmailMatch}
      )
      or exists (
        select 1
        from client_session
        where client_session.client_phone in (
          ${sql.join(phoneVariants.map(value => sql`${value}`), sql`, `)}
        )
      )
      or exists (
        select 1
        from luster_migration_backup_0052_client_times as backup
        where backup.id = ${candidate.id}
      )
      or exists (
        select 1
        from audit_log as audit
        where (
          audit.entity_id = ${candidate.id}
          or audit.actor_id = ${candidate.id}
          or (
            audit.actor_phone is not null
            and ${phoneMatchSql(sql`audit.actor_phone`, phone)}
          )
          or audit.metadata::text like (
            '%' || to_jsonb(${candidate.id}::text)::text || '%'
          )
        )
        and not (
          audit.salon_id = ${candidate.salonId}
          and audit.action = 'client_created'
          and audit.entity_type = 'salon_client'
          and audit.entity_id = ${candidate.id}
          and audit.actor_phone is null
        )
      )
      or (
        select count(*)::int
        from audit_log as creation_audit
        where creation_audit.salon_id = ${candidate.salonId}
          and creation_audit.action = 'client_created'
          and creation_audit.entity_type = 'salon_client'
          and creation_audit.entity_id = ${candidate.id}
      ) > 1
      or exists (
        select 1
        from integration_outbox as outbox
        left join appointment as outbox_appointment
          on outbox_appointment.id = outbox.appointment_id
        where outbox.status in ('pending', 'retry', 'processing')
          and (
            outbox_appointment.salon_client_id = ${candidate.id}
            or (
              outbox.salon_id = ${candidate.salonId}
              and
              outbox_appointment.salon_client_id is null
              and outbox_appointment.id is not null
              and ${phoneMatchSql(
                sql`outbox_appointment.client_phone`,
                phone,
              )}
            )
            or (
              outbox.appointment_id is null
              and (
                outbox.payload::text like (
                  '%' || to_jsonb(${candidate.id}::text)::text || '%'
                )
                or ${candidate.id} = any(
                  regexp_split_to_array(outbox.dedupe_key, '[:|/]')
                )
              )
            )
          )
      )
      or exists (
        select 1
        from notification_delivery as delivery
        left join appointment as delivery_appointment
          on delivery_appointment.id = delivery.appointment_id
        where delivery.status in (
            'queued',
            'pending',
            'retry',
            'processing',
            'accepted',
            'sending'
          )
          and (
            delivery_appointment.salon_client_id = ${candidate.id}
            or (
              delivery.salon_id = ${candidate.salonId}
              and
              delivery_appointment.salon_client_id is null
              and delivery_appointment.id is not null
              and ${phoneMatchSql(
                sql`delivery_appointment.client_phone`,
                phone,
              )}
            )
            or (
              delivery.appointment_id is null
              and ${candidate.id} = any(
                regexp_split_to_array(delivery.dedupe_key, '[:|/]')
              )
            )
          )
      )
    ) as has_history
  `);
  const row = readRows(result)[0];
  return booleanValue(row?.has_history);
}

async function evaluatePermanentDeleteEligibilityWithHandle(
  handle: LifecycleSqlHandle,
  candidate: PermanentDeleteCandidate,
): Promise<boolean> {
  await assertExactSalonClientForeignKeyAllowlist(handle);
  return !(await hasPermanentDeleteHistory(handle, candidate));
}

async function matchingPermanentDeletionAuditExists(
  handle: LifecycleSqlHandle,
  input: {
    salonId: string;
    terminalClientId: string;
    originalExpectedUpdatedAt: string;
  },
): Promise<boolean> {
  const result = await handle.execute(sql`
    select count(*)::int as audit_count
    from audit_log
    where salon_id = ${input.salonId}
      and action = ${PERMANENT_DELETE_AUDIT_ACTION}
      and entity_type = 'salon_client'
      and entity_id = ${input.terminalClientId}
      and metadata ->> 'terminalClientId' = ${input.terminalClientId}
      and metadata ->> 'originalExpectedUpdatedAt'
        = ${input.originalExpectedUpdatedAt}
      and metadata ->> 'deletionMode' = 'direct_empty_profile'
      and metadata ->> 'tombstoneKind'
        = 'salon_client_permanent_delete'
      and metadata ->> 'tombstoneVersion' = '1'
  `);
  const count = Number(readRows(result)[0]?.audit_count);
  if (!Number.isInteger(count)) {
    throw new ClientDeletionError('UNSUPPORTED_CLIENT_IDENTITY');
  }
  return count === 1;
}

export async function getPermanentDeleteEligibility(input: {
  salonId: string;
  requestedClientId: string;
}): Promise<PermanentDeleteEligibility> {
  const salonId = requireInput(input.salonId, 'salonId');
  const requestedClientId = requireInput(
    input.requestedClientId,
    'requestedClientId',
  );
  try {
    const terminal = await resolveTerminalSalonClientWithHandle(
      db as LifecycleSqlHandle,
      {
        salonId,
        clientId: requestedClientId,
        allowArchived: true,
      },
    );
    const candidate = await loadPermanentDeleteCandidate(
      db as LifecycleSqlHandle,
      {
        salonId,
        clientId: terminal.id,
      },
    );
    if (!candidate) {
      throw new ClientDeletionError('CLIENT_NOT_FOUND');
    }
    const eligible = requestedClientId === terminal.id
      && terminal.lineagePath.length === 1
      && await evaluatePermanentDeleteEligibilityWithHandle(
        db as LifecycleSqlHandle,
        candidate,
      );
    return {
      eligible,
      terminalClientId: terminal.id,
    };
  } catch (error) {
    return mapLifecycleError(error);
  }
}

export async function permanentlyDeleteSalonClient(
  rawInput: ClientDeletionInput,
): Promise<PermanentlyDeleteSalonClientResult> {
  const input = normalizedInput(rawInput);

  try {
    return await runDeletionTransaction(async (tx) => {
      const preliminary = await loadPermanentDeleteCandidate(tx, {
        salonId: input.salonId,
        clientId: input.requestedClientId,
      });
      if (!preliminary) {
        if (await matchingPermanentDeletionAuditExists(tx, {
          salonId: input.salonId,
          terminalClientId: input.requestedClientId,
          originalExpectedUpdatedAt: input.expectedUpdatedAt,
        })) {
          return {
            code: 'CLIENT_PERMANENTLY_DELETED',
            terminalClientId: input.requestedClientId,
            idempotent: true,
          };
        }
        throw new ClientDeletionError('CLIENT_NOT_FOUND');
      }
      if (
        preliminary.mergedIntoClientId
        || preliminary.archivedAt
        || preliminary.archivedBy
        || preliminary.mergedAt
        || preliminary.mergedBy
      ) {
        throw new ClientDeletionError(
          'CLIENT_PERMANENT_DELETE_NOT_ALLOWED',
        );
      }
      if (preliminary.updatedAt !== input.expectedUpdatedAt) {
        throw new ClientDeletionError('CLIENT_ARCHIVE_CONFLICT');
      }

      // Authoritative permanent-delete lock order:
      // 1. global client/session SHARE gate;
      // 2. sorted salon/contact advisory keys;
      // 3. exact terminal salon_client row;
      // 4. tenant salon row;
      // 5. eligibility reads, tombstone insert, exact-row delete.
      //
      // The current global login/session writers do not participate in the
      // salon-scoped advisory-lock namespace. This short, timeout-bounded gate
      // makes the subsequent absence check authoritative without deleting or
      // mutating either global table.
      await lockGlobalClientIdentityTablesWithHandle(tx);

      try {
        await lockSalonClientIdentityKeySetWithHandle(tx, {
          salonId: input.salonId,
          contacts: [{
            phone: preliminary.phone,
            email: preliminary.email,
          }],
        });
      } catch {
        throw new ClientDeletionError('UNSUPPORTED_CLIENT_IDENTITY');
      }

      const candidate = await loadPermanentDeleteCandidate(tx, {
        salonId: input.salonId,
        clientId: input.requestedClientId,
        lock: true,
      });
      if (!candidate) {
        if (await matchingPermanentDeletionAuditExists(tx, {
          salonId: input.salonId,
          terminalClientId: input.requestedClientId,
          originalExpectedUpdatedAt: input.expectedUpdatedAt,
        })) {
          return {
            code: 'CLIENT_PERMANENTLY_DELETED',
            terminalClientId: input.requestedClientId,
            idempotent: true,
          };
        }
        throw new ClientDeletionError('CLIENT_NOT_FOUND');
      }
      if (
        candidate.phone !== preliminary.phone
        || candidate.email !== preliminary.email
        || candidate.updatedAt !== input.expectedUpdatedAt
      ) {
        throw new ClientDeletionError('CLIENT_ARCHIVE_CONFLICT');
      }
      if (
        candidate.mergedIntoClientId
        || candidate.archivedAt
        || candidate.archivedBy
        || candidate.mergedAt
        || candidate.mergedBy
      ) {
        throw new ClientDeletionError(
          'CLIENT_PERMANENT_DELETE_NOT_ALLOWED',
        );
      }

      // Every salon-scoped history table has a salon FK. Locking this one tenant
      // row after the canonical client row makes phone-keyed absence predicates
      // stable while preserving client-first ordering used by booking.
      const salonLockResult = await tx.execute(sql`
      select id
      from salon
      where id = ${input.salonId}
      for update
    `);
      if (readRows(salonLockResult).length !== 1) {
        throw new ClientDeletionError('CLIENT_NOT_FOUND');
      }

      if (!await evaluatePermanentDeleteEligibilityWithHandle(tx, candidate)) {
        throw new ClientDeletionError(
          'CLIENT_PERMANENT_DELETE_NOT_ALLOWED',
        );
      }

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
        ${PERMANENT_DELETE_AUDIT_ACTION},
        'salon_client',
        ${candidate.id},
        jsonb_build_object(
          'terminalClientId', ${candidate.id}::text,
          'originalExpectedUpdatedAt', ${input.expectedUpdatedAt}::text,
          'deletionMode', 'direct_empty_profile',
          'tombstoneKind', 'salon_client_permanent_delete',
          'tombstoneVersion', 1
        ),
        null,
        null
      )
    `);

      const deletionResult = await tx.execute(sql`
      delete from salon_client as client
      where client.salon_id = ${input.salonId}
        and client.id = ${candidate.id}
        and client.client_id is null
        and client.archived_at is null
        and client.archived_by is null
        and client.merged_into_client_id is null
        and client.merged_at is null
        and client.merged_by is null
        and to_char(
          client.updated_at,
          'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'
        ) = ${input.expectedUpdatedAt}
      returning client.id
    `);
      const deletedRows = readRows(deletionResult);
      if (
        deletedRows.length !== 1
        || deletedRows[0]?.id !== candidate.id
      ) {
        throw new ClientDeletionError('CLIENT_ARCHIVE_CONFLICT');
      }
      if (!await matchingPermanentDeletionAuditExists(tx, {
        salonId: input.salonId,
        terminalClientId: candidate.id,
        originalExpectedUpdatedAt: input.expectedUpdatedAt,
      })) {
        throw new ClientDeletionError('UNSUPPORTED_CLIENT_IDENTITY');
      }

      return {
        code: 'CLIENT_PERMANENTLY_DELETED',
        terminalClientId: candidate.id,
        idempotent: false,
      };
    });
  } catch (error) {
    if (databaseSqlState(error) === '23503') {
      throw new ClientDeletionError(
        'CLIENT_PERMANENT_DELETE_NOT_ALLOWED',
      );
    }
    throw error;
  }
}
