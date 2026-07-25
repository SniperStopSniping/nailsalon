import { spawn } from 'node:child_process';
import crypto from 'node:crypto';
import path from 'node:path';

import pg from 'pg';

const { Client } = pg;

const EXPECTED_0061_CREATED_AT = 1784950000006;
const EXPECTED_0061_HASH
  = 'ec2ea523735b0a45b964ed78f6f56327c9019678c29e6e994f161a8b2a4f7731';
const EXPECTED_0061_OBJECT_COUNT = 19;
const EXPECTED_0062_CREATED_AT = 1784950000007;
const MAX_CHAIN_DEPTH = 16;

const DIRECT_CLIENT_REFERENCES = [
  'appointment',
  'review',
  'client_communication',
  'retention_campaign',
  'fraud_signal',
  'salon_client_note',
  'salon_client_contact_alias',
] as const;

const MEASURED_TABLES = [
  'salon_client',
  'appointment',
  'appointment_payment',
  'review',
  'client_communication',
  'retention_campaign',
  'fraud_signal',
  'salon_client_contact_alias',
  'salon_client_note',
] as const;

type RehearsalStage =
  | 'configuration'
  | 'preflight'
  | 'migration'
  | 'readiness'
  | 'measurements'
  | 'no_op';

type CountRow = {
  count: string | number;
};

type ReferenceCounts = {
  orphanRows: number;
  crossSalonRows: number;
  nonTerminalRows: number;
};

type TableSize = {
  estimatedRows: number;
  totalBytes: number;
};

type PreflightResult = {
  exact0061Applied: boolean;
  contacts: {
    invalidPhoneRows: number;
    nonNormalizedPhoneRows: number;
    invalidActivePhoneRows: number;
    nonNormalizedActivePhoneRows: number;
    sameSalonPhoneConflictGroups: number;
    sameSalonEmailConflictGroups: number;
  };
  references: Record<
    (typeof DIRECT_CLIENT_REFERENCES)[number],
    ReferenceCounts
  >;
  aliases: {
    uniquenessConflictGroups: number;
    currentContactConflictRows: number;
  };
  identities: {
    directExternalClientRows: number;
    customerAccountPhoneLinkRows: number;
    customerSessionPhoneLinkRows: number;
    preferencePhoneLinkRows: number;
    mergedSourceDirectExternalRows: number;
    mergedSourceCustomerAccountPhoneLinkRows: number;
    mergedSourceCustomerSessionPhoneLinkRows: number;
    mergedSourcePreferencePhoneLinkRows: number;
  };
  mergedSources: {
    rows: number;
    notArchivedRows: number;
    incompleteAuditRows: number;
    missingTargetRows: number;
    crossSalonTargetRows: number;
    cycleRows: number;
    excessiveDepthRows: number;
    inactiveTerminalRows: number;
  };
  rowsPreventing0062: number;
  tableSizes: Record<(typeof MEASURED_TABLES)[number], TableSize>;
};

type MigrationResult = {
  attempts: number;
  milliseconds: number;
};

type BarrierMigrationResult = {
  attempts: number;
  commandTotalMillisecondsIncludingInducedWait: number;
};

type ObservedMigrationLock = {
  lockType: 'advisory' | 'relation';
  table: (typeof MEASURED_TABLES)[number] | null;
  mode: string;
  observedMilliseconds: number;
};

type MigrationLockObservation = {
  samples: number;
  longestObservedLock: ObservedMigrationLock | null;
  longestObservedExistingTableLock: ObservedMigrationLock | null;
};

type ReadinessResult = {
  milliseconds: number;
};

type MeasurementResult = {
  inducedCoordinationWaitMilliseconds: number;
  transactionAdvisoryLockHoldMilliseconds: number;
  postBarrierMigrationCompletionMilliseconds: number;
  lockObservation: MigrationLockObservation;
  writesAfterBarrierRelease: {
    probeLaunchedBeforeMigrationCompleted: boolean;
    appointmentMilliseconds: number;
    paymentMilliseconds: number;
  };
  post0062: {
    appointmentWriteMilliseconds: number;
    paymentWriteMilliseconds: number;
    terminalResolutionTriggerOverheadMilliseconds: number;
  };
};

type SyntheticMeasurementResult = {
  appointmentWriteMilliseconds: number;
  paymentWriteMilliseconds: number;
  triggerOverheadMilliseconds: number;
};

type CommandResult = {
  status: number;
  stdout: string;
};

const phoneCanonicalSql = (column: string): string => `
  case
    when length(regexp_replace(coalesce(${column}, ''), '[^0-9]', '', 'g')) = 10
      then regexp_replace(${column}, '[^0-9]', '', 'g')
    when length(regexp_replace(coalesce(${column}, ''), '[^0-9]', '', 'g')) = 11
      and left(regexp_replace(${column}, '[^0-9]', '', 'g'), 1) = '1'
      then right(regexp_replace(${column}, '[^0-9]', '', 'g'), 10)
    else null
  end
`;

const terminalMapSql = `
  with recursive client_walk as (
    select
      client.salon_id,
      client.id as origin_id,
      client.id as current_id,
      client.merged_into_client_id as next_id,
      array[client.id]::text[] as visited,
      0 as depth,
      false as cycle
    from salon_client as client

    union all

    select
      walk.salon_id,
      walk.origin_id,
      target.id,
      target.merged_into_client_id,
      walk.visited || target.id,
      walk.depth + 1,
      target.id = any(walk.visited)
    from client_walk as walk
    inner join salon_client as target
      on target.salon_id = walk.salon_id
     and target.id = walk.next_id
    where walk.next_id is not null
      and not walk.cycle
      and walk.depth < ${MAX_CHAIN_DEPTH - 1}
  ),
  terminal_client as (
    select distinct on (salon_id, origin_id)
      salon_id,
      origin_id,
      current_id as terminal_id
    from client_walk
    where next_id is null
      and not cycle
    order by salon_id, origin_id, depth desc
  )
`;

