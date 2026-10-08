import { test } from "node:test";
import assert from "node:assert/strict";
import { Keypair } from "@solana/web3.js";
import bs58 from "bs58";
import { getRewardsPoolSigner, rewardsPoolServerStatus } from "./rewards-pool-signer";

const SECRET_ENV = "PANDA_REWARDS_POOL_SECRET_KEY";
const PUBLIC_ENV = "NEXT_PUBLIC_PANDA_REWARDS_POOL";

function withEnv<T>(vars: Record<string, string | undefined>, fn: () => T): T {
  const previous: Record<string, string | undefined> = {};
  for (const key of Object.keys(vars)) previous[key] = process.env[key];
  try {
    for (const [key, value] of Object.entries(vars)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    return fn();
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

test("unset secret: returns null, status reports not configured", () => {
  withEnv({ [SECRET_ENV]: undefined, [PUBLIC_ENV]: undefined }, () => {
    assert.equal(getRewardsPoolSigner(), null);
    assert.deepEqual(rewardsPoolServerStatus(), { configured: false });
  });
});

test("a valid base58 secret key, with no public key configured to check against, loads fine", () => {
  const kp = Keypair.generate();
  withEnv({ [SECRET_ENV]: bs58.encode(kp.secretKey), [PUBLIC_ENV]: undefined }, () => {
    const signer = getRewardsPoolSigner();
    assert.ok(signer);
    assert.equal(signer!.publicKey.toBase58(), kp.publicKey.toBase58());
    assert.deepEqual(rewardsPoolServerStatus(), { configured: true, ok: true, publicKey: kp.publicKey.toBase58() });
  });
});

test("a valid JSON byte-array secret key (solana-keygen's own format) loads fine", () => {
  const kp = Keypair.generate();
  withEnv({ [SECRET_ENV]: JSON.stringify(Array.from(kp.secretKey)), [PUBLIC_ENV]: undefined }, () => {
    const signer = getRewardsPoolSigner();
    assert.equal(signer!.publicKey.toBase58(), kp.publicKey.toBase58());
  });
});

test("a secret key that matches the configured public key loads fine", () => {
  const kp = Keypair.generate();
  withEnv({ [SECRET_ENV]: bs58.encode(kp.secretKey), [PUBLIC_ENV]: kp.publicKey.toBase58() }, () => {
    const signer = getRewardsPoolSigner();
    assert.equal(signer!.publicKey.toBase58(), kp.publicKey.toBase58());
  });
});

test("a secret key that does NOT match the configured public key is refused outright — never silently used", () => {
  const real = Keypair.generate();
  const someoneElse = Keypair.generate();
  withEnv({ [SECRET_ENV]: bs58.encode(real.secretKey), [PUBLIC_ENV]: someoneElse.publicKey.toBase58() }, () => {
    assert.throws(() => getRewardsPoolSigner(), /doesn't match NEXT_PUBLIC_PANDA_REWARDS_POOL/);
    const status = rewardsPoolServerStatus();
    assert.equal(status.configured, true);
    assert.ok(status.configured && !status.ok);
  });
});

for (const wordCount of [12, 24]) {
  test(`a ${wordCount}-word recovery phrase is rejected outright, never derived into a wallet`, () => {
    const phrase = Array.from({ length: wordCount }, (_, i) => `word${i}`.replace(/\d/g, "")).join(" ");
    withEnv({ [SECRET_ENV]: phrase, [PUBLIC_ENV]: undefined }, () => {
      assert.throws(() => getRewardsPoolSigner(), /recovery phrase/);
      const status = rewardsPoolServerStatus();
      assert.equal(status.configured, true);
      assert.ok(status.configured && !status.ok && /recovery phrase/.test(status.error));
    });
  });
}

test("garbage that is neither base58 nor a JSON array gets a clear, generic error — not a crash", () => {
  withEnv({ [SECRET_ENV]: "not-a-real-key-!!!", [PUBLIC_ENV]: undefined }, () => {
    assert.throws(() => getRewardsPoolSigner(), /isn't valid/);
  });
});

test("an 11-word phrase (not 12 or 24) is NOT treated as a mnemonic — falls through to the normal 'invalid' error", () => {
  const phrase = Array.from({ length: 11 }, (_, i) => `word${i}`.replace(/\d/g, "")).join(" ");
  withEnv({ [SECRET_ENV]: phrase, [PUBLIC_ENV]: undefined }, () => {
    assert.throws(() => getRewardsPoolSigner(), /isn't valid/);
  });
});
