ALTER TABLE "salon_signup_invite"
ADD COLUMN IF NOT EXISTS "result_salon_id" text;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "salon_signup_invite"
 ADD CONSTRAINT "salon_signup_invite_result_salon_id_salon_id_fk"
 FOREIGN KEY ("result_salon_id") REFERENCES "public"."salon"("id")
 ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "salon_signup_invite_result_salon_idx"
ON "salon_signup_invite" USING btree ("result_salon_id");
