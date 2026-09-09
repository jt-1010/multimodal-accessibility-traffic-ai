ALTER TABLE "menu_items" ADD COLUMN "protein_g" integer;--> statement-breakpoint
ALTER TABLE "menu_items" ADD COLUMN "price_source" text DEFAULT 'estimated' NOT NULL;--> statement-breakpoint
ALTER TABLE "menu_items" ADD COLUMN "nutrition_source" text DEFAULT '' NOT NULL;