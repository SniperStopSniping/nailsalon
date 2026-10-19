CREATE TABLE business_setup_workspace (
  id text PRIMARY KEY, salon_id text NOT NULL REFERENCES salon(id) ON DELETE CASCADE,
  head_revision integer NOT NULL CHECK (head_revision > 0), baseline_hash text NOT NULL, baseline jsonb NOT NULL,
  status text NOT NULL DEFAULT 'editing' CHECK (status IN ('editing', 'published')),
  created_at timestamp NOT NULL DEFAULT now(), updated_at timestamp NOT NULL DEFAULT now(),
  CONSTRAINT business_setup_workspace_salon_key UNIQUE (salon_id), CONSTRAINT business_setup_workspace_tenant_key UNIQUE (salon_id, id)
);
--> statement-breakpoint
CREATE TABLE business_setup_revision (
  salon_id text NOT NULL, workspace_id text NOT NULL, revision integer NOT NULL CHECK (revision > 0),
  operation_id text NOT NULL, operation_hash text NOT NULL, document jsonb NOT NULL, actor_id text NOT NULL, origin text NOT NULL,
  created_at timestamp NOT NULL DEFAULT now(), PRIMARY KEY (workspace_id, revision), CONSTRAINT business_setup_revision_operation_key UNIQUE (workspace_id, operation_id),
  FOREIGN KEY (salon_id, workspace_id) REFERENCES business_setup_workspace(salon_id, id) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE TABLE business_setup_approval (
  id text PRIMARY KEY, salon_id text NOT NULL, workspace_id text NOT NULL, revision integer NOT NULL,
  manifest_hash text NOT NULL, actor_id text NOT NULL, expires_at timestamp NOT NULL, created_at timestamp NOT NULL DEFAULT now(),
  FOREIGN KEY (salon_id, workspace_id) REFERENCES business_setup_workspace(salon_id, id) ON DELETE CASCADE,
  FOREIGN KEY (workspace_id, revision) REFERENCES business_setup_revision(workspace_id, revision)
);
--> statement-breakpoint
CREATE TABLE business_setup_publication (
  id text PRIMARY KEY, salon_id text NOT NULL, workspace_id text NOT NULL, revision integer NOT NULL,
  operation_id text NOT NULL, approval_id text NOT NULL REFERENCES business_setup_approval(id), actor_id text NOT NULL,
  service_ids jsonb NOT NULL, published_at timestamp NOT NULL DEFAULT now(), media_finalized boolean NOT NULL DEFAULT false,
  CONSTRAINT business_setup_publication_revision_key UNIQUE (workspace_id, revision), CONSTRAINT business_setup_publication_operation_key UNIQUE (salon_id, operation_id),
  FOREIGN KEY (salon_id, workspace_id) REFERENCES business_setup_workspace(salon_id, id) ON DELETE CASCADE,
  FOREIGN KEY (workspace_id, revision) REFERENCES business_setup_revision(workspace_id, revision)
);
--> statement-breakpoint
-- Serialize existing canonical writers with setup publication for enrolled
-- salons. A contended reverse child/parent lock can abort with 40P01; callers
-- must retry the entire transaction, never a partially applied operation.
CREATE FUNCTION lock_business_setup_parent() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE target_salon text;
BEGIN
  IF TG_TABLE_NAME = 'technician_services' THEN
    SELECT salon_id INTO target_salon FROM service WHERE id = CASE WHEN TG_OP = 'DELETE' THEN OLD.service_id ELSE NEW.service_id END;
  ELSE
    target_salon := CASE WHEN TG_OP = 'DELETE' THEN OLD.salon_id ELSE NEW.salon_id END;
  END IF;
  IF EXISTS (SELECT 1 FROM business_setup_workspace WHERE salon_id = target_salon) THEN
    PERFORM id FROM salon WHERE id = target_salon FOR UPDATE;
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER business_setup_service_lock BEFORE INSERT OR UPDATE OR DELETE ON service FOR EACH ROW EXECUTE FUNCTION lock_business_setup_parent();
--> statement-breakpoint
CREATE TRIGGER business_setup_staff_lock BEFORE INSERT OR UPDATE OR DELETE ON technician FOR EACH ROW EXECUTE FUNCTION lock_business_setup_parent();
--> statement-breakpoint
CREATE TRIGGER business_setup_location_lock BEFORE INSERT OR UPDATE OR DELETE ON salon_location FOR EACH ROW EXECUTE FUNCTION lock_business_setup_parent();
--> statement-breakpoint
CREATE TRIGGER business_setup_addon_lock BEFORE INSERT OR UPDATE OR DELETE ON add_on FOR EACH ROW EXECUTE FUNCTION lock_business_setup_parent();
--> statement-breakpoint
CREATE TRIGGER business_setup_addon_link_lock BEFORE INSERT OR UPDATE OR DELETE ON service_add_on FOR EACH ROW EXECUTE FUNCTION lock_business_setup_parent();
--> statement-breakpoint
CREATE TRIGGER business_setup_assignment_lock BEFORE INSERT OR UPDATE OR DELETE ON technician_services FOR EACH ROW EXECUTE FUNCTION lock_business_setup_parent();
--> statement-breakpoint
CREATE TABLE business_setup_turn (
  id text PRIMARY KEY, salon_id text NOT NULL, workspace_id text NOT NULL, actor_id text NOT NULL,
  expected_revision integer NOT NULL, request_hash text NOT NULL, message text NOT NULL, reply text, operations jsonb,
  status text NOT NULL CHECK (status IN ('pending', 'generated', 'completed', 'failed')),
  input_tokens integer, output_tokens integer, cost_micro_usd integer,
  lease_expires_at timestamp NOT NULL, created_at timestamp NOT NULL DEFAULT now(),
  FOREIGN KEY (salon_id, workspace_id) REFERENCES business_setup_workspace(salon_id, id) ON DELETE CASCADE
);
