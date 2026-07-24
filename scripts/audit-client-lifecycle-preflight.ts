import pg from 'pg';

type CountResult = {
  count: string | number;
};

type TableSizeResult = {
  table_name: string;
  estimated_rows: string | number;
  total_bytes: string | number;
};

const { Client } = pg;
const databaseUrl = process.env.DATABASE_URL;

if (!databaseUrl) {
  throw new Error('DATABASE_URL is required for the read-only lifecycle preflight.');
}

const client = new Client({
  connectionString: databaseUrl,
  application_name: 'client-lifecycle-read-only-preflight',
  statement_timeout: 60_000,
  query_timeout: 75_000,
});

async function count(query: string): Promise<number> {
  const result = await client.query<CountResult>(query);
  return Number(result.rows[0]?.count ?? 0);
}

async function tableExists(tableName: string): Promise<boolean> {
  const result = await client.query<{ exists: boolean }>(
    `select exists (
       select 1
       from information_schema.tables
       where table_schema = 'public'
         and table_name = $1
     ) as exists`,
    [tableName],
  );
  return result.rows[0]?.exists === true;
}

async function columnExists(
  tableName: string,
  columnName: string,
): Promise<boolean> {
  const result = await client.query<{ exists: boolean }>(
    `select exists (
       select 1
       from information_schema.columns
       where table_schema = 'public'
         and table_name = $1
         and column_name = $2
     ) as exists`,
    [tableName, columnName],
  );
  return result.rows[0]?.exists === true;
}

const directClientReferenceTables = [
  'appointment',
  'review',
  'client_communication',
  'retention_campaign',
  'fraud_signal',
  'salon_client_note',
  'salon_client_contact_alias',
] as const;

const measuredTables = [
  'salon_client',
  'appointment',
  'appointment_payment',
  'review',
  'client_communication',
  'retention_campaign',
  'fraud_signal',
] as const;

