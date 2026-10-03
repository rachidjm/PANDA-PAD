CREATE TABLE "founder_allocations" (
	"wallet" text PRIMARY KEY NOT NULL,
	"rank" smallint NOT NULL,
	"reserved_at" bigint NOT NULL,
	"minted_at" bigint,
	"asset_id" text,
	CONSTRAINT "founder_allocations_rank" UNIQUE("rank"),
	CONSTRAINT "founder_allocations_rank_range" CHECK ("founder_allocations"."rank" >= 1 AND "founder_allocations"."rank" <= 1000)
);
--> statement-breakpoint
CREATE TABLE "founder_panda_accrual" (
	"wallet" text PRIMARY KEY NOT NULL,
	"pending_base_units" bigint DEFAULT 0 NOT NULL,
	"total_accrued_base_units" bigint DEFAULT 0 NOT NULL,
	"total_claimed_base_units" bigint DEFAULT 0 NOT NULL,
	"updated_at" bigint NOT NULL,
	CONSTRAINT "founder_panda_accrual_nonneg" CHECK ("founder_panda_accrual"."pending_base_units" >= 0 AND "founder_panda_accrual"."total_accrued_base_units" >= 0 AND "founder_panda_accrual"."total_claimed_base_units" >= 0 AND "founder_panda_accrual"."total_claimed_base_units" <= "founder_panda_accrual"."total_accrued_base_units")
);
--> statement-breakpoint
CREATE TABLE "panda_launches" (
	"mint" text PRIMARY KEY NOT NULL,
	"creator" text NOT NULL,
	"launched_at" bigint NOT NULL
);
--> statement-breakpoint
CREATE TABLE "referral_daily_volume" (
	"wallet" text NOT NULL,
	"day" date NOT NULL,
	"volume_lamports" bigint DEFAULT 0 NOT NULL,
	CONSTRAINT "referral_daily_volume_wallet_day_pk" PRIMARY KEY("wallet","day"),
	CONSTRAINT "referral_daily_volume_nonneg" CHECK ("referral_daily_volume"."volume_lamports" >= 0)
);
--> statement-breakpoint
ALTER TABLE "referrals" ADD COLUMN "last_qualifying_day" date;--> statement-breakpoint
ALTER TABLE "referrals" ADD COLUMN "streak_at_last_qualifying_day" smallint DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "referrals" ADD COLUMN "first_activated_at" bigint;--> statement-breakpoint
CREATE INDEX "referrals_referrer_first_activated" ON "referrals" USING btree ("referrer","first_activated_at");--> statement-breakpoint
ALTER TABLE "referrals" ADD CONSTRAINT "referrals_streak_nonneg" CHECK ("referrals"."streak_at_last_qualifying_day" >= 0);