import { test } from "node:test";
import assert from "node:assert/strict";
import { Keypair, PublicKey } from "@solana/web3.js";
import { TOKEN_2022_PROGRAM_ID, TOKEN_PROGRAM_ID } from "@solana/spl-token";
import { getTokenHolders, holdersFromAccounts, parseRawAmount, tokenProgramOf } from "./holders";

// This exact function once shipped with its regex missing a backslash (/^d+$/), which silently
// rejected every real balance and made the rewards cron credit nobody. Real balances must parse.
test("real on-chain balances parse exactly, including ones above 2^53", () => {
  assert.equal(parseRawAmount("0"), BigInt(0));
  assert.equal(parseRawAmount("1"), BigInt(1));
  assert.equal(parseRawAmount("123456789"), BigInt(123456789));
  assert.equal(parseRawAmount("1000000000000000000000"), BigInt("1000000000000000000000"));
  assert.equal(parseRawAmount("9007199254740993"), BigInt("9007199254740993"));
});

test("anything that isn't a plain non-negative integer string is refused", () => {
  for (const bad of ["", "-1", "1.5", "1e9", " 1", "1 ", "abc", "d", "dd", "0x10", "١٢٣", 5, null, undefined, {}, []]) {
    assert.equal(parseRawAmount(bad), null, String(bad));
  }
});

// ── which program a coin lives in, and who holds it ─────────────────────────────────────────────────────────────────

const acc = (owner: string, amount: string, type: string | undefined = "account") => ({ account: { data: { parsed: { ...(type ? { type } : {}), info: { owner, tokenAmount: { amount } } } } } });

test("a coin is read from the token program it really lives in — Token-2022 coins (Pump.fun's today) are no longer invisible", () => {
  assert.equal(tokenProgramOf(TOKEN_PROGRAM_ID), TOKEN_PROGRAM_ID);
  assert.equal(tokenProgramOf(TOKEN_2022_PROGRAM_ID), TOKEN_2022_PROGRAM_ID);
  assert.equal(tokenProgramOf(new PublicKey("11111111111111111111111111111111")), null, "not a token at all");
  assert.equal(tokenProgramOf(null), null);
});

test("getTokenHolders asks Token-2022 for a Token-2022 coin (no 165-byte filter: its accounts carry extensions) and the classic program for a classic one", async () => {
  const mint = Keypair.generate().publicKey.toBase58();
  const asked: { program: string; filters: unknown[] }[] = [];
  const connection = (owner: PublicKey | null) =>
    ({
      getAccountInfo: async () => (owner ? { owner } : null),
      getParsedProgramAccounts: async (program: PublicKey, cfg: { filters: unknown[] }) => {
        asked.push({ program: program.toBase58(), filters: cfg.filters });
        return [acc("holderA", "5"), acc("holderB", "9")];
      },
    }) as never;

  assert.deepEqual((await getTokenHolders(connection(TOKEN_2022_PROGRAM_ID), mint)).map((h) => h.address), ["holderB", "holderA"]);
  assert.equal(asked[0].program, TOKEN_2022_PROGRAM_ID.toBase58());
  assert.deepEqual(asked[0].filters, [{ memcmp: { offset: 0, bytes: mint } }]);

  await getTokenHolders(connection(TOKEN_PROGRAM_ID), mint);
  assert.equal(asked[1].program, TOKEN_PROGRAM_ID.toBase58());
  assert.deepEqual(asked[1].filters, [{ dataSize: 165 }, { memcmp: { offset: 0, bytes: mint } }]);

  assert.deepEqual(await getTokenHolders(connection(null), mint), [], "a mint that doesn't exist has no holders");
  assert.equal(asked.length, 2);
});

test("holders: largest first, empty accounts and non-accounts skipped, capped", () => {
  const list = holdersFromAccounts([acc("a", "1"), acc("b", "0"), acc("c", "30"), acc("m", "99", "mint"), acc("d", "2", ""), acc("e", "x")], 3);
  assert.deepEqual(list, [{ address: "c", amount: BigInt(30) }, { address: "d", amount: BigInt(2) }, { address: "a", amount: BigInt(1) }]);
  assert.equal(holdersFromAccounts([acc("a", "1"), acc("c", "30")], 1)[0].address, "c");
});
