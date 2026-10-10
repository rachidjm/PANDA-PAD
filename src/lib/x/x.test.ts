import { test } from "node:test";
import assert from "node:assert/strict";
import { oauthHeader } from "./oauth";
import { fetchImage, realXClient, xConfig, xReason, X_ENV } from "./client";
import { digestProblem, weeklyXVersions, xCostUsd, xFinalLength, xFinalText, xFingerprint, xLength, xTextProblem, X_MAX } from "./text";

/** PANDA's account on X: the request signature, what a post may look like, and a client that never retries. No network. */

process.env.PANDA_ORDERS_ALLOWLIST = "*"; // PANDA orders are open to everyone: they may be named

// ── OAuth 1.0a ──────────────────────────────────────────────────────────────────────────────────────────────────────

test("the signature matches X's own published example (\"Creating a signature\")", () => {
  const header = oauthHeader(
    "POST",
    "https://api.twitter.com/1.1/statuses/update.json?include_entities=true",
    { apiKey: "xvz1evFS4wEEPTGEFPHBog", apiSecret: "kAcSOqF21Fu85e7zjz7ZN2U4ZRhfV3WpwPAoE3Z7kBw", accessToken: "370773112-GmHxMAgYyLbNEtIKZeRNFsMKPR9EyMZeS9weJAEb", accessTokenSecret: "LswwdoUaIvS8ltyTt5jkRh4J50vUPVVHtR2YPi5kE" },
    { params: { status: "Hello Ladies + Gentlemen, a signed OAuth request!" }, nonce: "kYjzVBB8Y0ZFabxSWbWovY3uYSQ2pTgmZeNu2VS4cg", timestamp: 1318622958 }
  );
  assert.ok(header.startsWith("OAuth "));
  assert.ok(header.includes('oauth_signature="hCtSmYh%2BiHYCEqBWrE7C7hYmtUk%3D"'), header);
  assert.ok(header.includes('oauth_consumer_key="xvz1evFS4wEEPTGEFPHBog"') && header.includes('oauth_signature_method="HMAC-SHA1"') && header.includes('oauth_version="1.0"'));
  assert.ok(!header.includes("kAcSOqF21Fu85e7zjz7ZN2U4ZRhfV3WpwPAoE3Z7kBw") && !header.includes("LswwdoUaIvS8ltyTt5jkRh4J50vUPVVHtR2YPi5kE"), "the two secrets are never in the header");
});

// ── settings ────────────────────────────────────────────────────────────────────────────────────────────────────────

test("settings: off unless the flag is exactly true; a missing credential is named (never shown); one post a day by default", () => {
  const off = xConfig({});
  assert.deepEqual([off.enabled, off.creds, off.maxPerDay, off.defaultImageUrl], [false, null, 1, null]);
  assert.deepEqual(off.missing, [...X_ENV]);
  const env = { FEATURE_X_POSTING: "true", X_API_KEY: "k", X_API_SECRET: "s", X_ACCESS_TOKEN: "t", X_ACCESS_TOKEN_SECRET: "ts", X_MAX_POSTS_PER_DAY: "3", X_DEFAULT_IMAGE_URL: "https://launchonpanda.app/og.png" };
  const on = xConfig(env);
  assert.deepEqual([on.enabled, on.missing, on.maxPerDay, on.defaultImageUrl], [true, [], 3, "https://launchonpanda.app/og.png"]);
  assert.deepEqual(xConfig({ ...env, X_ACCESS_TOKEN: " " }).missing, ["X_ACCESS_TOKEN"]);
  assert.equal(xConfig({ ...env, X_ACCESS_TOKEN: " " }).creds, null);
  for (const bad of ["0", "-1", "abc", "1.5", "999"]) assert.equal(xConfig({ ...env, X_MAX_POSTS_PER_DAY: bad }).maxPerDay, 1, bad);
  for (const bad of ["http://launchonpanda.app/a.png", "javascript:alert(1)", "https://localhost/a.png", "https://10.0.0.1/a.png", "nope"]) assert.equal(xConfig({ ...env, X_DEFAULT_IMAGE_URL: bad }).defaultImageUrl, null, bad);
});

