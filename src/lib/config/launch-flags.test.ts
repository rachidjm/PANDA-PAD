import { test } from "node:test";
import assert from "node:assert/strict";
import { FEATURES, isEnabled } from "./flags";
import { featureDisabledResponse } from "./guard";
import { CUSTODY_ADDENDA, getLegalPage, LEGAL_PAGES, LEGAL_SLUGS } from "@/lib/legal-content";

test("the launch flags exist and are OFF by default", () => {
  for (const f of ["STRATEGIES", "OTC_REWARDS"] as const) {
    assert.ok(FEATURES.includes(f));
    assert.equal(isEnabled(f, {}), false);
  }
});

test("a route of a switched-off feature answers 403 with a clear message and a stable code; switched on, it passes", async () => {
  for (const f of ["STRATEGIES", "OTC_REWARDS"] as const) {
    const res = featureDisabledResponse(f, {});
    assert.equal(res?.status, 403);
    const body = await res!.json();
    assert.equal(body.code, "FEATURE_DISABLED");
    assert.equal(body.feature, f);
    assert.match(body.error, /not enabled/);
    assert.equal(featureDisabledResponse(f, { [`FEATURE_${f}`]: "true" }), null);
    assert.equal(featureDisabledResponse(f, { [`FEATURE_${f}`]: "1" })?.status, 403, "only the exact string 'true' turns it on");
  }
});

const CUSTODY_WORDS = /Privy|Stop Loss|Take Profit|Draw Your Trade|Trigger vault|Trigger API|bóveda/i;

test("with the strategies flag OFF no legal page mentions the custodial vault (so 'non-custodial' stays true)", () => {
  for (const slug of LEGAL_SLUGS) {
    const page = getLegalPage(slug, { custody: false });
    for (const lang of ["en", "es"] as const) {
      for (const para of page.body[lang]) assert.doesNotMatch(para, CUSTODY_WORDS, `${slug}/${lang}: ${para.slice(0, 60)}`);
    }
  }
  assert.equal(getLegalPage("risk-disclosure", { custody: false }), LEGAL_PAGES["risk-disclosure"]);
});

test("with the flag ON the custody of Privy and its risks are declared, in both languages, on the pages that matter", () => {
  for (const slug of ["legal-notice", "terms-of-service", "privacy-policy", "risk-disclosure", "disclaimer"] as const) {
    const on = getLegalPage(slug, { custody: true });
    for (const lang of ["en", "es"] as const) {
      assert.ok(on.body[lang].length > LEGAL_PAGES[slug].body[lang].length, `${slug}/${lang} got no addendum`);
      assert.ok(on.body[lang].slice(LEGAL_PAGES[slug].body[lang].length).some((p) => /Privy/.test(p)), `${slug}/${lang} doesn't name Privy`);
    }
  }
  assert.ok(CUSTODY_ADDENDA["risk-disclosure"]!.en[0].includes("cannot recover"));
});

test("the cookie and privacy pages no longer claim 'no cookies' (the wallet sign-in sets one session cookie)", () => {
  const text = [...LEGAL_PAGES["cookie-policy"].body.en, ...LEGAL_PAGES["privacy-policy"].body.en].join(" ");
  assert.doesNotMatch(text, /does not use cookies of any kind|does not set cookies/i);
  assert.match(text, /session cookie/i);
});
