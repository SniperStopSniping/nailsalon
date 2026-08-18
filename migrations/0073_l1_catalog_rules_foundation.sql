-- 0073_l1_catalog_rules_foundation.sql
--
-- Luster L1 — PR2, dark catalog grouping / capability / rule foundation.
--
-- Adds the storage the guided catalog will later read: how add-ons are grouped
-- and how many of a group a client may pick, which technicians hold which
-- skills, and a bounded, typed vocabulary of catalog rules.
--
-- Everything here is INERT, in the same sense as 0072. Four new tables are
-- created empty and stay empty; the single column added to an existing table
-- (`add_on.group_id`) is nullable with no default and is backfilled by nothing.
-- No booking path, pricing calculation, duration calculation, availability
-- filter, request lifecycle or public DTO reads any of it, and no feature key
-- is flipped. A salon's behaviour the day after this migration is identical to
-- the day before.
--
-- NOTHING IS EXECUTED HERE. `catalog_rule` is a typed STORE of a bounded
-- vocabulary — there is deliberately no resolver, no expression language, no
-- price or duration arithmetic, and no user-authored code. What the rows mean
-- is decided by a later PR; what they may CONTAIN is decided here.
--
-- This migration deliberately does NOT touch the Discover portfolio schema
-- (0071), the L1 variant columns (0072), deposits, billing, communications, or
-- any public rendering path.
--
-- ---------------------------------------------------------------------------
-- Tenant safety, and why every foreign key below is composite
-- ---------------------------------------------------------------------------
-- Each new relationship carries `salon_id` on BOTH sides of its foreign key,
-- referencing a `(salon_id, id)` tenant identity on the parent. That makes a
-- cross-tenant reference unrepresentable at the database level rather than
-- something every future write path has to remember to check. `service`
-- already gained its `(salon_id, id)` identity in 0072; `add_on` and
-- `technician` gain theirs here, and the two new owning tables declare theirs
-- inline.
--
-- Every composite foreign key is MATCH SIMPLE (the default), so a NULL in any
-- referencing column satisfies it — which is what lets `add_on.group_id` stay
-- NULL on all 66 existing add-ons without a backfill, and what lets a
-- salon-wide `catalog_rule` leave `service_id` NULL.
--
-- Every composite foreign key is ON DELETE NO ACTION / ON UPDATE NO ACTION,
-- matching the rule 0072 established for the variant parent link:
--
--   * ON DELETE SET NULL is forbidden outright on a composite key — it would
--     null `salon_id` along with the reference, silently detaching a row from
--     its tenant. That must never happen.
--   * RESTRICT is deliberately NOT used. NO ACTION is checked at the END of
--     the statement, RESTRICT immediately. `salon` hard-deletion cascades to
--     `add_on`, `technician`, `service` and every table below in one
--     statement; under NO ACTION that whole cascade settles and passes, while
--     RESTRICT would abort it. Salon purge must keep working.
--   * Consequently, un-grouping an add-on or un-assigning a capability is an
--     EXPLICIT application operation, never a cascade side effect. A group
--     that still has members, and a technician who still holds capabilities,
--     cannot be deleted out from under those rows. Both tables are empty
--     today, so nothing existing can hit this; the later PR that adds the
--     owner editor owns the unlink-then-delete flow.

-- ---------------------------------------------------------------------------
-- Shared updated_at trigger for this migration's tables
-- ---------------------------------------------------------------------------
-- Follows the pattern 0069/0070/0071 established for new tables: the database,
-- not the caller, owns `updated_at`, so a direct-SQL write cannot leave it
-- stale. Existing tables keep their application-level `$onUpdate` and are not
-- touched.
CREATE FUNCTION "catalog_set_updated_at"() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  NEW."updated_at" = now();
  RETURN NEW;
