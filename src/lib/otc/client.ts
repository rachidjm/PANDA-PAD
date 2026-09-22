/**
 * Server-only HTTP client for OTC's real, documented API (https://otcdesks.cash/docs). Every call here
 * is exactly one of the three endpoints the docs describe — nothing invented, no API key (the docs say
 * plainly: "There is no key, no registration and no allow list"). Never imported from a client component:
 * PANDA's own /api/otc/* routes are what the browser talks to (see "Launching from your own app" in the
 * docs — this file makes the same three calls in the same order that page's own launcher makes).
 */

const OTC_BASE_URL = "https://otcdesks.cash";

export class OtcApiError extends Error {
  constructor(message: string, public status: number) {
    super(message);
    this.name = "OtcApiError";
  }
}

async function parseError(res: Response): Promise<never> {
  let message = `OTC request failed (${res.status}).`;
  try {
    const body = (await res.json()) as { error?: string };
    if (body?.error) message = body.error;
  } catch {}
  throw new OtcApiError(message, res.status);
}

export type UploadMetadataInput = {
  file: Blob;
  filename: string;
  name: string;
  symbol: string;
  description: string;
  twitter?: string;
  telegram?: string;
  website?: string;
};

/** Step 1 — POST /api/ipfs: pins the coin's image + metadata, returns `metadataUri`. */
export async function uploadMetadata(input: UploadMetadataInput): Promise<{ metadataUri: string }> {
  const form = new FormData();
  form.set("file", input.file, input.filename);
  form.set("name", input.name);
  form.set("symbol", input.symbol);
  form.set("description", input.description);
  if (input.twitter) form.set("twitter", input.twitter);
  if (input.telegram) form.set("telegram", input.telegram);
  if (input.website) form.set("website", input.website);

  const res = await fetch(`${OTC_BASE_URL}/api/ipfs`, { method: "POST", body: form });
  if (!res.ok) await parseError(res);
  const data = (await res.json()) as { metadataUri?: string };
  if (!data.metadataUri) throw new OtcApiError("OTC didn't return a metadataUri.", 502);
  return { metadataUri: data.metadataUri };
}

export type BuildMeteoraLaunchInput = {
  mint: string;
  name: string;
  symbol: string;
  uri: string;
  creator: string;
  quoteMint: string;
  /** Defaults to "low" per the docs when omitted. */
  mode?: "low" | "high";
  /** Decimal string, base units of the quote asset. Defaults to "0" (no opening buy) when omitted. */
  buy?: string;
};

export type BuildMeteoraLaunchResult = {
  /** Exactly two base64 transactions, in the order they must be signed and sent. */
  transactions: [string, string];
  config: string;
  blockhash: string;
  lastValidBlockHeight: number;
  quoteUsd: number;
};

/** Step 2 — POST /api/meteora/launch: builds the two transactions. Nothing is created on-chain yet. */
export async function buildMeteoraLaunch(input: BuildMeteoraLaunchInput): Promise<BuildMeteoraLaunchResult> {
  const res = await fetch(`${OTC_BASE_URL}/api/meteora/launch`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      mint: input.mint,
      name: input.name,
      symbol: input.symbol,
      uri: input.uri,
      creator: input.creator,
      quoteMint: input.quoteMint,
      mode: input.mode ?? "low",
      buy: input.buy ?? "0",
    }),
  });
  if (!res.ok) await parseError(res);
  const data = (await res.json()) as Partial<BuildMeteoraLaunchResult>;
  if (!data.transactions || data.transactions.length !== 2 || !data.config || !data.blockhash || data.lastValidBlockHeight === undefined) {
    throw new OtcApiError("OTC returned an incomplete launch build.", 502);
  }
  return {
    transactions: [data.transactions[0], data.transactions[1]],
    config: data.config,
    blockhash: data.blockhash,
    lastValidBlockHeight: data.lastValidBlockHeight,
    quoteUsd: data.quoteUsd ?? 0,
  };
}

export type RegisterCoinInput = {
  mint: string;
  name: string;
  symbol: string;
  uri: string;
  creator: string;
  createTx: string;
  pairMint: string;
  pairSymbol: string;
  rewardMint: string;
  rewardSymbol: string;
  meteoraConfig: string;
};

/** Result of a 409: the docs say this means the signature isn't indexed yet — retry shortly, don't relaunch. */
export type RegisterCoinResult = { ok: true } | { ok: false; notIndexedYet: true } | { ok: false; notIndexedYet: false; error: string };

/** Step 3 (optional) — POST /api/coins: lists the coin on OTC's own board. The launch itself already
 * exists and earns fees without this (see docs) — this only affects visibility on otcdesks.cash. */
export async function registerCoin(input: RegisterCoinInput): Promise<RegisterCoinResult> {
  const res = await fetch(`${OTC_BASE_URL}/api/coins`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ...input, venue: "meteora" }),
  });
  if (res.status === 409) return { ok: false, notIndexedYet: true };
  if (!res.ok) {
    let message = `OTC registration failed (${res.status}).`;
    try {
      const body = (await res.json()) as { error?: string };
      if (body?.error) message = body.error;
    } catch {}
    return { ok: false, notIndexedYet: false, error: message };
  }
  return { ok: true };
}