function roundedMilliseconds(value: number): number {
  return Number(Math.max(0, value).toFixed(2));
}

function median(values: number[]): number {
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 0) {
    return ((sorted[middle - 1] ?? 0) + (sorted[middle] ?? 0)) / 2;
  }
  return sorted[middle] ?? 0;
}

async function count(client: pg.Client, query: string): Promise<number> {
  const result = await client.query<CountRow>(query);
  return Number(result.rows[0]?.count ?? 0);
}

async function verifyExact0061(client: pg.Client): Promise<boolean> {
  const result = await client.query<{
    exact_rows: string;
    timestamp_rows: string;
    later_rows: string;
    object_count: string;
  }>(
    `
      select
        (
          select count(*)::text
          from drizzle.__drizzle_migrations
          where created_at = $1
            and hash = $2
        ) as exact_rows,
        (
          select count(*)::text
          from drizzle.__drizzle_migrations
          where created_at = $1
        ) as timestamp_rows,
        (
          select count(*)::text
          from drizzle.__drizzle_migrations
          where created_at >= $3
        ) as later_rows,
        (
          with objects as (
            select 'table:' || table_name as object_name
            from information_schema.tables
            where table_schema = 'public'
              and table_name in (
                'salon_client_contact_alias',
                'salon_client_note'
              )

            union all

            select 'trigger:' || triggers.tgname
            from pg_trigger as triggers
            inner join pg_class as relations
              on relations.oid = triggers.tgrelid
            inner join pg_namespace as namespaces
              on namespaces.oid = relations.relnamespace
            where namespaces.nspname = 'public'
              and not triggers.tgisinternal
              and triggers.tgname in (
                'salon_client_enforce_merge_transition',
                'salon_client_prevent_merged_source_update',
                'appointment_resolve_merged_client',
                'review_resolve_merged_client',
                'client_communication_resolve_merged_client',
                'retention_campaign_resolve_merged_client',
                'fraud_signal_resolve_merged_client',
                'salon_client_note_resolve_merged_client',
                'salon_client_alias_resolve_merged_client'
              )

            union all

            select 'index:' || indexname
            from pg_indexes
            where schemaname = 'public'
              and indexname in (
                'salon_client_salon_id_id_idx',
                'salon_client_lifecycle_idx',
                'salon_client_merged_into_idx',
                'salon_client_contact_alias_unique',
                'salon_client_contact_alias_client_idx',
                'salon_client_note_client_created_idx',
                'salon_client_note_source_idx'
              )

            union all

            select 'constraint:' || constraints.conname
            from pg_constraint as constraints
            inner join pg_namespace as namespaces
              on namespaces.oid = constraints.connamespace
            where namespaces.nspname = 'public'
              and constraints.conname
                = 'salon_client_merged_into_client_id_fkey'
              and constraints.convalidated
          )
          select count(*)::text
          from objects
        ) as object_count
    `,
    [
      EXPECTED_0061_CREATED_AT,
      EXPECTED_0061_HASH,
      EXPECTED_0062_CREATED_AT,
    ],
  );
  const row = result.rows[0];
  return Number(row?.exact_rows ?? 0) === 1
    && Number(row?.timestamp_rows ?? 0) === 1
    && Number(row?.later_rows ?? 0) === 0
    && Number(row?.object_count ?? 0) === EXPECTED_0061_OBJECT_COUNT;
}

async function collectReferenceCounts(
  client: pg.Client,
): Promise<PreflightResult['references']> {
  const entries = await Promise.all(
    DIRECT_CLIENT_REFERENCES.map(async (tableName) => {
      const result = await client.query<{
        orphan_rows: string;
        cross_salon_rows: string;
        non_terminal_rows: string;
      }>(`
        select
          count(*) filter (
            where record.salon_client_id is not null
              and linked_client.id is null
          )::text as orphan_rows,
          count(*) filter (
            where record.salon_client_id is not null
              and linked_client.id is not null
              and linked_client.salon_id <> record.salon_id
          )::text as cross_salon_rows,
          count(*) filter (
            where record.salon_client_id is not null
              and linked_client.salon_id = record.salon_id
              and linked_client.merged_into_client_id is not null
          )::text as non_terminal_rows
        from ${tableName} as record
        left join salon_client as linked_client
          on linked_client.id = record.salon_client_id
      `);
      const row = result.rows[0];
      return [
        tableName,
        {
          orphanRows: Number(row?.orphan_rows ?? 0),
          crossSalonRows: Number(row?.cross_salon_rows ?? 0),
          nonTerminalRows: Number(row?.non_terminal_rows ?? 0),
        },
      ] as const;
    }),
  );
  return Object.fromEntries(entries) as PreflightResult['references'];
}

async function collectTableSizes(
  client: pg.Client,
): Promise<PreflightResult['tableSizes']> {
  const result = await client.query<{
    table_name: string;
    estimated_rows: string;
    total_bytes: string;
  }>(
    `
      select
        relname as table_name,
        greatest(coalesce(n_live_tup, 0), 0)::bigint::text
          as estimated_rows,
        pg_total_relation_size(relid)::bigint::text as total_bytes
      from pg_stat_user_tables
      where schemaname = 'public'
        and relname = any($1::text[])
    `,
    [MEASURED_TABLES],
  );
  const byName = new Map(result.rows.map(row => [row.table_name, row]));
  return Object.fromEntries(MEASURED_TABLES.map((tableName) => {
    const row = byName.get(tableName);
    return [
      tableName,
      {
        estimatedRows: Number(row?.estimated_rows ?? 0),
        totalBytes: Number(row?.total_bytes ?? 0),
      },
    ];
  })) as PreflightResult['tableSizes'];
}

