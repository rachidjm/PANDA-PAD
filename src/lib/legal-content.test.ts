import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { getLegalPage, LEGAL_LAST_UPDATED, LEGAL_PAGES, LEGAL_SLUGS, type LegalOptions, type LegalSlug } from "./legal-content";
import { dict } from "@/lib/i18n/translations";
import { PANDA_FEE_BPS } from "@/lib/pump/constants";
import { PANDA_SHARE_BPS } from "@/lib/config/protocol";
import { MARKET_CONFIG } from "@/lib/market/config";
import { STRATEGY_FEE_BPS } from "@/lib/strategy/plan";
import { SESSION_COOKIE } from "@/lib/auth/session";
import { SESSION_TTL_MS } from "@/lib/auth/wallet-auth";

/**
 * The legal texts must say exactly what the code does with the CURRENT flags: right fees, custody only where true, nothing about a feature
 * that is switched off, the cookies and storage that really exist, and no claim PANDA can't back.
 */

const LANGS = ["en", "es"] as const;
const OFF: LegalOptions = { custody: false };
const ALL_ON: LegalOptions = { custody: true, holders: true, otc: true, nft: true, market: true, points: true, airdrops: true, pandaToken: true };
const text = (slug: LegalSlug, lang: "en" | "es", opts: LegalOptions) => getLegalPage(slug, opts).body[lang].join("\n");
const everything = (opts: LegalOptions, lang: "en" | "es") => LEGAL_SLUGS.map((s) => text(s, lang, opts)).join("\n\n");

const fmt = (bps: number, lang: "en" | "es") => `${lang === "es" ? String(bps / 100).replace(".", ",") : String(bps / 100)}%`;

test("every fee in the texts is the one the code charges: 0.5% trade, 5% of creator fees (95% to the creator), 1% strategies, 2% NFT market", () => {
  assert.equal(PANDA_FEE_BPS, 50);
  assert.equal(PANDA_SHARE_BPS, 500);
  for (const lang of LANGS) {
    const terms = text("terms-of-service", lang, OFF);
    assert.ok(terms.includes(fmt(PANDA_FEE_BPS, lang)), `${lang}: trading fee ${fmt(PANDA_FEE_BPS, lang)}`);
    assert.ok(terms.includes(fmt(PANDA_SHARE_BPS, lang)), `${lang}: share of creator fees`);
    assert.ok(terms.includes(fmt(10_000 - PANDA_SHARE_BPS, lang)), `${lang}: what remains for the creator`);
    assert.ok(text("risk-disclosure", lang, OFF).includes(fmt(PANDA_FEE_BPS, lang)));
    assert.ok(text("terms-of-service", lang, { custody: true }).includes(fmt(STRATEGY_FEE_BPS, lang)), `${lang}: strategies`);
    assert.ok(text("terms-of-service", lang, { custody: false, nft: true, market: true }).includes(fmt(MARKET_CONFIG.feeBps, lang)), `${lang}: NFT market`);
  }
  assert.equal(STRATEGY_FEE_BPS, 100);
  assert.equal(MARKET_CONFIG.feeBps, 200);
  // The Buy $PANDA widget charges the same PANDA_FEE_BPS as a trade (src/components/BuyPandaWidget.tsx) — the text says "the same".
  const widget = readFileSync(path.join(process.cwd(), "src", "components", "BuyPandaWidget.tsx"), "utf8");
  assert.match(widget, /PANDA_FEE_BPS/);
  assert.doesNotMatch(widget, /STRATEGY_FEE_BPS/);
});

test("with every optional flag OFF no text presents a switched-off feature: no vault, rewards, airdrops, points, NFTs, OTC", () => {
  const FEATURE_WORDS = /Privy|Trigger|Stop Loss|Take Profit|Draw Your Trade|bóveda|Rewards Pool|"Holders"|reward|recompensa|airdrop|PANDA Points|puntos|\bpoints\b|\bNFT|OTC|Meteora|Merkle|marketplace|mercado de NFT|holder/i;
  for (const lang of LANGS) {
    for (const slug of LEGAL_SLUGS) {
      for (const para of getLegalPage(slug, OFF).body[lang]) assert.doesNotMatch(para, FEATURE_WORDS, `${slug}/${lang}: ${para.slice(0, 80)}`);
    }
  }
});