async function main(): Promise<void> {
  await client.connect();

  try {
    await client.query('begin read only');
    const readOnly = await client.query<{ transaction_read_only: string }>(
      'show transaction_read_only',
    );
    if (readOnly.rows[0]?.transaction_read_only !== 'on') {
      throw new Error('Production preflight refused a writable transaction.');
    }

    const metrics: Record<string, number> = {};
    const phoneCanonicalSql = `
    case
      when length(regexp_replace(coalesce(phone, ''), '[^0-9]', '', 'g')) = 10
        then regexp_replace(phone, '[^0-9]', '', 'g')
      when length(regexp_replace(coalesce(phone, ''), '[^0-9]', '', 'g')) = 11
        and left(regexp_replace(phone, '[^0-9]', '', 'g'), 1) = '1'
        then right(regexp_replace(phone, '[^0-9]', '', 'g'), 10)
      else null
    end
  `;

    metrics.invalid_client_phone_values = await count(`
    select count(*)::bigint as count
    from salon_client
    where (${phoneCanonicalSql}) is null
  `);
    metrics.non_normalized_client_phone_values = await count(`
    select count(*)::bigint as count
    from salon_client
    where (${phoneCanonicalSql}) is not null
      and phone <> (${phoneCanonicalSql})
  `);
    metrics.same_salon_normalized_phone_conflict_groups = await count(`
    select count(*)::bigint as count
    from (
      select salon_id, (${phoneCanonicalSql}) as canonical_phone
      from salon_client
      where (${phoneCanonicalSql}) is not null
      group by salon_id, (${phoneCanonicalSql})
      having count(*) > 1
    ) conflicts
  `);
    metrics.same_salon_exact_phone_conflict_groups = await count(`
    select count(*)::bigint as count
    from (
      select salon_id, phone
      from salon_client
      group by salon_id, phone
      having count(*) > 1
    ) conflicts
  `);
    metrics.same_salon_normalized_email_conflict_groups = await count(`
    select count(*)::bigint as count
    from (
      select salon_id, lower(btrim(email)) as canonical_email
      from salon_client
      where nullif(btrim(email), '') is not null
      group by salon_id, lower(btrim(email))
      having count(*) > 1
    ) conflicts
  `);

    const hasArchivedAt = await columnExists('salon_client', 'archived_at');
    const hasMergedInto = await columnExists(
      'salon_client',
      'merged_into_client_id',
    );
    metrics.archived_state_rows = hasArchivedAt
      ? await count(`
        select count(*)::bigint as count
        from salon_client
        where archived_at is not null
      `)
      : 0;
    metrics.merged_state_rows = hasMergedInto
      ? await count(`
        select count(*)::bigint as count
        from salon_client
        where merged_into_client_id is not null
      `)
      : 0;

    for (const tableName of directClientReferenceTables) {
      if (!await tableExists(tableName)) {
        metrics[`${tableName}_orphaned_client_references`] = 0;
        metrics[`${tableName}_cross_salon_client_references`] = 0;
        continue;
      }

      metrics[`${tableName}_orphaned_client_references`] = await count(`
      select count(*)::bigint as count
      from ${tableName} record
      left join salon_client client on client.id = record.salon_client_id
      where record.salon_client_id is not null
        and client.id is null
    `);
      metrics[`${tableName}_cross_salon_client_references`] = await count(`
      select count(*)::bigint as count
      from ${tableName} record
      inner join salon_client client on client.id = record.salon_client_id
      where record.salon_id <> client.salon_id
    `);
    }

    metrics.direct_external_client_id_links = await count(`
    select count(*)::bigint as count
    from salon_client
    where client_id is not null
  `);
    metrics.customer_account_phone_links = await count(`
    with salon_phones as (
      select distinct (${phoneCanonicalSql}) as phone
      from salon_client
      where (${phoneCanonicalSql}) is not null
    ),
    customer_phones as (
      select distinct
        case
          when length(regexp_replace(coalesce(phone, ''), '[^0-9]', '', 'g')) = 10
            then regexp_replace(phone, '[^0-9]', '', 'g')
          when length(regexp_replace(coalesce(phone, ''), '[^0-9]', '', 'g')) = 11
            and left(regexp_replace(phone, '[^0-9]', '', 'g'), 1) = '1'
            then right(regexp_replace(phone, '[^0-9]', '', 'g'), 10)
          else null
        end as phone
      from client
    )
    select count(*)::bigint as count
    from salon_phones
    inner join customer_phones using (phone)
    where phone is not null
  `);
    metrics.customer_session_phone_links = await count(`
    with salon_phones as (
      select distinct (${phoneCanonicalSql}) as phone
      from salon_client
      where (${phoneCanonicalSql}) is not null
    ),
    session_phones as (
      select distinct
        case
          when length(regexp_replace(coalesce(client_phone, ''), '[^0-9]', '', 'g')) = 10
            then regexp_replace(client_phone, '[^0-9]', '', 'g')
          when length(regexp_replace(coalesce(client_phone, ''), '[^0-9]', '', 'g')) = 11
            and left(regexp_replace(client_phone, '[^0-9]', '', 'g'), 1) = '1'
            then right(regexp_replace(client_phone, '[^0-9]', '', 'g'), 10)
          else null
        end as phone
      from client_session
    )
    select count(*)::bigint as count
    from salon_phones
    inner join session_phones using (phone)
    where phone is not null
  `);
    metrics.customer_preference_phone_links = await count(`
    with salon_phones as (
      select distinct salon_id, (${phoneCanonicalSql}) as phone
      from salon_client
      where (${phoneCanonicalSql}) is not null
    )
    select count(*)::bigint as count
    from salon_phones
    inner join client_preferences preference
      on preference.salon_id = salon_phones.salon_id
     and preference.normalized_client_phone = salon_phones.phone
  `);

    const aliasTableExists = await tableExists('salon_client_contact_alias');
    metrics.existing_contact_alias_uniqueness_conflict_groups = aliasTableExists
      ? await count(`
        select count(*)::bigint as count
        from (
          select salon_id, kind, normalized_value
          from salon_client_contact_alias
          group by salon_id, kind, normalized_value
          having count(*) > 1
        ) conflicts
      `)
      : 0;
    metrics.contact_alias_candidate_conflict_groups
    = metrics.same_salon_normalized_phone_conflict_groups
    + metrics.same_salon_normalized_email_conflict_groups;

    const invalidMergeTargets = hasMergedInto
      ? await count(`
        select count(*)::bigint as count
        from salon_client source
        left join salon_client target
          on target.salon_id = source.salon_id
         and target.id = source.merged_into_client_id
        where source.merged_into_client_id is not null
          and target.id is null
      `)
      : 0;

    const objectCollisions = await count(`
    select (
      (select count(*) from information_schema.tables
       where table_schema = 'public'
         and table_name in ('salon_client_contact_alias', 'salon_client_note'))
      +
      (select count(*) from pg_trigger
       where not tgisinternal
         and tgname in (
           'salon_client_prevent_merged_source_update',
           'salon_client_enforce_merge_transition',
           'appointment_resolve_merged_client',
           'review_resolve_merged_client',
           'client_communication_resolve_merged_client',
           'retention_campaign_resolve_merged_client',
           'fraud_signal_resolve_merged_client',
           'salon_client_note_resolve_merged_client',
           'salon_client_alias_resolve_merged_client'
         ))
      +
      (select count(*) from pg_indexes
       where schemaname = 'public'
         and indexname in (
           'salon_client_salon_id_id_idx',
           'salon_client_lifecycle_idx',
           'salon_client_merged_into_idx',
           'salon_client_contact_alias_unique',
           'salon_client_contact_alias_client_idx',
           'salon_client_note_client_created_idx',
           'salon_client_note_source_idx'
         ))
      +
      (select count(*) from pg_constraint
       where conname = 'salon_client_merged_into_client_id_fkey')
    )::bigint as count
  `);
    metrics.preexisting_0061_object_collisions = objectCollisions;
    metrics.records_that_would_make_0061_fail
    = metrics.existing_contact_alias_uniqueness_conflict_groups
    + invalidMergeTargets
    + objectCollisions;

    const sizeResult = await client.query<TableSizeResult>(`
    select
      relname as table_name,
      greatest(coalesce(n_live_tup, 0), 0)::bigint as estimated_rows,
      pg_total_relation_size(relid)::bigint as total_bytes
    from pg_stat_user_tables
    where schemaname = 'public'
      and relname = any($1::text[])
    order by relname
  `, [measuredTables]);

    // Aggregate-only stdout is the intended artifact of this read-only audit.
    // eslint-disable-next-line no-console
    console.log(JSON.stringify({
      readOnly: true,
      metrics,
      tableSizes: sizeResult.rows.map(row => ({
        table: row.table_name,
        estimatedRows: Number(row.estimated_rows),
        totalBytes: Number(row.total_bytes),
      })),
    }, null, 2));

    await client.query('rollback');
  } catch (error) {
    await client.query('rollback').catch(() => undefined);
    throw error;
  } finally {
    await client.end();
  }
}

void main().catch((error: unknown) => {
  console.error(
    error instanceof Error ? error.message : 'Lifecycle preflight failed.',
  );
  process.exitCode = 1;
});