END;
$$;
--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- add_on_group — how a salon's add-ons are presented and bounded
-- ---------------------------------------------------------------------------
-- A group is a named set of add-ons with a selection bound: "pick 1 shape",
-- "pick up to 3 accents", "pick at least 1 finish". The bound is stored;
-- enforcing it against a client's selection is a later PR's job.
--
-- `max_selections = 1` is what a later PR will render as a single-select
-- (radio) group; NULL means unlimited. This is the ONLY grouping model in L1:
-- an add-on belongs to at most one group (see `add_on.group_id` below), and
-- there is deliberately no per-service override table. A future many-to-many
-- grouping is NOT implied or reserved by this shape.
CREATE TABLE "add_on_group" (
  "id" text PRIMARY KEY NOT NULL,
  "salon_id" text NOT NULL REFERENCES "salon"("id") ON DELETE CASCADE,
  "name" text NOT NULL,
  "slug" text NOT NULL,
  "description" text,

  -- How many members of this group a selection must / may contain.
  "min_selections" integer DEFAULT 0 NOT NULL,
  "max_selections" integer,

  "sort_order" integer DEFAULT 0 NOT NULL,
  "is_active" boolean DEFAULT true NOT NULL,

  -- Stable key linking this group to a catalog template, mirroring
  -- `add_on.template_key` and `service.template_key`.
  "template_key" text,

  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,

  -- A group cannot require a negative number of choices.
  CONSTRAINT "add_on_group_min_selections_check"
    CHECK ("min_selections" >= 0),
  -- NULL max means unlimited. A stated max of 0 would be a group that can
  -- never be satisfied and is not expressible.
  CONSTRAINT "add_on_group_max_selections_check"
    CHECK ("max_selections" IS NULL OR "max_selections" >= 1),
  -- A stated max must be reachable from the min, otherwise the group is
  -- unsatisfiable by construction.
  CONSTRAINT "add_on_group_min_max_compatible_check"
    CHECK ("max_selections" IS NULL OR "max_selections" >= "min_selections"),

  -- Tenant identity for the composite foreign key from `add_on`.
  CONSTRAINT "add_on_group_salon_id_id_key" UNIQUE ("salon_id", "id")
);
--> statement-breakpoint

CREATE INDEX "add_on_group_salon_idx" ON "add_on_group" ("salon_id");
--> statement-breakpoint
CREATE UNIQUE INDEX "add_on_group_salon_slug_idx"
  ON "add_on_group" ("salon_id", "slug");
--> statement-breakpoint
CREATE INDEX "add_on_group_salon_order_idx"
  ON "add_on_group" ("salon_id", "sort_order");
--> statement-breakpoint
-- One template-derived group per salon, mirroring
-- `add_on_salon_template_key_idx` from 0057.
CREATE UNIQUE INDEX "add_on_group_salon_template_key_idx"
  ON "add_on_group" ("salon_id", "template_key")
  WHERE "template_key" IS NOT NULL;
--> statement-breakpoint

CREATE TRIGGER "add_on_group_set_updated_at"
BEFORE UPDATE ON "add_on_group"
FOR EACH ROW EXECUTE FUNCTION "catalog_set_updated_at"();
--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- add_on.group_id — membership, nullable and legacy-compatible
-- ---------------------------------------------------------------------------
-- Every existing add-on keeps NULL and behaves exactly as it does today: an
-- ungrouped add-on is a perfectly valid add-on, both before and after this
-- migration. No bulk grouping is performed.
ALTER TABLE "add_on" ADD COLUMN "group_id" text;
--> statement-breakpoint

-- Tenant identity on `add_on`, for the composite keys from `add_on` itself and
-- from `catalog_rule`. `id` is already unique as the primary key; this pair
-- exists so a foreign key can carry `salon_id` through it.
ALTER TABLE "add_on"
  ADD CONSTRAINT "add_on_salon_id_id_key" UNIQUE ("salon_id", "id");
--> statement-breakpoint

ALTER TABLE "add_on"
  ADD CONSTRAINT "add_on_group_salon_fk"
  FOREIGN KEY ("salon_id", "group_id")
  REFERENCES "add_on_group" ("salon_id", "id")
  ON UPDATE NO ACTION ON DELETE NO ACTION;
--> statement-breakpoint

