import { test } from "node:test";
import assert from "node:assert/strict";
import { redact, REDACTED } from "./redact";

test("secret-named keys are redacted at any depth, others kept", () => {
  const out = redact({
    wallet: "W",
    signature: "txsig",
    tokenAmount: 5,
    secretKey: [1, 2, 3],
    nested: { privateKey: "abc", apiKey: "k", Authorization: "Bearer x", ok: 1, list: [{ password: "p", v: 2 }] },
    token: "jwt",
    cookie: "panda_session=abc",
  }) as Record<string, unknown>;
  assert.equal(out.wallet, "W");
  assert.equal(out.signature, "txsig"); // public tx signatures are meant to be auditable
  assert.equal(out.tokenAmount, 5);
  assert.equal(out.secretKey, REDACTED);
  assert.equal(out.token, REDACTED);
  assert.equal(out.cookie, REDACTED);
  const nested = out.nested as Record<string, unknown>;
  assert.equal(nested.privateKey, REDACTED);
  assert.equal(nested.apiKey, REDACTED);
  assert.equal(nested.Authorization, REDACTED);
  assert.equal(nested.ok, 1);
  assert.deepEqual(nested.list, [{ password: REDACTED, v: 2 }]);
});

test("is bounded: long strings, deep nesting, huge arrays, non-finite numbers, bigint", () => {
  assert.match(redact("x".repeat(5000)) as string, /truncated/);
  let deep: unknown = { a: 1 };
  for (let i = 0; i < 20; i++) deep = { n: deep };
  assert.match(JSON.stringify(redact(deep)), /max depth/);
  assert.equal((redact(Array.from({ length: 500 }, (_, i) => i)) as unknown[]).length, 50);
  assert.equal(redact(NaN), "NaN");
  assert.equal(redact(BigInt(7)), "7");
});

test("does not mutate its input", () => {
  const input = { secret: "s", a: { password: "p" } };
  redact(input);
  assert.equal(input.secret, "s");
  assert.equal(input.a.password, "p");
});
