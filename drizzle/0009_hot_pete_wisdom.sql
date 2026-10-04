CREATE TABLE "reserved_mint_keys" (
	"purpose" text PRIMARY KEY NOT NULL,
	"pubkey" text NOT NULL,
	"ciphertext" text NOT NULL,
	"nonce" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"used_at" bigint,
	CONSTRAINT "reserved_mint_keys_pubkey_unique" UNIQUE("pubkey")
);