-- The referencing side of a foreign key is not indexed automatically. Every
-- row is NULL today so this costs nothing, and it keeps the eventual
-- "members of this group" lookups and delete checks off sequential scans.
CREATE INDEX "add_on_group_member_idx"
  ON "add_on" ("salon_id", "group_id")
  WHERE "group_id" IS NOT NULL;
--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- capability — a salon-owned skill vocabulary
-- ---------------------------------------------------------------------------
-- "Can do Russian manicure", "certified for hard gel". Owned per salon, so one
-- salon's vocabulary is never visible to or shared with another. Deactivation
-- is soft (`is_active`), so retiring a skill never destroys the assignment
-- history that a later PR may need to explain a past booking.
CREATE TABLE "capability" (
  "id" text PRIMARY KEY NOT NULL,
  "salon_id" text NOT NULL REFERENCES "salon"("id") ON DELETE CASCADE,
  "slug" text NOT NULL,
  "name" text NOT NULL,
  "description" text,
  "is_active" boolean DEFAULT true NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,

  -- Tenant identity for the composite keys from `technician_capability` and
  -- `catalog_rule`.
  CONSTRAINT "capability_salon_id_id_key" UNIQUE ("salon_id", "id")
);
--> statement-breakpoint

CREATE INDEX "capability_salon_idx" ON "capability" ("salon_id");
--> statement-breakpoint
CREATE UNIQUE INDEX "capability_salon_slug_idx"
  ON "capability" ("salon_id", "slug");
--> statement-breakpoint

CREATE TRIGGER "capability_set_updated_at"
BEFORE UPDATE ON "capability"
FOR EACH ROW EXECUTE FUNCTION "catalog_set_updated_at"();
--> statement-breakpoint

-- Tenant identity on `technician`, for the composite key from
-- `technician_capability`.
ALTER TABLE "technician"
  ADD CONSTRAINT "technician_salon_id_id_key" UNIQUE ("salon_id", "id");
--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- technician_capability — who holds which skill
-- ---------------------------------------------------------------------------
-- Existing technicians receive NO capabilities: this table is created empty
-- and nothing backfills it. Because no rule references a capability yet and no
-- availability code reads this table, an empty table cannot filter anybody out
-- of anything. Availability is untouched by this PR.
CREATE TABLE "technician_capability" (
  "id" text PRIMARY KEY NOT NULL,
  "salon_id" text NOT NULL REFERENCES "salon"("id") ON DELETE CASCADE,
  "technician_id" text NOT NULL,
  "capability_id" text NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,

  -- Both sides carry `salon_id`, so assigning salon B's capability to salon
  -- A's technician — in either direction — is rejected by the database.
  CONSTRAINT "technician_capability_technician_salon_fk"
    FOREIGN KEY ("salon_id", "technician_id")
    REFERENCES "technician" ("salon_id", "id")
    ON UPDATE NO ACTION ON DELETE NO ACTION,
  CONSTRAINT "technician_capability_capability_salon_fk"
    FOREIGN KEY ("salon_id", "capability_id")
    REFERENCES "capability" ("salon_id", "id")
    ON UPDATE NO ACTION ON DELETE NO ACTION
);
--> statement-breakpoint

-- A technician holds a capability once or not at all. `technician_id` is
-- globally unique on its own, so this pair is sufficient and no salon-scoped
-- variant is needed.
CREATE UNIQUE INDEX "technician_capability_assignment_uniq"
  ON "technician_capability" ("technician_id", "capability_id");
--> statement-breakpoint
CREATE INDEX "technician_capability_salon_idx"
  ON "technician_capability" ("salon_id");
--> statement-breakpoint
CREATE INDEX "technician_capability_capability_idx"
  ON "technician_capability" ("salon_id", "capability_id");
--> statement-breakpoint

