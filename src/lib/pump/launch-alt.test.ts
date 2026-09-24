import { test } from "node:test";
import assert from "node:assert/strict";
import { Keypair, PublicKey } from "@solana/web3.js";
import type { Connection } from "@solana/web3.js";
import { getLaunchLookupTable, launchLookupTableAddress, localLookupTable } from "./launch-alt";

const addr = () => Keypair.generate().publicKey.toBase58();
const conn = (value: unknown, calls: { n: number }) => ({ getAddressLookupTable: async () => (calls.n++, { value }) }) as unknown as Connection;
const table = (key?: PublicKey) => localLookupTable([Keypair.generate().publicKey], key);

test("no PANDA_LOOKUP_TABLE (or a malformed one) means no table: the launch takes two transactions", async () => {
  assert.equal(launchLookupTableAddress({}), null);
  assert.equal(launchLookupTableAddress({ PANDA_LOOKUP_TABLE: "not-a-key" }), null);
  assert.ok(launchLookupTableAddress({ PANDA_LOOKUP_TABLE: addr() }) instanceof PublicKey);
  const calls = { n: 0 };
  assert.equal(await getLaunchLookupTable(conn(table(), calls), {}), null);
  assert.equal(calls.n, 0, "no RPC call without the variable");
});

test("a configured table that does not exist on-chain, or holds nothing, is not used", async () => {
  const calls = { n: 0 };
  assert.equal(await getLaunchLookupTable(conn(null, calls), { PANDA_LOOKUP_TABLE: addr() }), null);
  assert.equal(await getLaunchLookupTable(conn(localLookupTable([]), calls), { PANDA_LOOKUP_TABLE: addr() }), null);
});

test("an active table is returned and cached; a failed lookup is not retried for a minute", async () => {
  const calls = { n: 0 };
  const at = addr();
  const env = { PANDA_LOOKUP_TABLE: at };
  const t = table(new PublicKey(at)); // on-chain, the table's own key IS its address
  assert.equal(await getLaunchLookupTable(conn(t, calls), env), t);
  assert.equal(await getLaunchLookupTable(conn(t, calls), env), t);
  assert.equal(calls.n, 1, "second call served from the cache");

  const failing = { PANDA_LOOKUP_TABLE: addr() };
  const c2 = { n: 0 };
  assert.equal(await getLaunchLookupTable(conn(null, c2), failing), null);
  assert.equal(await getLaunchLookupTable(conn(null, c2), failing), null);
  assert.equal(c2.n, 1, "the failure is remembered instead of hammering the RPC");
});

// ── admin: creating the table with the admin's wallet ──────────────────────────────────────────────────────────────────
import { AddressLookupTableAccount, AddressLookupTableProgram, Transaction } from "@solana/web3.js";
import { buildCreateTableTx, buildFreezeTx } from "./alt-admin";
import { checkLaunchTable } from "./launch-alt-check";
import { launchStaticAddresses } from "./launch-alt";

test("creating the table: one transaction that creates and fills it (fits the limit), at the address derived from the wallet and slot", async () => {
  const authority = Keypair.generate().publicKey;
  const addresses = await launchStaticAddresses();
  const { tx, table } = buildCreateTableTx({ authority, recentSlot: 123_456_789, addresses });
  const slot = Buffer.alloc(8);
  slot.writeBigUInt64LE(BigInt(123_456_789));
  assert.equal(table.toBase58(), PublicKey.findProgramAddressSync([authority.toBuffer(), slot], AddressLookupTableProgram.programId)[0].toBase58());
  assert.equal(tx.instructions.length, 2, "create + extend");
  assert.ok(tx.instructions.every((i) => i.programId.equals(AddressLookupTableProgram.programId)));
  tx.feePayer = authority;
  tx.recentBlockhash = "11111111111111111111111111111111";
  assert.ok(tx.serialize({ requireAllSignatures: false, verifySignatures: false }).length <= 1232);
  assert.ok(tx.instructions[0].keys.some((k) => k.pubkey.equals(authority) && k.isSigner), "the admin's wallet is the only signer needed");
});

test("freezing: a single instruction signed by the authority, on that table only", () => {
  const authority = Keypair.generate().publicKey;
  const table = Keypair.generate().publicKey;
  const tx: Transaction = buildFreezeTx({ authority, table });
  assert.equal(tx.instructions.length, 1);
  assert.ok(tx.instructions[0].keys.some((k) => k.pubkey.equals(table)));
  assert.ok(tx.instructions[0].keys.some((k) => k.pubkey.equals(authority) && k.isSigner));
});

test("checkLaunchTable: ok only when active, FROZEN, complete and a launch fits; each failure is named", async () => {
  const addresses = await launchStaticAddresses();
  assert.equal((await checkLaunchTable(null)).exists, false);
  const good = await checkLaunchTable(localLookupTable(addresses));
  assert.equal(good.ok, true);
  assert.equal(good.frozen, true);
  assert.ok(good.fits.length === 2 && good.fits.every((f) => f.bytes !== null));

  const incomplete = await checkLaunchTable(localLookupTable(addresses.slice(0, 5)));
  assert.equal(incomplete.ok, false);
  assert.equal(incomplete.missing.length, addresses.length - 5);

  const unfrozen = new AddressLookupTableAccount({ key: Keypair.generate().publicKey, state: { deactivationSlot: BigInt("18446744073709551615"), lastExtendedSlot: 0, lastExtendedSlotStartIndex: 0, authority: Keypair.generate().publicKey, addresses } });
  const u = await checkLaunchTable(unfrozen);
  assert.equal(u.frozen, false);
  assert.equal(u.ok, false, "an unfrozen table could be deactivated by its authority");
  assert.ok(u.authority);
});
