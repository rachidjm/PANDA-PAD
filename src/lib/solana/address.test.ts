import { test, afterEach } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { Keypair } from "@solana/web3.js";
import { addressFromInput } from "./address";
import { copyText } from "../clipboard";

const MINT = "3eJExN3JCpXjADDKSqs3uV9N1kR2fBQiUrtP4zBwYX68";

test("a pasted contract address is recognised (spaces, newlines, solana: prefix), anything else is not", () => {
  assert.equal(addressFromInput(MINT), MINT);
  assert.equal(addressFromInput(`  ${MINT}\n`), MINT);
  assert.equal(addressFromInput(`solana:${MINT}`), MINT);
  const pk = Keypair.generate().publicKey.toBase58();
  assert.equal(addressFromInput(pk), pk);
  for (const bad of ["", "PANDA", "$TDOF", "cat", MINT.slice(0, 20), MINT.slice(0, -1), `${MINT}x`, MINT.replace("3", "0"), MINT.replace("e", "l"), "So1111", `${MINT} ${MINT}`, "https://pump.fun/coin/" + MINT]) assert.equal(addressFromInput(bad), null, bad);
});

const realNav = Object.getOwnPropertyDescriptor(globalThis, "navigator");
afterEach(() => {
  if (realNav) Object.defineProperty(globalThis, "navigator", realNav);
  else delete (globalThis as { navigator?: unknown }).navigator;
});
const setNavigator = (v: unknown) => Object.defineProperty(globalThis, "navigator", { value: v, configurable: true });

test("copyText: true only when the clipboard really took it; false (not a crash, not a fake success) when it refuses and there is no fallback", async () => {
  let copied = "";
  setNavigator({ clipboard: { writeText: async (t: string) => void (copied = t) } });
  assert.equal(await copyText(MINT), true);
  assert.equal(copied, MINT);
  setNavigator({ clipboard: { writeText: async () => { throw new Error("denied"); } } });
  assert.equal(await copyText(MINT), false, "denied and no DOM to fall back to (server/test)");
  setNavigator({});
  assert.equal(await copyText(MINT), false);
});

test("wiring: 'Copy CA' on cards (variant=\"inline\", beside the ticker inside the card's own link — as a span, never a real <button>) and on the page; a pasted CA opens the coin; any valid token address gets a page", () => {
  const read = (p: string) => readFileSync(path.join(process.cwd(), p), "utf8");
  const card = read("src/components/CoinCard.tsx");
  assert.match(card, /<CopyCa mint=\{coin\.mint\} variant="inline"/, "the card's copy control must use the span-based inline variant");
  const copyCaSrc = read("src/components/CopyCa.tsx");
  const inlineBlock = copyCaSrc.slice(copyCaSrc.indexOf('variant === "inline"'), copyCaSrc.indexOf('variant === "action"'));
  assert.match(inlineBlock, /role="button"/, "the inline variant must be a span with role=\"button\", not a real <button> — a real button can't nest inside the card's <a>");
  assert.doesNotMatch(inlineBlock, /<button/, "no real <button> inside the inline variant");
  assert.match(read("src/components/coin/CoinClient.tsx"), /<CopyCa mint=\{coin\.mint\}/);
  const search = read("src/components/CoinSearchBox.tsx");
  assert.match(search, /addressFromInput\(query\)/);
  assert.match(search, /router\.push\(`\/coin\/\$\{address\}`\)/);
  const page = read("src/app/coin/[mint]/page.tsx");
  assert.match(page, /addressFromInput\(mint\)/);
  assert.match(page, /<TokenNoMarket/);
  // the copy control gives visible confirmation
  const ca = read("src/components/CopyCa.tsx");
  assert.match(ca, /t\("ca\.copied"\)/);
  assert.match(ca, /setTimeout\(\(\) => setState\("idle"\), 1600\)/);
});