CREATE TRIGGER "technician_capability_set_updated_at"
BEFORE UPDATE ON "technician_capability"
FOR EACH ROW EXECUTE FUNCTION "catalog_set_updated_at"();
--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- catalog_rule — bounded, typed rule STORAGE
-- ---------------------------------------------------------------------------
-- Six rule types and nothing else. There is no price-adjustment rule, no
-- duration-adjustment rule, no boolean expression, no scripting, and no
-- user-authored code — deliberately, and the CHECK below is what keeps a
-- future writer from adding one without a migration.
--
--   include             — selecting the subject brings the object add-on with
--                         it (auto-added when `params.autoAdd` is true).
--   exclude             — selecting the subject makes the object add-on
--                         unavailable.
--   requires            — the subject is only valid when the object add-on is
--                         also selected.
--   mutually_exclusive  — the subject and the object add-on cannot both be
--                         selected.
--   max_quantity        — caps how many of the object add-on may be selected
--                         (`params.maxQuantity`).
--   requires_capability — the subject is only bookable with a technician who
--                         holds `capability_id`.
--
-- SCOPE. `service_id IS NULL` means the rule applies salon-wide; a non-NULL
-- `service_id` narrows it to one service. Scope is separate from SUBJECT: the
-- subject is the thing whose selection triggers the rule, the scope is where
-- the rule is in force at all.
CREATE TABLE "catalog_rule" (
  "id" text PRIMARY KEY NOT NULL,
  "salon_id" text NOT NULL REFERENCES "salon"("id") ON DELETE CASCADE,

  -- NULL = salon-wide.
  "service_id" text,

  "rule_type" text NOT NULL,

  -- Exactly one of these two identifies the subject.
  "subject_service_id" text,
  "subject_add_on_id" text,

  -- The object, whose presence depends on the rule type.
  "object_add_on_id" text,
  "capability_id" text,

  -- Bounded typed metadata, validated by the Zod contract in
  -- `src/libs/catalogRuleContract.ts`. See the note on enforcement below.
  "params" jsonb DEFAULT '{}'::jsonb NOT NULL,

  "priority" integer DEFAULT 0 NOT NULL,
  "is_active" boolean DEFAULT true NOT NULL,

  -- Owner-facing free text. Never projected to a client.
  "note" text,

  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,

  -- The vocabulary itself. Adding a seventh rule type requires a migration,
  -- which is the point.
  CONSTRAINT "catalog_rule_type_check" CHECK ("rule_type" IN (
    'include',
    'exclude',
    'requires',
    'mutually_exclusive',
    'max_quantity',
    'requires_capability'
  )),

  -- EXACTLY ONE SUBJECT. Boolean inequality is XOR: true when precisely one of
  -- the two is NULL, false when both are set and false when neither is. Written
  -- this way rather than with `num_nonnulls(...)` so the expression is plain
  -- portable SQL that behaves identically on PostgreSQL and on PGlite.
  CONSTRAINT "catalog_rule_single_subject_check"
    CHECK (("subject_service_id" IS NULL) <> ("subject_add_on_id" IS NULL)),

  -- The object side is fully determined by the rule type: a capability rule
  -- names a capability and no add-on, every other rule names an add-on and no
  -- capability. A `requires_capability` row with no capability, or an
  -- `exclude` row with no target, is unrepresentable.
  CONSTRAINT "catalog_rule_object_shape_check" CHECK (
    (
      "rule_type" = 'requires_capability'
      AND "capability_id" IS NOT NULL
      AND "object_add_on_id" IS NULL
    )
    OR (
      "rule_type" <> 'requires_capability'
      AND "capability_id" IS NULL
      AND "object_add_on_id" IS NOT NULL
    )
  ),

  -- An add-on cannot require, exclude or be mutually exclusive with itself.
  CONSTRAINT "catalog_rule_no_self_pair_check" CHECK (
    "subject_add_on_id" IS NULL
    OR "object_add_on_id" IS NULL
    OR "subject_add_on_id" <> "object_add_on_id"
  ),

  -- `params` is an object or nothing. This is the DATABASE-level floor; the
  -- per-rule-type SHAPE of that object is enforced by the typed contract, not
  -- here (see the note below).
  CONSTRAINT "catalog_rule_params_object_check"
    CHECK (jsonb_typeof("params") = 'object'),

  CONSTRAINT "catalog_rule_priority_check" CHECK ("priority" >= 0),

  -- Tenant-safe references. All MATCH SIMPLE, so a NULL column is satisfied.
  CONSTRAINT "catalog_rule_service_salon_fk"
    FOREIGN KEY ("salon_id", "service_id")
    REFERENCES "service" ("salon_id", "id")
    ON UPDATE NO ACTION ON DELETE NO ACTION,
  CONSTRAINT "catalog_rule_subject_service_salon_fk"
    FOREIGN KEY ("salon_id", "subject_service_id")
    REFERENCES "service" ("salon_id", "id")
    ON UPDATE NO ACTION ON DELETE NO ACTION,
  CONSTRAINT "catalog_rule_subject_add_on_salon_fk"
    FOREIGN KEY ("salon_id", "subject_add_on_id")
    REFERENCES "add_on" ("salon_id", "id")
    ON UPDATE NO ACTION ON DELETE NO ACTION,
  CONSTRAINT "catalog_rule_object_add_on_salon_fk"
    FOREIGN KEY ("salon_id", "object_add_on_id")
    REFERENCES "add_on" ("salon_id", "id")
    ON UPDATE NO ACTION ON DELETE NO ACTION,
  CONSTRAINT "catalog_rule_capability_salon_fk"
    FOREIGN KEY ("salon_id", "capability_id")
    REFERENCES "capability" ("salon_id", "id")
    ON UPDATE NO ACTION ON DELETE NO ACTION
);
--> statement-breakpoint

