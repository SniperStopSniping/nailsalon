import 'server-only';

import { type SQL, sql } from 'drizzle-orm';

import { db } from '@/libs/DB';
import { normalizePhone } from '@/libs/phone';

export const CLIENT_LIFECYCLE_MAX_CHAIN_DEPTH = 16;
export const CLIENT_LIFECYCLE_RETRYABLE_SQLSTATES = new Set([
  '40P01',
  '40001',
]);

export type ClientLifecycleErrorCode =
  | 'CLIENT_NOT_FOUND'
  | 'INVALID_CLIENT_STATE'
  | 'CLIENT_ARCHIVED';

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

export type SalonClientLifecycleLink = {
  id: string;
  archivedAt: Date | null;
  mergedIntoClientId: string | null;
};

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

  const terminals = await Promise.all(candidateIds.map(clientId =>
    resolveTerminalSalonClientWithHandle(handle, {
      salonId,
      clientId,
      allowArchived: input.allowArchived,
    })));
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
    select distinct id
    from lineage
    order by id
  `);
  const ids = readRows(result)
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
