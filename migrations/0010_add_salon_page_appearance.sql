CREATE TABLE IF NOT EXISTS "salon_page_appearance" (
	"id" text PRIMARY KEY NOT NULL,
	"salon_id" text NOT NULL,
	"page_name" text NOT NULL,
	"mode" text DEFAULT 'custom' NOT NULL,
	"theme_key" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "salon_page_appearance" ADD CONSTRAINT "salon_page_appearance_salon_id_salon_id_fk" FOREIGN KEY ("salon_id") REFERENCES "public"."salon"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "salon_page_appearance_unique" ON "salon_page_appearance" USING btree ("salon_id","page_name");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "salon_page_appearance_salon_idx" ON "salon_page_appearance" USING btree ("salon_id");