async function collectPreflight(client: pg.Client): Promise<PreflightResult> {
  await client.query('begin transaction read only');
  try {
    await client.query(`set local lock_timeout = '2s'`);
    await client.query(`set local statement_timeout = '30s'`);
    await client.query(`set local idle_in_transaction_session_timeout = '30s'`);

    const exact0061Applied = await verifyExact0061(client);
    const currentPhone = phoneCanonicalSql('client.phone');
    const accountPhone = phoneCanonicalSql('account.phone');
    const sessionPhone = phoneCanonicalSql('session.client_phone');

    const contactsResult = await client.query<{
      invalid_phone_rows: string;
      non_normalized_phone_rows: string;
      invalid_active_phone_rows: string;
      non_normalized_active_phone_rows: string;
      phone_conflict_groups: string;
      email_conflict_groups: string;
    }>(`
      select
        (
          select count(*)::text
          from salon_client as client
          where (${currentPhone}) is null
        ) as invalid_phone_rows,
        (
          select count(*)::text
          from salon_client as client
          where (${currentPhone}) is not null
            and client.phone <> (${currentPhone})
        ) as non_normalized_phone_rows,
        (
          select count(*)::text
          from salon_client as client
          where client.archived_at is null
            and client.merged_into_client_id is null
            and (${currentPhone}) is null
        ) as invalid_active_phone_rows,
        (
          select count(*)::text
          from salon_client as client
          where client.archived_at is null
            and client.merged_into_client_id is null
            and (${currentPhone}) is not null
            and client.phone <> (${currentPhone})
        ) as non_normalized_active_phone_rows,
        (
          select count(*)::text
          from (
            select client.salon_id, (${currentPhone}) as normalized_phone
            from salon_client as client
            where (${currentPhone}) is not null
            group by client.salon_id, (${currentPhone})
            having count(*) > 1
          ) as conflicts
        ) as phone_conflict_groups,
        (
          select count(*)::text
          from (
            select client.salon_id, lower(btrim(client.email)) as email
            from salon_client as client
            where nullif(btrim(client.email), '') is not null
            group by client.salon_id, lower(btrim(client.email))
            having count(*) > 1
          ) as conflicts
        ) as email_conflict_groups
    `);
    const contactRow = contactsResult.rows[0];
    const contacts: PreflightResult['contacts'] = {
      invalidPhoneRows: Number(contactRow?.invalid_phone_rows ?? 0),
      nonNormalizedPhoneRows: Number(
        contactRow?.non_normalized_phone_rows ?? 0,
      ),
      invalidActivePhoneRows: Number(
        contactRow?.invalid_active_phone_rows ?? 0,
      ),
      nonNormalizedActivePhoneRows: Number(
        contactRow?.non_normalized_active_phone_rows ?? 0,
      ),
      sameSalonPhoneConflictGroups: Number(
        contactRow?.phone_conflict_groups ?? 0,
      ),
      sameSalonEmailConflictGroups: Number(
        contactRow?.email_conflict_groups ?? 0,
      ),
    };

    const references = await collectReferenceCounts(client);
    const aliasResult = await client.query<{
      uniqueness_conflicts: string;
      current_contact_conflicts: string;
    }>(`
      ${terminalMapSql}
      select
        (
          select count(*)::text
          from (
            select salon_id, kind, normalized_value
            from salon_client_contact_alias
            group by salon_id, kind, normalized_value
            having count(*) > 1
          ) as conflicts
        ) as uniqueness_conflicts,
        (
          select count(*)::text
          from salon_client_contact_alias as alias
          inner join terminal_client as alias_terminal
            on alias_terminal.salon_id = alias.salon_id
           and alias_terminal.origin_id = alias.salon_client_id
          inner join salon_client as current_client
            on current_client.salon_id = alias.salon_id
           and (
             (
               alias.kind = 'phone'
               and alias.normalized_value = (
                 ${phoneCanonicalSql('current_client.phone')}
               )
             )
             or (
               alias.kind = 'email'
               and alias.normalized_value
                 = lower(btrim(current_client.email))
             )
           )
          inner join terminal_client as current_terminal
            on current_terminal.salon_id = current_client.salon_id
           and current_terminal.origin_id = current_client.id
          where alias_terminal.terminal_id <> current_terminal.terminal_id
        ) as current_contact_conflicts
    `);
    const aliasRow = aliasResult.rows[0];
    const aliases: PreflightResult['aliases'] = {
      uniquenessConflictGroups: Number(
        aliasRow?.uniqueness_conflicts ?? 0,
      ),
      currentContactConflictRows: Number(
        aliasRow?.current_contact_conflicts ?? 0,
      ),
    };

    const mergedResult = await client.query<{
      merged_rows: string;
      not_archived_rows: string;
      incomplete_audit_rows: string;
      missing_target_rows: string;
      cross_salon_target_rows: string;
      cycle_rows: string;
      excessive_depth_rows: string;
      inactive_terminal_rows: string;
    }>(`
      with recursive merge_walk as (
        select
          source.salon_id,
          source.id as origin_id,
          source.id as current_id,
          source.merged_into_client_id as next_id,
          source.archived_at,
          array[source.id]::text[] as visited,
          0 as depth,
          false as cycle,
          false as missing
        from salon_client as source
        where source.merged_into_client_id is not null

        union all

        select
          walk.salon_id,
          walk.origin_id,
          target.id,
          target.merged_into_client_id,
          target.archived_at,
          walk.visited || coalesce(target.id, walk.next_id),
          walk.depth + 1,
          coalesce(target.id = any(walk.visited), false),
          target.id is null
        from merge_walk as walk
        left join salon_client as target
          on target.salon_id = walk.salon_id
         and target.id = walk.next_id
        where walk.next_id is not null
          and not walk.cycle
          and not walk.missing
          and walk.depth < ${MAX_CHAIN_DEPTH - 1}
      )
      select
        (
          select count(*)::text
          from salon_client
          where merged_into_client_id is not null
        ) as merged_rows,
        (
          select count(*)::text
          from salon_client
          where merged_into_client_id is not null
            and archived_at is null
        ) as not_archived_rows,
        (
          select count(*)::text
          from salon_client
          where merged_into_client_id is not null
            and (
              merged_at is null
              or merged_by is null
              or archived_by is null
            )
        ) as incomplete_audit_rows,
        (
          select count(*)::text
          from salon_client as source
          left join salon_client as target
            on target.salon_id = source.salon_id
           and target.id = source.merged_into_client_id
          where source.merged_into_client_id is not null
            and target.id is null
        ) as missing_target_rows,
        (
          select count(*)::text
          from salon_client as source
          inner join salon_client as target
            on target.id = source.merged_into_client_id
           and target.salon_id <> source.salon_id
          where source.merged_into_client_id is not null
        ) as cross_salon_target_rows,
        count(distinct origin_id) filter (where cycle)::text as cycle_rows,
        count(distinct origin_id) filter (
          where depth = ${MAX_CHAIN_DEPTH - 1}
            and next_id is not null
            and not cycle
            and not missing
        )::text as excessive_depth_rows,
        count(distinct origin_id) filter (
          where next_id is null
            and depth > 0
            and archived_at is not null
            and not cycle
            and not missing
        )::text as inactive_terminal_rows
      from merge_walk
    `);
    const mergedRow = mergedResult.rows[0];
    const mergedSources: PreflightResult['mergedSources'] = {
      rows: Number(mergedRow?.merged_rows ?? 0),
      notArchivedRows: Number(mergedRow?.not_archived_rows ?? 0),
      incompleteAuditRows: Number(mergedRow?.incomplete_audit_rows ?? 0),
      missingTargetRows: Number(mergedRow?.missing_target_rows ?? 0),
      crossSalonTargetRows: Number(
        mergedRow?.cross_salon_target_rows ?? 0,
      ),
      cycleRows: Number(mergedRow?.cycle_rows ?? 0),
      excessiveDepthRows: Number(mergedRow?.excessive_depth_rows ?? 0),
      inactiveTerminalRows: Number(
        mergedRow?.inactive_terminal_rows ?? 0,
      ),
    };

    const identitiesResult = await client.query<{
      direct_external: string;
      account_links: string;
      session_links: string;
      preference_links: string;
      merged_direct_external: string;
      merged_account_links: string;
      merged_session_links: string;
      merged_preference_links: string;
    }>(`
      select
        (
          select count(*)::text
          from salon_client
          where client_id is not null
        ) as direct_external,
        (
          select count(distinct account.id)::text
          from client as account
          inner join salon_client as client
            on (${accountPhone}) is not null
           and (${accountPhone}) = (${currentPhone})
        ) as account_links,
        (
          select count(distinct session.id)::text
          from client_session as session
          inner join salon_client as client
            on (${sessionPhone}) is not null
           and (${sessionPhone}) = (${currentPhone})
        ) as session_links,
        (
          select count(distinct preference.id)::text
          from client_preferences as preference
          inner join salon_client as client
            on client.salon_id = preference.salon_id
           and (${currentPhone}) = preference.normalized_client_phone
        ) as preference_links,
        (
          select count(*)::text
          from salon_client
          where merged_into_client_id is not null
            and client_id is not null
        ) as merged_direct_external,
        (
          select count(distinct account.id)::text
          from client as account
          inner join salon_client as client
            on client.merged_into_client_id is not null
           and (${accountPhone}) is not null
           and (${accountPhone}) = (${currentPhone})
        ) as merged_account_links,
        (
          select count(distinct session.id)::text
          from client_session as session
          inner join salon_client as client
            on client.merged_into_client_id is not null
           and (${sessionPhone}) is not null
           and (${sessionPhone}) = (${currentPhone})
        ) as merged_session_links,
        (
          select count(distinct preference.id)::text
          from client_preferences as preference
          inner join salon_client as client
            on client.merged_into_client_id is not null
           and client.salon_id = preference.salon_id
           and (${currentPhone}) = preference.normalized_client_phone
        ) as merged_preference_links
    `);
    const identityRow = identitiesResult.rows[0];
    const identities: PreflightResult['identities'] = {
      directExternalClientRows: Number(identityRow?.direct_external ?? 0),
      customerAccountPhoneLinkRows: Number(identityRow?.account_links ?? 0),
      customerSessionPhoneLinkRows: Number(identityRow?.session_links ?? 0),
      preferencePhoneLinkRows: Number(identityRow?.preference_links ?? 0),
      mergedSourceDirectExternalRows: Number(
        identityRow?.merged_direct_external ?? 0,
      ),
      mergedSourceCustomerAccountPhoneLinkRows: Number(
        identityRow?.merged_account_links ?? 0,
      ),
      mergedSourceCustomerSessionPhoneLinkRows: Number(
        identityRow?.merged_session_links ?? 0,
      ),
      mergedSourcePreferencePhoneLinkRows: Number(
        identityRow?.merged_preference_links ?? 0,
      ),
    };

    const preexistingCapabilityRows = await count(
      client,
      `select case
         when to_regclass('public.app_schema_capability') is null then 0
         else 1
       end as count`,
    );
    const referenceBlockingRows = Object.values(references).reduce(
      (sum, reference) =>
        sum
        + reference.orphanRows
        + reference.crossSalonRows
        + reference.nonTerminalRows,
      0,
    );
    const rowsPreventing0062
      = (exact0061Applied ? 0 : 1)
      + contacts.invalidActivePhoneRows
      + contacts.nonNormalizedActivePhoneRows
      + contacts.sameSalonPhoneConflictGroups
      + contacts.sameSalonEmailConflictGroups
      + referenceBlockingRows
      + aliases.uniquenessConflictGroups
      + aliases.currentContactConflictRows
      + mergedSources.notArchivedRows
      + mergedSources.incompleteAuditRows
      + mergedSources.missingTargetRows
      + mergedSources.crossSalonTargetRows
      + mergedSources.cycleRows
      + mergedSources.excessiveDepthRows
      + mergedSources.inactiveTerminalRows
      + identities.mergedSourceDirectExternalRows
      + identities.mergedSourceCustomerAccountPhoneLinkRows
      + identities.mergedSourceCustomerSessionPhoneLinkRows
      + identities.mergedSourcePreferencePhoneLinkRows
      + preexistingCapabilityRows;

    const tableSizes = await collectTableSizes(client);
    await client.query('rollback');
    return {
      exact0061Applied,
      contacts,
      references,
      aliases,
      identities,
      mergedSources,
      rowsPreventing0062,
      tableSizes,
    };
  } catch (error) {
    await client.query('rollback').catch(() => undefined);
    throw error;
  }
}

