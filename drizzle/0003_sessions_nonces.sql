CREATE TABLE "auth_nonces" (
	"nonce" text PRIMARY KEY NOT NULL,
	"wallet" text NOT NULL,
	"issued_at" bigint NOT NULL,
	"expires_at" bigint NOT NULL,
	"used_at" bigint
);
--> statement-breakpoint
CREATE TABLE "sessions" (
	"jti" uuid PRIMARY KEY NOT NULL,
	"wallet" text NOT NULL,
	"issued_at" bigint NOT NULL,
	"expires_at" bigint NOT NULL,
	"revoked_at" bigint,
	"revoked_reason" text
);
--> statement-breakpoint
CREATE INDEX "auth_nonces_expires" ON "auth_nonces" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX "sessions_wallet" ON "sessions" USING btree ("wallet");--> statement-breakpoint
CREATE INDEX "sessions_expires" ON "sessions" USING btree ("expires_at");