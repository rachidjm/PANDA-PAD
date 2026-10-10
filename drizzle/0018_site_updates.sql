CREATE TABLE "site_updates" (
	"id" text PRIMARY KEY NOT NULL,
	"ts" bigint NOT NULL,
	"tag" text NOT NULL,
	"title_en" text NOT NULL,
	"title_es" text NOT NULL,
	"body_en" text NOT NULL,
	"body_es" text NOT NULL,
	"image_url" text,
	"source" text NOT NULL,
	"created_at" bigint NOT NULL,
	CONSTRAINT "site_updates_tag" CHECK ("site_updates"."tag" IN ('new', 'improved', 'fixed'))
);
--> statement-breakpoint
CREATE INDEX "site_updates_ts" ON "site_updates" USING btree ("ts");