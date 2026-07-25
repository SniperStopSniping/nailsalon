SET LOCAL lock_timeout = '2s';
--> statement-breakpoint
SET LOCAL statement_timeout = '30s';
--> statement-breakpoint

-- Drizzle owns this migration's transaction. A transaction-scoped lock is
-- safe through Neon/PgBouncer transaction pooling and is released on either
-- commit or rollback. The local lock timeout makes contention retryable by
-- the protected migration wrapper without relying on session affinity.
SELECT pg_advisory_xact_lock(
  hashtextextended('client-lifecycle-stabilization-migration', 0)
);
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "app_schema_capability" (
  "capability" text PRIMARY KEY NOT NULL,
  "version" integer NOT NULL,
  "state" text NOT NULL,
  "merge_writes_enabled" boolean DEFAULT false NOT NULL,
  "installed_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "app_schema_capability_state_valid"
    CHECK ("state" = 'ready'),
  CONSTRAINT "app_schema_capability_version_positive"
    CHECK ("version" > 0),
  CONSTRAINT "app_schema_capability_merge_writes_disabled"
    CHECK ("merge_writes_enabled" = false)
);
--> statement-breakpoint

-- Existing application versions legitimately update operational fields on
-- merged-source tombstones. Preserve those writes while protecting the
-- lifecycle identity that makes the tombstone resolve to its terminal client.
CREATE OR REPLACE FUNCTION "prevent_merged_salon_client_mutation"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF OLD.merged_into_client_id IS NOT NULL
    AND (
      NEW.id IS DISTINCT FROM OLD.id
      OR NEW.salon_id IS DISTINCT FROM OLD.salon_id
      OR NEW.archived_at IS DISTINCT FROM OLD.archived_at
      OR NEW.archived_by IS DISTINCT FROM OLD.archived_by
      OR NEW.merged_into_client_id IS DISTINCT FROM OLD.merged_into_client_id
      OR NEW.merged_at IS DISTINCT FROM OLD.merged_at
      OR NEW.merged_by IS DISTINCT FROM OLD.merged_by
    )
  THEN
    RAISE EXCEPTION 'merged salon client lifecycle identity is immutable'
      USING ERRCODE = '55000';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint

-- Merge creation remains disabled until the redesigned merge release. Keep
-- same-salon, active-target, bounded-chain, and cycle checks ready for that
-- future controlled writer without taking salon or client row locks here.
CREATE OR REPLACE FUNCTION "enforce_salon_client_merge_transition"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  current_id text;
  next_id text;
  current_archived_at timestamp with time zone;
  visited text[] := ARRAY[]::text[];
  chain_depth integer;
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF NEW.salon_id IS DISTINCT FROM OLD.salon_id THEN
      RAISE EXCEPTION 'client lifecycle tenant identity is immutable'
        USING ERRCODE = '55000';
    END IF;

    IF NEW.merged_into_client_id IS NOT DISTINCT FROM OLD.merged_into_client_id
    THEN
      RETURN NEW;
    END IF;
  END IF;

  IF NEW.merged_into_client_id IS NULL THEN
    IF TG_OP = 'INSERT' THEN
      RETURN NEW;
    END IF;
    RAISE EXCEPTION 'client merge creation is disabled'
      USING ERRCODE = '55000';
  END IF;

  current_id := NEW.merged_into_client_id;
  FOR chain_depth IN 0..15 LOOP
    IF current_id = NEW.id OR current_id = ANY(visited) THEN
      RAISE EXCEPTION 'cyclic same-salon client merge'
        USING ERRCODE = '23514';
    END IF;
    visited := array_append(visited, current_id);

    next_id := NULL;
    current_archived_at := NULL;
    SELECT client.merged_into_client_id, client.archived_at
    INTO next_id, current_archived_at
    FROM salon_client AS client
    WHERE client.salon_id = NEW.salon_id
      AND client.id = current_id;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'missing or foreign-salon client merge target'
        USING ERRCODE = '23514';
    END IF;
    IF next_id IS NULL THEN
      IF current_archived_at IS NOT NULL THEN
        RAISE EXCEPTION 'client merge target must be active'
          USING ERRCODE = '23514';
      END IF;
      RAISE EXCEPTION 'client merge creation is disabled'
        USING ERRCODE = '55000';
    END IF;
    current_id := next_id;
  END LOOP;

  RAISE EXCEPTION 'client merge chain exceeds safe depth'
    USING ERRCODE = '23514';
END;
$$;
--> statement-breakpoint

