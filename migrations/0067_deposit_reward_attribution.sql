-- D5-RWD-1: durable hold-time reward attribution.
--
-- The exact reward chosen by the authoritative booking-price resolver is
-- stored on the deposit aggregate in the same transaction as the hold.  It is
-- intentionally nullable: deposits without a reward and all pre-RWD deposits
-- keep their existing shape and behaviour.
--
-- No reward FK is added.  A bare FK would prove only that an id exists, not
-- salon/client ownership, and would add a new deletion-order dependency.  The
-- booking transaction validates and locks the exact tenant-owned reward before
-- this value is written; confirmation validates it again before consumption.
ALTER TABLE "appointment_deposit" ADD COLUMN "applied_reward_id" text;
--> statement-breakpoint
ALTER TABLE "appointment_deposit" ADD COLUMN "applied_reward_client_id" text;
--> statement-breakpoint
ALTER TABLE "appointment_deposit" ADD COLUMN "applied_reward_client_phone" text;
--> statement-breakpoint

-- The owner snapshot and reward id are one typed attribution.  Keeping the
-- canonical client id and exact reward-row phone make later consumption
-- independent of mutable live contact details while still proving the full
-- hold-time client ownership decision.
ALTER TABLE "appointment_deposit"
  ADD CONSTRAINT "appointment_deposit_reward_attribution_pair_chk"
  CHECK (
    (("applied_reward_id" IS NULL) = ("applied_reward_client_id" IS NULL))
    AND (("applied_reward_id" IS NULL) = ("applied_reward_client_phone" IS NULL))
  );
--> statement-breakpoint

-- Only an unpaid hold reserves a reward.  Confirmation atomically links the
-- exact reward before the row becomes observably paid, so paid history no
-- longer needs to suppress a reward that a later cancellation legitimately
-- releases.
CREATE UNIQUE INDEX "appointment_deposit_active_reward_uniq"
  ON "appointment_deposit" ("salon_id", "applied_reward_id")
  WHERE "applied_reward_id" IS NOT NULL
    AND "status" = 'checkout_created';
