import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { cardPlacement, demoView, overlaps, TUTORIAL_STEPS, TUTORIAL_TARGETS, type Box } from "./draw-tutorial";

/**
 * The guided tutorial is a DEMO: what it shows comes from the step alone, it never touches the real panel, the wallet or
 * the server, and closing it leaves everything as it was. These tests hold that in place.
 */

const TUTORIAL = readFileSync("src/components/coin/draw/DrawTutorial.tsx", "utf8");
const PANEL = readFileSync("src/components/coin/draw/DrawTradePanel.tsx", "utf8");

test("each step lights one zone: the Venta / Stop tabs, the % row, the chart, the sign button", () => {
  assert.deepEqual([...TUTORIAL_TARGETS], ["tabs", "pct", "chart", "sign"]);
  assert.equal(TUTORIAL_TARGETS.length, TUTORIAL_STEPS.length);
  for (const mark of ["tabs", "pct", "sign"]) assert.ok(TUTORIAL.includes(`data-tutorial="${mark}"`), mark);
  assert.ok(readFileSync("src/components/coin/PriceChart.tsx", "utf8").includes('data-tutorial="chart"'));
});

test("the demo is derived from the step and its gesture only: Venta, then 25%, then the example line, then the pulsing button", () => {
  assert.deepEqual(demoView(0, false), { sell: false, pct25: false, line: false, pulse: false }, "before anything: nothing is marked");
  assert.deepEqual(demoView(0, true), { sell: true, pct25: false, line: false, pulse: false });
  assert.deepEqual(demoView(1, false), { sell: true, pct25: false, line: false, pulse: false }, "earlier steps stay done");
  assert.deepEqual(demoView(1, true), { sell: true, pct25: true, line: false, pulse: false });
  assert.deepEqual(demoView(2, false), { sell: true, pct25: true, line: false, pulse: false });
  assert.deepEqual(demoView(2, true), { sell: true, pct25: true, line: true, pulse: false });
  assert.deepEqual(demoView(3, false), { sell: true, pct25: true, line: true, pulse: true }, "the last step only makes the button pulse — it is never pressed");
  assert.deepEqual(demoView(3, true), demoView(3, false));
  // The same input always gives the same picture: there is no hidden state to restore.
  assert.deepEqual(demoView(2, true), demoView(2, true));
});

test("the demo never creates an order, opens the wallet or calls the server", () => {
  for (const forbidden of ["fetch(", "useWallet", "useDrawTrade", "useConnection", "/api/", "sendTransaction", "signTransaction", "confirmPanda", "setSelectedPct", "startTarget", "localStorage", "DrawApi"]) {
    assert.ok(!TUTORIAL.includes(forbidden), `the tutorial must not use ${forbidden}`);
  }
  assert.ok(!/draw\.[A-Za-z]+\(|draw\}/.test(TUTORIAL), "it has no access to the trading state (only translation keys start with draw.)");
  // It receives nothing of the real panel: only "close" and the explicit "try it yourself".
  assert.match(PANEL, /<DrawTutorial onClose=\{closeTutorial\} onTry=\{tryIt\} \/>/);
  assert.match(TUTORIAL, /export default function DrawTutorial\(\{ onClose, onTry \}: \{ onClose: \(\) => void; onTry: \(\) => void \}\)/);
  // The demo's controls are inert pictures, not buttons.
  const demo = TUTORIAL.slice(TUTORIAL.indexOf("function TutorialDemoPanel"), TUTORIAL.indexOf("function Hand"));
  assert.ok(demo.includes("inert") && !demo.includes("<button") && !demo.includes("onClick"));
});

test("closing restores the panel exactly: the real controls are only hidden while the tutorial is open, and closing changes nothing but 'seen'", () => {
  assert.ok(PANEL.includes('<div className={tutorial ? "hidden" : "contents"}>'), "the real controls stay mounted");
  assert.ok(PANEL.includes("{tutorial && <div id={TUTORIAL_SLOT_ID} />}"), "the demo has its own place and leaves with the tutorial");
  const close = PANEL.slice(PANEL.indexOf("const closeTutorial = useCallback"), PANEL.indexOf("const startTarget = draw.startTarget"));
  assert.ok(close.includes("setTutorial(false)") && close.includes("TUTORIAL_SEEN_KEY") && !close.includes("draw."), "closing touches no trading state");
  // "Pruébalo tú" is the one deliberate exception: it selects Venta — only when selling is possible — and nothing else.
  const tryIt = PANEL.slice(PANEL.indexOf("const tryIt = useCallback"), PANEL.indexOf("const view = current"));
  assert.match(tryIt, /closeTutorial\(\);\s+if \(canSell && !busy\) startTarget\("sell1"\);/);
  assert.ok(!/confirm|setSelectedPct|signIn|fetch/.test(tryIt));
});

test("on a desktop the card sits beside the lit zone — never on top of it, always inside the window", () => {
  const win = { width: 1280, height: 800 };
  const card = { width: 540, height: 96 };
  const zones: Box[] = [
    { top: 500, left: 60, width: 220, height: 40 }, // the tabs
    { top: 560, left: 60, width: 600, height: 44 }, // the % row
    { top: 120, left: 60, width: 620, height: 300 }, // the chart
    { top: 700, left: 60, width: 600, height: 48 }, // the sign button, near the bottom
    { top: 300, left: 900, width: 360, height: 60 }, // something at the right edge
    { top: 10, left: 10, width: 1260, height: 300 }, // a zone as wide as the window
    { top: 380, left: 10, width: 1260, height: 400 }, // …and one at the bottom
  ];
  for (const zone of zones) {
    const at = cardPlacement(zone, card, win);
    const box = { ...at, ...card };
    assert.ok(!overlaps(box, zone), `covers the zone: ${JSON.stringify({ zone, at })}`);
    assert.ok(at.left >= 0 && at.top >= 0 && at.left + card.width <= win.width && at.top + card.height <= win.height, `outside the window: ${JSON.stringify({ zone, at })}`);
  }
  assert.deepEqual(cardPlacement(zones[0], card, win), { top: 472, left: 294 }, "to the right when there is room");
  assert.equal(cardPlacement(zones[4], card, win).left, 900 - 14 - 540, "to the left at the right edge");
  // A zone as big as the window leaves no free side: the card goes to the bottom corner.
  assert.deepEqual(cardPlacement({ top: 0, left: 0, width: 1280, height: 800 }, card, win), { top: 800 - 96 - 14, left: 1280 - 540 - 14 });
});

test("motion is optional: with 'reduce motion' there is no hand and no loop, and the pulse becomes a still outline", () => {
  assert.ok(TUTORIAL.includes('useMedia("(prefers-reduced-motion: reduce)")'));
  assert.match(TUTORIAL, /const tapped = still \|\| beat === 2;/);
  assert.match(TUTORIAL, /const hand = !still && step < 3 && point/);
  const css = readFileSync("src/app/globals.css", "utf8");
  assert.match(css, /@media \(prefers-reduced-motion: reduce\) \{\s+\.tutorial-pulse \{ animation: none;/);
});