// ── what a post may look like ───────────────────────────────────────────────────────────────────────────────────────

test("a post is a short note in plain sentences — these go through", () => {
  for (const ok of [
    "PANDA orders are open to everyone now. Draw a sell or a stop on the chart for a coin you hold and it runs by itself, even with the site closed.",
    "Small one today. Your balance of each coin shows above the trade box.",
    "New on PANDA: sells and stops you draw on the chart.\n\nAny size, and you can change or cancel them whenever you like 🐼",
    "Works with Pumpfun and PumpSwap coins.",
  ]) {
    assert.equal(xTextProblem(ok), null, ok);
  }
});

test("refused: a list, a changelog heading, marketing phrases, long dashes, hashtags, two emoji, dates, links and domains, more than 280", () => {
  const bad: [string, RegExp][] = [
    ["", /empty/],
    ["New on PANDA:\n- sells on the chart\n- stops on the chart", /a list/],
    ["Today:\n1. Sells\n2. Stops", /a list/],
    ["• Sells on the chart", /a list/],
    ["✨ New\nSells on the chart for everyone.", /a heading/],
    ["# PANDA update\nSells on the chart.", /a heading/],
    ["Excited to announce sells on the chart.", /marketing phrase/],
    ["We're thrilled: sells on the chart.", /marketing phrase/],
    ["A real game-changer for traders.", /marketing phrase/],
    ["A seamless way to sell.", /marketing phrase/],
    ["Elevate your trading with chart orders.", /marketing phrase/],
    ["Unlock sells on the chart.", /marketing phrase/],
    ["Dive in and draw your first sell.", /marketing phrase/],
    ["A revolutionary way to sell.", /marketing phrase/],
    ["Sells on the chart — for everyone.", /long dash/],
    ["Sells on the chart – for everyone.", /long dash/],
    ["Sells on the chart for everyone #solana", /hashtag/],
    ["Sells on the chart 🐼🚀", /more than one emoji/],
    ["October 10: sells on the chart.", /a date/],
    ["Sells on the chart since 2026-10-10.", /a date/],
    ["Sells on the chart. https://launchonpanda.app", /link or a domain/],
    ["Sells on the chart at launchonpanda.app", /link or a domain/],
    ["Works with Pump.fun coins.", /link or a domain/],
    ["Sells on the chart <b>now</b>.", /markup/],
    [`${"Sells on the chart for every coin you hold. ".repeat(7)}`, /more than 280 characters/],
    // …and the changelog's content rules still apply.
    ["Fixed an exploit in the wallet flow.", /security detail/],
    ["Staking is coming soon.", /promise about the future/],
    ["This coin will pump.", /price or rewards/],
    ["We moved the database.", /infrastructure/],
    ["New tools in /admin.", /admin area/],
  ];
  for (const [text, why] of bad) {
    const p = xTextProblem(text);
    assert.ok(p && why.test(p), `${JSON.stringify(text)} → ${p}`);
  }
});

test("length is counted the way X does (an emoji is two), the link is 23 and its own line, and the price depends on the link", () => {
  assert.equal(xLength("abc"), 3);
  assert.equal(xLength("abc 🐼"), 6);
  assert.equal(xLength("ñandú"), 5);
  const full = "word ".repeat(56); // 280 with its last space
  assert.equal(xTextProblem(full.slice(0, X_MAX - 1) + "s"), null);
  assert.match(xTextProblem(full + "s") ?? "", /280 characters \(281\)/);
  assert.equal(xFinalText("  Hello.  ", null), "Hello.");
  assert.equal(xFinalText("Hello.", "https://launchonpanda.app"), "Hello.\nhttps://launchonpanda.app");
  assert.deepEqual([xFinalLength("Hello.", false), xFinalLength("Hello.", true)], [6, 30]);
  assert.deepEqual([xCostUsd(false), xCostUsd(true)], [0.015, 0.2]);
  assert.equal(xFingerprint("Hello,  World!"), xFingerprint("hello world"));
  assert.notEqual(xFingerprint("Hello world"), xFingerprint("Hello worlds"));
});

