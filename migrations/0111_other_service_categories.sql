-- Neutral grouping for owner-authored appointments outside the nail catalogue.
-- Existing services, booking groups, appointments and prices remain unchanged.
ALTER TYPE "service_category" ADD VALUE IF NOT EXISTS 'other';
--> statement-breakpoint
ALTER TYPE "booking_category" ADD VALUE IF NOT EXISTS 'other';
