CREATE TABLE IF NOT EXISTS "network_no_show_platform_control" (
	"id" integer PRIMARY KEY DEFAULT 1 NOT NULL,
	"enabled_at" timestamp with time zone,
	"prospective_after" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "network_no_show_platform_control_singleton" CHECK ("network_no_show_platform_control"."id" = 1)
);
--> statement-breakpoint
DROP TABLE "network_no_show_participation";--> statement-breakpoint