test("each optional feature's sections appear only with its flag, in both languages", () => {
  const cases: { flag: keyof LegalOptions; opts: LegalOptions; word: RegExp; slug: LegalSlug }[] = [
    { flag: "custody", opts: { custody: true }, word: /Privy/, slug: "terms-of-service" },
    { flag: "holders", opts: { custody: false, holders: true }, word: /Rewards Pool/, slug: "terms-of-service" },
    { flag: "otc", opts: { custody: false, otc: true }, word: /Meteora/, slug: "terms-of-service" },
    { flag: "nft", opts: { custody: false, nft: true }, word: /NFT/, slug: "terms-of-service" },
    { flag: "market", opts: { custody: false, nft: true, market: true }, word: /2%|2 %/, slug: "terms-of-service" },
    { flag: "points", opts: { custody: false, points: true }, word: /Points/, slug: "terms-of-service" },
    { flag: "airdrops", opts: { custody: false, airdrops: true }, word: /Merkle/, slug: "terms-of-service" },
  ];
  for (const c of cases) {
    for (const lang of LANGS) {
      assert.match(text(c.slug, lang, c.opts), c.word, `${c.flag}/${lang}: missing when on`);
      assert.doesNotMatch(text(c.slug, lang, OFF), c.word, `${c.flag}/${lang}: present when off`);
    }
  }
  // The market fee needs the market flag, not just the themes.
  assert.doesNotMatch(text("terms-of-service", "en", { custody: false, nft: true }), /marketplace fee/i);
});

test("'non-custodial' is only claimed for buying, selling, launching; when a custodial feature is on the exception is declared on the pages that matter", () => {
  for (const lang of LANGS) {
    for (const slug of LEGAL_SLUGS) {
      for (const para of getLegalPage(slug, OFF).body[lang]) {
        if (/non-custodial|no custodial|no custodian|sin custodia/i.test(para)) assert.match(para, /trad|buy|sell|compr|vend|oper|launch|lanz|creat|crear/i, `${slug}/${lang}: unscoped custody claim`);
      }
    }
    for (const opts of [{ custody: true }, { custody: false, holders: true }] as LegalOptions[]) {
      for (const slug of ["legal-notice", "terms-of-service", "risk-disclosure", "disclaimer"] as const) {
        assert.match(text(slug, lang, opts), /custod|Privy|Rewards Pool/i, `${slug}/${lang}: custody exception missing`);
      }
    }
  }
  // The footer: "non-custodial" flat only when no custodial feature is on.
  assert.match(dict["footer.disclaimer"].en, /non-custodial/);
  assert.match(dict["footer.disclaimerCustody"].en, /exception/i);
  assert.match(dict["footer.disclaimerCustody"].es, /excepción/i);
  assert.doesNotMatch(dict["footer.disclaimerCustody"].en, /is a non-custodial interface/);
});

