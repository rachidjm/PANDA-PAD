# PANDA — The GIF Coin Launchpad

A memecoin launchpad concept for Solana, focused on GIF coins. Built with Next.js (App Router), Tailwind CSS v4, and `@solana/wallet-adapter` for Phantom.

## Running it

```bash
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

## What's real vs. mocked

- **Wallet connect** is real: it uses the Wallet Standard plus the explicit Phantom adapter, so an installed Phantom or Solflare extension is detected and connected non-custodially (no keys ever touch this app). It talks to Solana devnet, so the SOL balance shown is your real devnet balance.
- **Coin discovery, prices, market cap, volume, socials, and trades** are real — fetched server-side from GeckoTerminal's public API, which indexes Pump.fun's bonding-curve dex and PumpSwap (its post-graduation AMM) directly on-chain. If that feed is ever unreachable, the app falls back to clearly-labeled demo data instead of breaking.
- **Buy / Sell / Launch** are simulated locally (no transaction is ever sent). The trading panel and create flow are both labeled "Simulated" — wiring them to the real Pump.fun SDK (`@pump-fun/pump-sdk`) for on-chain create/buy/sell is the next step.
- **Holders** aren't available from the current data source, so that tab says so honestly instead of showing fake numbers.
- Coin media on the feed falls back to small original SVG doodle loops when a real token has no image; the Create flow accepts a real GIF/PNG/JPG/WEBP upload and previews it directly.

## Structure

- `src/components/panda/Panda.tsx` — the mascot, one hand-drawn SVG with pose variants (`idle`, `create`, `tradeUp`, `tradeDown`, `loading`, `empty`, `success`, `error`) and cursor-tracking eyes / blinking on the hero.
- `src/components/doodles/Doodle.tsx` — the placeholder coin "GIFs" used when a real token has no image.
- `src/components/coin/` — token page, price chart, and trading panel.
- `src/lib/gecko/client.ts` — the GeckoTerminal API client (isolated so the data source can be swapped later).
- `src/lib/live-coins.ts` — shapes GeckoTerminal data into the app's `Coin`/`Trade` types, with mock-data fallback.
- `src/lib/mock-data.ts` — demo fallback data, also used directly on the Rewards page.
