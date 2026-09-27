# Vanity mint addresses ("…panda")

Every coin PANDA creates uses a mint keypair — an account that has to sign its own creation. To give that
address a fixed ending ("panda", lowercase), PANDA keeps a small pre-generated **stock** of matching keypairs
in Postgres, encrypted at rest, and hands one out per launch (`src/lib/vanity/stock.ts`). If the stock is ever
empty, the launch still goes through with a normal, random address — **a launch is never blocked, delayed, or
made to wait on this.** Ops gets alerted instead (`ALERT_WEBHOOK_URL`, or the Vercel logs if that isn't set).

Generating a vanity address is CPU-bound, unpredictable in how long any ONE address takes, and can run for
minutes to hours — nothing serverless (Vercel's functions have a hard time limit) can do it. It has to run
somewhere with no time limit: your own machine, or a GitHub Action.

## 1. Generate keypairs

Install the [Solana CLI](https://docs.anza.xyz/cli/install) (gives you `solana-keygen`; Windows: the installer
script works in PowerShell, or use WSL). Then, in an empty folder:

```bash
mkdir vanity-keys && cd vanity-keys
solana-keygen grind --ends-with panda:20 --num-threads 8
```

- `--ends-with panda:20` — grind until you have 20 addresses ending in exactly `panda` (lowercase; matching is
  case-sensitive by default, so this is the literal 5 characters "panda", not "Panda" or "PANDA").
- `--num-threads 8` — use as many threads as your machine has cores; more threads finds matches faster.
- Each match is written as `<pubkey>.json` in the current folder (a Solana keypair file — the same format
  `Keypair.fromSecretKey`/`solana-keygen new` use).

**How long this takes.** A 5-character suffix is 58⁵ ≈ 656 million possible combinations (base58 has 58
characters). This is genuinely CPU-dependent and there's no way to give you an exact number without inventing
one — the honest way to know is to grind for 60 seconds first and see how many attempts it logs per second on
*your* machine, then divide. As a rough, widely-reported range for `solana-keygen grind` on ordinary CPU
hardware: **a 5-character suffix commonly takes minutes to a few hours per address**, faster with more
threads. If you want it meaningfully faster, a GPU-based vanity grinder (search "solana vanity address GPU") can
do orders of magnitude more attempts per second than a CPU — worth it only if you're generating a large batch.

**GitHub Action alternative** (so it runs on GitHub's runners instead of your PC): a workflow that installs the
Solana CLI, runs the same `solana-keygen grind` command with a time or count limit, and uploads the resulting
`*.json` files as a build artifact for you to download and import — say the word and this gets built as
`.github/workflows/vanity-grind.yml`; not created yet, since it needs your go-ahead on which GitHub runner
tier to use (a multi-hour grind on a hosted runner has real minutes-billed cost).

## 2. Set VANITY_STOCK_KEY (once)

The stock is encrypted at rest (AES-256-GCM) with `VANITY_STOCK_KEY`, a server-only Vercel env var — 32 random
bytes, base64-encoded. Generate one and set it in Vercel (Production), same discipline as every other secret
in this project: never in `NEXT_PUBLIC_*`, never pasted into chat.

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
```

Losing this key doesn't lose money (the stock rows just become unreadable — `claimMintKeypair` falls back to a
plain random address automatically) but it does lose whatever's left of the stock; back it up somewhere safe,
same as you would a private key.

## 3. Import into Postgres

With `DATABASE_URL` and `VANITY_STOCK_KEY` available locally (`vercel env pull .env.local` pulls both from
Vercel, or set them directly for a one-off run):

```bash
npm run vanity:import
```

This reads every `*.json` in `./vanity-keys` (pass `--dir <folder>` for a different one), re-derives each
public key from its own secret (never trusts the filename), skips anything that doesn't actually end in
"panda", encrypts and inserts the rest, and **deletes each file once it's safely in the database** — a
plaintext private key has no reason to keep sitting on disk afterward. Files that were already in the stock
(re-running on the same folder) are left alone, not deleted twice.

## How big a stock to keep

There's no way to know your real launch volume in advance, so don't front-load hours of grinding on a guess.
Start with a small batch — **~20–50 keys** — and let the automatic low-stock alert
(`vanity.stock_low`, fires once the stock drops to 20 or fewer, at most once every 6 hours) tell you when to
grind another batch, rather than trying to size it up front. Each `vanity:import` run tops the same stock up
further; there's no reason to keep more on hand than you'll plausibly launch before your next top-up.
