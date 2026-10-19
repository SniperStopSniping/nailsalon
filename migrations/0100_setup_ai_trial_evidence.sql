ALTER TABLE custom_site_generation ADD COLUMN request jsonb;
--> statement-breakpoint
ALTER TABLE custom_site_generation ADD COLUMN phase text NOT NULL DEFAULT 'waiting';
--> statement-breakpoint
CREATE TABLE setup_ai_budget (
 id text PRIMARY KEY, cap_micro_cad integer NOT NULL CHECK(cap_micro_cad > 0 AND cap_micro_cad <= 40000000)
);
--> statement-breakpoint
CREATE TABLE setup_ai_call (
 id text PRIMARY KEY, budget_id text NOT NULL REFERENCES setup_ai_budget(id),
 salon_id text NOT NULL, actor_id text NOT NULL, operation_id text NOT NULL, ordinal integer NOT NULL,
 model text NOT NULL, provider text NOT NULL, request_hash text NOT NULL,
 reserved_micro_usd integer NOT NULL CHECK(reserved_micro_usd >= 0),
 charged_micro_cad integer NOT NULL CHECK(charged_micro_cad >= 0),
 cost_micro_usd integer, input_tokens integer, output_tokens integer, elapsed_ms integer,
 status text NOT NULL CHECK(status IN ('pending','completed','incomplete','failed')),
 raw_output text, validation text NOT NULL DEFAULT 'unchecked', created_at timestamp NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE UNIQUE INDEX setup_ai_call_request_key ON setup_ai_call(operation_id,ordinal);
--> statement-breakpoint
ALTER TABLE business_setup_turn ADD COLUMN design_request text;
--> statement-breakpoint
ALTER TABLE business_setup_turn ADD COLUMN design_operation_id text;
