CREATE UNIQUE INDEX IF NOT EXISTS "admin_user_normalized_email_idx"
ON "admin_user" USING btree (lower("email"))
WHERE "email" IS NOT NULL;
