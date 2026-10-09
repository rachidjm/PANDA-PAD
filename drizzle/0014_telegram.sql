CREATE TABLE "telegram_alerts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"telegram_id" bigint NOT NULL,
	"mint" text NOT NULL,
	"ticker" text NOT NULL,
	"metric" text NOT NULL,
	"direction" text NOT NULL,
	"value" double precision NOT NULL,
	"created_at" bigint NOT NULL,
	"fired_at" bigint,
	CONSTRAINT "telegram_alerts_metric" CHECK ("telegram_alerts"."metric" IN ('price', 'mcap')),
	CONSTRAINT "telegram_alerts_direction" CHECK ("telegram_alerts"."direction" IN ('above', 'below')),
	CONSTRAINT "telegram_alerts_value" CHECK ("telegram_alerts"."value" > 0)
);
--> statement-breakpoint
CREATE TABLE "telegram_link_codes" (
	"code_hash" text PRIMARY KEY NOT NULL,
	"telegram_id" bigint NOT NULL,
	"created_at" bigint NOT NULL,
	"expires_at" bigint NOT NULL,
	"used_at" bigint,
	"used_by_wallet" text
);
--> statement-breakpoint
CREATE TABLE "telegram_outbox" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "telegram_outbox_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"dedupe_key" text,
	"chat_id" text NOT NULL,
	"method" text NOT NULL,
	"payload" jsonb NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"attempts" smallint DEFAULT 0 NOT NULL,
	"next_attempt_at" bigint NOT NULL,
	"last_error" text,
	"created_at" bigint NOT NULL,
	"sent_at" bigint,
	CONSTRAINT "telegram_outbox_status" CHECK ("telegram_outbox"."status" IN ('pending', 'sent', 'failed')),
	CONSTRAINT "telegram_outbox_method" CHECK ("telegram_outbox"."method" IN ('sendMessage', 'sendPhoto'))
);
--> statement-breakpoint
CREATE TABLE "telegram_state" (
	"key" text PRIMARY KEY NOT NULL,
	"value" jsonb NOT NULL,
	"updated_at" bigint NOT NULL
);
--> statement-breakpoint
CREATE TABLE "telegram_suggestions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"telegram_id" bigint NOT NULL,
	"text" text NOT NULL,
	"created_at" bigint NOT NULL,
	CONSTRAINT "telegram_suggestions_len" CHECK (char_length("telegram_suggestions"."text") BETWEEN 1 AND 1000)
);
--> statement-breakpoint
CREATE TABLE "telegram_updates" (
	"update_id" bigint PRIMARY KEY NOT NULL,
	"received_at" bigint NOT NULL
);
--> statement-breakpoint
CREATE TABLE "telegram_users" (
	"telegram_id" bigint PRIMARY KEY NOT NULL,
	"lang" text DEFAULT 'en' NOT NULL,
	"wallet" text,
	"linked_at" bigint,
	"blocked" boolean DEFAULT false NOT NULL,
	"created_at" bigint NOT NULL,
	"updated_at" bigint NOT NULL,
	CONSTRAINT "telegram_users_lang" CHECK ("telegram_users"."lang" IN ('en', 'es'))
);
--> statement-breakpoint
CREATE TABLE "telegram_watchlist" (
	"telegram_id" bigint NOT NULL,
	"mint" text NOT NULL,
	"created_at" bigint NOT NULL,
	CONSTRAINT "telegram_watchlist_telegram_id_mint_pk" PRIMARY KEY("telegram_id","mint")
);
--> statement-breakpoint
CREATE INDEX "telegram_alerts_user" ON "telegram_alerts" USING btree ("telegram_id");--> statement-breakpoint
CREATE INDEX "telegram_alerts_live" ON "telegram_alerts" USING btree ("mint") WHERE "telegram_alerts"."fired_at" IS NULL;--> statement-breakpoint
CREATE INDEX "telegram_link_codes_user" ON "telegram_link_codes" USING btree ("telegram_id");--> statement-breakpoint
CREATE INDEX "telegram_link_codes_expires" ON "telegram_link_codes" USING btree ("expires_at");--> statement-breakpoint
CREATE UNIQUE INDEX "telegram_outbox_dedupe" ON "telegram_outbox" USING btree ("dedupe_key") WHERE "telegram_outbox"."dedupe_key" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "telegram_outbox_due" ON "telegram_outbox" USING btree ("status","next_attempt_at");--> statement-breakpoint
CREATE INDEX "telegram_outbox_chat_sent" ON "telegram_outbox" USING btree ("chat_id","sent_at");--> statement-breakpoint
CREATE INDEX "telegram_suggestions_created" ON "telegram_suggestions" USING btree ("created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "telegram_users_wallet" ON "telegram_users" USING btree ("wallet") WHERE "telegram_users"."wallet" IS NOT NULL;