-- Resolve stale stable references without acquiring explicit row locks. Merge
-- creation is disabled during stabilization, so the existing chain is stable;
-- lifecycle-aware application writes use the canonical client-first lock
-- order before mutating dependent rows.
CREATE OR REPLACE FUNCTION "resolve_merged_salon_client_reference"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  current_id text;
  next_id text;
  visited text[] := ARRAY[]::text[];
  chain_depth integer;
BEGIN
  IF NEW.salon_client_id IS NULL THEN
    RETURN NEW;
  END IF;

  current_id := NEW.salon_client_id;
  FOR chain_depth IN 0..15 LOOP
    IF current_id = ANY(visited) THEN
      RAISE EXCEPTION 'cyclic same-salon client merge chain'
        USING ERRCODE = '23514';
    END IF;
    visited := array_append(visited, current_id);

    next_id := NULL;
    SELECT client.merged_into_client_id
    INTO next_id
    FROM salon_client AS client
    WHERE client.salon_id = NEW.salon_id
      AND client.id = current_id;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'missing or foreign-salon client reference'
        USING ERRCODE = '23514';
    END IF;
    IF next_id IS NULL THEN
      NEW.salon_client_id := current_id;
      RETURN NEW;
    END IF;
    current_id := next_id;
  END LOOP;

  RAISE EXCEPTION 'client merge chain exceeds safe depth'
    USING ERRCODE = '23514';
END;
$$;
--> statement-breakpoint

