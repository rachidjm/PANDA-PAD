# PANDA — architecture audit (Phase 0)

Stack: Next.js 16 App Router, TypeScript, Tailwind, Vercel (Hobby), Vercel Blob for JSON state, Solana web3.js + wallet-adapter (Phantom), Pump.fun SDKs, Jupiter swap + Trigger API.

## What exists and is real
| Area | State |
|---|---|
| Home / discover / analytics | Real data (Pump.fun web API + Dexscreener + GeckoTerminal, failover). |
| Create coin | Real Pump.fun create + optional fee-sharing in the same tx. |
| Buy / sell | Real Pump bonding curve, PumpSwap, Jupiter; 1% PANDA fee visible in the wallet tx. Browser RPC goes through `/api/rpc` (allowlist, same-origin). |
| Portfolio / P&L | Positions derived on-chain (`derive-trade`, `backfill`); average-cost; flagged "estimated". |
| Rewards | Registry + per-mint ledger in Blob (ETag atomic updates), reserve-then-pay claims, per-claim and daily caps, alerts, solvency check in cron. |
| SL / TP | Jupiter Trigger v2 (custodial Privy vault, disclosed in UI). |
| i18n, legal pages | EN/ES. |

## Not built yet (Phases 4+ of the spec)
Wallet-signature auth (nonce), PANDA Points, epochs, airdrops/Merkle claims, NFT Themes/market/branches, anti-Sybil scoring, admin area, audit log, emergency pause, multi-RPC failover for server reads.

## Findings
| # | Severity | Finding | Status |
|---|---|---|---|
| 1 | **High** | PANDA's 5% creator-fee share was enforced only in the browser. `/api/pump/create` checked "sums to 100%" but not that PANDA was in the list, so a direct API call skipped it. | **Fixed**: `validateShareholders` now requires exactly one PANDA-treasury entry at 500 bps, total 10000, integer/positive bps, no duplicates. 14 tests. |
| 2 | Medium | `POST /api/rewards/claim` takes `holder` from the request body with no proof of wallet ownership. Payouts go to that same address (no theft path), but anyone can trigger or grief another holder's claim timing. | **Fixed** (see "Wallet sign-in"): claims now require a signed-in session for that exact wallet. |
| 3 | Medium | Rate limiting is in-memory, per serverless instance — bypassable by spreading requests. | Open — needs shared store (Upstash/Vercel KV). |
| 4 | Medium | Blob JSON is used for the rewards ledger. ETag optimistic locking makes claims safe at low volume, but it is not a transactional DB. | Open — a real DB (Postgres/Supabase) is required before points/airdrops (append-only event ledger, unique constraints). |
| 5 | Medium | No app-level security headers. | **Fixed (baseline)**: nosniff, frame-deny, referrer, permissions, HSTS, `frame-ancestors/base-uri/object-src/form-action` CSP. Full `script-src` CSP needs nonces — open. |
| 6 | Low | `npm audit --omit=dev`: 22 findings (14 moderate, 8 high), transitive via `@solana/*`/`uuid`; `--force` fix would downgrade spl-token, so not applied. | Open — review individually. |
| 7 | Low | No test runner existed. | **Fixed**: `npm test` (tsx + node:test), `npm run typecheck`. |
| 8 | Info | Server RPC falls back to the public endpoint if `SOLANA_RPC_URL` is unset; no NETWORK guard (mainnet/devnet). | Open — add `NETWORK` env + program-ID check before enabling new money flows. |
| 9 | Info | Fee-distribution is optional at create time; a coin created without it pays PANDA nothing from creator fees. | Product decision. |

## Changes in this pass
- `src/lib/config/protocol.ts` — single source for `PANDA_SHARE_BPS` (500) and creator max (9500).
- `src/lib/money/bps.ts` — bigint-only `bpsOf`, `splitPool` (sum + dust always == pool). Fuzz-tested. Foundation for rewards/airdrop math.
- `src/lib/pump/fee-shares-validation.ts` — PANDA share enforcement.
- `src/app/api/pump/create/route.ts` — type/length checks on inputs.
- `src/lib/config/flags.ts` — feature flags, default off (not wired to features yet, none exist).
- `next.config.ts` — security headers.

