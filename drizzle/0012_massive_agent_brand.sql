CREATE TABLE "referral_attempt_log" (
	"id" uuid PRIMARY KEY NOT NULL,
	"wallet" text,
	"code" text,
	"referrer" text,
	"kind" text NOT NULL,
	"result" text NOT NULL,
	"reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "referral_attempt_log_kind" CHECK ("referral_attempt_log"."kind" IN ('apply_code','sign_in')),
	CONSTRAINT "referral_attempt_log_result" CHECK ("referral_attempt_log"."result" IN ('bound','pending','rejected','already_bound','already_traded','invalid_code','error'))
);
--> statement-breakpoint
CREATE INDEX "referral_attempt_log_code" ON "referral_attempt_log" USING btree ("code");--> statement-breakpoint
CREATE INDEX "referral_attempt_log_wallet" ON "referral_attempt_log" USING btree ("wallet");--> statement-breakpoint
CREATE INDEX "referral_attempt_log_referrer" ON "referral_attempt_log" USING btree ("referrer");--> statement-breakpoint
CREATE INDEX "referral_attempt_log_created" ON "referral_attempt_log" USING btree ("created_at");