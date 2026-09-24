CREATE TABLE "pending_fee_locks" (
	"mint" text PRIMARY KEY NOT NULL,
	"creator" text NOT NULL,
	"ts" bigint NOT NULL,
	"shareholders" jsonb,
	"audited_at" bigint
);
