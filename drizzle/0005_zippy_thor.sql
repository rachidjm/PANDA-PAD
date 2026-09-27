CREATE TABLE "referral_payouts" (
	"signature" text NOT NULL,
	"referrer" text NOT NULL,
	"referred" text NOT NULL,
	"mint" text NOT NULL,
	"lamports" bigint NOT NULL,
	"ts" bigint NOT NULL,
	CONSTRAINT "referral_payouts_signature_referrer_pk" PRIMARY KEY("signature","referrer"),
	CONSTRAINT "referral_payouts_positive" CHECK ("referral_payouts"."lamports" > 0)
);
--> statement-breakpoint
CREATE TABLE "referrals" (
	"wallet" text PRIMARY KEY NOT NULL,
	"referrer" text NOT NULL,
	"bound_at" bigint NOT NULL,
	CONSTRAINT "referrals_no_self" CHECK ("referrals"."wallet" <> "referrals"."referrer")
);
--> statement-breakpoint
CREATE INDEX "referral_payouts_referrer" ON "referral_payouts" USING btree ("referrer");--> statement-breakpoint
CREATE INDEX "referrals_referrer" ON "referrals" USING btree ("referrer");