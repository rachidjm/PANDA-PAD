/**
 * check-sharing — a READ-ONLY look at a coin's on-chain fee-sharing config (Pump.fun's `SharingConfig` account):
 * who the shareholders are and their shares, who the config's `admin` is, and whether `adminRevoked` is set.
 *
 *   npm run check-sharing -- <mint> [--rpc <url>]
 *
 * It uses no key and sends nothing. Use it after creating a Standard coin to see that the split really written
 * on-chain is what the Create screen showed (creator + PANDA's locked 5 %), and whether it can still be changed.
 */
import { Connection, PublicKey } from "@solana/web3.js";
import { PANDA_SHARE_BPS } from "../src/lib/config/protocol";
import { PANDA_TREASURY } from "../src/lib/pump/constants";
import { getRawSharingConfig } from "../src/lib/pump/fee-sharing";

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

async function main() {
  let mint: PublicKey;
  try {
    mint = new PublicKey(process.argv[2] ?? "");
  } catch {
    console.error("Usage: npm run check-sharing -- <mint> [--rpc <url>]");
    process.exit(2);
  }
  const connection = new Connection(arg("rpc") || process.env.SOLANA_RPC_URL || "https://api.mainnet-beta.solana.com", "confirmed");
  const raw = await getRawSharingConfig(connection, mint);
  if (!raw) {
    console.log(`No SharingConfig for ${mint.toBase58()}: this coin never opted in to fee sharing (its creator fees go to the creator).`);
    process.exit(1);
  }

  const { config, address } = raw;
  const treasury = PANDA_TREASURY.toBase58();
  console.log(`SharingConfig  ${address.toBase58()}   (version ${config.version})`);
  console.log(`Mint           ${config.mint.toBase58()}`);
  console.log(`Admin          ${config.admin.toBase58()}`);
  console.log(`adminRevoked   ${config.adminRevoked}`);
  console.log("Shareholders");
  let total = 0;
  for (const s of config.shareholders) {
    total += s.shareBps;
    const tag = s.address.toBase58() === treasury ? "  ← PANDA treasury" : "";
    console.log(`  ${s.address.toBase58()}  ${(s.shareBps / 100).toFixed(2)} %${tag}`);
  }
  console.log(`  total ${(total / 100).toFixed(2)} %`);
  console.log();

  const problems: string[] = [];
  if (total !== 10_000) problems.push(`shares add up to ${(total / 100).toFixed(2)} %, not 100 %`);
  const panda = config.shareholders.filter((s) => s.address.toBase58() === treasury);
  if (panda.length !== 1 || panda[0].shareBps !== PANDA_SHARE_BPS) problems.push(`PANDA's treasury (${treasury}) is not present exactly once at ${PANDA_SHARE_BPS / 100} %`);
  console.log(problems.length ? `CHECK FAILED: ${problems.join("; ")}` : `CHECK OK: 100 % assigned and PANDA's ${PANDA_SHARE_BPS / 100} % goes to the treasury this deployment is configured with.`);
  console.log(
    config.adminRevoked
      ? "Can it be changed later? adminRevoked is TRUE: the admin's rights over this config were revoked."
      : `Can it be changed later? adminRevoked is FALSE: the admin (${config.admin.toBase58()}) still holds the rights over this config. What exactly the admin may change is defined by Pump.fun's program, not by PANDA — (unverified) read its documentation before promising users the split is permanent.`
  );
  process.exit(problems.length ? 1 : 0);
}

main().catch((err) => {
  console.error("check-sharing failed:", err instanceof Error ? err.message : err);
  process.exit(1);
});
