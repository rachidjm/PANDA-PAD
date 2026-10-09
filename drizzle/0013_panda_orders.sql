CREATE TABLE "panda_nonce_accounts" (
	"address" text PRIMARY KEY NOT NULL,
	"wallet" text NOT NULL,
	"seed" text NOT NULL,
	"state" text NOT NULL,
	"created_at" bigint NOT NULL,
	"updated_at" bigint NOT NULL,
	CONSTRAINT "panda_nonce_accounts_state" CHECK ("panda_nonce_accounts"."state" IN ('pending', 'ready', 'closed'))
);
--> statement-breakpoint
CREATE TABLE "panda_orders" (
	"id" text PRIMARY KEY NOT NULL,
	"wallet" text NOT NULL,
	"mint" text NOT NULL,
	"ticker" text NOT NULL,
	"group_id" text NOT NULL,
	"tranche_id" text NOT NULL,
	"n" smallint NOT NULL,
	"leg" text NOT NULL,
	"venue" text NOT NULL,
	"pool" text,
	"pct" double precision NOT NULL,
	"nonce_account" text NOT NULL,
	"nonce_value" text NOT NULL,
	"token_amount_raw" text NOT NULL,
	"token_decimals" smallint NOT NULL,
	"trigger_out_lamports" bigint NOT NULL,
	"min_out_lamports" bigint NOT NULL,
	"fee_lamports" bigint NOT NULL,
	"target_usd" double precision NOT NULL,
	"ref_usd" double precision NOT NULL,
	"state" text NOT NULL,
	"reason" text,
	"message_hash" text NOT NULL,
	"tx_ciphertext" text,
	"tx_iv" text,
	"signature" text,
	"notice" text,
	"notice_at" bigint,
	"last_checked_at" bigint,
	"unknown_failures" smallint DEFAULT 0 NOT NULL,
	"sent_at" bigint,
	"executed_at" bigint,
	"created_at" bigint NOT NULL,
	"updated_at" bigint NOT NULL,
	CONSTRAINT "panda_orders_state_check" CHECK ("panda_orders"."state" IN ('prepared', 'active', 'sending', 'executed', 'cancelled', 'needs_resign')),
	CONSTRAINT "panda_orders_leg_check" CHECK ("panda_orders"."leg" IN ('sell', 'stop')),
	CONSTRAINT "panda_orders_venue_check" CHECK ("panda_orders"."venue" IN ('curve', 'amm')),
	CONSTRAINT "panda_orders_amounts" CHECK ("panda_orders"."trigger_out_lamports" > 0 AND "panda_orders"."min_out_lamports" > 0 AND "panda_orders"."min_out_lamports" <= "panda_orders"."trigger_out_lamports" AND "panda_orders"."fee_lamports" >= 0),
	CONSTRAINT "panda_orders_pct" CHECK ("panda_orders"."pct" > 0 AND "panda_orders"."pct" <= 100)
);
--> statement-breakpoint
CREATE INDEX "panda_nonce_accounts_wallet" ON "panda_nonce_accounts" USING btree ("wallet");--> statement-breakpoint
CREATE INDEX "panda_orders_wallet_mint" ON "panda_orders" USING btree ("wallet","mint");--> statement-breakpoint
CREATE INDEX "panda_orders_state" ON "panda_orders" USING btree ("state");--> statement-breakpoint
CREATE INDEX "panda_orders_group" ON "panda_orders" USING btree ("group_id");--> statement-breakpoint
CREATE UNIQUE INDEX "panda_orders_live_leg" ON "panda_orders" USING btree ("nonce_account","leg") WHERE "panda_orders"."state" IN ('prepared', 'active', 'sending');