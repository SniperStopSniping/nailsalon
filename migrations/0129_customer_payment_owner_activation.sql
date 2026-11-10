-- Owner opt-in is separate from inert preparation policies. No default activation.
CREATE TABLE customer_payment_workspace_policy (
 salon_id text PRIMARY KEY REFERENCES salon(id) ON DELETE RESTRICT,
 revision integer NOT NULL CHECK (revision BETWEEN 1 AND 2147483646),
 enabled boolean NOT NULL DEFAULT false,
 cancellation_policy text NOT NULL CHECK (length(cancellation_policy)<=5000),
 binding_id text,
 platform_account_id text,
 livemode boolean NOT NULL,
 actor_id text NOT NULL CHECK (length(actor_id) BETWEEN 1 AND 200),
 request_id uuid NOT NULL,
 request_hash text NOT NULL CHECK (request_hash ~ '^[a-f0-9]{64}$'),
 updated_at timestamptz NOT NULL DEFAULT now(),
 CHECK (NOT enabled OR (binding_id IS NOT NULL AND platform_account_id IS NOT NULL AND platform_account_id ~ '^acct_[A-Za-z0-9]+$' AND length(btrim(cancellation_policy))>0))
);
--> statement-breakpoint
CREATE TABLE customer_payment_workspace_policy_audit (
 salon_id text NOT NULL REFERENCES customer_payment_workspace_policy(salon_id) ON DELETE RESTRICT,
 revision integer NOT NULL,
 snapshot jsonb NOT NULL,
 actor_id text NOT NULL,
 request_id uuid NOT NULL,
 request_hash text NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(salon_id,revision),
 CONSTRAINT customer_payment_workspace_policy_request_once UNIQUE(salon_id,request_id)
);
--> statement-breakpoint
CREATE FUNCTION customer_payment_workspace_policy_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'PAYMENT_WORKSPACE_HISTORY_IMMUTABLE'; END IF;
 IF (TG_OP='INSERT' AND NEW.revision<>1) OR (TG_OP='UPDATE' AND (NEW.salon_id<>OLD.salon_id OR NEW.revision<>OLD.revision+1))
 THEN RAISE EXCEPTION 'PAYMENT_WORKSPACE_POLICY_STALE'; END IF;
 IF NOT EXISTS(SELECT 1 FROM admin_salon_membership WHERE salon_id=NEW.salon_id AND admin_id=NEW.actor_id AND role='owner')
 THEN RAISE EXCEPTION 'PAYMENT_WORKSPACE_OWNER_REQUIRED'; END IF;
 IF NEW.enabled AND NOT EXISTS(SELECT 1 FROM salon_stripe_account WHERE id=NEW.binding_id AND salon_id=NEW.salon_id AND revoked_at IS NULL AND livemode=NEW.livemode)
 THEN RAISE EXCEPTION 'PAYMENT_WORKSPACE_BINDING_REQUIRED'; END IF;
 NEW.updated_at=clock_timestamp();
 RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER payment_workspace_policy_guard BEFORE INSERT OR UPDATE OR DELETE ON customer_payment_workspace_policy FOR EACH ROW EXECUTE FUNCTION customer_payment_workspace_policy_guard();
--> statement-breakpoint
CREATE FUNCTION customer_payment_workspace_policy_audit_write() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 INSERT INTO customer_payment_workspace_policy_audit(salon_id,revision,snapshot,actor_id,request_id,request_hash,created_at)
 VALUES(NEW.salon_id,NEW.revision,to_jsonb(NEW),NEW.actor_id,NEW.request_id,NEW.request_hash,NEW.updated_at);
 RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER payment_workspace_policy_audit_write AFTER INSERT OR UPDATE ON customer_payment_workspace_policy FOR EACH ROW EXECUTE FUNCTION customer_payment_workspace_policy_audit_write();
--> statement-breakpoint
CREATE FUNCTION customer_payment_workspace_policy_audit_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF pg_trigger_depth()<2 OR NOT EXISTS(SELECT 1 FROM customer_payment_workspace_policy p WHERE p.salon_id=NEW.salon_id AND p.revision=NEW.revision AND to_jsonb(p)=NEW.snapshot AND p.actor_id=NEW.actor_id AND p.request_id=NEW.request_id AND p.request_hash=NEW.request_hash)
 THEN RAISE EXCEPTION 'PAYMENT_WORKSPACE_AUDIT_SOURCE_REQUIRED'; END IF;
 RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER payment_workspace_policy_audit_guard BEFORE INSERT ON customer_payment_workspace_policy_audit FOR EACH ROW EXECUTE FUNCTION customer_payment_workspace_policy_audit_guard();
--> statement-breakpoint
CREATE TRIGGER payment_workspace_policy_audit_immutable BEFORE UPDATE OR DELETE ON customer_payment_workspace_policy_audit FOR EACH ROW EXECUTE FUNCTION customer_payment_workspace_history_guard();
