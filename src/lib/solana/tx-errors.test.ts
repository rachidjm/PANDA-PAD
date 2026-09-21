import { test } from "node:test";
import assert from "node:assert/strict";
import { classifyFailure, TxFailedError } from "./tx-errors";
import { ammPoolProblem, MIN_POOL_SOL_LAMPORTS, WSOL_MINT } from "../pump/pool-check";

test("a transaction that ran out of SOL is recognised from the System program's own log", () => {
  const err = { InstructionError: [1, { Custom: 1 }] };
  const logs = ["Program 1111 invoke [1]", "Transfer: insufficient lamports 20000000, need 505000000", "Program 1111 failed: custom program error: 0x1"];
  assert.equal(classifyFailure(err, logs), "insufficient_sol");
  assert.equal(classifyFailure("InsufficientFundsForFee"), "insufficient_sol");
  assert.equal(classifyFailure({ InsufficientFundsForRent: { account_index: 1 } }), "insufficient_sol");
});

test("selling more tokens than you hold is a different reason from lacking SOL", () => {
  assert.equal(classifyFailure({ InstructionError: [3, { Custom: 1 }] }, ["Program log: Error: insufficient funds"]), "insufficient_tokens");
});

test("slippage, missing accounts and expiry are told apart", () => {
  assert.equal(classifyFailure({ InstructionError: [2, { Custom: 6004 }] }, ["Program log: AnchorError ... ExceededSlippage. Error Number: 6004"]), "slippage");
  assert.equal(classifyFailure({ InstructionError: [2, { Custom: 6002 }] }, ["Program log: Error Code: TooMuchSolRequired"]), "slippage");
  // The real failure that motivated this: a pool set up the wrong way round.
  assert.equal(classifyFailure({ InstructionError: [2, { Custom: 3012 }] }, ["Program log: AnchorError caused by account: user_quote_token_account. Error Code: AccountNotInitialized."]), "account_missing");
  assert.equal(classifyFailure("BlockhashNotFound"), "expired");
});

test("anything else stays 'unknown' rather than being guessed", () => {
  assert.equal(classifyFailure({ InstructionError: [0, "InvalidAccountData"] }, ["Program log: something else"]), "unknown");
  assert.equal(classifyFailure(undefined, undefined), "unknown");
  assert.equal(classifyFailure(null, []), "unknown");
});

test("the error keeps the old wording (so older matchers still work) and carries the reason", () => {
  const e = new TxFailedError("insufficient_sol", { x: 1 });
  assert.match(e.message, /failed on-chain/i);
  assert.equal(e.reason, "insufficient_sol");
  assert.deepEqual(e.rawError, { x: 1 });
});

const TOKEN = "3e6to4qrHByU19Sij9DVKPB4AQD5RuyhH2Sj2ESLpump";
const healthy = { baseMint: TOKEN, quoteMint: WSOL_MINT, baseReserve: BigInt("194377061284989"), quoteReserve: BigInt("79966664919") };

test("a healthy token/SOL pool passes", () => {
  assert.equal(ammPoolProblem(healthy, TOKEN), null);
  assert.equal(ammPoolProblem({ ...healthy, baseReserve: "194377061284989", quoteReserve: { toString: () => "79966664919" } }, TOKEN), null, "reserves may come as strings or BN-like objects");
});

test("the real broken pools are refused: SOL as base and the token as quote, with next to nothing inside", () => {
  const inverted = { baseMint: WSOL_MINT, quoteMint: "3FSgC2pPmBpDNJqEqmJMaXCE6k1ehRAhw1D3WNhNvWcD", baseReserve: BigInt("1"), quoteReserve: BigInt("12961") };
  assert.ok(ammPoolProblem(inverted, "3FSgC2pPmBpDNJqEqmJMaXCE6k1ehRAhw1D3WNhNvWcD"));
  assert.ok(ammPoolProblem({ ...healthy, baseMint: "SomeOtherToken1111111111111111111111111111" }, TOKEN), "a pool of a different token");
  assert.ok(ammPoolProblem({ ...healthy, quoteMint: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v" }, TOKEN), "quoted in USDC, not SOL");
});

test("an (almost) empty pool is refused, exactly at the threshold", () => {
  assert.ok(ammPoolProblem({ ...healthy, quoteReserve: MIN_POOL_SOL_LAMPORTS - BigInt("1") }, TOKEN));
  assert.equal(ammPoolProblem({ ...healthy, quoteReserve: MIN_POOL_SOL_LAMPORTS }, TOKEN), null);
  assert.ok(ammPoolProblem({ ...healthy, baseReserve: BigInt("0") }, TOKEN));
  assert.ok(ammPoolProblem({ ...healthy, quoteReserve: "not a number" }, TOKEN), "unreadable reserves count as empty");
});
