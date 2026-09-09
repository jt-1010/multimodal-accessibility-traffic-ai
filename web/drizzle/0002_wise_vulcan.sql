ALTER TABLE "menu_items" ADD COLUMN "image_url" text;--> statement-breakpoint
ALTER TABLE "menu_items" ADD COLUMN "image_source" text DEFAULT '' NOT NULL;