function runTsxScript(
  databaseUrl: string,
  scriptPath: string,
): Promise<CommandResult> {
  const executable = path.join(
    process.cwd(),
    'node_modules',
    '.bin',
    process.platform === 'win32' ? 'tsx.cmd' : 'tsx',
  );
  return new Promise((resolve, reject) => {
    const child = spawn(executable, [scriptPath], {
      cwd: process.cwd(),
      env: {
        ...process.env,
        DATABASE_URL: databaseUrl,
      },
      shell: false,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    const timeout = setTimeout(() => {
      child.kill('SIGTERM');
    }, 120_000);
    let stdout = '';
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (chunk: string) => {
      if (stdout.length <= 16_384) {
        stdout += chunk;
      }
    });
    // Child errors are intentionally discarded because database errors can
    // contain SQL text, connection details, or row identifiers.
    child.stderr.resume();
    child.once('error', () => {
      clearTimeout(timeout);
      reject(new Error('protected command failed'));
    });
    child.once('close', (code) => {
      clearTimeout(timeout);
      resolve({
        status: code ?? 1,
        stdout,
      });
    });
  });
}

function parseMigrationResult(command: CommandResult): MigrationResult {
  if (command.status !== 0) {
    throw new Error('protected migration failed');
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(command.stdout.trim());
  } catch {
    throw new Error('protected migration returned invalid output');
  }
  if (
    typeof parsed !== 'object'
    || parsed == null
    || !('status' in parsed)
    || parsed.status !== 'ok'
    || !('attempts' in parsed)
    || typeof parsed.attempts !== 'number'
    || !('milliseconds' in parsed)
    || typeof parsed.milliseconds !== 'number'
  ) {
    throw new Error('protected migration returned invalid output');
  }
  return {
    attempts: parsed.attempts,
    milliseconds: parsed.milliseconds,
  };
}

function parseReadinessResult(command: CommandResult): ReadinessResult {
  if (command.status !== 0) {
    throw new Error('readiness verification failed');
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(command.stdout.trim());
  } catch {
    throw new Error('readiness verification returned invalid output');
  }
  if (
    typeof parsed !== 'object'
    || parsed == null
    || !('ready' in parsed)
    || parsed.ready !== true
    || !('milliseconds' in parsed)
    || typeof parsed.milliseconds !== 'number'
  ) {
    throw new Error('readiness verification returned invalid output');
  }
  return { milliseconds: parsed.milliseconds };
}

async function currentMigrationWaitMilliseconds(
  observer: pg.Client,
  notBefore: Date,
): Promise<number | null> {
  const result = await observer.query<{ wait_milliseconds: string }>(
    `
      select extract(
        epoch from (clock_timestamp() - query_start)
      ) * 1000 as wait_milliseconds
      from pg_stat_activity
      where application_name like 'client-lifecycle-migration-%'
        and query_start >= $1
        and wait_event_type = 'Lock'
        and wait_event = 'advisory'
      order by query_start desc
      limit 1
    `,
    [notBefore],
  );
  if (result.rowCount !== 1) {
    return null;
  }
  return roundedMilliseconds(
    Number(result.rows[0]?.wait_milliseconds ?? 0),
  );
}

async function waitForMigrationCoordinationLock(
  observer: pg.Client,
  notBefore: Date,
): Promise<void> {
  const deadline = performance.now() + 8_000;
  while (performance.now() < deadline) {
    if (
      await currentMigrationWaitMilliseconds(observer, notBefore) != null
    ) {
      return;
    }
    await new Promise<void>(resolve => setImmediate(resolve));
  }
  throw new Error('migration lock barrier was not observed');
}

async function waitForFollowerCoordinationLock(
  observer: pg.Client,
  notBefore: Date,
): Promise<void> {
  const deadline = performance.now() + 8_000;
  while (performance.now() < deadline) {
    const result = await observer.query<{ waiting: boolean }>(
      `select exists (
         select 1
         from pg_stat_activity
         where application_name =
           'client-lifecycle-rehearsal-lock-follower'
           and query_start >= $1
           and wait_event_type = 'Lock'
           and wait_event = 'advisory'
       ) as waiting`,
      [notBefore],
    );
    if (result.rows[0]?.waiting === true) {
      return;
    }
    await new Promise<void>(resolve => setImmediate(resolve));
  }
  throw new Error('migration lock follower was not queued');
}

async function observeMigrationLocks(
  observer: pg.Client,
  isMigrationComplete: () => boolean,
): Promise<MigrationLockObservation> {
  type LockRow = {
    pid: number;
    lock_type: 'advisory' | 'relation';
    mode: string;
    table_name: (typeof MEASURED_TABLES)[number] | null;
  };
  type LockSpan = LockRow & {
    firstObservedAt: number;
    lastObservedAt: number;
  };

  const spans = new Map<string, LockSpan>();
  let samples = 0;
  do {
    const observedAt = performance.now();
    const result = await observer.query<LockRow>(
      `select
         locks.pid,
         locks.locktype as lock_type,
         locks.mode,
         case
           when namespaces.nspname = 'public'
             and relations.relname = any($1::text[])
             then relations.relname
           else null
         end as table_name
       from pg_stat_activity as activity
       inner join pg_locks as locks on locks.pid = activity.pid
       left join pg_class as relations on relations.oid = locks.relation
       left join pg_namespace as namespaces
         on namespaces.oid = relations.relnamespace
       where activity.application_name like 'client-lifecycle-migration-%'
         and locks.granted
         and (
           locks.locktype = 'advisory'
           or (
             locks.locktype = 'relation'
             and namespaces.nspname = 'public'
             and relations.relname = any($1::text[])
           )
         )`,
      [MEASURED_TABLES],
    );
    samples += 1;
    for (const row of result.rows) {
      const key = [
        row.pid,
        row.lock_type,
        row.table_name ?? '',
        row.mode,
      ].join(':');
      const existing = spans.get(key);
      if (existing) {
        existing.lastObservedAt = observedAt;
      } else {
        spans.set(key, {
          ...row,
          firstObservedAt: observedAt,
          lastObservedAt: observedAt,
        });
      }
    }
    if (!isMigrationComplete()) {
      await new Promise<void>(resolve => setImmediate(resolve));
    }
  } while (!isMigrationComplete());

  const summarized = [...spans.values()].map<ObservedMigrationLock>(span => ({
    lockType: span.lock_type,
    table: span.table_name,
    mode: span.mode,
    observedMilliseconds: roundedMilliseconds(
      span.lastObservedAt - span.firstObservedAt,
    ),
  }));
  const longest = (
    candidates: ObservedMigrationLock[],
  ): ObservedMigrationLock | null => candidates
    .sort((left, right) =>
      right.observedMilliseconds - left.observedMilliseconds)[0] ?? null;

  return {
    samples,
    longestObservedLock: longest([...summarized]),
    longestObservedExistingTableLock: longest(
      summarized.filter(lock => lock.lockType === 'relation'),
    ),
  };
}

async function runMigrationWithBarrier(databaseUrl: string): Promise<{
  migration: BarrierMigrationResult;
  inducedCoordinationWaitMilliseconds: number;
  transactionAdvisoryLockHoldMilliseconds: number;
  postBarrierMigrationCompletionMilliseconds: number;
  lockObservation: MigrationLockObservation;
  writesAfterBarrierRelease: {
    probeLaunchedBeforeMigrationCompleted: boolean;
    appointmentMilliseconds: number;
    paymentMilliseconds: number;
  };
}> {
  const lockClient = new Client({
    connectionString: databaseUrl,
    application_name: 'client-lifecycle-rehearsal-lock-barrier',
    connectionTimeoutMillis: 15_000,
  });
  const observer = new Client({
    connectionString: databaseUrl,
    application_name: 'client-lifecycle-rehearsal-lock-observer',
    connectionTimeoutMillis: 15_000,
  });
  const follower = new Client({
    connectionString: databaseUrl,
    application_name: 'client-lifecycle-rehearsal-lock-follower',
    connectionTimeoutMillis: 15_000,
  });
  let lockTransactionOpen = false;
  let followerTransactionOpen = false;
  let migrationComplete = false;
  let migrationCompletedAt: number | null = null;
  let commandPromise: Promise<CommandResult> | undefined;
  try {
    await Promise.all([
      lockClient.connect(),
      observer.connect(),
      follower.connect(),
    ]);
    await lockClient.query('begin');
    lockTransactionOpen = true;
    await lockClient.query(`set local statement_timeout = '15s'`);
    await observer.query(`set statement_timeout = '15s'`);
    await follower.query('begin');
    followerTransactionOpen = true;
    await follower.query(`set local statement_timeout = '15s'`);
    await lockClient.query(`
      select pg_advisory_xact_lock(
        hashtextextended('client-lifecycle-stabilization-migration', 0)
      )
    `);
    const marker = await observer.query<{ marker: Date }>(
      'select clock_timestamp() as marker',
    );
    commandPromise = runTsxScript(
      databaseUrl,
      'scripts/migrate-client-lifecycle.ts',
    );
    void commandPromise.then(
      () => {
        migrationComplete = true;
        migrationCompletedAt = performance.now();
      },
      () => {
        migrationComplete = true;
        migrationCompletedAt = performance.now();
      },
    );
    await waitForMigrationCoordinationLock(
      observer,
      marker.rows[0]?.marker ?? new Date(),
    );
    const followerLockPromise = follower.query(`
      select pg_advisory_xact_lock(
        hashtextextended('client-lifecycle-stabilization-migration', 0)
      )
    `);
    await waitForFollowerCoordinationLock(
      observer,
      marker.rows[0]?.marker ?? new Date(),
    );
    const inducedCoordinationWaitMilliseconds
      = await currentMigrationWaitMilliseconds(
        observer,
        marker.rows[0]?.marker ?? new Date(),
      );
    if (inducedCoordinationWaitMilliseconds == null) {
      throw new Error('migration left the coordination barrier unexpectedly');
    }
    const lockObservationPromise = observeMigrationLocks(
      observer,
      () => migrationComplete,
    );
    const migrationReleasedAt = performance.now();
    await lockClient.query('rollback');
    lockTransactionOpen = false;
    const probeLaunchedBeforeMigrationCompleted = !migrationComplete;
    let followerAcquiredAt: number | null = null;
    const followerAcquiredPromise = followerLockPromise.then(async () => {
      followerAcquiredAt = performance.now();
      await follower.query('rollback');
      followerTransactionOpen = false;
    });
    const [writesAfterBarrierRelease, lockObservation, command]
      = await Promise.all([
        collectSyntheticMeasurements(databaseUrl, 1),
        lockObservationPromise,
        commandPromise,
        followerAcquiredPromise,
      ]);
    const postBarrierMigrationCompletionMilliseconds = roundedMilliseconds(
      (migrationCompletedAt ?? performance.now()) - migrationReleasedAt,
    );
    const transactionAdvisoryLockHoldMilliseconds = roundedMilliseconds(
      (followerAcquiredAt ?? performance.now()) - migrationReleasedAt,
    );
    const migrationCommand = parseMigrationResult(command);
    return {
      migration: {
        attempts: migrationCommand.attempts,
        commandTotalMillisecondsIncludingInducedWait:
          migrationCommand.milliseconds,
      },
      inducedCoordinationWaitMilliseconds,
      transactionAdvisoryLockHoldMilliseconds,
      postBarrierMigrationCompletionMilliseconds,
      lockObservation,
      writesAfterBarrierRelease: {
        probeLaunchedBeforeMigrationCompleted,
        appointmentMilliseconds:
          writesAfterBarrierRelease.appointmentWriteMilliseconds,
        paymentMilliseconds:
          writesAfterBarrierRelease.paymentWriteMilliseconds,
      },
    };
  } finally {
    if (lockTransactionOpen) {
      await lockClient.query('rollback').catch(() => undefined);
    }
    if (followerTransactionOpen) {
      await follower.query('rollback').catch(() => undefined);
    }
    await commandPromise?.catch(() => undefined);
    await Promise.all([
      lockClient.end().catch(() => undefined),
      observer.end().catch(() => undefined),
      follower.end().catch(() => undefined),
    ]);
  }
}

async function timedQuery(
  client: pg.Client,
  query: string,
  values: unknown[],
): Promise<number> {
  const startedAt = performance.now();
  await client.query(query, values);
  return performance.now() - startedAt;
}

async function collectSyntheticMeasurements(
  databaseUrl: string,
  sampleCount = 5,
): Promise<SyntheticMeasurementResult> {
  const client = new Client({
    connectionString: databaseUrl,
    application_name: 'client-lifecycle-rehearsal-synthetic-writes',
    connectionTimeoutMillis: 15_000,
  });
  const suffix = crypto.randomUUID().replaceAll('-', '');
  const salonId = `lifecycle_rehearsal_salon_${suffix}`;
  const salonSlug = `lifecycle-rehearsal-${suffix}`;
  const clientId = `lifecycle_rehearsal_client_${suffix}`;
  const baselineDurations: number[] = [];
  const appointmentDurations: number[] = [];
  const paymentDurations: number[] = [];
  let transactionOpen = false;
  try {
    await client.connect();
    await client.query('begin');
    transactionOpen = true;
    await client.query(`set local lock_timeout = '2s'`);
    await client.query(`set local statement_timeout = '15s'`);
    await client.query(`set local idle_in_transaction_session_timeout = '30s'`);
    await client.query(
      `insert into salon (id, name, slug, theme_key)
       values ($1, 'Lifecycle rehearsal fixture', $2, 'minimal')`,
      [salonId, salonSlug],
    );
    await client.query(
      `insert into salon_client (
         id, salon_id, phone, full_name, created_at, updated_at
       )
       values ($1, $2, '0000000000', 'Lifecycle rehearsal fixture', now(), now())`,
      [clientId, salonId],
    );

    for (let index = 0; index < sampleCount; index += 1) {
      const baselineAppointmentId
        = `lifecycle_rehearsal_baseline_${index}_${suffix}`;
      const appointmentId = `lifecycle_rehearsal_appointment_${index}_${suffix}`;
      const paymentId = `lifecycle_rehearsal_payment_${index}_${suffix}`;
      baselineDurations.push(await timedQuery(
        client,
        `insert into appointment (
           id, salon_id, salon_client_id, client_phone, client_name,
           start_time, end_time, status, total_price, total_duration_minutes
         )
         values (
           $1, $2, null, '0000000000', 'Lifecycle rehearsal fixture',
           '2030-01-01T15:00:00Z', '2030-01-01T16:00:00Z',
           'completed', 100, 60
         )`,
        [baselineAppointmentId, salonId],
      ));
      appointmentDurations.push(await timedQuery(
        client,
        `insert into appointment (
           id, salon_id, salon_client_id, client_phone, client_name,
           start_time, end_time, status, total_price, total_duration_minutes
         )
         values (
           $1, $2, $3, '0000000000', 'Lifecycle rehearsal fixture',
           '2030-01-01T15:00:00Z', '2030-01-01T16:00:00Z',
           'completed', 100, 60
         )`,
        [appointmentId, salonId, clientId],
      ));
      paymentDurations.push(await timedQuery(
        client,
        `insert into appointment_payment (
           id, appointment_id, salon_id, amount_cents, method,
           recorded_by_type
         )
         values ($1, $2, $3, 100, 'cash', 'system')`,
        [paymentId, appointmentId, salonId],
      ));
    }

    await client.query('rollback');
    transactionOpen = false;
    const appointmentWriteMilliseconds = median(appointmentDurations);
    return {
      appointmentWriteMilliseconds: roundedMilliseconds(
        appointmentWriteMilliseconds,
      ),
      paymentWriteMilliseconds: roundedMilliseconds(median(paymentDurations)),
      triggerOverheadMilliseconds: roundedMilliseconds(
        appointmentWriteMilliseconds - median(baselineDurations),
      ),
    };
  } finally {
    if (transactionOpen) {
      await client.query('rollback').catch(() => undefined);
    }
    await client.end().catch(() => undefined);
  }
}

function writeJson(value: unknown, error = false): void {
  const serialized = `${JSON.stringify(value)}\n`;
  if (error) {
    process.stderr.write(serialized);
  } else {
    process.stdout.write(serialized);
  }
}

function isLoopbackHost(hostname: string): boolean {
  return hostname === 'localhost'
    || hostname === '127.0.0.1'
    || hostname === '::1'
    || hostname === '[::1]';
}

function validateRehearsalConfiguration(): string | null {
  const databaseUrl = process.env.DATABASE_URL;
  const expectedHost = process.env.CLIENT_LIFECYCLE_REHEARSAL_EXPECTED_HOST;
  if (
    process.env.CLIENT_LIFECYCLE_REHEARSAL_CONFIRMED !== 'true'
    || process.env.CLIENT_LIFECYCLE_DISPOSABLE_DATABASE_CONFIRMED !== 'true'
    || !databaseUrl
    || !expectedHost
  ) {
    return null;
  }

  try {
    const parsed = new URL(databaseUrl);
    if (
      !['postgres:', 'postgresql:'].includes(parsed.protocol)
      || parsed.hostname.toLowerCase() !== expectedHost.toLowerCase()
    ) {
      return null;
    }
    if (!isLoopbackHost(parsed.hostname)) {
      const sslMode = parsed.searchParams.get('sslmode');
      if (!['require', 'verify-ca', 'verify-full'].includes(sslMode ?? '')) {
        return null;
      }
    }
  } catch {
    return null;
  }

  return databaseUrl;
}

async function main(): Promise<void> {
  let stage: RehearsalStage = 'configuration';
  const databaseUrl = validateRehearsalConfiguration();
  if (!databaseUrl) {
    writeJson({ status: 'failed', stage }, true);
    process.exitCode = 1;
    return;
  }

  const preflightClient = new Client({
    connectionString: databaseUrl,
    application_name: 'client-lifecycle-rehearsal-preflight',
    connectionTimeoutMillis: 15_000,
  });
  try {
    stage = 'preflight';
    await preflightClient.connect();
    const preflight = await collectPreflight(preflightClient);
    await preflightClient.end();
    if (preflight.rowsPreventing0062 > 0) {
      writeJson({
        status: 'blocked',
        stage,
        preflight,
      });
      process.exitCode = 1;
      return;
    }

    stage = 'migration';
    const migrationWithBarrier = await runMigrationWithBarrier(databaseUrl);

    stage = 'readiness';
    const readiness = parseReadinessResult(await runTsxScript(
      databaseUrl,
      'scripts/verify-client-lifecycle-schema.ts',
    ));

    stage = 'measurements';
    const syntheticMeasurements = await collectSyntheticMeasurements(
      databaseUrl,
    );

    stage = 'no_op';
    const noOp = parseMigrationResult(await runTsxScript(
      databaseUrl,
      'scripts/migrate-client-lifecycle.ts',
    ));

    const measurements: MeasurementResult = {
      inducedCoordinationWaitMilliseconds:
        migrationWithBarrier.inducedCoordinationWaitMilliseconds,
      transactionAdvisoryLockHoldMilliseconds:
        migrationWithBarrier.transactionAdvisoryLockHoldMilliseconds,
      postBarrierMigrationCompletionMilliseconds:
        migrationWithBarrier.postBarrierMigrationCompletionMilliseconds,
      lockObservation: migrationWithBarrier.lockObservation,
      writesAfterBarrierRelease:
        migrationWithBarrier.writesAfterBarrierRelease,
      post0062: {
        appointmentWriteMilliseconds:
          syntheticMeasurements.appointmentWriteMilliseconds,
        paymentWriteMilliseconds:
          syntheticMeasurements.paymentWriteMilliseconds,
        terminalResolutionTriggerOverheadMilliseconds:
          syntheticMeasurements.triggerOverheadMilliseconds,
      },
    };
    writeJson({
      status: 'ok',
      preflight,
      migration: migrationWithBarrier.migration,
      readiness,
      noOp,
      measurements,
    });
  } catch {
    writeJson({ status: 'failed', stage }, true);
    process.exitCode = 1;
  } finally {
    await preflightClient.end().catch(() => undefined);
  }
}

void main();
