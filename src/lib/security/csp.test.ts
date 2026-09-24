import { test } from "node:test";
import assert from "node:assert/strict";
import { buildCsp, cspHeaderName, cspMode, newNonce, parseViolations } from "./csp";

test("the mode defaults to REPORT-ONLY, and only exact known values change it", () => {
  assert.equal(cspMode({}), "report-only");
  assert.equal(cspMode({ CSP_MODE: "enforce" }), "enforce");
  assert.equal(cspMode({ CSP_MODE: " OFF " }), "off");
  assert.equal(cspMode({ CSP_MODE: "banana" }), "report-only", "a typo never silently enforces or disables it");
  assert.equal(cspHeaderName("report-only"), "Content-Security-Policy-Report-Only");
  assert.equal(cspHeaderName("enforce"), "Content-Security-Policy");
});

test("every request gets a different, unguessable nonce, and it is the ONLY way for a script to run", () => {
  const a = newNonce(), b = newNonce();
  assert.notEqual(a, b);
  assert.ok(a.length >= 40);
  const csp = buildCsp({ nonce: a });
  assert.ok(csp.includes(`script-src 'self' 'nonce-${a}' 'strict-dynamic'`));
  assert.ok(!/script-src[^;]*'unsafe-inline'/.test(csp), "no unsafe-inline for scripts");
  assert.ok(!/script-src[^;]*'unsafe-eval'/.test(csp), "no eval in production");
  assert.ok(/script-src[^;]*'unsafe-eval'/.test(buildCsp({ nonce: a, dev: true })), "dev needs eval for React's debugging");
});

test("the rest of the policy: same-origin connections, no frames or plugins, no framing, reports go to our endpoint", () => {
  const csp = buildCsp({ nonce: "x" });
  for (const d of ["default-src 'self'", "connect-src 'self'", "frame-src 'none'", "object-src 'none'", "base-uri 'self'", "form-action 'self'", "frame-ancestors 'none'", "report-uri /api/csp-report", "report-to csp-endpoint"]) assert.ok(csp.includes(d), d);
  assert.ok(!csp.includes("upgrade-insecure-requests"), "not in report-only");
  assert.ok(buildCsp({ nonce: "x", enforce: true }).includes("upgrade-insecure-requests"));
});

test("reports: both formats are understood, and only directive, origin and page PATH are kept (never a query string)", () => {
  const legacy = { "csp-report": { "effective-directive": "script-src-elem", "blocked-uri": "https://evil.example/x.js?token=SECRET", "document-uri": "https://panda.test/portfolio?wallet=ABC123", "source-file": "https://panda.test/_next/static/a.js" } };
  const [v] = parseViolations(legacy);
  assert.deepEqual(v, { directive: "script-src-elem", blocked: "https://evil.example", page: "/portfolio", source: "https://panda.test" });
  const modern = [{ type: "csp-violation", body: { effectiveDirective: "img-src", blockedURL: "inline", documentURL: "https://panda.test/coin/abc?x=1" } }, { type: "network-error", body: {} }];
  assert.deepEqual(parseViolations(modern), [{ directive: "img-src", blocked: "inline", page: "/coin/abc", source: "" }]);
  assert.ok(!JSON.stringify([v, ...parseViolations(modern)]).includes("SECRET"));
});

test("junk is ignored, and one report can't carry an unbounded number of violations", () => {
  assert.deepEqual(parseViolations(null), []);
  assert.deepEqual(parseViolations("nope"), []);
  assert.deepEqual(parseViolations({ other: 1 }), []);
  const many = Array.from({ length: 100 }, () => ({ type: "csp-violation", body: { effectiveDirective: "script-src" } }));
  assert.equal(parseViolations(many).length, 20);
});