-- WHERE `params` IS AND IS NOT ENFORCED
--
-- The database guarantees only that `params` is a JSON object. The per-type
-- shape — that `max_quantity` carries a positive integer `maxQuantity`, that
-- `include` may carry `autoAdd`, that no unknown key is present — is enforced
-- by `catalogRuleParamsSchema` in `src/libs/catalogRuleContract.ts`, at every
-- write, and re-validated on read before use.
--
-- This split is deliberate and is recorded honestly rather than overstated.
-- A CHECK strong enough to express those shapes would have to reach into JSON
-- with expressions whose semantics and error behaviour are not guaranteed to
-- match between PostgreSQL and the PGlite build the test suite replays
-- against, and a constraint that only holds on one engine is worse than an
-- explicit application-layer one: it reads as a guarantee it cannot keep.
-- The invariants that ARE structural — the vocabulary, the single subject, the
-- object shape, tenant ownership — are all above, in the database, where they
-- cannot be bypassed by a future caller.
--
-- Raw `params` is never projected to a public client. The later PR that builds
-- the public rule projection derives an opaque, client-safe shape from it.

CREATE INDEX "catalog_rule_salon_idx" ON "catalog_rule" ("salon_id");
--> statement-breakpoint
CREATE INDEX "catalog_rule_salon_service_idx"
  ON "catalog_rule" ("salon_id", "service_id");
--> statement-breakpoint
CREATE INDEX "catalog_rule_subject_service_idx"
  ON "catalog_rule" ("salon_id", "subject_service_id")
  WHERE "subject_service_id" IS NOT NULL;
--> statement-breakpoint
CREATE INDEX "catalog_rule_subject_add_on_idx"
  ON "catalog_rule" ("salon_id", "subject_add_on_id")
  WHERE "subject_add_on_id" IS NOT NULL;
--> statement-breakpoint
CREATE INDEX "catalog_rule_object_add_on_idx"
  ON "catalog_rule" ("salon_id", "object_add_on_id")
  WHERE "object_add_on_id" IS NOT NULL;
--> statement-breakpoint
CREATE INDEX "catalog_rule_capability_idx"
  ON "catalog_rule" ("salon_id", "capability_id")
  WHERE "capability_id" IS NOT NULL;
--> statement-breakpoint
CREATE INDEX "catalog_rule_active_idx"
  ON "catalog_rule" ("salon_id", "is_active", "priority");
--> statement-breakpoint

CREATE TRIGGER "catalog_rule_set_updated_at"
BEFORE UPDATE ON "catalog_rule"
FOR EACH ROW EXECUTE FUNCTION "catalog_set_updated_at"();
