/**
 * burn-simulate — a dry run of one buy-and-burn round against the real network. NOTHING is signed and NOTHING is sent:
 * the transactions are only simulated (the RPC's simulateTransaction, signatures not checked).
 *
 *   npm run burn:simulate -- <coin address> [SOL to spend, default 0.05] [--payer <public address>]
 *
 * It builds the very transactions the burn cron sends (src/lib/burn/run.ts): the coin's ordinary Pump.fun / PumpSwap
 * buy with no PANDA fee, then the token program's BurnChecked for everything that buy would leave in the wallet, and the
 * closing of the empty token account. The payer is only an address that holds SOL to simulate with — by default the
 * burn wallet (NEXT_PUBLIC_PANDA_BURN_WALLET) or, if that isn't set or is empty, the Rewards Pool's public address.
 * No secret is read.
 */
import { ComputeBudgetProgram, Connection, PublicKey, Transaction, VersionedTransaction } from "@solana/web3.js";
import { getAssociatedTokenAddressSync } from "@solana/spl-token";
import { buildBurnBuy, burnInstructions } from "@/lib/burn/run";
import { PANDA_BURN_WALLET, PANDA_REWARDS_POOL } from "@/lib/pump/constants";
import { tokenProgramOf } from "@/lib/pump/token-program";
import { serverRpcUrl } from "@/lib/solana/rpc";

const args = process.argv.slice(2);
const flag = (name: string) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : undefined;
};
const positional = args.filter((a, i) => !a.startsWith("--") && !(i > 0 && args[i - 1].startsWith("--")));

async function main() {
  if (!positional[0]) throw new Error("Usage: npm run burn:simulate -- <coin address> [SOL] [--payer <public address>]");
  const mint = new PublicKey(positional[0]);
  const sol = Number(positional[1] ?? 0.05);
  if (!(sol > 0)) throw new Error("The SOL amount must be a positive number.");
  const connection = new Connection(serverRpcUrl(), "confirmed");

  // An ordinary wallet that holds enough SOL to simulate with: the burn wallet once it is funded, otherwise the Rewards Pool's public address.
  const candidates = [flag("payer") ? new PublicKey(flag("payer")!) : null, PANDA_BURN_WALLET, PANDA_REWARDS_POOL].filter((k): k is PublicKey => !!k);
  let payer: PublicKey | null = null;
  for (const k of candidates) {
    if ((await connection.getBalance(k)) >= sol * 1e9 + 10_000_000) {
      payer = k;
      break;
    }
  }
  if (!payer) throw new Error("No wallet with enough SOL to simulate with. Pass --payer <public address of any wallet holding a little more than the amount>.");
  console.log(`coin   ${mint.toBase58()}\nspend  ${sol} SOL\npayer  ${payer.toBase58()} (simulation only: nothing is signed or sent)\n`);

  const tokenProgram = await tokenProgramOf(connection, mint);
  const account = getAssociatedTokenAddressSync(mint, payer, false, tokenProgram);
  const { blockhash } = await connection.getLatestBlockhash("confirmed");
  const prepared = (tx: Transaction) => {
    tx.feePayer = payer;
    tx.recentBlockhash = blockhash;
    return tx;
  };

  // 1) the buy, exactly as the cron builds it
  const built = await buildBurnBuy(connection, payer, mint, Math.round(sol * 1e9));
  if (built instanceof VersionedTransaction) {
    // A coin whose pool isn't paired with SOL: Jupiter's route. Its transaction can't be merged with the burn here, so only the buy is simulated.
    const sim = await connection.simulateTransaction(built, { sigVerify: false, replaceRecentBlockhash: true, accounts: { encoding: "base64", addresses: [account.toBase58()] } });
    if (sim.value.err) {
      console.log("BUY   would FAIL (Jupiter route):", JSON.stringify(sim.value.err));
      process.exit(1);
    }
    const acc = sim.value.accounts?.[0]?.data?.[0];
    const got = acc ? Buffer.from(acc, "base64").readBigUInt64LE(64) : BigInt(0);
    const dec = (await connection.getTokenSupply(mint)).value.decimals;
    console.log(`BUY   ok   through Jupiter's route · would leave ${(Number(got) / 10 ** dec).toLocaleString("en-US")} tokens in the wallet`);
    console.log("BURN  not simulated for a routed buy (it is the same BurnChecked the other coins use, simulated again by the cron before it is sent).");
    console.log("\nNothing was sent.");
    return;
  }
  const buy = prepared(built);
  const sim1 = await connection.simulateTransaction(buy, undefined, [account]);
  if (sim1.value.err) {
    console.log("BUY   would FAIL:", JSON.stringify(sim1.value.err));
    for (const l of (sim1.value.logs ?? []).slice(-8)) console.log("   ", l);
    process.exit(1);
  }
  const data = sim1.value.accounts?.[0]?.data?.[0];
  if (!data) throw new Error("The simulation didn't return the token account.");
  const raw = Buffer.from(data, "base64");
  const bought = raw.readBigUInt64LE(64); // SPL token account layout: mint 32, owner 32, amount u64
  const decimals = (await connection.getTokenSupply(mint)).value.decimals;
  console.log(`BUY   ok   ${sim1.value.unitsConsumed} compute units`);
  console.log(`      would leave ${(Number(bought) / 10 ** decimals).toLocaleString("en-US")} tokens in the wallet`);

  // 2) buy + burn of everything bought + closing the account, in one simulated transaction (the cron sends the burn
  //    as a second transaction; simulating them together is the only way to see the burn without sending the buy)
  const both = new Transaction();
  both.add(...buy.instructions);
  both.add(ComputeBudgetProgram.setComputeUnitLimit({ units: 400_000 }));
  const held = await connection.getTokenAccountBalance(account).then((b) => BigInt(b.value.amount)).catch(() => BigInt(0));
  both.add(...burnInstructions({ owner: payer, mint, tokenProgram, amount: bought + held * BigInt(0), decimals, close: held === BigInt(0) }));
  // Two compute-budget limits can't be in one transaction: keep the buy's own.
  both.instructions = both.instructions.filter((ix, i, all) => !(ix.programId.equals(ComputeBudgetProgram.programId) && ix.data[0] === 2 && all.findIndex((o) => o.programId.equals(ComputeBudgetProgram.programId) && o.data[0] === 2) !== i));
  const sim2 = await connection.simulateTransaction(prepared(both), undefined, [account]);
  if (sim2.value.err) {
    console.log("BURN  would FAIL:", JSON.stringify(sim2.value.err));
    for (const l of (sim2.value.logs ?? []).slice(-8)) console.log("   ", l);
    process.exit(1);
  }
  const burnLog = (sim2.value.logs ?? []).some((l) => /Instruction: BurnChecked/.test(l));
  const closed = !sim2.value.accounts?.[0] || sim2.value.accounts[0].lamports === 0;
  console.log(`BURN  ok   BurnChecked ran: ${burnLog ? "yes" : "NO"} · tokens left in the account: ${closed ? "0 (account closed, rent returned)" : "see account"}`);
  console.log("\nNothing was sent. This is what a round for this coin would do.");
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message || err.name || String(err) : err);
  process.exit(1);
});