test("no claim PANDA can't back: not audited, secure, regulated, licensed, MiCA-compliant, risk-free; 'guarantee' only in negations", () => {
  const FORBIDDEN = /(?<![\p{L}])(audited|auditad[oa]s?|regulated by|regulad[oa] por|licensed|licenciad[oa]|insured|asegurad[oa]|risk[- ]free|sin riesgo|100% (safe|secure|seguro)|totally safe|fully secure|completamente seguro)(?![\p{L}])/iu;
  const MICA = /\bMiCA\b/; // case-sensitive on purpose: "atómica" is not MiCA
  const NEGATION = /\b(not|no|never|nor|cannot|can't|nothing|nobody|nunca|tampoco|nada|nadie|sin|ni|puede garantizar)\b|n't/i;
  const strings: { where: string; s: string }[] = [];
  for (const lang of LANGS) for (const slug of LEGAL_SLUGS) for (const p of getLegalPage(slug, ALL_ON).body[lang]) strings.push({ where: `${slug}/${lang}`, s: p });
  for (const [k, v] of Object.entries(dict)) for (const lang of LANGS) strings.push({ where: `dict ${k}/${lang}`, s: (v as Record<string, string>)[lang] });
  for (const { where, s } of strings) {
    assert.doesNotMatch(s, FORBIDDEN, where);
    assert.doesNotMatch(s, MICA, where);
    if (/guarantee|garantiz|garantía|garantiza/i.test(s)) assert.match(s, NEGATION, `${where}: a guarantee that isn't negated: ${s.slice(0, 90)}`);
  }
});

test("the cookie policy matches what the site really sets: one cookie (name, 2 h, flags), and every localStorage key that exists in the code", () => {
  const src = path.join(process.cwd(), "src");
  const files: string[] = [];
  const walk = (dir: string) => {
    for (const n of readdirSync(dir)) {
      const p = path.join(dir, n);
      if (statSync(p).isDirectory()) walk(p);
      else if (/\.(ts|tsx)$/.test(n) && !/\.test\./.test(n)) files.push(p);
    }
  };
  walk(src);
  const cookieSetters = files.filter((f) => /cookies\.set\(|document\.cookie|Set-Cookie/.test(readFileSync(f, "utf8"))).map((f) => path.relative(process.cwd(), f).replace(/\\/g, "/"));
  assert.deepEqual(cookieSetters.filter((f) => !f.endsWith("legal-content.test.ts") && !f.endsWith("admin-lockdown.test.ts")), ["src/lib/auth/session.ts"], "a new place sets cookies: the Cookie Policy must describe it");

  const hours = SESSION_TTL_MS / 3_600_000;
  for (const lang of LANGS) {
    const cookie = text("cookie-policy", lang, ALL_ON);
    assert.ok(cookie.includes(SESSION_COOKIE), `${lang}: cookie name`);
    assert.match(cookie, new RegExp(`\\b${hours} (hours|horas)\\b`), `${lang}: duration`);
    for (const flag of ["HttpOnly", "Secure", "SameSite=Strict"]) assert.ok(cookie.includes(flag), `${lang}: ${flag}`);
  }
  const sessionSource = readFileSync(path.join(src, "lib", "auth", "session.ts"), "utf8");
  assert.match(sessionSource, /httpOnly: true/);
  assert.match(sessionSource, /sameSite: "strict"/);
  assert.match(sessionSource, /secure: process\.env\.NODE_ENV === "production"/);

  const keys = new Set<string>();
  for (const f of files) {
    const body = readFileSync(f, "utf8");
    if (f.endsWith("legal-content.ts") || !/localStorage|sessionStorage/.test(body)) continue; // (the texts themselves mention them)
    assert.doesNotMatch(body, /sessionStorage\./, `${f}: the policy says sessionStorage isn't used`);
    for (const m of body.matchAll(/["'`](panda[.-][A-Za-z0-9.\-]*[A-Za-z0-9])/g)) keys.add(m[1]);
  }
  assert.ok(keys.has("panda-lang") && keys.has("panda.buy.unit"), `found ${[...keys].join(", ")}`);
  for (const lang of LANGS) {
    const withDraw = text("cookie-policy", lang, { custody: true });
    for (const key of keys) assert.ok(withDraw.includes(key), `${lang}: localStorage key ${key} isn't in the cookie policy`);
    // The draw-drafts key belongs only to a feature that is off by default.
    assert.doesNotMatch(text("cookie-policy", lang, OFF), /panda\.draw/);
    assert.ok(text("cookie-policy", lang, OFF).includes("walletName"), "the wallet library's key");
  }
});

test("dates: the update date is valid, not in the future, and shown on every page; ES and EN have the same structure", () => {
  assert.match(LEGAL_LAST_UPDATED, /^\d{4}-\d{2}-\d{2}$/);
  const d = new Date(`${LEGAL_LAST_UPDATED}T00:00:00Z`);
  assert.ok(!Number.isNaN(d.getTime()) && d.getTime() <= Date.now(), "update date is in the future or invalid");
  for (const slug of LEGAL_SLUGS) {
    assert.equal(LEGAL_PAGES[slug].updated, LEGAL_LAST_UPDATED);
    for (const opts of [OFF, ALL_ON]) {
      const page = getLegalPage(slug, opts);
      assert.equal(page.body.en.length, page.body.es.length, `${slug}: ES/EN paragraph counts differ`);
    }
  }
  const layout = readFileSync(path.join(process.cwd(), "src", "components", "legal", "LegalPageLayout.tsx"), "utf8");
  assert.match(layout, /page\.updated/);
});

test("NO personal or identity data of the owner, and no text that points to information that doesn't exist (contact, owner details)", () => {
  const OWNER_DATA = /\[COMPLETAR|\b(e-?mail|correo|contact[ao]?|contacta|domicilio|NIF|CIF|razón social|registered address|company name|tax id|write to|escribe a|titular)\b/i;
  const uiStrings = Object.entries(dict).flatMap(([k, v]) => LANGS.map((l) => ({ where: `dict ${k}/${l}`, s: (v as Record<string, string>)[l] })));
  const pages = LANGS.flatMap((lang) => LEGAL_SLUGS.flatMap((slug) => getLegalPage(slug, ALL_ON).body[lang].map((s) => ({ where: `${slug}/${lang}`, s }))));
  for (const { where, s } of [...pages, ...uiStrings]) assert.doesNotMatch(s, OWNER_DATA, `${where}: ${s.slice(0, 90)}`);
  for (const lang of LANGS) assert.doesNotMatch(everything(ALL_ON, lang), /to be added|\[pendiente\]|pendiente de añadir|\[to be/i);
  // nothing outside the texts publishes it either
  const meta = readFileSync(path.join(process.cwd(), "src", "app", "layout.tsx"), "utf8");
  assert.doesNotMatch(meta, /mailto:|@[a-z0-9-]+\.(com|es|org|net)\b/i);
});

test("the operator's decisions are in the texts: 18+, no US or sanctioned countries, Spanish law, 5 years of records, regions", () => {
  for (const lang of LANGS) {
    const terms = text("terms-of-service", lang, OFF);
    assert.match(terms, /18 (years|años)/);
    assert.match(terms, /United States|Estados Unidos/);
    assert.match(terms, /OFAC/);
    assert.match(terms, /European Union|Unión Europea/);
    assert.match(terms, /United Nations|Naciones Unidas/);
    assert.match(terms, /Spanish law|ley española/);
    const privacy = text("privacy-policy", lang, OFF);
    assert.match(privacy, /5 (years|años)/);
    assert.match(privacy, /US East/);
    assert.match(privacy, /Paris|París/, "the Blob store is in cdg1 (Paris)");
    assert.match(privacy, /Neon/);
    assert.match(privacy, /Upstash/);
  }
});

test("the NFT 'coming soon' teaser is gone from the home page (nothing is promised that isn't switched on)", () => {
  assert.ok(!("nft.soon.title" in dict) && !("nft.soon.kicker" in dict));
  const home = readFileSync(path.join(process.cwd(), "src", "app", "page.tsx"), "utf8");
  assert.doesNotMatch(home, /NftComingSoon/);
  assert.equal(existsSync(path.join(process.cwd(), "src", "components", "home", "NftComingSoon.tsx")), false);
});

test("$PANDA: described as not launched until its mint is configured, then as a market-priced token with no promises", () => {
  for (const lang of LANGS) {
    assert.match(text("disclaimer", lang, OFF), /no se ha lanzado|has not been launched/);
    assert.doesNotMatch(text("disclaimer", lang, { custody: false, pandaToken: true }), /no se ha lanzado|has not been launched/);
    assert.match(text("disclaimer", lang, { custody: false, pandaToken: true }), /mercado|market/);
  }
});

test("the Rewards page and its links exist only while holder rewards are on", () => {
  const read = (p: string) => readFileSync(path.join(process.cwd(), p), "utf8");
  assert.match(read("src/app/rewards/layout.tsx"), /isEnabled\("HOLDER_REWARDS"\)/);
  for (const f of ["src/components/Navbar.tsx", "src/components/MobileTabBar.tsx", "src/components/Footer.tsx", "src/components/portfolio/WalletPanel.tsx"]) assert.match(read(f), /holderRewards/, `${f} shows /rewards regardless of the flag`);
  assert.match(read("src/components/portfolio/PortfolioView.tsx"), /holderRewards/);
  assert.match(read("src/components/analytics/EconomyView.tsx"), /holderRewards/);
  assert.match(read("src/components/coin/CoinClient.tsx"), /holderRewards/);
});

test("ES and EN dictionary strings state the same numbers, percentages and units (no language says something the other doesn't)", () => {
  const nums = (s: string) => [...s.replace(/(\d),(\d)/g, "$1.$2").matchAll(/\d+(?:\.\d+)?\s?%?/g)].map((m) => m[0].replace(/\s/g, "")).sort();
  const bad: string[] = [];
  for (const [k, v] of Object.entries(dict)) {
    const e = nums((v as { en: string }).en), s = nums((v as { es: string }).es);
    if (JSON.stringify(e) !== JSON.stringify(s)) bad.push(`${k}: en ${e.join(",")} / es ${s.join(",")}`);
  }
  for (const slug of LEGAL_SLUGS) {
    const page = getLegalPage(slug, ALL_ON);
    page.body.en.forEach((p, i) => {
      const e = nums(p), s = nums(page.body.es[i]);
      if (JSON.stringify(e) !== JSON.stringify(s)) bad.push(`${slug}[${i}]: en ${e.join(",")} / es ${s.join(",")}`);
    });
  }
  assert.deepEqual(bad, []);
});
