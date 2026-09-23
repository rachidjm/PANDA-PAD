CREATE TABLE "activity_events" (
	"id" text PRIMARY KEY NOT NULL,
	"kind" text NOT NULL,
	"ts" bigint NOT NULL,
	"mint" text NOT NULL,
	"wallet" text,
	"lamports" bigint,
	"token_amount" double precision,
	"signature" text,
	"verified" boolean DEFAULT false NOT NULL,
	"recorded_day" date NOT NULL,
	"recorded_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "backfill_marks" (
	"wallet" text PRIMARY KEY NOT NULL,
	"at" bigint NOT NULL
);
--> statement-breakpoint
CREATE TABLE "economy_daily" (
	"day" date PRIMARY KEY NOT NULL,
	"volume_lamports" bigint DEFAULT 0 NOT NULL,
	"trades" bigint DEFAULT 0 NOT NULL,
	"trade_fee_lamports" bigint DEFAULT 0 NOT NULL,
	"creator_fee_lamports" bigint DEFAULT 0 NOT NULL,
	"creator_fee_treasury_lamports" bigint DEFAULT 0 NOT NULL,
	"creator_fee_pool_lamports" bigint DEFAULT 0 NOT NULL,
	"distributions" bigint DEFAULT 0 NOT NULL,
	"dropped" bigint DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "economy_total" (
	"id" smallint PRIMARY KEY DEFAULT 1 NOT NULL,
	"since" bigint,
	"volume_lamports" bigint DEFAULT 0 NOT NULL,
	"trades" bigint DEFAULT 0 NOT NULL,
	"trade_fee_lamports" bigint DEFAULT 0 NOT NULL,
	"creator_fee_lamports" bigint DEFAULT 0 NOT NULL,
	"creator_fee_treasury_lamports" bigint DEFAULT 0 NOT NULL,
	"creator_fee_pool_lamports" bigint DEFAULT 0 NOT NULL,
	"distributions" bigint DEFAULT 0 NOT NULL,
	"dropped" bigint DEFAULT 0 NOT NULL,
	CONSTRAINT "economy_total_single" CHECK ("economy_total"."id" = 1)
);
--> statement-breakpoint
CREATE TABLE "payout_days" (
	"day" date PRIMARY KEY NOT NULL,
	"paid_lamports" bigint DEFAULT 0 NOT NULL,
	CONSTRAINT "payout_days_nonneg" CHECK ("payout_days"."paid_lamports" >= 0)
);
--> statement-breakpoint
CREATE TABLE "protocol_pause" (
	"subsystem" text PRIMARY KEY NOT NULL,
	"paused" boolean NOT NULL,
	"reason" text NOT NULL,
	"since" bigint NOT NULL,
	"by_wallet" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "reward_balances" (
	"mint" text NOT NULL,
	"wallet" text NOT NULL,
	"credited_lamports" bigint DEFAULT 0 NOT NULL,
	"reserved_lamports" bigint DEFAULT 0 NOT NULL,
	"claimed_lamports" bigint DEFAULT 0 NOT NULL,
	CONSTRAINT "reward_balances_mint_wallet_pk" PRIMARY KEY("mint","wallet"),
	CONSTRAINT "reward_balances_no_overpay" CHECK ("reward_balances"."reserved_lamports" >= 0 AND "reward_balances"."claimed_lamports" >= 0 AND "reward_balances"."reserved_lamports" + "reward_balances"."claimed_lamports" <= "reward_balances"."credited_lamports")
);
--> statement-breakpoint
CREATE TABLE "reward_claims" (
	"id" uuid PRIMARY KEY NOT NULL,
	"mint" text NOT NULL,
	"wallet" text NOT NULL,
	"lamports" bigint NOT NULL,
	"status" text NOT NULL,
	"signature" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "reward_claims_positive" CHECK ("reward_claims"."lamports" > 0),
	CONSTRAINT "reward_claims_status" CHECK ("reward_claims"."status" IN ('reserved','sent','confirmed','failed','released'))
);
--> statement-breakpoint
CREATE TABLE "reward_credits" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "reward_credits_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"mint" text NOT NULL,
	"wallet" text NOT NULL,
	"lamports" bigint NOT NULL,
	"source_sig" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "reward_credits_once" UNIQUE("source_sig","mint","wallet"),
	CONSTRAINT "reward_credits_positive" CHECK ("reward_credits"."lamports" > 0)
);
--> statement-breakpoint
CREATE TABLE "reward_distributions" (
	"source_sig" text NOT NULL,
	"mint" text NOT NULL,
	"distributed_lamports" bigint NOT NULL,
	"dust_lamports" bigint NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "reward_distributions_source_sig_mint_pk" PRIMARY KEY("source_sig","mint"),
	CONSTRAINT "reward_distributions_nonneg" CHECK ("reward_distributions"."distributed_lamports" >= 0 AND "reward_distributions"."dust_lamports" >= 0)
);
--> statement-breakpoint
CREATE TABLE "reward_ledgers" (
	"mint" text PRIMARY KEY NOT NULL,
	"total_distributed_lamports" bigint DEFAULT 0 NOT NULL,
	"dust_lamports" bigint DEFAULT 0 NOT NULL,
	CONSTRAINT "reward_ledgers_nonneg" CHECK ("reward_ledgers"."total_distributed_lamports" >= 0 AND "reward_ledgers"."dust_lamports" >= 0)
);
--> statement-breakpoint
CREATE TABLE "reward_registry" (
	"mint" text PRIMARY KEY NOT NULL,
	"registered_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "trades" (
	"signature" text NOT NULL,
	"wallet" text NOT NULL,
	"mint" text NOT NULL,
	"ticker" text NOT NULL,
	"side" text NOT NULL,
	"sol_amount" double precision NOT NULL,
	"token_amount" double precision NOT NULL,
	"sol_price_usd_at_trade" double precision NOT NULL,
	"ts" bigint NOT NULL,
	"estimated" boolean DEFAULT false NOT NULL,
	"seq" bigint GENERATED ALWAYS AS IDENTITY (sequence name "trades_seq_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	CONSTRAINT "trades_wallet_signature_pk" PRIMARY KEY("wallet","signature"),
	CONSTRAINT "trades_side" CHECK ("trades"."side" IN ('buy','sell'))
);
--> statement-breakpoint
CREATE INDEX "activity_events_day" ON "activity_events" USING btree ("recorded_day");--> statement-breakpoint
CREATE INDEX "activity_events_mint" ON "activity_events" USING btree ("mint");--> statement-breakpoint
CREATE INDEX "reward_balances_wallet" ON "reward_balances" USING btree ("wallet");--> statement-breakpoint
CREATE INDEX "reward_claims_holder" ON "reward_claims" USING btree ("mint","wallet");--> statement-breakpoint
CREATE INDEX "reward_claims_open" ON "reward_claims" USING btree ("status");--> statement-breakpoint
CREATE INDEX "reward_credits_wallet" ON "reward_credits" USING btree ("wallet");--> statement-breakpoint
CREATE INDEX "trades_wallet_seq" ON "trades" USING btree ("wallet","seq");