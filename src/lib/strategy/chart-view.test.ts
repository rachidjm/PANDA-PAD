import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { validateKind } from "./kinds";
import { validateStrategy } from "./plan";
import { pricesAgree, quoteWasOverruled, referencePrice } from "./reference";
import { CHART, clampDomain, clampedY, fitDomain, priceToY, rowToAnchor, sameDomain, wheelFactor, yToPrice, zoomDomain, zoomLimits, type Domain } from "./scale";

/**
 * The chart's price axis (the normal view, and a zoom that is simple and can't go wrong) and the price every drawn line
 * is compared with (the coin's real current price, whatever one source says).
 */

// ── the reference price ─────────────────────────────────────────────────────────────────────────────────────────────
test("the reported case: a buy 9.5% under the price reads -9.5%, not billions of percent — whatever one source says", () => {
  const current = 0.0000485; // a coin graduated to PumpSwap
  const buy = 0.0000439;
  // A feed that answers with a figure from somewhere else (another pool, another unit) makes the same line read as
  // +1,818,897,637,695% — the number on the user's screen.
  const badFeed = buy / 18_188_976_377.953;
  assert.equal(Math.round((buy / badFeed - 1) * 100 * 10) / 10, 1_818_897_637_695.3);

  // The page's own price and the chart agree with each other and not with it: it is set aside.
  const ref = referencePrice({ quote: badFeed, live: current, chart: 0.0000483 });
  assert.equal(ref, current);
  assert.equal(quoteWasOverruled({ quote: badFeed, live: current, chart: 0.0000483 }), true);
  assert.equal(Math.round((buy / ref! - 1) * 1000) / 10, -9.5);
  // And nothing calls that line "absurdly far": the order can be signed.
  assert.deepEqual(validateKind("buy", { buy }, { currentUsd: ref, amountUsd: 20, liquidityUsd: 20_000 }), []);
  // With the bad figure it was blocked.
  assert.ok(validateKind("buy", { buy }, { currentUsd: badFeed, amountUsd: 20, liquidityUsd: 20_000 }).includes("too_far"));
});

test("the current price is the one the sources agree on — for a buy, a sell and a stop, on a curve coin and a graduated one", () => {
  // Agreement (they are read seconds apart on coins that move): the feed's own figure is used.
  assert.equal(referencePrice({ quote: 0.0000485, live: 0.0000487, chart: 0.000048 }), 0.0000485);
  assert.equal(referencePrice({ quote: 0.0000485, live: null, chart: 0.00005 }), 0.0000485);
  assert.equal(quoteWasOverruled({ quote: 0.0000485, live: 0.0000487 }), false);
  // One source alone is what there is.
  assert.equal(referencePrice({ quote: 0.00000312 }), 0.00000312);
  assert.equal(referencePrice({ chart: 0.00000312 }), 0.00000312);
  assert.equal(referencePrice({ quote: null, live: undefined, chart: 0 }), null);
  assert.equal(referencePrice({ quote: NaN, live: -1, chart: Infinity }), null);
  // The feed far off in either direction, with the other two together.
  for (const wrong of [2.4e-15, 0.5, 882_165, 0.0000485 * 109]) assert.equal(referencePrice({ quote: wrong, live: 0.0000485, chart: 0.000047 }), 0.0000485, String(wrong));
  // The page's price is the odd one out: the feed and the chart together win.
  assert.equal(referencePrice({ quote: 0.0000485, live: 0.9, chart: 0.000047 }), 0.0000485);
  // Nobody agrees with anybody: what the user is looking at.
  assert.equal(referencePrice({ quote: 1e-15, live: 0.0000485, chart: 0.9 }), 0.0000485);
  assert.equal(referencePrice({ quote: 1e-15, chart: 0.9 }), 0.9);
  assert.equal(pricesAgree(0.0000485, 0.00009), true);
  assert.equal(pricesAgree(0.0000485, 0.0001), false);

  // Very small prices, a coin still on its curve ($0.00000312) and a graduated one ($0.0000485): each kind of line.
  for (const cur of [0.00000312, 0.0000485, 0.000000041]) {
    const ref = referencePrice({ quote: cur / 1e9, live: cur, chart: cur * 1.01 })!;
    assert.equal(ref, cur);
    assert.deepEqual(validateKind("buy", { buy: cur * 0.905 }, { currentUsd: ref, amountUsd: 20, liquidityUsd: 20_000 }), [], `buy at ${cur}`);
    assert.deepEqual(validateKind("sell", { sell: cur * 1.3 }, { currentUsd: ref, tokensUsd: 50, liquidityUsd: 20_000 }), [], `sell at ${cur}`);
    assert.deepEqual(validateKind("stop", { stop: cur * 0.8 }, { currentUsd: ref, tokensUsd: 50, liquidityUsd: 20_000 }), [], `stop at ${cur}`);
    assert.ok(!validateStrategy({ buy: cur * 0.9, sell: cur * 1.5, stop: cur * 0.7, amountUsd: 20, currentUsd: ref, liquidityUsd: 20_000 }).includes("too_far"));
    // A line really is absurdly far when it IS: that check still works against the real price.
    assert.ok(validateKind("sell", { sell: cur * 1e6 }, { currentUsd: ref, tokensUsd: 50, liquidityUsd: 20_000 }).includes("too_far"));
  }
});