## Wallet sign-in (Phase 2)
- `POST /api/auth/challenge` issues a one-time nonce (5 min) bound to wallet + domain; `POST /api/auth/verify` rebuilds the message server-side, verifies the ed25519 signature, atomically burns the nonce (ETag-locked Blob update; one blob per nonce) and sets an HttpOnly, SameSite=Strict, Secure, 2h HMAC-signed cookie. `GET /api/auth/session`, `POST /api/auth/logout`.
- `POST /api/rewards/claim` requires the session wallet to equal `holder`; also checks Origin. The client signs once per session via `useWalletSession`.
- Fails closed: without `AUTH_SESSION_SECRET` (>= 32 chars) sign-in returns 503 and nobody can claim.
- Tests: 22 unit tests + an end-to-end script (16 checks: wrong key, garbage/forged signature, replay, 8 concurrent verifies -> 1 login, forged/other-wallet cookie, cross-origin, claim without/with wrong/with right session).
- Limits: sessions can't be revoked server-side before their 2h expiry (logout only clears the cookie); used-nonce blobs accumulate in Blob until a cleanup job exists; Blob write atomicity was verified by design (same ETag mechanism as the rewards ledger) but the concurrency test ran against the dev in-memory store, not Blob.

## Audit trail + emergency pause (Phase 3)
- **Audit log** (`src/lib/audit`): every event is its own immutable Blob file (`audit/events/<day>/<id>.json`, never overwritten) with id, timestamp, actor, action, object, old/new state, reason, request ID; keys named like secrets are redacted (`redact.ts`) and each event is also written to the Vercel log. Recorded now: `auth.login`, `claim.paid|failed_onchain|outcome_unknown`, `token.create_tx_built` (actor marked `unauthenticated:` — that route has no session), `cron.collect_fees`, `protocol.pause|resume`, `admin.denied`. Not yet: fee-config changes beyond creation, reward calculation, epochs, airdrops (those systems don't exist yet).
- **Pause switches** (`src/lib/protocol`): independent per subsystem — `claims`, `airdrops`, `nft_minting`, `token_launches`, `reward_calculations`, `fee_processing`. Wired to: claims (`/api/rewards/claim`), token launches (`/api/pump/create`), fee processing (cron). Others get wired when their systems are built. Pausing stores a reason and deletes nothing. Public `GET /api/protocol/status` feeds the "PANDA PROTOCOL PAUSED" banner (EN/ES).
- **Fail closed**: if the pause state can't be read, the subsystem is treated as paused.
- **Admin** (`/admin`, `/api/admin/*`): enforced server-side — a wallet in `ADMIN_WALLETS` with a wallet sign-in from the last 30 minutes, same-origin check, rate limit, exact confirmation phrase ("PAUSE claims"), every change audited + alerted. Empty `ADMIN_WALLETS` = nobody is admin.
- Tests: 34 unit tests + 27-check end-to-end script (authorization, validation, pause/resume gating claims and launches independently, audit content and ordering, no secrets in output).
- Limits: audit recording is best-effort (a failed write is logged, doesn't block — so an emergency pause can't be blocked); audit blobs are readable by anyone with the URL (no secrets stored, wallet addresses and public signatures only); no hash-chaining, so it is append-only by convention, not tamper-evident; a pause reaches other server instances within ~5 s; the admin UI's signed-in view was type-checked but not clicked through with a real wallet; admin is a single-wallet check, not multisig.

## Fee distribution (Phase 4)
- Create form (`FeeDistributionStep`): PANDA 5% shown as a locked row (never an input); the creator splits the other 95% between Creator, Holders (PANDA's rewards pool) and an optional Partner wallet, with a live bar, presets, and an always-visible "PANDA 5% + allocations = 100%" line. Inputs parse as exact integer basis points (`parsePercentToBps`, max 2 decimals, no floats); a broken or unbalanced plan disables Launch and can never fall through to "no fee distribution".
- Final confirmation modal (`LaunchConfirm`) lists every recipient, address (abbreviated), percentage, total 100% and the first buy before the wallet prompt. Verified on desktop and 375px mobile, EN/ES.
- Server is still the enforcer: `validateShareholders` requires exactly one PANDA-treasury entry at 500 bps, total 10000, no duplicates, positive integer bps, max 10 recipients, and now also rejects the System Program and incinerator addresses (fees sent there are unrecoverable).
- Rewards fix: the daily cron split holder credits with floating point (`Math.floor((amount/total)*distributed)` on UI amounts). Now raw integer balances + `splitPool`; the rounding remainder is stored as `dustLamports` in the ledger, and `creditHolders` refuses to write unless credits + dust == distributed exactly. Fuzz-tested.
- Tests: 44 unit tests total. Not covered: an on-chain create with a 3-way split (needs a real wallet and SOL); the create UI itself was checked in the browser through a temporary harness page, not with a connected wallet.
- Known: fee-sharing config authority — whether the creator or PANDA can later change a coin's split on-chain is a property of Pump's SharingConfig, not verified here; the UI therefore says the split is "written on-chain with your coin", not that it is permanent.

## PANDA Points + epochs (Phase 5–6)
Off by default: everything below is behind `FEATURE_PANDA_POINTS=true` (routes answer 404 otherwise).
- **Ledger** (`src/lib/points`): append-only events with deterministic IDs (`<signature>:<instructionIndex>:trade`, `correction:<id>`); `applyAward` is a pure, non-mutating function; a duplicate event never counts twice. One Blob document per wallet per epoch (awards to different wallets never contend), updated with the ETag-guarded update; integers only.
- **Formula v1** (`config.ts`, all numbers configurable and versioned): trade points = floor(sqrt(cumulative epoch volume / 0.001 SOL)); each trade earns the difference, so the total is identical however the volume is split (a first design applied the square root per trade and paid 14x more for slicing — caught by a test and replaced; fuzz-tested for path independence). Minimum trade 0.05 SOL; caps per wallet per epoch (5,000 per type, 20,000 total, 500 events).
- **What counts as a PANDA trade**: the confirmed transaction must contain a SystemProgram transfer of PANDA's fee from the trader to the treasury; volume = min(fee-implied volume, observed SOL movement). A trade made elsewhere earns nothing; the fee is real money paid, so volume can't be inflated on paper. Wired into `/api/portfolio/record-trade` (a points failure never fails the trade record).
- **Epochs** (`src/lib/epochs`): UPCOMING → ACTIVE → SNAPSHOT → CALCULATING → FINALIZED → DISTRIBUTING → COMPLETED, plus PAUSED (resumes only to where it came from). Transition table exhaustively tested; ACTIVE needs start time reached; SNAPSHOT needs snapshotTime + 10 min grace; FINALIZED is immutable (can't be paused, reopened or rolled back). Events are placed by their own timestamp and only recorded while the epoch is ACTIVE; late events are refused, not slipped into the next epoch.
- **Finalization**: totals (wallet-sorted, canonical JSON, sha256) are written once, never overwritten; an existing file must be byte-identical or finalization refuses; the hash is pinned on the epoch and re-verified on read (`totalsAreIntact`). This is the input the airdrop / Merkle phase will consume.
- **Corrections**: history is never edited; `/api/admin/points-correction` adds a new (possibly negative) event in the currently ACTIVE epoch, idempotent by `correctionId`, audited. A wallet's epoch total never goes below zero.
- **Admin API** (`/api/admin/epochs`: create / transition / finalize): admin session, same-origin, rate limit, exact confirmation phrases, audited; moves into CALCULATING / FINALIZED respect the `reward_calculations` pause switch.
- **Users**: `GET /api/points/me` (own points only, provisional until finalized; finalized epochs verified against the pinned hash) and public `GET /api/points/epochs` (no wallet data).
- **Storage abstraction** (`src/lib/storage/store.ts`): read / atomic update / create-once / list — the single file to replace when moving to a database.
- Tests: 79 unit/integration tests (incl. the full epoch lifecycle in the store) + a 34-check HTTP script with the flag on and a 5-check script with it off.
- Not done yet: no admin UI for epochs or points UI for users (the airdrop dashboard phase); other point types (launch, themes, NFT, campaigns, holding) have caps configured but no producers; anti-Sybil (only per-wallet caps today: many small wallets still multiply points); no leaderboard/rank (would need a cached snapshot, not a full scan per request).

## Environment variables
PUBLIC: `NEXT_PUBLIC_SOLANA_RPC_URL`, `NEXT_PUBLIC_PANDA_TREASURY`, `NEXT_PUBLIC_PANDA_TOKEN_MINT`, `NEXT_PUBLIC_PANDA_REWARDS_POOL`.
SERVER_ONLY: `AUTH_SESSION_SECRET`, `ADMIN_WALLETS`, `PANDA_REWARDS_POOL_SECRET_KEY`, `CRON_SECRET`, `JUPITER_API_KEY`, `SOLANA_RPC_URL`, `ALERT_WEBHOOK_URL`, `REWARDS_MAX_CLAIM_SOL`, `REWARDS_DAILY_CAP_SOL`, `FEATURE_*`.

## Trust assumptions today
Rewards payouts are off-chain-authorised (server holds the pool key) — not trust-minimised. SL/TP tokens sit in Jupiter's Privy vault. Public price/market data is third-party. Vercel/Blob availability.
