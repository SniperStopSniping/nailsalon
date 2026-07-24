ALTER TABLE "salon_client"
  ADD COLUMN IF NOT EXISTS "birthday" date,
  ADD COLUMN IF NOT EXISTS "archived_at" timestamp with time zone,
  ADD COLUMN IF NOT EXISTS "archived_by" text,
  ADD COLUMN IF NOT EXISTS "merged_into_client_id" text,
  ADD COLUMN IF NOT EXISTS "merged_at" timestamp with time zone,
  ADD COLUMN IF NOT EXISTS "merged_by" text;
--> statement-breakpoint

CREATE UNIQUE INDEX "salon_client_salon_id_id_idx"
  ON "salon_client" ("salon_id", "id");
--> statement-breakpoint

ALTER TABLE "salon_client"
  ADD CONSTRAINT "salon_client_merged_into_client_id_fkey"
  FOREIGN KEY ("salon_id", "merged_into_client_id")
  REFERENCES "salon_client"("salon_id", "id")
  ON DELETE RESTRICT
  NOT VALID;
--> statement-breakpoint
ALTER TABLE "salon_client"
  VALIDATE CONSTRAINT "salon_client_merged_into_client_id_fkey";
--> statement-breakpoint

CREATE INDEX "salon_client_lifecycle_idx"
  ON "salon_client" ("salon_id", "archived_at", "merged_into_client_id");
--> statement-breakpoint
CREATE INDEX "salon_client_merged_into_idx"
  ON "salon_client" ("salon_id", "merged_into_client_id");
--> statement-breakpoint