test("the same rule decides the price on the server (orders) and in the app (web and Mini App share the hook)", () => {
  const market = readFileSync("src/lib/strategy/market.ts", "utf8");
  assert.ok(market.includes("const tokenUsd = referencePrice({ quote: feed, live });") && market.includes("getLivePrice(mint)"));
  const hook = readFileSync("src/components/coin/draw/useDrawTrade.ts", "utf8");
  assert.ok(hook.includes("const currentUsd = referencePrice({ quote: quote?.tokenUsd, live: coin?.livePriceUsd, chart: chartPrice });"));
  // The card's distance and every check read that one value.
  assert.ok(hook.includes("validateKind(kind, legs, { currentUsd,") && hook.includes("validateStrategy({ buy: draft.buy!, sell: draft.sell!, stop: draft.stop!, amountUsd, currentUsd,"));
  const panel = readFileSync("src/components/coin/draw/DrawTradePanel.tsx", "utf8");
  assert.equal(panel.split("now={draw.currentUsd}").length - 1, 2, "buy/sell/stop cards and the held-coin lines");
  // The Mini App shows this very chart and panel.
  assert.ok(readFileSync("src/components/tg/TgCoin.tsx", "utf8").includes('import("@/components/coin/PriceChart")'));
});

// ── the normal view ─────────────────────────────────────────────────────────────────────────────────────────────────
const P = 0.0000485;
const candles = [0.000041, 0.000044, 0.00005, 0.000047, P];

