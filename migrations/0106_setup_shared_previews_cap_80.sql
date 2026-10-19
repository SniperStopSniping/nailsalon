-- The owner explicitly raised the cumulative testing limit to CAD 80.
-- Preserve the existing ledger; this does not itself increase any budget row.
ALTER TABLE setup_ai_budget DROP CONSTRAINT setup_ai_budget_cap_micro_cad_check;
--> statement-breakpoint
ALTER TABLE setup_ai_budget ADD CONSTRAINT setup_ai_budget_cap_micro_cad_check
CHECK (cap_micro_cad > 0 AND cap_micro_cad <= 80000000);
--> statement-breakpoint
CREATE TABLE business_setup_preview_share (
  token_hash text PRIMARY KEY,
  salon_id text NOT NULL,
  workspace_id text NOT NULL,
  revision integer NOT NULL,
  actor_id text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  revoked_at timestamptz,
  FOREIGN KEY (salon_id, workspace_id) REFERENCES business_setup_workspace (salon_id, id) ON DELETE CASCADE,
  FOREIGN KEY (workspace_id, revision) REFERENCES business_setup_revision (workspace_id, revision) ON DELETE CASCADE
);