CREATE TABLE "salon_client_contact_alias" (
  "salon_id" text NOT NULL REFERENCES "salon"("id") ON DELETE CASCADE,
  "salon_client_id" text NOT NULL REFERENCES "salon_client"("id") ON DELETE CASCADE,
  "kind" text NOT NULL,
  "normalized_value" text NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "salon_client_contact_alias_kind_valid"
    CHECK ("kind" IN ('phone', 'email')),
  CONSTRAINT "salon_client_contact_alias_value_nonempty"
    CHECK (length("normalized_value") > 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX "salon_client_contact_alias_unique"
  ON "salon_client_contact_alias" ("salon_id", "kind", "normalized_value");
--> statement-breakpoint
CREATE INDEX "salon_client_contact_alias_client_idx"
  ON "salon_client_contact_alias" ("salon_id", "salon_client_id");
--> statement-breakpoint

CREATE TABLE "salon_client_note" (
  "id" text PRIMARY KEY NOT NULL,
  "salon_id" text NOT NULL REFERENCES "salon"("id") ON DELETE CASCADE,
  "salon_client_id" text NOT NULL REFERENCES "salon_client"("id") ON DELETE CASCADE,
  "source_client_id" text,
  "body" text NOT NULL,
  "created_by" text NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "salon_client_note_body_nonempty"
    CHECK (length(btrim("body")) > 0)
);
--> statement-breakpoint
CREATE INDEX "salon_client_note_client_created_idx"
  ON "salon_client_note" ("salon_id", "salon_client_id", "created_at");
--> statement-breakpoint
CREATE INDEX "salon_client_note_source_idx"
  ON "salon_client_note" ("salon_id", "source_client_id");
--> statement-breakpoint

ALTER TABLE "client_communication"
  ADD COLUMN IF NOT EXISTS "destination_snapshot" text;
--> statement-breakpoint

-- Serialize merge-target transitions by salon, require an active same-salon
-- terminal target, and reject self-links/cycles even for direct SQL writers.
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
  IF NEW.merged_into_client_id IS NULL THEN
    RETURN NEW;
  END IF;

  -- Application merges already take this lock. Keeping the rule here also
  -- serializes opposing direct-SQL transitions before either can form a cycle.
  PERFORM 1
  FROM salon
  WHERE id = NEW.salon_id
  FOR UPDATE;

  current_id := NEW.merged_into_client_id;
  FOR chain_depth IN 0..15 LOOP
    IF current_id = NEW.id OR current_id = ANY(visited) THEN
      RAISE EXCEPTION 'cyclic same-salon client merge for %', NEW.id
        USING ERRCODE = '23514';
    END IF;
    visited := array_append(visited, current_id);

    next_id := NULL;
    current_archived_at := NULL;
    SELECT client.merged_into_client_id, client.archived_at
    INTO next_id, current_archived_at
    FROM salon_client AS client
    WHERE client.salon_id = NEW.salon_id
      AND client.id = current_id
    FOR KEY SHARE;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'missing or foreign-salon client merge target for %', current_id
        USING ERRCODE = '23514';
    END IF;
    IF next_id IS NULL THEN
      IF current_archived_at IS NOT NULL THEN
        RAISE EXCEPTION 'client merge target % must be active', current_id
          USING ERRCODE = '23514';
      END IF;
      RETURN NEW;
    END IF;
    current_id := next_id;
  END LOOP;

  RAISE EXCEPTION 'client merge chain exceeds safe depth for %', NEW.id
    USING ERRCODE = '23514';
END;
$$;
--> statement-breakpoint

CREATE TRIGGER "salon_client_enforce_merge_transition"
  BEFORE INSERT OR UPDATE OF "salon_id", "merged_into_client_id"
  ON "salon_client"
  FOR EACH ROW
  EXECUTE FUNCTION "enforce_salon_client_merge_transition"();
--> statement-breakpoint

-- Once a profile is a preserved merge source it is immutable. This closes the
-- second stale-writer race: a request that selected the duplicate before the
-- merge must not put rewards, review state, flags, caches, or contact data back
-- onto the archived source after the merge commits. The initial transition is
-- allowed because OLD.merged_into_client_id is still null. Delete eligibility
-- remains enforced by the application so parent-salon cascades and a future
-- explicit privacy-erasure workflow are not blocked by this trigger.
CREATE OR REPLACE FUNCTION "prevent_merged_salon_client_mutation"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF OLD.merged_into_client_id IS NOT NULL THEN
    RAISE EXCEPTION 'merged salon client % is immutable', OLD.id
      USING ERRCODE = '55000';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint

CREATE TRIGGER "salon_client_prevent_merged_source_update"
  BEFORE UPDATE
  ON "salon_client"
  FOR EACH ROW
  EXECUTE FUNCTION "prevent_merged_salon_client_mutation"();
--> statement-breakpoint

-- A writer can resolve a client immediately before a merge, then insert its
-- row after the merge commits. Keep that stale write attached to the terminal
-- same-salon primary without changing any booking or financial snapshots.
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
      RAISE EXCEPTION 'cyclic same-salon client merge chain for %', NEW.salon_client_id
        USING ERRCODE = '23514';
    END IF;
    visited := array_append(visited, current_id);

    -- This lock either precedes the merge's FOR UPDATE lock (so the merge
    -- later sees and relinks our insert) or waits for that merge to commit,
    -- after which EvalPlanQual returns the new merge target.
    next_id := NULL;
    SELECT client.merged_into_client_id
    INTO next_id
    FROM salon_client AS client
    WHERE client.salon_id = NEW.salon_id
      AND client.id = current_id
    FOR KEY SHARE;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'missing or foreign-salon client merge target for %', current_id
        USING ERRCODE = '23514';
    END IF;
    IF next_id IS NULL THEN
      NEW.salon_client_id := current_id;
      RETURN NEW;
    END IF;
    current_id := next_id;
  END LOOP;

  RAISE EXCEPTION 'client merge chain exceeds safe depth for %', NEW.salon_client_id
    USING ERRCODE = '23514';
END;
$$;
--> statement-breakpoint

CREATE TRIGGER "appointment_resolve_merged_client"
  BEFORE INSERT OR UPDATE OF "salon_id", "salon_client_id"
  ON "appointment"
  FOR EACH ROW
  EXECUTE FUNCTION "resolve_merged_salon_client_reference"();
--> statement-breakpoint
CREATE TRIGGER "review_resolve_merged_client"
  BEFORE INSERT OR UPDATE OF "salon_id", "salon_client_id"
  ON "review"
  FOR EACH ROW
  EXECUTE FUNCTION "resolve_merged_salon_client_reference"();
--> statement-breakpoint
CREATE TRIGGER "client_communication_resolve_merged_client"
  BEFORE INSERT OR UPDATE OF "salon_id", "salon_client_id"
  ON "client_communication"
  FOR EACH ROW
  EXECUTE FUNCTION "resolve_merged_salon_client_reference"();
--> statement-breakpoint
CREATE TRIGGER "retention_campaign_resolve_merged_client"
  BEFORE INSERT OR UPDATE OF "salon_id", "salon_client_id"
  ON "retention_campaign"
  FOR EACH ROW
  EXECUTE FUNCTION "resolve_merged_salon_client_reference"();
--> statement-breakpoint
CREATE TRIGGER "fraud_signal_resolve_merged_client"
  BEFORE INSERT OR UPDATE OF "salon_id", "salon_client_id"
  ON "fraud_signal"
  FOR EACH ROW
  EXECUTE FUNCTION "resolve_merged_salon_client_reference"();
--> statement-breakpoint
CREATE TRIGGER "salon_client_note_resolve_merged_client"
  BEFORE INSERT OR UPDATE OF "salon_id", "salon_client_id"
  ON "salon_client_note"
  FOR EACH ROW
  EXECUTE FUNCTION "resolve_merged_salon_client_reference"();
--> statement-breakpoint
CREATE TRIGGER "salon_client_alias_resolve_merged_client"
  BEFORE INSERT OR UPDATE OF "salon_id", "salon_client_id"
  ON "salon_client_contact_alias"
  FOR EACH ROW
  EXECUTE FUNCTION "resolve_merged_salon_client_reference"();
