CREATE TABLE "referral_attempts" (
	"wallet" text PRIMARY KEY NOT NULL,
	"referrer" text NOT NULL,
	"source" text NOT NULL,
	"code" text,
	"status" text NOT NULL,
	"updated_at" bigint NOT NULL,
	CONSTRAINT "referral_attempts_no_self" CHECK ("referral_attempts"."wallet" <> "referral_attempts"."referrer"),
	CONSTRAINT "referral_attempts_source" CHECK ("referral_attempts"."source" in ('link', 'code')),
	CONSTRAINT "referral_attempts_status" CHECK ("referral_attempts"."status" in ('pending', 'rejected'))
);
--> statement-breakpoint
ALTER TABLE "referrals" ADD COLUMN "source" text DEFAULT 'link' NOT NULL;--> statement-breakpoint
ALTER TABLE "referrals" ADD COLUMN "code" text;--> statement-breakpoint
CREATE INDEX "referral_attempts_referrer" ON "referral_attempts" USING btree ("referrer");--> statement-breakpoint
ALTER TABLE "referrals" ADD CONSTRAINT "referrals_source" CHECK ("referrals"."source" in ('link', 'code'));