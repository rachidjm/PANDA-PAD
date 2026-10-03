CREATE TABLE "legacy_fee_wallets" (
	"wallet" text PRIMARY KEY NOT NULL,
	"marked_at" bigint NOT NULL
);
--> statement-breakpoint
CREATE TABLE "recruiter_codes" (
	"code" text PRIMARY KEY NOT NULL,
	"wallet" text NOT NULL,
	"created_at" bigint NOT NULL,
	CONSTRAINT "recruiter_codes_wallet_unique" UNIQUE("wallet")
);
