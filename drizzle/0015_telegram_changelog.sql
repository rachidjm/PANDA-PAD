CREATE TABLE "telegram_changelogs" (
	"id" text PRIMARY KEY NOT NULL,
	"text" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"decided_by" bigint,
	"decided_at" bigint,
	"created_at" bigint NOT NULL,
	CONSTRAINT "telegram_changelogs_status" CHECK ("telegram_changelogs"."status" IN ('pending', 'published', 'discarded')),
	CONSTRAINT "telegram_changelogs_len" CHECK (char_length("telegram_changelogs"."text") BETWEEN 1 AND 3500)
);
--> statement-breakpoint
CREATE INDEX "telegram_changelogs_created" ON "telegram_changelogs" USING btree ("created_at");