ALTER TABLE "telegram_changelogs" ADD COLUMN "kind" text DEFAULT 'changelog' NOT NULL;--> statement-breakpoint
ALTER TABLE "telegram_changelogs" ADD COLUMN "versions" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "telegram_changelogs" ADD COLUMN "published_version" smallint;