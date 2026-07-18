ALTER TABLE "add_on"
  ADD COLUMN IF NOT EXISTS "template_key" text;
--> statement-breakpoint


CREATE UNIQUE INDEX IF NOT EXISTS "add_on_salon_template_key_idx"
  ON "add_on" ("salon_id", "template_key")
  WHERE "template_key" IS NOT NULL;
