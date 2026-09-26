import { test, before, afterEach } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync, existsSync } from "node:fs";
import path from "node:path";
import { NextRequest, NextResponse } from "next/server";
import { Keypair } from "@solana/web3.js";
import { createSessionToken, SESSION_TTL_MS } from "./wallet-auth";
import { SESSION_COOKIE } from "./session";
import { hiddenResponse, isAdminRequest, requireAdmin } from "./admin";
import { ADMIN_ONLY_PREFIXES, adminGatePasses, isAdminOnlyPath } from "./admin-gate";
import { ADMIN_FRESH_MS } from "./admin-policy";
import { proxy } from "@/proxy";
import { POST as adminEligible } from "@/app/api/auth/admin-eligible/route";
import { GET as cleanupAuth } from "@/app/api/cron/cleanup-auth/route";
import { GET as collectFees } from "@/app/api/cron/collect-fees/route";
import { GET as healthTrading } from "@/app/api/health/trading/route";

const SECRET = "s".repeat(48);
const ADMIN = Keypair.generate().publicKey.toBase58();
const OTHER = Keypair.generate().publicKey.toBase58();
const cookieFor = (wallet: string, now = Date.now()) => `${SESSION_COOKIE}=${createSessionToken(wallet, SECRET, now, SESSION_TTL_MS)}`;
const req = (url: string, init?: RequestInit & { cookie?: string }) =>
  new Request(`https://panda.test${url}`, { ...init, headers: { ...(init?.cookie ? { cookie: init.cookie } : {}), ...(init?.headers as Record<string, string>) } });

before(() => {
  process.env.AUTH_SESSION_SECRET = SECRET;
  process.env.ADMIN_WALLETS = ADMIN;
  delete process.env.PANDA_STORAGE_MODES;
  delete process.env.CRON_SECRET;
});
afterEach(() => {
  process.env.ADMIN_WALLETS = ADMIN;
});

const isBare404 = async (res: Response) => res.status === 404 && (await res.text()) === "";

// ── the three visitors: no wallet, a wallet that isn't an admin, an admin ───────────────────────────────────────────────────────────────

test("requireAdmin: no session → bare 404 (not 401, nothing that says the route exists)", async () => {
  const res = await requireAdmin(req("/api/admin/pause"));
  assert.ok(res instanceof NextResponse);
  assert.equal(await isBare404(res), true);
});

test("requireAdmin: a valid session of a wallet that is NOT an admin → the same bare 404 (not 403)", async () => {
  const res = await requireAdmin(req("/api/admin/pause", { cookie: cookieFor(OTHER) }));
  assert.ok(res instanceof NextResponse);
  assert.equal(await isBare404(res), true);
});

test("requireAdmin: a forged or expired token counts as no session", async () => {
  const forged = `${SESSION_COOKIE}=${createSessionToken(ADMIN, "x".repeat(48), Date.now(), SESSION_TTL_MS)}`;
  assert.equal(await isBare404((await requireAdmin(req("/api/admin/pause", { cookie: forged }))) as Response), true);
  const expired = cookieFor(ADMIN, Date.now() - SESSION_TTL_MS - 1000);
  assert.equal(await isBare404((await requireAdmin(req("/api/admin/pause", { cookie: expired }))) as Response), true);
});

test("requireAdmin: a fresh session of an admin wallet is let through", async () => {
  const res = await requireAdmin(req("/api/admin/pause", { cookie: cookieFor(ADMIN) }));
  assert.deepEqual(res, { wallet: ADMIN });
});

test("requireAdmin: an admin wallet whose sign-in is too old is asked to sign in again (401) — only an admin ever hears that", async () => {
  const res = await requireAdmin(req("/api/admin/pause", { cookie: cookieFor(ADMIN, Date.now() - ADMIN_FRESH_MS - 60_000) }));
  assert.ok(res instanceof NextResponse);
  assert.equal(res.status, 401);
  assert.equal((await res.json()).code, "REAUTH_REQUIRED");
});

test("with ADMIN_WALLETS empty nobody is an admin", async () => {
  process.env.ADMIN_WALLETS = "";
  assert.equal(await isBare404((await requireAdmin(req("/api/admin/pause", { cookie: cookieFor(ADMIN) }))) as Response), true);
});

// ── the /admin page decision ───────────────────────────────────────────────────────────────────────────────────────────────────────────

