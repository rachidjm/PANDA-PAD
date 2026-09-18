import { Coin, Holder, Trade } from "./types";

function seededHistory(seed: number, points = 24, drift = 0): number[] {
  let value = 50 + (seed % 20);
  const out: number[] = [];
  let s = seed;
  for (let i = 0; i < points; i++) {
    s = (s * 9301 + 49297) % 233280;
    const rnd = s / 233280 - 0.5;
    value = Math.max(4, value + rnd * 14 + drift);
    out.push(Number(value.toFixed(2)));
  }
  return out;
}

export const coins: Coin[] = [
  {
    mint: "demo-cat",
    source: "mock",
    ticker: "CAT",
    name: "Dancing Cat",
    description: "The cat that never stops dancing. Born on the timeline, raised by degens.",
    doodle: "cat",
    bg: "#FFD23F",
    marketCap: 182_400,
    volume24h: 421_000,
    holders: 1284,
    changePct: 24.8,
    priceHistory: seededHistory(11, 24, 0.6),
    creator: "8xKp…f3Qz",
    createdAt: "2026-09-12T10:22:00Z",
  },
  {
    mint: "demo-frog",
    source: "mock",
    ticker: "FROG",
    name: "Vibing Frog",
    description: "Just a frog, vibing. No utility, all vibes.",
    doodle: "frog",
    bg: "#7FE0A0",
    marketCap: 96_200,
    volume24h: 154_000,
    holders: 642,
    changePct: 91.3,
    priceHistory: seededHistory(23, 24, 1.4),
    creator: "3mNq…7Lwe",
    createdAt: "2026-09-15T14:05:00Z",
  },
  {
    mint: "demo-donut",
    source: "mock",
    ticker: "DONUT",
    name: "Spinning Donut",
    description: "Glazed, spinning, unstoppable. The snack that became a coin.",
    doodle: "donut",
    bg: "#FF9AD5",
    marketCap: 341_900,
    volume24h: 88_400,
    holders: 2110,
    changePct: -6.2,
    priceHistory: seededHistory(41, 24, -0.3),
    creator: "PandaDAO",
    createdAt: "2026-09-08T09:00:00Z",
  },
  {
    mint: "demo-boo",
    source: "mock",
    ticker: "BOO",
    name: "Floaty Ghost",
    description: "Haunts your portfolio, gently.",
    doodle: "ghost",
    bg: "#B8B4FF",
    marketCap: 54_700,
    volume24h: 41_200,
    holders: 318,
    changePct: 12.1,
    priceHistory: seededHistory(59, 24, 0.2),
    creator: "6uTr…9Kdx",
    createdAt: "2026-09-16T22:40:00Z",
  },
  {
    mint: "demo-egg",
    source: "mock",
    ticker: "EGG",
    name: "Cracked Egg",
    description: "About to hatch. Or already did. Nobody knows.",
    doodle: "egg",
    bg: "#FFC85C",
    marketCap: 22_050,
    volume24h: 9_800,
    holders: 140,
    changePct: 5.4,
    priceHistory: seededHistory(67, 24, 0.1),
    creator: "4fGh…2Ptz",
    createdAt: "2026-09-17T08:12:00Z",
  },
  {
    mint: "demo-cloud",
    source: "mock",
    ticker: "CLOUD",
    name: "Lazy Cloud",
    description: "Drifting sideways since launch. Extremely chill.",
    doodle: "cloud",
    bg: "#8FD3FF",
    marketCap: 128_300,
    volume24h: 61_500,
    holders: 890,
    changePct: -1.8,
    priceHistory: seededHistory(29, 24, -0.05),
    creator: "9zXe…4Vmn",
    createdAt: "2026-09-10T16:30:00Z",
  },
  {
    mint: "demo-fish",
    source: "mock",
    ticker: "FISH",
    name: "Blub Fish",
    description: "Swims against the market. Mostly loses.",
    doodle: "fish",
    bg: "#6FD8D0",
    marketCap: 71_900,
    volume24h: 33_700,
    holders: 455,
    changePct: 38.6,
    priceHistory: seededHistory(77, 24, 0.9),
    creator: "2kLp…8Ryx",
    createdAt: "2026-09-14T11:18:00Z",
  },
  {
    mint: "demo-worm",
    source: "mock",
    ticker: "WORM",
    name: "Wiggly Worm",
    description: "Low cap, high wiggle.",
    doodle: "worm",
    bg: "#FF8A5C",
    marketCap: 15_600,
    volume24h: 4_200,
    holders: 76,
    changePct: -14.3,
    priceHistory: seededHistory(83, 24, -0.6),
    creator: "7bNw…1Cqe",
    createdAt: "2026-09-18T02:55:00Z",
  },
];

export function getCoin(mintOrTicker: string): Coin | undefined {
  const q = mintOrTicker.toLowerCase();
  return coins.find((c) => c.mint.toLowerCase() === q || c.ticker.toLowerCase() === q);
}

export function mockTrades(coin: Coin): Trade[] {
  const traders = ["8xKp…f3Qz", "3mNq…7Lwe", "6uTr…9Kdx", "4fGh…2Ptz", "9zXe…4Vmn", "2kLp…8Ryx"];
  return Array.from({ length: 12 }).map((_, i) => {
    const side: Trade["side"] = i % 3 === 0 ? "sell" : "buy";
    const sol = Number((0.05 + ((i * 37) % 50) / 20).toFixed(2));
    return {
      id: `${coin.ticker}-${i}`,
      side,
      trader: traders[i % traders.length],
      sol,
      tokens: Math.round(sol * 18234),
      time: `${(i + 1) * 3}m ago`,
    };
  });
}

export function mockHolders(coin: Coin): Holder[] {
  const traders = ["8xKp…f3Qz", "3mNq…7Lwe", "6uTr…9Kdx", "4fGh…2Ptz", "9zXe…4Vmn", "PandaDAO", "2kLp…8Ryx", "7bNw…1Cqe"];
  let remaining = 100;
  return traders.map((address, i) => {
    const pct = i === traders.length - 1 ? Number(remaining.toFixed(1)) : Number((remaining / (traders.length - i) + (i === 0 ? 6 : 0)).toFixed(1));
    remaining -= pct;
    return { address, pct: Math.max(pct, 0.2), tokens: Math.round((coin.marketCap / 0.012) * (pct / 100)) };
  });
}
