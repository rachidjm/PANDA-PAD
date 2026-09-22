import { PublicKey } from "@solana/web3.js";
import { isValidOtcRewardAsset } from "./reward-assets";

/** OTC's own documented limits ("The fields"): name up to 32 chars, symbol up to 13 — deliberately
 * not reusing PANDA Standard's own limits (16 for symbol), since these are two different systems
 * with two different upstream constraints. */
export const OTC_NAME_MAX = 32;
export const OTC_SYMBOL_MAX = 13;
export const OTC_URI_MAX = 200;

export function isValidPublicKey(v: unknown): v is string {
  if (typeof v !== "string" || !v) return false;
  try {
    new PublicKey(v);
    return true;
  } catch {
    return false;
  }
}

export type OtcLaunchFields = {
  mint: string;
  name: string;
  symbol: string;
  uri: string;
  creator: string;
  quoteMint: string;
  mode?: string;
  buy?: string;
};

/** Mirrors OTC's own documented validation ("When it fails" → 400s) so PANDA fails the same requests
 * before spending a round trip, and never forwards a quoteMint OTC hasn't offered. */
export function validateOtcLaunchFields(input: Partial<OtcLaunchFields>): string | null {
  if (!isValidPublicKey(input.mint)) return "mint isn't a valid public key.";
  if (!isValidPublicKey(input.creator)) return "creator isn't a valid public key.";
  if (typeof input.name !== "string" || !input.name.trim() || input.name.length > OTC_NAME_MAX) {
    return `name is required and must be at most ${OTC_NAME_MAX} characters.`;
  }
  if (typeof input.symbol !== "string" || !input.symbol.trim() || input.symbol.length > OTC_SYMBOL_MAX) {
    return `symbol is required and must be at most ${OTC_SYMBOL_MAX} characters.`;
  }
  if (typeof input.uri !== "string" || !input.uri.trim() || input.uri.length > OTC_URI_MAX) {
    return `uri is required and must be at most ${OTC_URI_MAX} characters.`;
  }
  if (!isValidPublicKey(input.quoteMint)) return "quoteMint isn't a valid public key.";
  if (!isValidOtcRewardAsset(input.quoteMint)) return "That reward asset isn't offered by OTC.";
  if (input.mode !== undefined && input.mode !== "low" && input.mode !== "high") return "mode must be \"low\" or \"high\".";
  if (input.buy !== undefined) {
    if (typeof input.buy !== "string" || !/^\d+(\.\d+)?$/.test(input.buy)) return "buy must be a plain decimal string.";
  }
  return null;
}

/** A real base58 transaction signature is always 64 bytes → 86-88 base58 characters. Loose but real. */
export function isPlausibleSignature(v: unknown): v is string {
  return typeof v === "string" && /^[1-9A-HJ-NP-Za-km-z]{64,90}$/.test(v);
}