test("the weekly summary: three wordings from the one-line summaries, each a valid post; too many are left out, never cut; none → nothing", () => {
  assert.deepEqual(weeklyXVersions([]), []);
  assert.deepEqual(weeklyXVersions(["", "  "]), []);
  const three = weeklyXVersions(["trades confirm faster", "your holdings on every coin page", "A new Telegram button on the home page"]);
  assert.equal(three.length, 3);
  assert.equal(three[0], "This week on PANDA: trades confirm faster, your holdings on every coin page and a new Telegram button on the home page.");
  assert.equal(three[1], "A few small things landed on PANDA this week. Trades confirm faster. Your holdings on every coin page. A new Telegram button on the home page.");
  assert.equal(new Set(three).size, 3);
  for (const t of three) assert.equal(xTextProblem(t), null, t);
  assert.equal(weeklyXVersions(["trades confirm faster"])[0], "This week on PANDA: trades confirm faster.");
  assert.equal(weeklyXVersions(["same", "same"])[0], "This week on PANDA: same.");
  const many = weeklyXVersions(Array.from({ length: 12 }, (_, k) => `the improvement number ${k + 1} of this long week`));
  for (const t of many) assert.ok(xLength(t) <= X_MAX && /[a-z]\.$|now\.$/.test(t), t);
  assert.ok(!many[0].includes("number 12"), "the last ones are left out");
  // The one-line summary itself: short, one phrase, and within the same rules.
  assert.equal(digestProblem("trades confirm faster"), null);
  assert.match(digestProblem(undefined) ?? "", /missing/);
  assert.match(digestProblem("x".repeat(91)) ?? "", /90 characters/);
  assert.match(digestProblem("Trades confirm faster.") ?? "", /no final punctuation/);
  assert.match(digestProblem("a seamless trade box") ?? "", /marketing phrase/);
  assert.match(digestProblem("an exploit closed") ?? "", /security detail/);
});

// ── the client ──────────────────────────────────────────────────────────────────────────────────────────────────────

const CREDS = { apiKey: "key-key-key", apiSecret: "secret-secret-secret-secret", accessToken: "token-token-token-token", accessTokenSecret: "tokensecret-tokensecret" };
type Call = { url: string; method: string; headers: Record<string, string>; body: unknown };
function fakeFetch(answer: (call: Call) => Response | Promise<Response>) {
  const calls: Call[] = [];
  const impl = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const call = { url: String(input), method: init?.method ?? "GET", headers: (init?.headers ?? {}) as Record<string, string>, body: init?.body };
    calls.push(call);
    return answer(call);
  }) as typeof fetch;
  return { impl, calls };
}
const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