test("the normal view is around the candles, the current price and the drawn lines, with room above and below — never down to zero", () => {
  const plain = fitDomain(candles);
  assert.ok(plain.min > 0 && plain.min < 0.000041 && plain.max > 0.00005);
  // Where lines can be drawn there is room to mark above the highs and below the lows.
  const room = fitDomain(candles, [], 0.25, P);
  assert.ok(room.max - 0.00005 > (0.00005 - 0.000041) * 0.25 && 0.000041 - room.min > (0.00005 - 0.000041) * 0.25);
  // A line that is drawn is in view, with margin beyond it.
  const withSell = fitDomain(candles, [0.00007], 0.25, P);
  assert.ok(withSell.max > 0.00007 && clampedY(0.00007, withSell).out === null);
  const withStop = fitDomain(candles, [0.00003], 0.25, P);
  assert.ok(withStop.min < 0.00003 && withStop.min > 0);
  // One far away (a sell at 20x) does not flatten the chart: it is pinned to the edge instead.
  const far = fitDomain(candles, [P * 20], 0.25, P);
  assert.ok(sameDomain(far, room));
  assert.equal(clampedY(P * 20, far).out, "above");
  // A live price above every candle is still in view.
  assert.ok(fitDomain(candles, [], 0, 0.00006).max > 0.00006);
  // A coin that fell 99% in the window: the bottom stays above zero.
  const crash = fitDomain([0.001, 0.0005, 0.00001], [], 0.25, 0.00001);
  assert.ok(crash.min >= 0.00001 * 0.5 && crash.min > 0);
  // One flat candle, or nothing at all: still a real range.
  const flat = fitDomain([P, P]);
  assert.ok(flat.max > flat.min && flat.min > 0);
  assert.deepEqual(fitDomain([]), { min: 0, max: 1 });
  assert.ok(fitDomain([0, NaN, -1, P]).min > 0, "junk values are ignored");
});

// ── the zoom ────────────────────────────────────────────────────────────────────────────────────────────────────────
const fit = fitDomain(candles, [], 0.25, P);
const lim = zoomLimits(fit, P);

test("the zoom has limits: never below a tenth of the current price, never above ten times it, never to zero, never too close", () => {
  assert.ok(Math.abs(lim.lo - P * 0.1) < 1e-15 && Math.abs(lim.hi - P * 10) < 1e-15);
  // Zooming out for ever — from the bottom, the middle or the top — stops at those ends.
  for (const anchor of [0, 0.5, 1]) {
    let d: Domain = fit;
    for (let i = 0; i < 400; i++) d = zoomDomain(d, wheelFactor(120), anchor, lim);
    assert.ok(Math.abs(d.min - P * 0.1) < 1e-12 && Math.abs(d.max - P * 10) < 1e-12, `anchor ${anchor}: ${d.min} – ${d.max}`);
    assert.ok(d.min > 0);
  }
  // Zooming in for ever stops at a tenth of the normal view.
  let d: Domain = fit;
  for (let i = 0; i < 400; i++) d = zoomDomain(d, wheelFactor(-120), 0.5, lim);
  assert.ok(Math.abs(d.max - d.min - (fit.max - fit.min) * 0.1) < 1e-15);
  assert.ok(d.min > fit.min && d.max < fit.max);
  // Wherever the pointer is while zooming — far out, then all the way in at the very top or bottom — the current
  // price never leaves the screen: a zoom can't end up showing an empty stretch of the axis.
  for (const [outAt, inAt] of [[0.95, 0.5], [0.05, 0.98], [0.5, 0.02], [1, 1], [0, 0]]) {
    let v: Domain = fit;
    for (let i = 0; i < 60; i++) v = zoomDomain(v, wheelFactor(120), outAt, lim);
    for (let i = 0; i < 400; i++) {
      v = zoomDomain(v, wheelFactor(-120), inAt, lim);
      assert.ok(v.min < P && P < v.max, `the price is on screen (${outAt}, ${inAt}, step ${i})`);
    }
  }
  // Candles that already go beyond those ends (a coin that fell 99%) keep them in reach.
  const crash = fitDomain([0.001, 0.0005, 0.00001], [], 0.25, 0.00001);
  const wide = zoomLimits(crash, 0.00001);
  assert.ok(wide.hi >= crash.max && wide.lo <= crash.min && wide.lo > 0);
  // No current price: the normal view is the whole of it.
  assert.deepEqual([zoomLimits(fit, null).lo, zoomLimits(fit, null).hi], [fit.min, fit.max]);
  // Whatever view is handed in comes back inside the limits.
  const c = clampDomain({ min: -5, max: 99 }, lim);
  assert.ok(c.min >= lim.lo && c.max <= lim.hi + 1e-15);
});

