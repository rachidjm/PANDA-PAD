import { test } from "node:test";
import assert from "node:assert/strict";
import { FEATURES, isEnabled } from "./flags";

test("every flag is off by default", () => {
  for (const f of FEATURES) assert.equal(isEnabled(f, {}), false);
});

test("only the exact string 'true' enables a flag", () => {
  assert.equal(isEnabled("NFT_THEMES", { FEATURE_NFT_THEMES: "true" }), true);
  for (const v of ["1", "TRUE", "yes", "True", " true", "", "false"]) {
    assert.equal(isEnabled("NFT_THEMES", { FEATURE_NFT_THEMES: v }), false, v);
  }
});
