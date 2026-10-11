CREATE TABLE "burn_accruals" (
	"source_sig" text PRIMARY KEY NOT NULL,
	"mint" text NOT NULL,
	"lamports" bigint NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "burn_accruals_positive" CHECK ("burn_accruals"."lamports" > 0)
);
--> statement-breakpoint
CREATE TABLE "burn_transactions" (
	"signature" text PRIMARY KEY NOT NULL,
	"mint" text NOT NULL,
	"kind" text NOT NULL,
	"status" text NOT NULL,
	"lamports" bigint DEFAULT 0 NOT NULL,
	"tokens" text,
	"decimals" smallint,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"confirmed_at" timestamp with time zone,
	"posted_at" timestamp with time zone,
	CONSTRAINT "burn_transactions_kind" CHECK ("burn_transactions"."kind" IN ('buy','burn') AND "burn_transactions"."status" IN ('sent','confirmed','failed'))
);
--> statement-breakpoint
CREATE INDEX "burn_accruals_mint" ON "burn_accruals" USING btree ("mint");--> statement-breakpoint
CREATE INDEX "burn_transactions_mint" ON "burn_transactions" USING btree ("mint","kind","status");