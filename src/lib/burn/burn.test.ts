import { test, before } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { Keypair, PublicKey } from "@solana/web3.js";
import { TOKEN_2022_PROGRAM_ID, TOKEN_PROGRAM_ID, getAssociatedTokenAddressSync } from "@solana/spl-token";
import bs58 from "bs58";
import type { Db } from "@/lib/db/client";
import { newTestDb } from "@/lib/db/testing";
import { pgAccrueBurn, pgBurnBalances, pgBurnSummary, pgBurnsToPost, pgKnownBurnSignatures, pgMarkBurnsPosted, pgOpenBurnTxs, pgRecordBurnTx, pgSettleBurnTx } from "@/lib/db/burn";
import { tgSetState } from "@/lib/db/telegram";
import { isEnabled } from "@/lib/config/flags";
import { CREATOR_CONFIGURABLE_MAX_BPS, PANDA_SHARE_BPS } from "@/lib/config/protocol";
import { planIssue, planLines } from "@/lib/pump/fee-plan";
import { validateShareholders } from "@/lib/pump/fee-shares-validation";
import { burnShareIssue } from "@/lib/pump/holder-rewards";
import { PANDA_TREASURY } from "@/lib/pump/constants";
import { SUBSYSTEMS } from "@/lib/protocol/pause";
import { describeSplit, postBurnDigest, tokensText, type FeedDeps } from "@/lib/telegram/feeds";
import { telegramConfig } from "@/lib/telegram/config";
import { coin, fakeMarket, testConfig } from "@/lib/telegram/testing";
import { tt } from "@/lib/telegram/text";
import { accrueFromDistribution, burnShareOf } from "./accrue";
import { BURN_RESERVE_LAMPORTS, burnEnabled, burnMinLamports, burnSpendLamports, burnWalletAddress, DEFAULT_BURN_MIN_SOL, getBurnSigner } from "./config";
import { burnInstructions } from "./run";

/**
 * "🔥 Burn": a share of a coin's creator fees that buys the coin and burns it. The share is an ordinary line of the
 * split paid to PANDA's burn wallet; what that wallet received and spent is a ledger read from the chain; the burn is
 * the token program's own instruction; and what is said about it in public is only what happened.
 */

const TREASURY = PANDA_TREASURY.toBase58();
const CREATOR = Keypair.generate().publicKey.toBase58();
const POOL = Keypair.generate().publicKey.toBase58();
const BURN = Keypair.generate();
const BURN_WALLET = BURN.publicKey.toBase58();
const MINT = "zefa42tKR24WwpYZJujta7CDkD43n47soQwCoJpanda";
const OTHER = "So11111111111111111111111111111111111111112";
const sig = (n: number) => bs58.encode(Uint8Array.from({ length: 64 }, (_, i) => (i * 7 + n) % 256));