test("reading the signed-in account, posting and uploading: the official v2 endpoints, signed, called ONCE each", async () => {
  const f = fakeFetch((c) => (c.url.endsWith("/2/users/me") ? json(200, { data: { id: "42", username: "LaunchOnPanda" } }) : c.url.endsWith("/2/media/upload") ? json(200, { data: { id: "9001" } }) : json(201, { data: { id: "777", text: "hi" } })));
  const x = realXClient(CREDS, f.impl);
  assert.deepEqual(await x.verify(), { ok: true, value: { id: "42", username: "LaunchOnPanda" } });
  assert.deepEqual(await x.uploadImage(new Uint8Array([1, 2, 3]), "image/png"), { ok: true, value: { mediaId: "9001" } });
  assert.deepEqual(await x.post("Hello.", "9001"), { ok: true, value: { id: "777" } });
  assert.deepEqual(f.calls.map((c) => `${c.method} ${c.url}`), ["GET https://api.x.com/2/users/me", "POST https://api.x.com/2/media/upload", "POST https://api.x.com/2/tweets"]);
  assert.ok(f.calls.every((c) => /^OAuth oauth_consumer_key="key-key-key", oauth_nonce="[0-9a-f]{32}", oauth_signature="[^"]+", oauth_signature_method="HMAC-SHA1", oauth_timestamp="\d+", oauth_token="token-token-token-token", oauth_version="1\.0"$/.test(c.headers.Authorization)));
  assert.ok(f.calls.every((c) => !JSON.stringify(c.headers).includes(CREDS.apiSecret) && !JSON.stringify(c.headers).includes(CREDS.accessTokenSecret)));
  assert.equal(f.calls[2].body, JSON.stringify({ text: "Hello.", media: { media_ids: ["9001"] } }));
  assert.ok(f.calls[1].body instanceof FormData && (f.calls[1].body as FormData).get("media_category") === "tweet_image");
});

test("X says no → 'rejected' with X's own reason; no answer or a server error → 'unknown' (the post may exist). Never a second call", async () => {
  const cases: [Response | Error, "rejected" | "unknown", RegExp][] = [
    [json(403, { detail: "You are not allowed to create a Tweet with duplicate content.", title: "Forbidden" }), "rejected", /duplicate content.*not allowed/],
    [json(401, { title: "Unauthorized" }), "rejected", /Unauthorized \(credentials not accepted\)/],
    [json(402, {}), "rejected", /no credits left/],
    [json(429, { title: "Too Many Requests" }), "rejected", /rate limit/],
    [json(400, { errors: [{ message: "Your Tweet text is too long." }] }), "rejected", /too long\. \(HTTP 400\)/],
    [json(503, {}), "unknown", /HTTP 503/],
    [new Response("<html>", { status: 201 }), "unknown", /not with what was expected/],
    [Object.assign(new Error("timed out"), { name: "TimeoutError" }), "unknown", /didn't answer in time/],
    [new Error("socket hang up"), "unknown", /couldn't reach X/],
  ];
  for (const [answer, kind, reason] of cases) {
    const f = fakeFetch(() => {
      if (answer instanceof Error) throw answer;
      return answer.clone();
    });
    const r = await realXClient(CREDS, f.impl).post("Hello.");
    assert.ok(!r.ok && r.kind === kind && reason.test(r.reason), `${kind}: ${JSON.stringify(r)}`);
    assert.equal(f.calls.length, 1, "one call, whatever happens");
    assert.ok(!JSON.stringify(r).includes("secret") && !JSON.stringify(r).includes("token-token"), "nothing of ours in the reason");
  }
  assert.equal(xReason(418, null), "HTTP 418");
  assert.ok(xReason(403, { detail: "x".repeat(900) }).length <= 300);
});

test("the image: only https, only a real image, at most 5 MB", async () => {
  const png = (bytes: number, type = "image/png") => fakeFetch(() => new Response(new Uint8Array(bytes), { headers: { "Content-Type": type } }));
  const ok = await fetchImage("https://launchonpanda.app/og.png", png(10).impl);
  assert.ok(ok.ok && ok.mime === "image/png" && ok.bytes.length === 10);
  const cases: [string, typeof fetch, RegExp][] = [
    ["http://launchonpanda.app/og.png", png(10).impl, /valid https link/],
    ["https://localhost/og.png", png(10).impl, /valid https link/],
    ["https://launchonpanda.app/og.png", png(10, "text/html").impl, /isn't a PNG/],
    ["https://launchonpanda.app/og.png", png(0).impl, /empty or larger/],
    ["https://launchonpanda.app/og.png", png(5 * 1024 * 1024 + 1).impl, /empty or larger/],
    ["https://launchonpanda.app/og.png", fakeFetch(() => new Response("no", { status: 404 })).impl, /HTTP 404/],
    ["https://launchonpanda.app/og.png", fakeFetch(() => { throw new Error("down"); }).impl, /couldn't be downloaded/],
  ];
  for (const [url, impl, why] of cases) {
    const r = await fetchImage(url, impl);
    assert.ok(!r.ok && why.test(r.reason), `${url} → ${JSON.stringify(r)}`);
  }
});
