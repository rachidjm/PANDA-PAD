CREATE TABLE "audit_anchors" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "audit_anchors_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"head_seq" bigint NOT NULL,
	"head_hash" text NOT NULL,
	"signature" text NOT NULL,
	"wallet" text NOT NULL,
	"anchored_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "audit_anchors_signature_unique" UNIQUE("signature")
);
--> statement-breakpoint
CREATE TABLE "audit_events" (
	"seq" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "audit_events_seq_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"event_id" text NOT NULL,
	"ts" bigint NOT NULL,
	"actor" text NOT NULL,
	"action" text NOT NULL,
	"object" text NOT NULL,
	"old_state" jsonb,
	"new_state" jsonb,
	"reason" text,
	"request_id" text NOT NULL,
	"prev_hash" text NOT NULL,
	"hash" text NOT NULL,
	CONSTRAINT "audit_events_event_id_unique" UNIQUE("event_id")
);
--> statement-breakpoint
CREATE INDEX "audit_events_ts" ON "audit_events" USING btree ("ts");--> statement-breakpoint
CREATE INDEX "audit_events_action" ON "audit_events" USING btree ("action");