test("/admin page: rendered only for a live admin session (a stale one may open it to sign in again); everyone else gets the 404", async () => {
  assert.equal(await isAdminRequest(null), false, "no wallet");
  assert.equal(await isAdminRequest(cookieFor(OTHER)), false, "a wallet that isn't an admin");
  assert.equal(await isAdminRequest(cookieFor(ADMIN)), true, "an admin");
  assert.equal(await isAdminRequest(cookieFor(ADMIN, Date.now() - ADMIN_FRESH_MS - 60_000)), true, "an admin whose sign-in is stale can reach the button to sign in again");
  assert.equal(await isAdminRequest("panda_session=garbage"), false);
});

// ── every admin route, every method ────────────────────────────────────────────────────────────────────────────────────────────────────

function routeFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((n) => {
    const p = path.join(dir, n);
    return statSync(p).isDirectory() ? routeFiles(p) : n === "route.ts" ? [p] : [];
  });
}

test("EVERY /api/admin/* route answers a bare 404 to no session and to a non-admin session, on every method it exports", async () => {
  const root = path.join(process.cwd(), "src", "app", "api", "admin");
  const files = routeFiles(root);
  assert.ok(files.length >= 13, `found ${files.length} admin routes`);
  let handlers = 0;
  for (const file of files) {
    const rel = path.relative(path.join(process.cwd(), "src", "app"), file).replace(/\\/g, "/").replace(/\/route\.ts$/, "");
    const mod = (await import(`@/app/${rel}/route`)) as Record<string, unknown>;
    for (const method of ["GET", "POST", "PUT", "PATCH", "DELETE"]) {
      const handler = mod[method];
      if (typeof handler !== "function") continue;
      for (const cookie of [undefined, cookieFor(OTHER)]) {
        const res = (await handler(req(`/api/${rel.replace(/^api\//, "")}`, { method, cookie, headers: { "content-type": "application/json" }, ...(method === "GET" ? {} : { body: "{}" }) }))) as Response;
        assert.equal(await isBare404(res), true, `${method} /${rel} ${cookie ? "as a non-admin" : "without a session"} → ${res.status}`);
        handlers++;
      }
    }
  }
  assert.ok(handlers >= 20, `checked ${handlers} handler/visitor combinations`);
});

test("/api/health/trading (env presence, treasury, database, Upstash) is admin-only: bare 404 to everyone else", async () => {
  assert.equal(await isBare404(await healthTrading(req("/api/health/trading"))), true);
  assert.equal(await isBare404(await healthTrading(req("/api/health/trading", { cookie: cookieFor(OTHER) }))), true);
});

test("cron routes: a missing or wrong secret is a bare 404 (and the secret is checked before anything else runs)", async () => {
  assert.equal(await isBare404(await cleanupAuth(req("/api/cron/cleanup-auth"))), true, "CRON_SECRET not set");
  assert.equal(await isBare404(await collectFees(req("/api/cron/collect-fees"))), true, "CRON_SECRET not set");
  process.env.CRON_SECRET = "c".repeat(32);
  try {
    assert.equal(await isBare404(await cleanupAuth(req("/api/cron/cleanup-auth", { headers: { authorization: "Bearer nope" } }))), true);
    assert.equal(await isBare404(await collectFees(req("/api/cron/collect-fees", { headers: { authorization: "Bearer nope" } }))), true);
  } finally {
    delete process.env.CRON_SECRET;
  }
});

// ── the wallet-menu flow ─────────────────────────────────────────────────────────────────────────────────────────────────────────────

const eligible = (wallet: unknown, ip: string) =>
  adminEligible(req("/api/auth/admin-eligible", { method: "POST", headers: { "content-type": "application/json", "x-forwarded-for": ip }, body: JSON.stringify({ wallet }) }));

test("admin-eligible: an admin wallet is told so; any other wallet, garbage and nothing get a bare 404", async () => {
  const yes = await eligible(ADMIN, "10.1.0.1");
  assert.equal(yes.status, 200);
  assert.deepEqual(await yes.json(), { eligible: true });
  assert.equal(await isBare404(await eligible(OTHER, "10.1.0.2")), true);
  assert.equal(await isBare404(await eligible("not-a-wallet", "10.1.0.3")), true);
  assert.equal(await isBare404(await eligible(undefined, "10.1.0.4")), true);
});

test("admin-eligible can't be used to test a list of addresses: it is rate limited per IP", async () => {
  const statuses: number[] = [];
  for (let i = 0; i < 14; i++) statuses.push((await eligible(Keypair.generate().publicKey.toBase58(), "10.1.9.9")).status);
  assert.ok(statuses.includes(429), statuses.join(","));
});