-- Fail the atomic migration before publishing readiness if immutable 0061
-- history is incomplete or was installed differently.
DO $$
BEGIN
  IF to_regclass('public.salon_client_contact_alias') IS NULL
    OR to_regclass('public.salon_client_note') IS NULL
  THEN
    RAISE EXCEPTION 'required client lifecycle tables are missing';
  END IF;

  IF (
    WITH expected(
      table_name,
      column_name,
      formatted_type,
      not_null,
      has_default
    ) AS (
      VALUES
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
    SELECT count(*)
    FROM expected
    INNER JOIN pg_namespace AS namespaces
      ON namespaces.nspname = 'public'
    INNER JOIN pg_class AS relations
      ON relations.relnamespace = namespaces.oid
     AND relations.relname = expected.table_name
     AND relations.relkind IN ('r', 'p')
    INNER JOIN pg_attribute AS attributes
      ON attributes.attrelid = relations.oid
     AND attributes.attname = expected.column_name
     AND attributes.attnum > 0
     AND NOT attributes.attisdropped
    LEFT JOIN pg_attrdef AS defaults
      ON defaults.adrelid = attributes.attrelid
     AND defaults.adnum = attributes.attnum
    WHERE format_type(attributes.atttypid, attributes.atttypmod)
        = expected.formatted_type
      AND attributes.attnotnull = expected.not_null
      AND (defaults.oid IS NOT NULL) = expected.has_default
  ) <> 24 THEN
    RAISE EXCEPTION 'required client lifecycle column contracts are unavailable';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint AS constraints
    INNER JOIN pg_class AS source_relation
      ON source_relation.oid = constraints.conrelid
    INNER JOIN pg_namespace AS source_namespace
      ON source_namespace.oid = source_relation.relnamespace
    INNER JOIN pg_class AS target_relation
      ON target_relation.oid = constraints.confrelid
    INNER JOIN pg_namespace AS target_namespace
      ON target_namespace.oid = target_relation.relnamespace
    WHERE source_namespace.nspname = 'public'
      AND target_namespace.nspname = 'public'
      AND source_relation.relname = 'salon_client'
      AND target_relation.relname = 'salon_client'
      AND constraints.conname = 'salon_client_merged_into_client_id_fkey'
      AND constraints.contype = 'f'
      AND constraints.convalidated
      AND constraints.confdeltype = 'r'
      AND ARRAY(
        SELECT attributes.attname::text
        FROM unnest(constraints.conkey)
          WITH ORDINALITY AS keys(attribute_number, ordinality)
        INNER JOIN pg_attribute AS attributes
          ON attributes.attrelid = constraints.conrelid
         AND attributes.attnum = keys.attribute_number
        ORDER BY keys.ordinality
      ) = ARRAY['salon_id', 'merged_into_client_id']::text[]
      AND ARRAY(
        SELECT attributes.attname::text
        FROM unnest(constraints.confkey)
          WITH ORDINALITY AS keys(attribute_number, ordinality)
        INNER JOIN pg_attribute AS attributes
          ON attributes.attrelid = constraints.confrelid
         AND attributes.attnum = keys.attribute_number
        ORDER BY keys.ordinality
      ) = ARRAY['salon_id', 'id']::text[]
  ) THEN
    RAISE EXCEPTION 'same-salon client lifecycle constraint is unavailable';
  END IF;

  IF (
    SELECT count(*)
    FROM pg_constraint AS constraints
    INNER JOIN pg_class AS relations
      ON relations.oid = constraints.conrelid
    INNER JOIN pg_namespace AS namespaces
      ON namespaces.oid = relations.relnamespace
    WHERE namespaces.nspname = 'public'
      AND relations.relname = 'app_schema_capability'
      AND constraints.convalidated
      AND constraints.conname IN (
        'app_schema_capability_pkey',
        'app_schema_capability_state_valid',
        'app_schema_capability_version_positive',
        'app_schema_capability_merge_writes_disabled'
      )
  ) <> 4 THEN
    RAISE EXCEPTION 'client lifecycle capability constraints are unavailable';
  END IF;

  IF NOT (
    WITH expected(
      index_name,
      relation_name,
      access_method,
      is_unique,
      column_names
    ) AS (
      VALUES
        (
          'salon_client_salon_id_id_idx',
          'salon_client',
          'btree',
          true,
          ARRAY['salon_id', 'id']::text[]
        ),
        (
          'salon_client_lifecycle_idx',
          'salon_client',
          'btree',
          false,
          ARRAY['salon_id', 'archived_at', 'merged_into_client_id']::text[]
        ),
        (
          'salon_client_merged_into_idx',
          'salon_client',
          'btree',
          false,
          ARRAY['salon_id', 'merged_into_client_id']::text[]
        ),
        (
          'salon_client_contact_alias_unique',
          'salon_client_contact_alias',
          'btree',
          true,
          ARRAY['salon_id', 'kind', 'normalized_value']::text[]
        ),
        (
          'salon_client_contact_alias_client_idx',
          'salon_client_contact_alias',
          'btree',
          false,
          ARRAY['salon_id', 'salon_client_id']::text[]
        ),
        (
          'salon_client_note_client_created_idx',
          'salon_client_note',
          'btree',
          false,
          ARRAY['salon_id', 'salon_client_id', 'created_at']::text[]
        ),
        (
          'salon_client_note_source_idx',
          'salon_client_note',
          'btree',
          false,
          ARRAY['salon_id', 'source_client_id']::text[]
        )
    ),
    actual AS (
      SELECT
        index_classes.relname AS index_name,
        indexed_relations.relname AS relation_name,
        access_methods.amname AS access_method,
        indexes.indisunique AS is_unique,
        indexes.indisvalid,
        indexes.indisready,
        indexes.indpred IS NULL AS has_no_predicate,
        indexes.indexprs IS NULL AS has_no_expressions,
        indexes.indnatts = indexes.indnkeyatts AS has_no_included_columns,
        indexes.indnkeyatts,
        array_agg(attributes.attname::text ORDER BY keys.ordinality)
          FILTER (WHERE keys.ordinality <= indexes.indnkeyatts)
          AS column_names
      FROM pg_class AS index_classes
      INNER JOIN pg_index AS indexes
        ON indexes.indexrelid = index_classes.oid
      INNER JOIN pg_namespace AS index_namespaces
        ON index_namespaces.oid = index_classes.relnamespace
      INNER JOIN pg_class AS indexed_relations
        ON indexed_relations.oid = indexes.indrelid
       AND indexed_relations.relkind IN ('r', 'p')
      INNER JOIN pg_namespace AS indexed_namespaces
        ON indexed_namespaces.oid = indexed_relations.relnamespace
      INNER JOIN pg_am AS access_methods
        ON access_methods.oid = index_classes.relam
      CROSS JOIN LATERAL unnest(indexes.indkey)
        WITH ORDINALITY AS keys(attribute_number, ordinality)
      INNER JOIN pg_attribute AS attributes
        ON attributes.attrelid = indexes.indrelid
       AND attributes.attnum = keys.attribute_number
      WHERE index_namespaces.nspname = 'public'
        AND indexed_namespaces.nspname = 'public'
        AND index_classes.relkind = 'i'
        AND index_classes.relname IN (
          'salon_client_salon_id_id_idx',
          'salon_client_lifecycle_idx',
          'salon_client_merged_into_idx',
          'salon_client_contact_alias_unique',
          'salon_client_contact_alias_client_idx',
          'salon_client_note_client_created_idx',
          'salon_client_note_source_idx'
        )
      GROUP BY
        index_classes.relname,
        indexed_relations.relname,
        access_methods.amname,
        indexes.indisunique,
        indexes.indisvalid,
        indexes.indisready,
        (indexes.indpred IS NULL),
        (indexes.indexprs IS NULL),
        indexes.indnatts,
        indexes.indnkeyatts
    )
    SELECT
      count(*) = 7
      AND bool_and(actual.indisvalid)
      AND bool_and(actual.indisready)
      AND bool_and(actual.access_method = expected.access_method)
      AND bool_and(actual.is_unique = expected.is_unique)
      AND bool_and(actual.has_no_predicate)
      AND bool_and(actual.has_no_expressions)
      AND bool_and(actual.has_no_included_columns)
      AND bool_and(
        actual.indnkeyatts = cardinality(expected.column_names)
      )
      AND bool_and(actual.column_names = expected.column_names)
    FROM expected
    INNER JOIN actual
      ON actual.index_name = expected.index_name
     AND actual.relation_name = expected.relation_name
  ) THEN
    RAISE EXCEPTION 'required client lifecycle indexes are missing';
  END IF;

  IF (
    SELECT count(*)
    FROM pg_proc AS functions
    INNER JOIN pg_namespace AS namespaces
      ON namespaces.oid = functions.pronamespace
    INNER JOIN pg_language AS languages
      ON languages.oid = functions.prolang
    WHERE namespaces.nspname = 'public'
      AND functions.proname IN (
        'enforce_salon_client_merge_transition',
        'prevent_merged_salon_client_mutation',
        'resolve_merged_salon_client_reference'
      )
      AND functions.pronargs = 0
      AND functions.prorettype = 'trigger'::regtype
      AND languages.lanname = 'plpgsql'
  ) <> 3 THEN
    RAISE EXCEPTION 'required client lifecycle functions are missing';
  END IF;

  IF (
    WITH expected(
      trigger_name,
      relation_name,
      function_signature,
      trigger_type
    ) AS (
      VALUES
        (
          'salon_client_enforce_merge_transition',
          'salon_client',
          'public.enforce_salon_client_merge_transition()',
          23
        ),
        (
          'salon_client_prevent_merged_source_update',
          'salon_client',
          'public.prevent_merged_salon_client_mutation()',
          19
        ),
        (
          'appointment_resolve_merged_client',
          'appointment',
          'public.resolve_merged_salon_client_reference()',
          23
        ),
        (
          'review_resolve_merged_client',
          'review',
          'public.resolve_merged_salon_client_reference()',
          23
        ),
        (
          'client_communication_resolve_merged_client',
          'client_communication',
          'public.resolve_merged_salon_client_reference()',
          23
        ),
        (
          'retention_campaign_resolve_merged_client',
          'retention_campaign',
          'public.resolve_merged_salon_client_reference()',
          23
        ),
        (
          'fraud_signal_resolve_merged_client',
          'fraud_signal',
          'public.resolve_merged_salon_client_reference()',
          23
        ),
        (
          'salon_client_note_resolve_merged_client',
          'salon_client_note',
          'public.resolve_merged_salon_client_reference()',
          23
        ),
        (
          'salon_client_alias_resolve_merged_client',
          'salon_client_contact_alias',
          'public.resolve_merged_salon_client_reference()',
          23
        )
    )
    SELECT count(*)
    FROM expected
    INNER JOIN pg_trigger AS triggers
      ON triggers.tgname = expected.trigger_name
     AND NOT triggers.tgisinternal
     AND triggers.tgenabled = 'O'
     AND triggers.tgtype = expected.trigger_type
    INNER JOIN pg_class AS relations
      ON relations.oid = triggers.tgrelid
     AND relations.relname = expected.relation_name
    INNER JOIN pg_namespace AS namespaces
      ON namespaces.oid = relations.relnamespace
     AND namespaces.nspname = 'public'
    INNER JOIN pg_proc AS functions
      ON functions.oid = triggers.tgfoid
     AND functions.oid = to_regprocedure(expected.function_signature)
  ) <> 9 THEN
    RAISE EXCEPTION 'required client lifecycle triggers are unavailable';
  END IF;
END;
$$;
--> statement-breakpoint

INSERT INTO "app_schema_capability" (
  "capability",
  "version",
  "state",
  "merge_writes_enabled",
  "installed_at"
)
VALUES ('client_lifecycle', 2, 'ready', false, now())
ON CONFLICT ("capability") DO UPDATE
SET
  "version" = EXCLUDED."version",
  "state" = EXCLUDED."state",
  "merge_writes_enabled" = false,
  "installed_at" = EXCLUDED."installed_at";
