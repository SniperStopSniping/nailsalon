import { type SQL, sql } from 'drizzle-orm';

const CLIENT_LIFECYCLE_MAX_CHAIN_DEPTH = 16;

export type LifecycleReadinessSqlHandle = {
  execute: (query: SQL) => Promise<unknown>;
};

export const CLIENT_LIFECYCLE_MIGRATION_CREATED_AT = 1784950000007;
export const CLIENT_LIFECYCLE_MIGRATION_SHA256
  = 'da07fadc9bcbc173f848495e82a97b5b43b1aa9d994dba06629b01b748e40ec9';
export const CLIENT_LIFECYCLE_CAPABILITY_VERSION = 2;

export type ClientLifecycleReadinessCategory =
  | 'migration'
  | 'capability'
  | 'columns'
  | 'tables'
  | 'indexes'
  | 'constraint'
  | 'functions'
  | 'triggers'
  | 'behavior';

export type ClientLifecycleSchemaReadiness = {
  ready: boolean;
  categories: Record<ClientLifecycleReadinessCategory, boolean>;
};

function readRows(result: unknown): Record<string, unknown>[] {
  const resultWithRows = result as { rows?: Record<string, unknown>[] };
  if (Array.isArray(resultWithRows?.rows)) {
    return resultWithRows.rows;
  }
  return Array.isArray(result) ? result as Record<string, unknown>[] : [];
}

async function booleanQuery(
  handle: LifecycleReadinessSqlHandle,
  query: SQL,
): Promise<boolean> {
  try {
    const result = await handle.execute(query);
    return readRows(result)[0]?.ok === true;
  } catch {
    return false;
  }
}

/**
 * Cheap hosted-health probe. The private deployment verifier performs the
 * complete catalog and bounded-behavior proof below; public health only needs
 * the atomic migration journal/capability handshake.
 */
export async function isClientLifecycleCapabilityReady(
  handle: LifecycleReadinessSqlHandle,
): Promise<boolean> {
  return booleanQuery(handle, sql`
    select (
      to_regclass('drizzle.__drizzle_migrations') is not null
      and to_regclass('public.app_schema_capability') is not null
      and (
        select count(*)
        from drizzle.__drizzle_migrations
        where created_at = ${CLIENT_LIFECYCLE_MIGRATION_CREATED_AT}
      ) = 1
      and (
        select count(*)
        from drizzle.__drizzle_migrations
        where created_at = ${CLIENT_LIFECYCLE_MIGRATION_CREATED_AT}
          and hash = ${CLIENT_LIFECYCLE_MIGRATION_SHA256}
      ) = 1
      and (
        select count(*)
        from app_schema_capability
        where capability = 'client_lifecycle'
          and version = ${CLIENT_LIFECYCLE_CAPABILITY_VERSION}
          and state = 'ready'
          and merge_writes_enabled = false
      ) = 1
    ) as ok
  `);
}

