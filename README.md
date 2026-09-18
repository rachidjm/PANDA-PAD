# PANDA — The GIF Coin Launchpad

A memecoin launchpad concept for Solana, focused on GIF coins. Built with Next.js (App Router), Tailwind CSS v4, and `@solana/wallet-adapter` for Phantom.

## Running it

```bash
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

## What's real vs. mocked

- **Wallet connect** is real: it uses the Wallet Standard, so an installed Phantom extension is detected and connected non-custodially (no keys ever touch this app). It talks to Solana devnet, so the SOL balance shown is your real devnet balance.
- **Coins, prices, trades, holders and rewards** are mock data (`src/lib/mock-data.ts`) — there's no on-chain program yet.
- **Buy / Sell / Launch** are simulated locally (no transaction is ever sent). The trading panel and create flow are both labeled "Simulated" — wiring them to a real Pump.fun-style bonding curve is the next step.
- **Coin media** are small original SVG doodle loops standing in for uploaded GIFs on the feed; the Create flow accepts a real `.gif` upload and previews it directly.

## Structure

- `src/components/panda/Panda.tsx` — the mascot, one hand-drawn SVG with pose variants (`idle`, `create`, `tradeUp`, `tradeDown`, `loading`, `empty`, `success`, `error`) and cursor-tracking eyes / blinking on the hero.
- `src/components/doodles/Doodle.tsx` — the placeholder coin "GIFs".
- `src/components/coin/` — token page + trading panel.
- `src/lib/mock-data.ts` — swap this out for real data once there's a backend/indexer.
