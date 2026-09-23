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
