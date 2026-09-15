-- Disabled-by-default owner-assistant evidence. No existing menu is changed.
CREATE TABLE service_menu_revision (
  salon_id text PRIMARY KEY REFERENCES salon(id) ON DELETE CASCADE,
  revision bigint NOT NULL DEFAULT 0,
  updated_at timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE owner_assistant_menu_operation (
  id text PRIMARY KEY,
  salon_id text NOT NULL REFERENCES salon(id) ON DELETE CASCADE,
  actor_admin_id text NOT NULL REFERENCES admin_user(id) ON DELETE RESTRICT,
  idempotency_key text NOT NULL,
  status text NOT NULL CHECK (status IN ('ready', 'no_op', 'applied', 'undone')),
  base_revision bigint NOT NULL,
  applied_revision bigint,
  old_order jsonb NOT NULL,
  new_order jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  applied_at timestamptz,
  undone_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (salon_id, actor_admin_id, idempotency_key)
);
--> statement-breakpoint
CREATE INDEX owner_assistant_menu_operation_salon_idx ON owner_assistant_menu_operation(salon_id, created_at);
--> statement-breakpoint
CREATE FUNCTION service_menu_revision_bump() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE target_salon_id text;
DECLARE previous_salon_id text;
BEGIN
  target_salon_id := COALESCE(NEW.salon_id, OLD.salon_id);
  previous_salon_id := CASE WHEN TG_OP = 'UPDATE' THEN OLD.salon_id ELSE NULL END;
  -- A DELETE caused by salon ON DELETE CASCADE runs after the parent no
  -- longer exists. Do not resurrect a child revision row into that cascade.
  IF NOT EXISTS (SELECT 1 FROM salon WHERE id = target_salon_id) THEN
    RETURN COALESCE(NEW, OLD);
  END IF;
  INSERT INTO service_menu_revision (salon_id, revision, updated_at)
  VALUES (target_salon_id, 1, now())
  ON CONFLICT (salon_id) DO UPDATE
    SET revision = service_menu_revision.revision + 1, updated_at = now();
  -- Tenant reassignment is not an owner-assistant feature, but invalidating
  -- both snapshots is required if a maintenance writer ever performs one.
  IF previous_salon_id IS NOT NULL AND previous_salon_id <> target_salon_id
    AND EXISTS (SELECT 1 FROM salon WHERE id = previous_salon_id) THEN
    INSERT INTO service_menu_revision (salon_id, revision, updated_at)
    VALUES (previous_salon_id, 1, now())
    ON CONFLICT (salon_id) DO UPDATE
      SET revision = service_menu_revision.revision + 1, updated_at = now();
  END IF;
  RETURN COALESCE(NEW, OLD);
END;
$$;
--> statement-breakpoint
CREATE TRIGGER service_menu_revision_bump_trigger
AFTER INSERT OR UPDATE OR DELETE ON service
FOR EACH ROW EXECUTE FUNCTION service_menu_revision_bump();