// ── the option at launch ────────────────────────────────────────────────────────────────────────────────────────────
test("Burn is a line of the fee split like Creator, Holders and Partner — paid to PANDA's burn wallet, and the split still adds up", () => {
  const ctx = { creator: CREATOR, treasury: TREASURY, rewardsPool: POOL, burnWallet: BURN_WALLET };
  const plan = { creatorBps: 5000, holdersBps: 2500, burnBps: 2000, partnerBps: 0, partnerAddress: "" };
  assert.equal(planIssue(plan, ctx), null);
  const lines = planLines(plan, ctx);
  assert.deepEqual(lines.map((l) => [l.kind, l.bps]), [["panda", PANDA_SHARE_BPS], ["creator", 5000], ["holders", 2500], ["burn", 2000]]);
  assert.equal(lines.find((l) => l.kind === "burn")!.address, BURN_WALLET);
  assert.equal(lines.reduce((s, l) => s + l.bps, 0), 10_000);
  // The server's own check of the same list (PANDA's share locked, each recipient once, 100% exactly).
  assert.equal(validateShareholders(lines.map((l) => ({ address: l.address, shareBps: l.bps }))), null);

  // All of the creator's side to Burn is allowed; over or under 95% is not.
  assert.equal(planIssue({ creatorBps: 0, holdersBps: 0, burnBps: CREATOR_CONFIGURABLE_MAX_BPS, partnerBps: 0, partnerAddress: "" }, ctx), null);
  assert.deepEqual(planIssue({ creatorBps: 9000, holdersBps: 0, burnBps: 1000, partnerBps: 0, partnerAddress: "" }, ctx), { code: "TOTAL_MISMATCH", deltaBps: -500 });
  // No burn wallet configured: the share can't be chosen. A partner can't be the burn wallet.
  assert.deepEqual(planIssue(plan, { ...ctx, burnWallet: null }), { code: "BURN_UNAVAILABLE" });
  assert.deepEqual(planIssue({ creatorBps: 9000, holdersBps: 0, burnBps: 0, partnerBps: 500, partnerAddress: BURN_WALLET }, ctx), { code: "PARTNER_ADDRESS_DUPLICATE" });
  // A plan from before Burn existed (no burnBps) is exactly what it was.
  assert.deepEqual(planLines({ creatorBps: 9500, holdersBps: 0, partnerBps: 0, partnerAddress: "" }, ctx).map((l) => l.kind), ["panda", "creator"]);
  // The incinerator and the System Program are still refused as recipients: burning is an instruction, not an address.
  assert.match(validateShareholders([{ address: TREASURY, shareBps: 500 }, { address: "1nc1nerator11111111111111111111111111111111", shareBps: 9500 }]) ?? "", /can't receive fees/);
});

test("FEATURE_BURN is off unless it is exactly 'true', needs the burn wallet, and with it off the server refuses a split that pays that wallet", () => {
  assert.equal(isEnabled("BURN", {}), false);
  assert.equal(isEnabled("BURN", { FEATURE_BURN: "1" }), false);
  assert.equal(burnEnabled({ FEATURE_BURN: "true" }), false, "no wallet, no burn");
  assert.equal(burnEnabled({ FEATURE_BURN: "true", NEXT_PUBLIC_PANDA_BURN_WALLET: "not an address" }), false);
  assert.equal(burnEnabled({ FEATURE_BURN: "true", NEXT_PUBLIC_PANDA_BURN_WALLET: BURN_WALLET }), true);
  assert.equal(burnWalletAddress({ NEXT_PUBLIC_PANDA_BURN_WALLET: ` ${BURN_WALLET} ` }), BURN_WALLET);
  const split = [{ address: TREASURY }, { address: CREATOR }, { address: BURN_WALLET }];
  assert.match(burnShareIssue(split, { enabled: false, wallet: BURN_WALLET }) ?? "", /Burn is not enabled/);
  assert.equal(burnShareIssue(split, { enabled: true, wallet: BURN_WALLET }), null);
  assert.equal(burnShareIssue([{ address: TREASURY }, { address: CREATOR }], { enabled: false, wallet: BURN_WALLET }), null);
  const route = readFileSync("src/app/api/pump/create/route.ts", "utf8");
  assert.ok(route.includes('burnShareIssue(shareholders as FeeShareholderInput[], { enabled: isEnabled("BURN"), wallet: PANDA_BURN_WALLET?.toBase58() ?? null })'));
  // There is an emergency pause of its own, and the cron obeys it.
  assert.ok((SUBSYSTEMS as readonly string[]).includes("burns"));
  const cron = readFileSync("src/app/api/cron/burn/route.ts", "utf8");
  assert.ok(cron.includes('if ((await checkActive("burns")).paused)') && cron.includes("if (!burnEnabled())") && cron.includes("moneyFlowGuardResponse()"));
  assert.ok(cron.indexOf('checkActive("burns")') < cron.indexOf("runBurnForMint("), "paused: nothing is bought or burned");
  assert.ok(JSON.parse(readFileSync("vercel.json", "utf8")).crons.some((c: { path: string }) => c.path === "/api/cron/burn"));
});

test("the burn wallet's key: only the exported key of THAT wallet — never a recovery phrase, never another wallet's, and never shown", () => {
  const good = { NEXT_PUBLIC_PANDA_BURN_WALLET: BURN_WALLET, PANDA_BURN_WALLET_SECRET_KEY: bs58.encode(BURN.secretKey) };
  assert.equal(getBurnSigner(good)?.publicKey.toBase58(), BURN_WALLET);
  assert.equal(getBurnSigner({ ...good, PANDA_BURN_WALLET_SECRET_KEY: JSON.stringify([...BURN.secretKey]) })?.publicKey.toBase58(), BURN_WALLET);
  assert.equal(getBurnSigner({ NEXT_PUBLIC_PANDA_BURN_WALLET: BURN_WALLET }), null);
  const other = Keypair.generate();
  const cases: [Record<string, string>, RegExp][] = [
    [{ ...good, PANDA_BURN_WALLET_SECRET_KEY: bs58.encode(other.secretKey) }, /doesn't match/],
    [{ ...good, PANDA_BURN_WALLET_SECRET_KEY: Array(12).fill("word").join(" ") }, /recovery phrase/],
    [{ ...good, PANDA_BURN_WALLET_SECRET_KEY: "nonsense" }, /isn't a valid secret key/],
    [{ PANDA_BURN_WALLET_SECRET_KEY: bs58.encode(BURN.secretKey) }, /NEXT_PUBLIC_PANDA_BURN_WALLET isn't/],
  ];
  for (const [env, re] of cases) {
    assert.throws(() => getBurnSigner(env), (e: Error) => re.test(e.message) && !e.message.includes(env.PANDA_BURN_WALLET_SECRET_KEY) && !e.message.includes(bs58.encode(other.secretKey)), String(re));
  }
});

// ── the minimum, and what is spent ──────────────────────────────────────────────────────────────────────────────────
test("BURN_MIN_SOL: a coin is bought and burned only once its share has gathered the minimum, and a reserve stays for fees", () => {
  assert.equal(burnMinLamports({}), DEFAULT_BURN_MIN_SOL * 1e9);
  assert.equal(burnMinLamports({ BURN_MIN_SOL: "0.2" }), 200_000_000);
  assert.equal(burnMinLamports({ BURN_MIN_SOL: "0.0001" }), 10_000_000, "never under 0.01 SOL: fees would eat it");
  for (const bad of ["", "abc", "-1", "0"]) assert.equal(burnMinLamports({ BURN_MIN_SOL: bad }), DEFAULT_BURN_MIN_SOL * 1e9, bad);
  const min = burnMinLamports({});
  assert.equal(burnSpendLamports(min - 1, min), 0);
  assert.equal(burnSpendLamports(0, min), 0);
  assert.equal(burnSpendLamports(-5, min), 0);
  assert.equal(burnSpendLamports(min, min), min - BURN_RESERVE_LAMPORTS);
  assert.equal(burnSpendLamports(1_000_000_000, min), 1_000_000_000 - BURN_RESERVE_LAMPORTS);
  assert.equal(burnSpendLamports(NaN, min), 0);
});

// ── the burn itself ─────────────────────────────────────────────────────────────────────────────────────────────────
test("burning is the token program's own BurnChecked instruction on the wallet's own account — the tokens are not sent anywhere", () => {
  const owner = BURN.publicKey;
  const mint = new PublicKey(MINT);
  for (const program of [TOKEN_PROGRAM_ID, TOKEN_2022_PROGRAM_ID]) {
    const account = getAssociatedTokenAddressSync(mint, owner, false, program);
    const [burn, close] = burnInstructions({ owner, mint, tokenProgram: program, amount: BigInt("123456789012345"), decimals: 6, close: true });
    assert.ok(burn.programId.equals(program), "the coin's own token program (classic or Token-2022)");
    assert.equal(burn.data[0], 15, "BurnChecked");
    assert.equal(burn.data.readBigUInt64LE(1), BigInt("123456789012345"));
    assert.equal(burn.data[9], 6);
    assert.deepEqual(burn.keys.map((k) => k.pubkey.toBase58()), [account.toBase58(), mint.toBase58(), owner.toBase58()], "the wallet's account, the mint, the wallet: no destination");
    assert.equal(close.data[0], 9, "CloseAccount: the empty account's rent comes back");
    assert.equal(close.keys[1].pubkey.toBase58(), owner.toBase58(), "to the burn wallet itself");
    assert.equal(burnInstructions({ owner, mint, tokenProgram: program, amount: BigInt(1), decimals: 6, close: false }).length, 1);
  }
  const run = readFileSync("src/lib/burn/run.ts", "utf8");
  assert.doesNotMatch(run, /createTransfer|SystemProgram\.transfer|1nc1nerator/, "nothing in a burn round transfers tokens or SOL to an address");
  // Simulated before it is sent, written to the ledger before it is sent, and the buy carries no PANDA fee.
  const send = run.slice(run.indexOf("async function sendChecked("), run.indexOf("/** Burns everything the wallet holds"));
  assert.ok(send.indexOf("connection.simulateTransaction(tx") < send.indexOf("await record(signature)") && send.indexOf("await record(signature)") < send.indexOf("connection.sendRawTransaction("));
  assert.equal(send.split("connection.simulateTransaction(tx").length - 1, 2, "both kinds of transaction are simulated");
  assert.ok(send.includes("if (err) throw new Error(`simulation failed:") && send.indexOf("if (err) throw") < send.indexOf("await record(signature)"));
  assert.ok(run.includes("platformFee: false"));
  // What was bought is always burned: anything still held is burned first, whatever the ledger remembers.
  const round = run.slice(run.indexOf("export async function runBurnForMint("));
  assert.ok(round.indexOf("burnHeld(connection, db, signer, key)") < round.indexOf("buildBurnBuy("));
  // A pool that isn't paired with SOL is bought through Jupiter's route instead — the same swap, still no PANDA fee.
  const buy = run.slice(run.indexOf("export async function buildBurnBuy("), run.indexOf("async function sendChecked("));
  assert.ok(buy.includes("inputMint: SOL_MINT, outputMint: mint.toBase58()") && !buy.includes("feeTransferInstructions"));
});

// ── the ledger ──────────────────────────────────────────────────────────────────────────────────────────────────────
let db: Db;
before(async () => {
  db = await newTestDb();
});

test("the Burn share is booked from what the distribution really paid the burn wallet, once per transaction", async () => {
  const shares = [{ address: TREASURY, lamports: 5_000 }, { address: CREATOR, lamports: 50_000 }, { address: BURN_WALLET, lamports: 45_000 }];
  assert.equal(burnShareOf(shares, BURN_WALLET), 45_000);
  assert.equal(burnShareOf(shares.slice(0, 2), BURN_WALLET), 0, "a coin with no Burn share books nothing");
  const mint = Keypair.generate().publicKey.toBase58();
  assert.equal(await accrueFromDistribution(db, BURN_WALLET, { mint, signature: sig(1), shares }), 45_000);
  assert.equal(await accrueFromDistribution(db, BURN_WALLET, { mint, signature: sig(1), shares }), 0, "the same transaction again changes nothing");
  assert.equal(await accrueFromDistribution(db, BURN_WALLET, { mint, signature: sig(2), shares: shares.slice(0, 2) }), 0);
  assert.equal(await pgAccrueBurn(db, { sourceSig: sig(3), mint, lamports: 0 }), false);
  assert.equal(await pgAccrueBurn(db, { sourceSig: sig(3), mint, lamports: -5 }), false);
  assert.deepEqual(await pgBurnBalances(db, mint), [{ mint, accruedLamports: 45_000, spentLamports: 0, pendingLamports: 45_000 }]);
  assert.deepEqual([...(await pgKnownBurnSignatures(db, [sig(1), sig(2)]))], [sig(1)]);
  const cron = readFileSync("src/app/api/cron/collect-fees/route.ts", "utf8");
  assert.ok(cron.indexOf("accrueFromDistribution(getDb(), burnWallet,") < cron.indexOf("if (!distributed || distributed.lamports <= 0)"), "booked even when the coin has no Holders share");
});

test("each coin's SOL is its own, SOL on its way out is never counted twice, and the ledger is settled from the chain", async () => {
  const a = Keypair.generate().publicKey.toBase58();
  const b = Keypair.generate().publicKey.toBase58();
  await pgAccrueBurn(db, { sourceSig: sig(10), mint: a, lamports: 100_000_000 });
  await pgAccrueBurn(db, { sourceSig: sig(11), mint: a, lamports: 20_000_000 });
  await pgAccrueBurn(db, { sourceSig: sig(12), mint: b, lamports: 30_000_000 });
  const pending = async (m: string) => (await pgBurnBalances(db, m))[0].pendingLamports;
  assert.equal(await pending(a), 120_000_000);
  assert.equal(await pending(b), 30_000_000);

  // A buy is written down BEFORE it is sent, at the most it can cost: that SOL is no longer available.
  await pgRecordBurnTx(db, { signature: sig(20), mint: a, kind: "buy", reservedLamports: 120_000_000 });
  assert.equal(await pending(a), 0);
  assert.equal(await pending(b), 30_000_000, "another coin's SOL is untouched");
  assert.equal((await pgOpenBurnTxs(db)).filter((t) => t.mint === a).length, 1);
  // Confirmed: what it really cost, from the chain.
  await pgSettleBurnTx(db, sig(20), { status: "confirmed", lamports: 115_300_000 });
  assert.equal(await pending(a), 4_700_000);
  await pgSettleBurnTx(db, sig(20), { status: "failed" });
  assert.equal(await pending(a), 4_700_000, "a settled transaction is never settled again");
  // A transaction that never landed spent nothing.
  await pgRecordBurnTx(db, { signature: sig(21), mint: b, kind: "buy", reservedLamports: 30_000_000 });
  assert.equal(await pending(b), 0);
  await pgSettleBurnTx(db, sig(21), { status: "failed" });
  assert.equal(await pending(b), 30_000_000);
  // The burn: its fee is spent too — and rent that came back (a negative cost) is counted back.
  await pgRecordBurnTx(db, { signature: sig(22), mint: a, kind: "burn", reservedLamports: 100_000, tokens: "5000000000000", decimals: 6 });
  await pgSettleBurnTx(db, sig(22), { status: "confirmed", lamports: -2_034_280 });
  assert.equal(await pending(a), 4_700_000 + 2_034_280);
  await assert.rejects(pgRecordBurnTx(db, { signature: sig(22), mint: a, kind: "burn", reservedLamports: 1 }), "one row per transaction");
});

test("the coin's page: the total burned, from confirmed burns only", async () => {
  const mint = Keypair.generate().publicKey.toBase58();
  assert.deepEqual(await pgBurnSummary(db, mint), { mint, tokensBurned: "0", decimals: null, lamportsSpent: 0, burns: 0, recent: [] });
  await pgRecordBurnTx(db, { signature: sig(30), mint, kind: "buy", reservedLamports: 60_000_000 });
  await pgSettleBurnTx(db, sig(30), { status: "confirmed", lamports: 55_000_000 });
  await pgRecordBurnTx(db, { signature: sig(31), mint, kind: "burn", reservedLamports: 100_000, tokens: "18446744073709551615", decimals: 6 });
  await pgSettleBurnTx(db, sig(31), { status: "confirmed", lamports: 5_000 });
  await pgRecordBurnTx(db, { signature: sig(32), mint, kind: "burn", reservedLamports: 100_000, tokens: "1000000", decimals: 6 });
  await pgSettleBurnTx(db, sig(32), { status: "confirmed", lamports: 5_000 });
  await pgRecordBurnTx(db, { signature: sig(33), mint, kind: "burn", reservedLamports: 100_000, tokens: "999", decimals: 6 }); // sent, not confirmed
  await pgRecordBurnTx(db, { signature: sig(34), mint, kind: "burn", reservedLamports: 100_000, tokens: "777", decimals: 6 });
  await pgSettleBurnTx(db, sig(34), { status: "failed" });
  const s = await pgBurnSummary(db, mint);
  assert.equal(s.tokensBurned, (BigInt("18446744073709551615") + BigInt(1_000_000)).toString(), "exact, beyond what a number holds");
  assert.equal(s.burns, 2);
  assert.equal(s.decimals, 6);
  assert.equal(s.lamportsSpent, 55_000_000);
  assert.deepEqual(s.recent.map((r) => r.signature).sort(), [sig(31), sig(32)].sort());
  const route = readFileSync("src/app/api/burn/summary/route.ts", "utf8");
  assert.ok(route.includes("if (!burnEnabled()) return new NextResponse(null, { status: 404 });"));
  for (const f of ["src/components/coin/CoinClient.tsx", "src/components/tg/TgCoin.tsx"]) assert.ok(readFileSync(f, "utf8").includes("<BurnedLine mint={coin.mint}"), f);
});

// ── Telegram ────────────────────────────────────────────────────────────────────────────────────────────────────────
test("Telegram: burns go to their own topic, one digest an hour with each coin once — facts only", async () => {
  assert.equal(telegramConfig({ TELEGRAM_TOPIC_BURNS: "77" }).topics.burns, 77);
  assert.equal(telegramConfig({}).topics.burns, null);
  const tdb = await newTestDb();
  const clock = { t: 1_800_000_000_000 };
  const d: FeedDeps = { db: tdb, now: () => clock.t, cfg: testConfig(), market: fakeMarket({ coins: { [MINT]: coin(MINT, { ticker: "PANDA" }) } }), pandaMint: MINT, feeSplit: async () => null, feeLockPending: async () => false, trades: async () => [], treasury: TREASURY, rewardsPool: POOL, burnWallet: BURN_WALLET };
  const { telegramOutbox } = await import("@/lib/db/schema");
  const sent = async () => (await tdb.select().from(telegramOutbox)).map((r) => r.payload as { text: string; message_thread_id?: number });

  assert.equal(await postBurnDigest(d), 0, "the first run only starts the clock: no history is posted");
  // Two buys and two burns of one coin, one burn of another, in the same hour.
  for (const [s, kind, lamports, tokens] of [[40, "buy", 50_000_000, null], [41, "burn", 5_000, "1500000000000"], [42, "buy", 70_000_000, null], [43, "burn", 5_000, "2500000000000"]] as const) {
    await pgRecordBurnTx(tdb, { signature: sig(s), mint: MINT, kind, reservedLamports: lamports, ...(tokens ? { tokens, decimals: 6 } : {}) });
    await pgSettleBurnTx(tdb, sig(s), { status: "confirmed", lamports });
  }
  await pgRecordBurnTx(tdb, { signature: sig(44), mint: OTHER, kind: "burn", reservedLamports: 5_000, tokens: "900000000", decimals: 9 });
  await pgSettleBurnTx(tdb, sig(44), { status: "confirmed", lamports: 5_000 });
  await pgRecordBurnTx(tdb, { signature: sig(45), mint: OTHER, kind: "burn", reservedLamports: 5_000, tokens: "1", decimals: 9 }); // not confirmed: not reported

  clock.t += 10 * 60_000;
  assert.equal(await postBurnDigest(d), 0, "not within the hour");
  assert.equal((await sent()).length, 0);
  clock.t += 51 * 60_000;
  assert.equal(await postBurnDigest(d), 2);
  const [msg] = await sent();
  assert.equal(msg.message_thread_id, 15, "the Burns topic");
  const lines = msg.text.split("\n");
  assert.equal(lines.length, 3, "one message; each coin once, however many burns it had");
  assert.equal(lines[0], tt("en", "burnsTitle"));
  assert.equal(lines[1], `• $PANDA: 4,000,000 tokens burned (0.12 SOL) · <a href="https://solscan.io/tx/${sig(43)}">transaction</a>`);
  assert.ok(lines[2].includes("0.9 tokens burned"));
  // Only what happened: no price, no promise, nothing about the future.
  for (const lang of ["en", "es"] as const) for (const key of ["burnsTitle", "burnLine"] as const) assert.doesNotMatch(tt(lang, key), /price|precio|pump|moon|will|soon|subir|sube|próxim|next|future|futur|supply shock|🚀/i, `${lang} ${key}`);
  assert.doesNotMatch(readFileSync("src/lib/i18n/translations.ts", "utf8").split("\n").filter((l) => /"(burn\.|fd\.burn)/.test(l)).join("\n"), /price|precio|will go|subir|va a|soon|pronto/i);

  // Reported once: the next hour has nothing to say about them.
  assert.deepEqual((await pgBurnsToPost(tdb)).burns.map((b) => b.signature), []);
  clock.t += 61 * 60_000;
  assert.equal(await postBurnDigest(d), 0);
  assert.equal((await sent()).length, 1);
  await pgMarkBurnsPosted(tdb, [], clock.t);
  await tgSetState(tdb, "burns.digestAt", clock.t, clock.t);

  assert.equal(tokensText("1500000000000", 6), "1,500,000");
  assert.equal(tokensText("1234567", 6), "1.23");
  // A launch post names the Burn share by what it is.
  assert.equal(describeSplit([{ address: TREASURY, shareBps: 500 }, { address: CREATOR, shareBps: 7500 }, { address: BURN_WALLET, shareBps: 2000 }], { treasury: TREASURY, rewardsPool: POOL, creator: CREATOR, burnWallet: BURN_WALLET }), "PANDA 5% · creator 75% · burn 20%");
  assert.ok(readFileSync("src/app/api/cron/telegram/route.ts", "utf8").includes('await step("burns", () => postBurnDigest(feeds));'));
});

test("the Create form offers Burn only with the feature on, with its own colour and its explanation", () => {
  const form = readFileSync("src/components/create/FeeDistributionStep.tsx", "utf8");
  assert.ok(form.includes("const burnWallet = burn ? BURN_WALLET : null;") && form.includes("{burnWallet && <Row dot={BAR_COLOR.burn}"));
  assert.ok(form.includes('burn: "bg-clay-red",') && form.includes('tooltip={t("fd.burnInfo")}'));
  const texts = readFileSync("src/lib/i18n/translations.ts", "utf8");
  assert.ok(texts.includes('"fd.burn": { en: "🔥 Burn", es: "🔥 Burn" }'));
  assert.ok(texts.includes("es: \"Esta parte de las comisiones compra tu moneda automáticamente y la quema para siempre.\""));
  assert.ok(texts.includes('"burn.line": { en: "🔥 Burned: {amount} tokens", es: "🔥 Quemados: {amount} tokens" }'));
  assert.ok(readFileSync("src/app/layout.tsx", "utf8").includes('burn: isEnabled("BURN") && !!process.env.NEXT_PUBLIC_PANDA_BURN_WALLET,'));
  // The Mini App's Create screen is this very form.
  assert.ok(readFileSync("src/components/tg/TgCreate.tsx", "utf8").includes('import("@/app/create/CreateClient")'));
  // The burn wallet is never counted as a holder of the coin it is about to burn.
  assert.ok(readFileSync("src/lib/rewards/eligible.ts", "utf8").includes("...(PANDA_BURN_WALLET ? [PANDA_BURN_WALLET.toBase58()] : []),"));
});