// ── the first gate (proxy) ──────────────────────────────────────────────────────────────────────────────────────────────────────────

const proxied = (url: string, cookie?: string, method = "GET") => proxy(new NextRequest(`https://panda.test${url}`, { method, headers: cookie ? { cookie } : {} }));
const rewritten = (res: Response) => res.headers.get("x-middleware-rewrite");

test("proxy: admin-only paths are rewritten to a path that doesn't exist for no session / a non-admin / a forged token — every method, every sub-path", () => {
  for (const url of ["/admin", "/admin/anything", "/api/admin/pause", "/api/admin/audit/anchor", "/api/admin", "/api/health/trading"]) {
    for (const method of ["GET", "POST", "DELETE"]) {
      for (const cookie of [undefined, cookieFor(OTHER), `${SESSION_COOKIE}=forged`]) {
        assert.ok(rewritten(proxied(url, cookie, method))?.includes("/_hidden-404"), `${method} ${url}`);
      }
    }
  }
});

test("proxy: a session cookie of an admin passes through; ordinary pages and APIs are not touched", () => {
  for (const url of ["/admin", "/api/admin/pause", "/api/health/trading"]) assert.equal(rewritten(proxied(url, cookieFor(ADMIN))), null, url);
  for (const url of ["/", "/discover", "/legal/privacy", "/api/coins", "/api/protocol/status", "/administrator"]) assert.equal(rewritten(proxied(url)), null, url);
});

test("the gate's pure pieces: cookie name matches the session module's; unset/short secrets and empty admin lists never pass", () => {
  const token = createSessionToken(ADMIN, SECRET, Date.now(), SESSION_TTL_MS);
  assert.equal(SESSION_COOKIE, "panda_session", "src/proxy.ts hard-codes this name (it can't import the session module)");
  assert.equal(adminGatePasses(token, { secret: SECRET, admins: ADMIN }, Date.now()), true);
  assert.equal(adminGatePasses(token, { secret: undefined, admins: ADMIN }, Date.now()), false);
  assert.equal(adminGatePasses(token, { secret: "short", admins: ADMIN }, Date.now()), false);
  assert.equal(adminGatePasses(token, { secret: SECRET, admins: "" }, Date.now()), false);
  assert.equal(adminGatePasses(token, { secret: SECRET, admins: OTHER }, Date.now()), false);
  assert.equal(adminGatePasses(undefined, { secret: SECRET, admins: ADMIN }, Date.now()), false);
  assert.equal(isAdminOnlyPath("/administrator"), false, "a prefix match must be on a path segment");
  assert.deepEqual([...ADMIN_ONLY_PREFIXES], ["/admin", "/api/admin", "/api/health"]);
  assert.equal(hiddenResponse().status, 404);
});

// ── nothing links to it ────────────────────────────────────────────────────────────────────────────────────────────────────────────────

test("nothing public links to /admin, and there is no sitemap or robots entry that names it", () => {
  const src = path.join(process.cwd(), "src");
  for (const f of ["robots.ts", "robots.txt", "sitemap.ts", "sitemap.xml"]) {
    for (const dir of [path.join(src, "app"), path.join(process.cwd(), "public")]) {
      const p = path.join(dir, f);
      if (existsSync(p)) assert.ok(!/admin/i.test(readFileSync(p, "utf8")), `${p} names the admin console`);
    }
  }
  const allowed = [
    path.join("src", "app", "admin"),
    path.join("src", "components", "admin"),
    path.join("src", "app", "api", "admin"),
    path.join("src", "components", "portfolio", "WalletPanel.tsx"), // the "Sign in as admin" button, shown only to a listed admin wallet
    path.join("src", "proxy.ts"),
    path.join("src", "lib", "auth"),
    path.join("src", "lib", "config"),
    path.join("src", "lib", "i18n"),
  ];
  const offenders: string[] = [];
  const walk = (dir: string) => {
    for (const n of readdirSync(dir)) {
      const p = path.join(dir, n);
      if (statSync(p).isDirectory()) walk(p);
      else if (/\.(tsx?|mdx?)$/.test(n) && !/\.test\./.test(n)) {
        const rel = path.relative(process.cwd(), p);
        if (allowed.some((a) => rel.startsWith(a))) continue;
        if (/["'`(]\/admin(["'`/?#)]|\b)/.test(readFileSync(p, "utf8"))) offenders.push(rel);
      }
    }
  };
  walk(src);
  assert.deepEqual(offenders, [], "these files mention the /admin path");
});
