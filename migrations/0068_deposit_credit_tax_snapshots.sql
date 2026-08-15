-- D6.1 deposit-credit invoice identity and tax snapshots.
--
-- All new facts are nullable. NULL explicitly means that the corresponding
-- fact is unknown or its lifecycle event has not occurred. The one historical
-- currency backfill below is evidence-based: 0065 constrains every deposit to
-- `currency = 'cad'` and tenant-binds it to its appointment.

ALTER TABLE "appointment"
  ADD COLUMN IF NOT EXISTS "invoice_currency" text,
  ADD COLUMN IF NOT EXISTS "booking_tax_snapshot" jsonb,
  ADD COLUMN IF NOT EXISTS "reschedule_tax_snapshot" jsonb,
  ADD COLUMN IF NOT EXISTS "final_tax_snapshot" jsonb;
--> statement-breakpoint

DO $$
BEGIN
  ALTER TABLE "appointment"
    ADD CONSTRAINT "appointment_invoice_currency_valid"
    CHECK (
      "invoice_currency" IS NULL
      OR "invoice_currency" IN ('CAD', 'USD')
    );
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint

-- A pre-0068 deposit is durable proof that its appointment's invoice currency
-- was CAD. This preserves historical deposit credit without consulting mutable
-- current salon settings. Appointments without that proof remain NULL, and no
-- historical tax snapshot is synthesized.
UPDATE "appointment" AS "a"
SET "invoice_currency" = 'CAD'
WHERE "a"."invoice_currency" IS NULL
  AND EXISTS (
    SELECT 1
    FROM "appointment_deposit" AS "d"
    WHERE "d"."salon_id" = "a"."salon_id"
      AND "d"."appointment_id" = "a"."id"
      AND "d"."currency" = 'cad'
  );
--> statement-breakpoint

ALTER TABLE "appointment_deposit"
  ADD COLUMN IF NOT EXISTS "collected_at" timestamptz,
  ADD COLUMN IF NOT EXISTS "forfeited_at" timestamptz,
  ADD COLUMN IF NOT EXISTS "forfeiture_tax_snapshot" jsonb;
--> statement-breakpoint

ALTER TABLE "appointment_payment"
  ADD COLUMN IF NOT EXISTS "idempotency_key" text;
--> statement-breakpoint

-- New payment rows are tenant-bound to their appointment. Existing mismatches
-- (if any) do not make the migration destructive: the NOT VALID constraint
-- protects all future writes immediately, runtime ledger resolution blocks the
-- historical row, and a clean cohort is validated in-place below.
DO $$
BEGIN
  ALTER TABLE "appointment_payment"
    ADD CONSTRAINT "appointment_payment_appointment_tenant_fk"
    FOREIGN KEY ("salon_id", "appointment_id")
    REFERENCES "appointment"("salon_id", "id")
    ON DELETE CASCADE
    NOT VALID;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM "appointment_payment" AS "payment"
    LEFT JOIN "appointment" AS "appointment"
      ON "appointment"."salon_id" = "payment"."salon_id"
     AND "appointment"."id" = "payment"."appointment_id"
    WHERE "appointment"."id" IS NULL
  ) THEN
    ALTER TABLE "appointment_payment"
      VALIDATE CONSTRAINT "appointment_payment_appointment_tenant_fk";
  END IF;
END $$;
--> statement-breakpoint

-- The tenant and appointment are both part of the durable identity. Historical
-- rows remain NULL and may repeat; only explicit retry identities are unique.
CREATE UNIQUE INDEX IF NOT EXISTS "appointment_payment_tenant_idempotency_uniq"
  ON "appointment_payment" ("salon_id", "appointment_id", "idempotency_key")
  WHERE "idempotency_key" IS NOT NULL;
