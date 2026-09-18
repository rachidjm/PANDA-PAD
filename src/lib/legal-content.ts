export type LegalSlug = "legal-notice" | "terms-of-service" | "privacy-policy" | "risk-disclosure" | "cookie-policy" | "disclaimer";

export type LegalPage = { slug: LegalSlug; title: string; body: string[] };

/**
 * A short, honest caveat kept at the top of every page (styled as a warning
 * in LegalPageLayout): this was drafted by PANDA's own team, not reviewed by
 * a lawyer. The rest of each page is real, substantive content grounded in
 * what PANDA actually does — not filler — but the operator-identity fields
 * below (entity name, address, jurisdiction, contact email) are left as
 * explicit "to be added" placeholders because we don't have real values for
 * them yet; inventing a company name or address here would be worse than
 * leaving it blank.
 */
const DRAFT_NOTICE =
  "Draft prepared by the PANDA team, not by a lawyer — treat this as a good-faith starting point, not final legal advice, until it's reviewed by qualified counsel in the relevant jurisdiction.";

export const LEGAL_PAGES: Record<LegalSlug, LegalPage> = {
  "legal-notice": {
    slug: "legal-notice",
    title: "Legal Notice",
    body: [
      DRAFT_NOTICE,
      "Operator: [legal entity or individual name to be added]. Registered address: [to be added]. Governing jurisdiction: [to be added]. Contact: [to be added]. These details will be filled in once PANDA's operating entity is finalized — nothing here should be assumed until then.",
      "PANDA is a software interface for interacting with public, permissionless Solana programs (Pump.fun, PumpSwap, and third-party Solana DEXes via Jupiter's aggregator). PANDA does not operate as a bank, broker-dealer, custodian, or money transmitter: it never holds user funds, private keys, or seed phrases. Every transaction shown in the app is built unsigned and only becomes real once the user reviews and signs it in their own wallet (e.g. Phantom, Solflare).",
      "Coins created through PANDA are minted directly by users via Pump.fun's public program. PANDA does not issue, endorse, or guarantee any coin created or traded through it, including $PANDA itself.",
    ],
  },
  "terms-of-service": {
    slug: "terms-of-service",
    title: "Terms of Service",
    body: [
      DRAFT_NOTICE,
      "By using PANDA, you agree to these terms. If you don't agree, don't use the app.",
      "Non-custodial by design. PANDA never takes custody of your funds, tokens, or private keys. Every trade, coin creation, fee-distribution setup, or claim is a transaction you review and sign yourself, in your own wallet. PANDA has no ability to move your assets without your signature, and no ability to reverse a transaction once you've signed it.",
      "Your responsibility. You are solely responsible for your wallet, its seed phrase, and every transaction you approve. PANDA will never ask for your seed phrase or private key, in the app or otherwise. Double-check every transaction's details in your wallet before signing — PANDA cannot undo a signed transaction.",
      "Acceptable use. You agree not to use PANDA to violate applicable law, to manipulate markets, to launder funds, or to infringe anyone else's rights. PANDA may restrict access to the app (though not to the underlying public Solana programs, which anyone can interact with directly) for accounts that clearly abuse it.",
      "No warranty. PANDA is provided \"as is,\" without warranties of any kind. Market data comes from third parties (GeckoTerminal) and can be delayed, rate-limited, or temporarily unavailable — the app shows this honestly (a \"live\" indicator) rather than pretending stale data is current, but you should not rely on it for time-critical decisions.",
      "Limitation of liability. To the maximum extent permitted by law, PANDA and its operator aren't liable for losses arising from your use of the app, including losses from market volatility, smart-contract risk, third-party services (Solana RPC providers, Pump.fun, Jupiter, GeckoTerminal), or your own transaction mistakes.",
      "Changes. These terms may be updated as PANDA evolves; continued use after a change means you accept the new terms. Governing law: [to be added].",
    ],
  },
  "privacy-policy": {
    slug: "privacy-policy",
    title: "Privacy Policy",
    body: [
      DRAFT_NOTICE,
      "The short version: PANDA collects very little, because it doesn't need much to work. This section describes what the app actually does, not a generic template.",
      "Wallet data. When you connect a wallet, PANDA reads your public wallet address and, for the Portfolio and Rewards pages, your real on-chain token balances — all of this is already public on the Solana blockchain; PANDA doesn't store it anywhere, it's read live from Solana each time you view those pages. PANDA never receives, requests, or stores your seed phrase or private key.",
      "No cookies, no tracking. PANDA does not set cookies and does not use localStorage, sessionStorage, or any third-party analytics or tracking scripts (no Google Analytics, no ad pixels, no session replay). This isn't a policy promise layered on top of tracking code — it's a description of the actual app, and you're welcome to verify it yourself by inspecting network requests and storage in your browser's dev tools.",
      "Third-party services. To show real data and build real transactions, your browser or PANDA's servers make requests to: GeckoTerminal (market data — coin prices, volume, trades), Jupiter's public swap API (quotes and swap routing for non-Pump.fun coins), and a Solana RPC provider (reading balances, sending transactions). These requests carry the technical information any web or API request does (e.g. IP address, at the network level) — PANDA doesn't combine this with your wallet address or build a profile of you.",
      "Hosting logs. Like any hosted web app, standard infrastructure-level access logs may exist at the hosting provider level for security and reliability purposes. PANDA doesn't use these for tracking or marketing.",
      "Your rights and contact. To ask about data PANDA might hold about you, contact: [to be added].",
    ],
  },
  "risk-disclosure": {
    slug: "risk-disclosure",
    title: "Risk Disclosure",
    body: [
      DRAFT_NOTICE,
      "Trading and creating coins through PANDA involves real, significant financial risk. Read this before you connect a wallet.",
      "Extreme volatility and total loss. Memecoins, including every coin created through PANDA and $PANDA itself, are highly speculative. Prices can move dramatically in minutes and can go to zero. Only ever risk money you can afford to lose completely.",
      "No vetting, no endorsement. PANDA doesn't review, approve, or vouch for any coin created or traded through it. Anyone can create a coin with any name, image, or description — that alone says nothing about its legitimacy or future value.",
      "Smart contract and program risk. Trades and coin creation execute through Pump.fun's, PumpSwap's, and (for non-Pump.fun coins) third-party DEXes' public Solana programs, plus Jupiter's routing. PANDA didn't write these programs and can't guarantee they're free of bugs or exploits.",
      "Fee distribution and rewards are experimental. A coin's on-chain \"Holder\" fee share (see Fee Distribution in Create) determines how much of its creator fees route toward holders, but PANDA's own Rewards Pool payout mechanism is still early — real eligibility is shown honestly, but claim payouts aren't live yet (see the Rewards page for current status). Past fee activity is never a guarantee of future rewards.",
      "Network and execution risk. Solana network congestion, RPC issues, or slippage can cause a transaction to fail, execute at a worse price than expected, or take longer than expected to confirm. Network fees are real and non-refundable once a transaction confirms, even if the trade itself doesn't go the way you hoped.",
      "Not investment advice. Nothing in PANDA — including market data, stats, or any coin's presence in a \"Trending\" or \"Top Gainers\" list — is a recommendation to buy, sell, or hold anything. See also: Disclaimer.",
    ],
  },
  "cookie-policy": {
    slug: "cookie-policy",
    title: "Cookie Policy",
    body: [
      DRAFT_NOTICE,
      "PANDA does not use cookies of any kind — no session cookies, no advertising cookies, no analytics cookies.",
      "PANDA also doesn't use browser localStorage, sessionStorage, or any third-party tracking or analytics scripts. There's nothing to opt out of, because nothing is being set.",
      "Your wallet extension (e.g. Phantom, Solflare) may use its own browser storage to remember your connection preferences — that storage is controlled entirely by the extension, not by PANDA, and is covered by that extension's own privacy practices, not this one.",
      "If this ever changes — for example, if PANDA adds an optional feature that needs local storage for your convenience — this page will be updated to describe exactly what's stored and why, honestly and specifically, not with a generic cookie-consent template.",
    ],
  },
  disclaimer: {
    slug: "disclaimer",
    title: "Disclaimer",
    body: [
      DRAFT_NOTICE,
      "PANDA is a non-custodial software interface for creating and trading coins on Solana. It is not a financial advisor, broker, dealer, exchange, or bank, and nothing in the app constitutes financial, investment, legal, or tax advice.",
      "Market data, stats, and charts shown in PANDA (including on the Analytics page and Home sections) are sourced from GeckoTerminal and reflect real on-chain activity, but can be incomplete, delayed, or temporarily unavailable if the upstream data source is rate-limited — the app is built to say so honestly (via its \"live\" indicators) rather than silently show stale numbers as current.",
      "$PANDA, PANDA's own token, has not launched at the time of writing. Any reference to it in the app describes planned functionality, not a live, tradeable asset, until it actually exists on-chain — the app itself reflects this honestly rather than showing a fake balance or price.",
      "Any third-party links (a coin's website, X/Twitter, or Telegram, as supplied by its creator) are provided as-is. PANDA doesn't control or vet that content.",
      "You are solely responsible for your own decisions when using PANDA. Do your own research before creating, buying, selling, or holding any coin.",
    ],
  },
};

export const LEGAL_SLUGS = Object.keys(LEGAL_PAGES) as LegalSlug[];
