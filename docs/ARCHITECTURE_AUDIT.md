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

## Environment variables
PUBLIC: `NEXT_PUBLIC_SOLANA_RPC_URL`, `NEXT_PUBLIC_PANDA_TREASURY`, `NEXT_PUBLIC_PANDA_TOKEN_MINT`, `NEXT_PUBLIC_PANDA_REWARDS_POOL`.
SERVER_ONLY: `AUTH_SESSION_SECRET`, `ADMIN_WALLETS`, `PANDA_REWARDS_POOL_SECRET_KEY`, `CRON_SECRET`, `JUPITER_API_KEY`, `SOLANA_RPC_URL`, `ALERT_WEBHOOK_URL`, `REWARDS_MAX_CLAIM_SOL`, `REWARDS_DAILY_CAP_SOL`, `FEATURE_*`.

## Trust assumptions today
Rewards payouts are off-chain-authorised (server holds the pool key) — not trust-minimised. SL/TP tokens sit in Jupiter's Privy vault. Public price/market data is third-party. Vercel/Blob availability.
