import { test } from "node:test";
import assert from "node:assert/strict";
import { Keypair } from "@solana/web3.js";
import { FEATURES, isEnabled } from "./flags";
import { featureDisabledResponse } from "./guard";
import { decideCoinCreation, COIN_CREATION_BLOCKED_MESSAGE } from "./creation";
import { envReport } from "./env";
import { holderShareIssue } from "@/lib/pump/holder-rewards";
import { getLegalPage, LEGAL_SLUGS } from "@/lib/legal-content";

const key = () => Keypair.generate().publicKey.toBase58();

test("FEATURE_HOLDER_REWARDS exists, is off by default, and only the exact string 'true' turns it on", async () => {
  assert.ok(FEATURES.includes("HOLDER_REWARDS"));
  assert.equal(isEnabled("HOLDER_REWARDS", {}), false);
  assert.equal(isEnabled("HOLDER_REWARDS", { FEATURE_HOLDER_REWARDS: "1" }), false);
  assert.equal(isEnabled("HOLDER_REWARDS", { FEATURE_HOLDER_REWARDS: "true" }), true);
  const res = featureDisabledResponse("HOLDER_REWARDS", {});
  assert.equal(res?.status, 403);
  assert.equal((await res!.json()).feature, "HOLDER_REWARDS");
});

test("with the flag OFF the server refuses any split that includes the Holders share (the pool address); ON, or no pool configured, it does not", () => {
  const pool = key();
  const creator = key();
  const treasury = key();
  const withHolders = [{ address: treasury }, { address: creator }, { address: pool }];
  const withoutHolders = [{ address: treasury }, { address: creator }, { address: key() }]; // a partner wallet
  assert.match(holderShareIssue(withHolders, { enabled: false, pool }) ?? "", /Holders/);
  assert.equal(holderShareIssue(withoutHolders, { enabled: false, pool }), null, "PANDA 5% + creator + partner is the launch split");
  assert.equal(holderShareIssue(withHolders, { enabled: true, pool }), null);
  assert.equal(holderShareIssue(withHolders, { enabled: false, pool: null }), null, "no pool configured: there is no Holders band to refuse");
  // the pool address dressed up as a 'partner' is the same address, so it is refused too
  assert.ok(holderShareIssue([{ address: pool }], { enabled: false, pool }));
});

test("coin creation: on mainnet it is blocked unless TREASURY_IS_MULTISIG is exactly 'true'; devnet and an unset network are not gated; trading never calls this", () => {
  assert.deepEqual(decideCoinCreation({ NETWORK: "mainnet" }), { allowed: false, reason: "treasury_not_multisig" });
  for (const v of ["false", "TRUE", "1", "yes", "", " true"]) assert.equal(decideCoinCreation({ NETWORK: "mainnet", TREASURY_IS_MULTISIG: v }).allowed, false, JSON.stringify(v));
  assert.deepEqual(decideCoinCreation({ NETWORK: "mainnet", TREASURY_IS_MULTISIG: "true" }), { allowed: true });
  assert.equal(decideCoinCreation({ NETWORK: "devnet" }).allowed, true);
  assert.equal(decideCoinCreation({}).allowed, true, "no NETWORK (local development)");
  assert.match(COIN_CREATION_BLOCKED_MESSAGE, /multisig/);
  assert.match(COIN_CREATION_BLOCKED_MESSAGE, /Trading is not affected/);
});

test("TREASURY_IS_MULTISIG is reported by the env schema: required on mainnet only, and must be true/false", () => {
  const by = (env: Record<string, string>) => envReport(env).find((i) => i.name === "TREASURY_IS_MULTISIG")!;
  assert.equal(by({ NETWORK: "mainnet" }).required, true);
  assert.equal(by({ NETWORK: "mainnet" }).status, "absent");
  assert.equal(by({ NETWORK: "mainnet", TREASURY_IS_MULTISIG: "maybe" }).status, "invalid");
  assert.equal(by({ NETWORK: "mainnet", TREASURY_IS_MULTISIG: "true" }).status, "present");
  assert.equal(by({ NETWORK: "devnet" }).required, false);
});

test("legal pages: nothing about the Rewards Pool while holder rewards are off; declared (ES/EN) when on", () => {
  const POOL = /Rewards Pool|"Holders"|\\"Holders\\"/;
  for (const slug of LEGAL_SLUGS) {
    const off = getLegalPage(slug, { custody: false, holders: false });
    for (const lang of ["en", "es"] as const) for (const p of off.body[lang]) assert.doesNotMatch(p, POOL, `${slug}/${lang}: ${p.slice(0, 70)}`);
  }
  for (const slug of ["legal-notice", "terms-of-service", "risk-disclosure", "disclaimer", "privacy-policy"] as const) {
    const on = getLegalPage(slug, { custody: false, holders: true });
    for (const lang of ["en", "es"] as const) assert.ok(on.body[lang].some((p) => /Rewards Pool|holder|holders/i.test(p)), `${slug}/${lang}`);
  }
  // both families independent
  const both = getLegalPage("risk-disclosure", { custody: true, holders: true });
  assert.ok(both.body.en.some((p) => /Privy/.test(p)) && both.body.en.some((p) => /Rewards Pool/.test(p)));
});