test("the zoom is smooth and vertical only: the price under the pointer stays where it is, and one notch is a small step", () => {
  assert.ok(wheelFactor(100) > 1 && wheelFactor(100) < 1.15, "one notch of the wheel: a few percent");
  assert.ok(wheelFactor(-100) < 1 && wheelFactor(-100) > 0.87);
  assert.equal(wheelFactor(10_000), wheelFactor(80), "a wild wheel event is still one small step");
  assert.equal(wheelFactor(0), 1);
  for (const anchor of [0.2, 0.5, 0.9]) {
    const pivot = fit.min + anchor * (fit.max - fit.min);
    const out = zoomDomain(fit, 1.5, anchor, lim);
    assert.ok(Math.abs(out.min + anchor * (out.max - out.min) - pivot) < 1e-15, `anchor ${anchor}`);
    assert.ok(out.max - out.min > fit.max - fit.min);
    // Out and back in by the same amount is where it started.
    assert.ok(sameDomain(zoomDomain(out, 1 / 1.5, anchor, lim), fit));
  }
  for (const bad of [0, -1, NaN, Infinity]) assert.ok(sameDomain(zoomDomain(fit, bad, 0.5, lim), fit));
  assert.equal(rowToAnchor(CHART.padding), 1);
  assert.equal(rowToAnchor(CHART.height - CHART.padding), 0);
});

test("drawing, dragging and each line's tag work at any zoom: pixel ↔ price is the same mapping the curve uses", () => {
  let d: Domain = fit;
  const views: Domain[] = [fit];
  for (let i = 0; i < 12; i++) views.push((d = zoomDomain(d, 1.35, 0.3, lim)));
  for (let i = 0; i < 20; i++) views.push((d = zoomDomain(d, 0.8, 0.7, lim)));
  for (const view of views) {
    for (const y of [CHART.padding, 60, 130, 200, CHART.height - CHART.padding]) {
      const price = yToPrice(y, view);
      assert.ok(price > 0 && Math.abs(priceToY(price, view) - y) < 1e-6, "a line lands exactly where the finger put it");
    }
    // A line's tag sits on its line; a line outside the view is pinned to the edge it left by.
    const inside = (view.min + view.max) / 2;
    assert.equal(clampedY(inside, view).out, null);
    assert.equal(clampedY(view.max * 1.01, view).out, "above");
    assert.equal(clampedY(view.min * 0.99, view).out, "below");
  }
});

test("the chart: wheel only over it, two fingers to pinch, one finger still draws and the page still scrolls", () => {
  const chart = readFileSync("src/components/coin/PriceChart.tsx", "utf8");
  // The wheel listener lives on the chart itself (not the window), and leaves ctrl + wheel to the browser.
  assert.ok(chart.includes('el.addEventListener("wheel", wheel, { passive: false });') && chart.includes("if (!el || e.ctrlKey) return;"));
  // Only two fingers zoom; one finger is never taken for it.
  assert.ok(chart.includes("if (e.touches.length !== 2) {") && chart.includes("e.preventDefault(); // two fingers on the chart are the chart's"));
  assert.ok(chart.includes('touchAction: drawing ? "none" : "pan-y",'), "one finger scrolls the page through the chart, except while a line is being placed");
  // No dragging the axis around any more: the zoom is the only way the view changes.
  assert.doesNotMatch(chart, /panView|dragAxis|cursor-grabbing/);
  // "Reset view": only when the view was moved.
  assert.ok(chart.includes("const moved = domain !== fit;") && chart.includes("{moved && (") && chart.includes("onClick={() => setZoom(null)}"));
  // One domain for the curve, the lines, their tags and the pointer.
  for (const use of ["priceToY(v, domain)", "<StrategyLines overlay={overlay} domain={domain} />", "<PriceTags overlay={overlay} domain={domain}", "yToPrice(clientYToChartY(clientY, rect.top, rect.height), domain)"]) assert.ok(chart.includes(use), use);
});
