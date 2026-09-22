/**
 * Thin client for Jupiter's public Swap API (the standard Solana DEX
 * aggregator — routes through Raydium, Orca, Meteora, etc.). Used for coins
 * that don't trade on Pump.fun/PumpSwap, which the Pump SDK has no way to
 * route. Free tier, no API key required.
 */

const JUP_BASE = "https://lite-api.jup.ag";

export const SOL_MINT = "So11111111111111111111111111111111111111112";

export type JupiterQuote = {
  inputMint: string;
  inAmount: string;
  outputMint: string;
  outAmount: string;
  otherAmountThreshold: string;
  priceImpactPct: string;
  slippageBps: number;
  [key: string]: unknown;
};

export async function getJupiterQuote({
  inputMint,
  outputMint,
  amount,
  slippageBps,
}: {
  inputMint: string;
  outputMint: string;
  amount: string;
  slippageBps: number;
}): Promise<JupiterQuote> {
  const url = `${JUP_BASE}/swap/v1/quote?inputMint=${inputMint}&outputMint=${outputMint}&amount=${amount}&slippageBps=${slippageBps}`;
  const res = await fetch(url, { headers: { Accept: "application/json" }, cache: "no-store" });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Jupiter quote failed (${res.status}): ${body.slice(0, 200)}`);
  }
  const quote = await res.json();
  if (!quote || !quote.outAmount) throw new Error("No route found for this trade.");
  return quote;
}

export async function getJupiterSwapTransaction({
  quote,
  userPublicKey,
}: {
  quote: JupiterQuote;
  userPublicKey: string;
}): Promise<string> {
  const res = await fetch(`${JUP_BASE}/swap/v1/swap`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      quoteResponse: quote,
      userPublicKey,
      dynamicComputeUnitLimit: true,
      dynamicSlippage: true,
      // Ask for a priority fee (at most 0.0002 SOL) so the swap lands when the network is busy.
      prioritizationFeeLamports: { priorityLevelWithMaxLamports: { maxLamports: 200_000, priorityLevel: "high" } },
    }),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Jupiter swap build failed (${res.status}): ${body.slice(0, 200)}`);
  }
  const data = await res.json();
  if (!data.swapTransaction) throw new Error("Jupiter didn't return a transaction.");
  return data.swapTransaction as string;
}
