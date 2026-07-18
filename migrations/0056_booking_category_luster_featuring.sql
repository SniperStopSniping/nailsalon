DO $$
BEGIN
  CREATE TYPE "booking_category" AS ENUM (
    'manicure',
    'pedicure',
    'combo'
  );
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint


ALTER TABLE "service"
  ADD COLUMN IF NOT EXISTS "booking_category" "booking_category",
  ADD COLUMN IF NOT EXISTS "featured_order" integer,
  ADD COLUMN IF NOT EXISTS "template_key" text;
--> statement-breakpoint


UPDATE "service"
SET "booking_category" = CASE
  WHEN "category" IN ('pedicure', 'feet') THEN 'pedicure'::"booking_category"
  WHEN "category" = 'combo' THEN 'combo'::"booking_category"
  ELSE 'manicure'::"booking_category"
END
WHERE "booking_category" IS NULL;
--> statement-breakpoint


ALTER TABLE "service" ALTER COLUMN "booking_category" SET DEFAULT 'manicure';
--> statement-breakpoint


ALTER TABLE "service" ALTER COLUMN "booking_category" SET NOT NULL;
--> statement-breakpoint


UPDATE "service" s
SET "template_key" = 'luster_manicure'
FROM (
  SELECT DISTINCT ON ("salon_id") "id", "salon_id"
  FROM "service"
  WHERE lower("name") LIKE '%luster%'
    AND "category" NOT IN ('pedicure', 'feet', 'combo')
  ORDER BY "salon_id", ("is_active" IS TRUE) DESC, "sort_order" ASC NULLS LAST, "id" ASC
) best
WHERE s."id" = best."id"
  AND s."template_key" IS NULL
  AND NOT EXISTS (
    SELECT 1 FROM "service" existing
    WHERE existing."salon_id" = best."salon_id"
      AND existing."template_key" = 'luster_manicure'
  );
--> statement-breakpoint


CREATE UNIQUE INDEX IF NOT EXISTS "service_salon_template_key_idx"
  ON "service" ("salon_id", "template_key")
  WHERE "template_key" IS NOT NULL;