export async function getClientLifecycleSchemaReadiness(
  handle: LifecycleReadinessSqlHandle,
): Promise<ClientLifecycleSchemaReadiness> {
  const entries = await Promise.all([
    booleanQuery(handle, sql`
      select (
        to_regclass('drizzle.__drizzle_migrations') is not null
        and (
          select count(*)
          from drizzle.__drizzle_migrations
          where created_at = ${CLIENT_LIFECYCLE_MIGRATION_CREATED_AT}
        ) = 1
        and (
          select count(*)
          from drizzle.__drizzle_migrations
          where created_at = ${CLIENT_LIFECYCLE_MIGRATION_CREATED_AT}
            and hash = ${CLIENT_LIFECYCLE_MIGRATION_SHA256}
        ) = 1
      ) as ok
    `),
    booleanQuery(handle, sql`
      select (
        to_regclass('public.app_schema_capability') is not null
        and (
          select count(*)
          from app_schema_capability
          where capability = 'client_lifecycle'
            and version = ${CLIENT_LIFECYCLE_CAPABILITY_VERSION}
            and state = 'ready'
            and merge_writes_enabled = false
        ) = 1
        and (
          select count(*)
          from pg_constraint as constraints
          inner join pg_class as relations
            on relations.oid = constraints.conrelid
          inner join pg_namespace as namespaces
            on namespaces.oid = relations.relnamespace
          where namespaces.nspname = 'public'
            and relations.relname = 'app_schema_capability'
            and constraints.convalidated
            and constraints.conname in (
              'app_schema_capability_pkey',
              'app_schema_capability_state_valid',
              'app_schema_capability_version_positive',
              'app_schema_capability_merge_writes_disabled'
            )
        ) = 4
      ) as ok
    `),
    booleanQuery(handle, sql`
      with expected(
        table_name,
        column_name,
        formatted_type,
        not_null,
        has_default
      ) as (
        values
          ('salon_client', 'birthday', 'date', false, false),
          ('salon_client', 'archived_at', 'timestamp with time zone', false, false),
          ('salon_client', 'archived_by', 'text', false, false),
          ('salon_client', 'merged_into_client_id', 'text', false, false),
          ('salon_client', 'merged_at', 'timestamp with time zone', false, false),
          ('salon_client', 'merged_by', 'text', false, false),
          ('client_communication', 'destination_snapshot', 'text', false, false),
          ('salon_client_contact_alias', 'salon_id', 'text', true, false),
          ('salon_client_contact_alias', 'salon_client_id', 'text', true, false),
          ('salon_client_contact_alias', 'kind', 'text', true, false),
          ('salon_client_contact_alias', 'normalized_value', 'text', true, false),
          ('salon_client_contact_alias', 'created_at', 'timestamp with time zone', true, true),
          ('salon_client_note', 'id', 'text', true, false),
          ('salon_client_note', 'salon_id', 'text', true, false),
          ('salon_client_note', 'salon_client_id', 'text', true, false),
          ('salon_client_note', 'source_client_id', 'text', false, false),
          ('salon_client_note', 'body', 'text', true, false),
          ('salon_client_note', 'created_by', 'text', true, false),
          ('salon_client_note', 'created_at', 'timestamp with time zone', true, true),
          ('app_schema_capability', 'capability', 'text', true, false),
          ('app_schema_capability', 'version', 'integer', true, false),
          ('app_schema_capability', 'state', 'text', true, false),
          ('app_schema_capability', 'merge_writes_enabled', 'boolean', true, true),
          ('app_schema_capability', 'installed_at', 'timestamp with time zone', true, true)
      )
      select count(*) = 24 as ok
      from expected
      inner join pg_namespace as namespaces
        on namespaces.nspname = 'public'
      inner join pg_class as relations
        on relations.relnamespace = namespaces.oid
       and relations.relname = expected.table_name
       and relations.relkind in ('r', 'p')
      inner join pg_attribute as attributes
        on attributes.attrelid = relations.oid
       and attributes.attname = expected.column_name
       and attributes.attnum > 0
       and not attributes.attisdropped
      left join pg_attrdef as defaults
        on defaults.adrelid = attributes.attrelid
       and defaults.adnum = attributes.attnum
      where format_type(attributes.atttypid, attributes.atttypmod)
          = expected.formatted_type
        and attributes.attnotnull = expected.not_null
        and (defaults.oid is not null) = expected.has_default
    `),
    booleanQuery(handle, sql`
      select count(*) = 3 as ok
      from information_schema.tables
      where table_schema = 'public'
        and table_name in (
          'salon_client_contact_alias',
          'salon_client_note',
          'app_schema_capability'
        )
    `),
    booleanQuery(handle, sql`
      with expected(
        index_name,
        relation_name,
        access_method,
        is_unique,
        column_names
      ) as (
        values
          (
            'salon_client_salon_id_id_idx',
            'salon_client',
            'btree',
            true,
            array['salon_id', 'id']::text[]
          ),
          (
            'salon_client_lifecycle_idx',
            'salon_client',
            'btree',
            false,
            array['salon_id', 'archived_at', 'merged_into_client_id']::text[]
          ),
          (
            'salon_client_merged_into_idx',
            'salon_client',
            'btree',
            false,
            array['salon_id', 'merged_into_client_id']::text[]
          ),
          (
            'salon_client_contact_alias_unique',
            'salon_client_contact_alias',
            'btree',
            true,
            array['salon_id', 'kind', 'normalized_value']::text[]
          ),
          (
            'salon_client_contact_alias_client_idx',
            'salon_client_contact_alias',
            'btree',
            false,
            array['salon_id', 'salon_client_id']::text[]
          ),
          (
            'salon_client_note_client_created_idx',
            'salon_client_note',
            'btree',
            false,
            array['salon_id', 'salon_client_id', 'created_at']::text[]
          ),
          (
            'salon_client_note_source_idx',
            'salon_client_note',
            'btree',
            false,
            array['salon_id', 'source_client_id']::text[]
          )
      ),
      actual as (
        select
          index_classes.relname as index_name,
          indexed_relations.relname as relation_name,
          access_methods.amname as access_method,
          indexes.indisunique as is_unique,
          indexes.indisvalid,
          indexes.indisready,
          indexes.indpred is null as has_no_predicate,
          indexes.indexprs is null as has_no_expressions,
          indexes.indnatts = indexes.indnkeyatts
            as has_no_included_columns,
          indexes.indnkeyatts,
          array_agg(attributes.attname::text order by keys.ordinality)
            filter (where keys.ordinality <= indexes.indnkeyatts)
            as column_names
        from pg_class as index_classes
        inner join pg_index as indexes
          on indexes.indexrelid = index_classes.oid
        inner join pg_namespace as index_namespaces
          on index_namespaces.oid = index_classes.relnamespace
        inner join pg_class as indexed_relations
          on indexed_relations.oid = indexes.indrelid
         and indexed_relations.relkind in ('r', 'p')
        inner join pg_namespace as indexed_namespaces
          on indexed_namespaces.oid = indexed_relations.relnamespace
        inner join pg_am as access_methods
          on access_methods.oid = index_classes.relam
        cross join lateral unnest(indexes.indkey)
          with ordinality as keys(attribute_number, ordinality)
        inner join pg_attribute as attributes
          on attributes.attrelid = indexes.indrelid
         and attributes.attnum = keys.attribute_number
        where index_namespaces.nspname = 'public'
          and indexed_namespaces.nspname = 'public'
          and index_classes.relkind = 'i'
          and index_classes.relname in (
            'salon_client_salon_id_id_idx',
            'salon_client_lifecycle_idx',
            'salon_client_merged_into_idx',
            'salon_client_contact_alias_unique',
            'salon_client_contact_alias_client_idx',
            'salon_client_note_client_created_idx',
            'salon_client_note_source_idx'
          )
        group by
          index_classes.relname,
          indexed_relations.relname,
          access_methods.amname,
          indexes.indisunique,
          indexes.indisvalid,
          indexes.indisready,
          (indexes.indpred is null),
          (indexes.indexprs is null),
          indexes.indnatts,
          indexes.indnkeyatts
      )
      select (
        count(*) = 7
        and bool_and(actual.indisvalid)
        and bool_and(actual.indisready)
        and bool_and(actual.access_method = expected.access_method)
        and bool_and(actual.is_unique = expected.is_unique)
        and bool_and(actual.has_no_predicate)
        and bool_and(actual.has_no_expressions)
        and bool_and(actual.has_no_included_columns)
        and bool_and(
          actual.indnkeyatts = cardinality(expected.column_names)
        )
        and bool_and(actual.column_names = expected.column_names)
      ) as ok
      from expected
      inner join actual
        on actual.index_name = expected.index_name
       and actual.relation_name = expected.relation_name
    `),
    booleanQuery(handle, sql`
      select count(*) = 1 as ok
      from pg_constraint as constraints
      inner join pg_class as source_relation
        on source_relation.oid = constraints.conrelid
      inner join pg_namespace as source_namespace
        on source_namespace.oid = source_relation.relnamespace
      inner join pg_class as target_relation
        on target_relation.oid = constraints.confrelid
      inner join pg_namespace as target_namespace
        on target_namespace.oid = target_relation.relnamespace
      where source_namespace.nspname = 'public'
        and target_namespace.nspname = 'public'
        and source_relation.relname = 'salon_client'
        and target_relation.relname = 'salon_client'
        and constraints.conname = 'salon_client_merged_into_client_id_fkey'
        and constraints.contype = 'f'
        and constraints.convalidated
        and constraints.confdeltype = 'r'
        and array(
          select attributes.attname::text
          from unnest(constraints.conkey)
            with ordinality as keys(attribute_number, ordinality)
          inner join pg_attribute as attributes
            on attributes.attrelid = constraints.conrelid
           and attributes.attnum = keys.attribute_number
          order by keys.ordinality
        ) = array['salon_id', 'merged_into_client_id']::text[]
        and array(
          select attributes.attname::text
          from unnest(constraints.confkey)
            with ordinality as keys(attribute_number, ordinality)
          inner join pg_attribute as attributes
            on attributes.attrelid = constraints.confrelid
           and attributes.attnum = keys.attribute_number
          order by keys.ordinality
        ) = array['salon_id', 'id']::text[]
    `),
    booleanQuery(handle, sql`
      select count(*) = 3 as ok
      from pg_proc as functions
      inner join pg_namespace as namespaces
        on namespaces.oid = functions.pronamespace
      inner join pg_language as languages
        on languages.oid = functions.prolang
      where namespaces.nspname = 'public'
        and functions.proname in (
          'enforce_salon_client_merge_transition',
          'prevent_merged_salon_client_mutation',
          'resolve_merged_salon_client_reference'
        )
        and functions.pronargs = 0
        and functions.prorettype = 'trigger'::regtype
        and languages.lanname = 'plpgsql'
    `),
    booleanQuery(handle, sql`
      with expected(
        trigger_name,
        relation_name,
        function_signature,
        trigger_type,
        update_columns
      ) as (
        values
          (
            'salon_client_enforce_merge_transition',
            'salon_client',
            'public.enforce_salon_client_merge_transition()',
            23,
            array['merged_into_client_id', 'salon_id']::text[]
          ),
          (
            'salon_client_prevent_merged_source_update',
            'salon_client',
            'public.prevent_merged_salon_client_mutation()',
            19,
            array[]::text[]
          ),
          (
            'appointment_resolve_merged_client',
            'appointment',
            'public.resolve_merged_salon_client_reference()',
            23,
            array['salon_client_id', 'salon_id']::text[]
          ),
          (
            'review_resolve_merged_client',
            'review',
            'public.resolve_merged_salon_client_reference()',
            23,
            array['salon_client_id', 'salon_id']::text[]
          ),
          (
            'client_communication_resolve_merged_client',
            'client_communication',
            'public.resolve_merged_salon_client_reference()',
            23,
            array['salon_client_id', 'salon_id']::text[]
          ),
          (
            'retention_campaign_resolve_merged_client',
            'retention_campaign',
            'public.resolve_merged_salon_client_reference()',
            23,
            array['salon_client_id', 'salon_id']::text[]
          ),
          (
            'fraud_signal_resolve_merged_client',
            'fraud_signal',
            'public.resolve_merged_salon_client_reference()',
            23,
            array['salon_client_id', 'salon_id']::text[]
          ),
          (
            'salon_client_note_resolve_merged_client',
            'salon_client_note',
            'public.resolve_merged_salon_client_reference()',
            23,
            array['salon_client_id', 'salon_id']::text[]
          ),
          (
            'salon_client_alias_resolve_merged_client',
            'salon_client_contact_alias',
            'public.resolve_merged_salon_client_reference()',
            23,
            array['salon_client_id', 'salon_id']::text[]
          )
      )
      select count(*) = 9 as ok
      from expected
      inner join pg_trigger as triggers
        on triggers.tgname = expected.trigger_name
       and not triggers.tgisinternal
       and triggers.tgenabled = 'O'
       and triggers.tgtype = expected.trigger_type
       and triggers.tgqual is null
       and array(
         select attributes.attname::text
         from unnest(triggers.tgattr)
           as keys(attribute_number)
         inner join pg_attribute as attributes
           on attributes.attrelid = triggers.tgrelid
          and attributes.attnum = keys.attribute_number
         order by attributes.attname
       ) = expected.update_columns
      inner join pg_class as relations
        on relations.oid = triggers.tgrelid
       and relations.relname = expected.relation_name
      inner join pg_namespace as namespaces
        on namespaces.oid = relations.relnamespace
       and namespaces.nspname = 'public'
      inner join pg_proc as functions
        on functions.oid = triggers.tgfoid
       and functions.oid = to_regprocedure(expected.function_signature)
    `),
    booleanQuery(handle, sql`
      with recursive chain as (
        select
          source.id as source_id,
          source.salon_id,
          source.id as current_id,
          source.merged_into_client_id as next_id,
          source.archived_at,
          array[source.id]::text[] as path,
          0 as depth
        from salon_client as source
        where source.merged_into_client_id is not null

        union all

        select
          chain.source_id,
          chain.salon_id,
          target.id,
          target.merged_into_client_id,
          target.archived_at,
          chain.path || target.id,
          chain.depth + 1
        from chain
        inner join salon_client as target
          on target.salon_id = chain.salon_id
         and target.id = chain.next_id
        where chain.next_id is not null
          and chain.depth < ${CLIENT_LIFECYCLE_MAX_CHAIN_DEPTH - 1}
          and not target.id = any(chain.path)
      ),
      sources as (
        select id, salon_id, archived_at
        from salon_client
        where merged_into_client_id is not null
      )
      select not exists (
        select 1
        from sources
        where sources.archived_at is null
          or not exists (
            select 1
            from chain
            where chain.source_id = sources.id
              and chain.salon_id = sources.salon_id
              and chain.next_id is null
              and chain.archived_at is null
          )
          or exists (
            select 1
            from chain
            inner join salon_client as target
              on target.salon_id = chain.salon_id
             and target.id = chain.next_id
            where chain.source_id = sources.id
              and target.id = any(chain.path)
          )
          or exists (
            select 1
            from chain
            where chain.source_id = sources.id
              and chain.depth = ${CLIENT_LIFECYCLE_MAX_CHAIN_DEPTH - 1}
              and chain.next_id is not null
          )
      ) as ok
    `),
  ]);

  const categoryNames: ClientLifecycleReadinessCategory[] = [
    'migration',
    'capability',
    'columns',
    'tables',
    'indexes',
    'constraint',
    'functions',
    'triggers',
    'behavior',
  ];
  const categories = Object.fromEntries(
    categoryNames.map((name, index) => [name, entries[index] === true]),
  ) as Record<ClientLifecycleReadinessCategory, boolean>;

  return {
    ready: Object.values(categories).every(Boolean),
    categories,
  };
}

export async function isClientLifecycleSchemaReady(
  handle: LifecycleReadinessSqlHandle,
): Promise<boolean> {
  const readiness = await getClientLifecycleSchemaReadiness(handle);
  return readiness.ready;
}
