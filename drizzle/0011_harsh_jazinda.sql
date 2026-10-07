CREATE TABLE "holder_payout_runs" (
	"id" uuid PRIMARY KEY NOT NULL,
	"mint" text NOT NULL,
	"status" text NOT NULL,
	"holders_paid" smallint DEFAULT 0 NOT NULL,
	"lamports_paid" bigint DEFAULT 0 NOT NULL,
	"error" text,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "holder_payout_runs_status" CHECK ("holder_payout_runs"."status" IN ('done','failed')),
	CONSTRAINT "holder_payout_runs_nonneg" CHECK ("holder_payout_runs"."holders_paid" >= 0 AND "holder_payout_runs"."lamports_paid" >= 0)
);
--> statement-breakpoint
ALTER TABLE "reward_claims" ADD COLUMN "run_id" uuid;--> statement-breakpoint
CREATE INDEX "holder_payout_runs_mint" ON "holder_payout_runs" USING btree ("mint","started_at");--> statement-breakpoint
CREATE INDEX "reward_claims_run" ON "reward_claims" USING btree ("run_id");