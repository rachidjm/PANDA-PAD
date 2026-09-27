CREATE TABLE "vanity_mint_keys" (
	"pubkey" text PRIMARY KEY NOT NULL,
	"suffix" text NOT NULL,
	"ciphertext" text NOT NULL,
	"nonce" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"claimed_at" bigint
);
--> statement-breakpoint
CREATE INDEX "vanity_mint_keys_available" ON "vanity_mint_keys" USING btree ("suffix","claimed_at");