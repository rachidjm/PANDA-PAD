import { ABUSE_CONFIG as C } from "./config";
import { collectSignals } from "./signals";
import type { AbuseStatus, AnalysisInput, Finding, Signal, SignalFamily } from "./types";

/**
 * Turns evidence into a CAUTIOUS proposal. The rules that protect honest users:
 *  - a signal's worth is points x confidence, so a weak guess adds little;
 *  - each FAMILY of evidence is capped below the RESTRICTED line, so no single
 *    kind of signal — however strong — can push a wallet past REVIEW alone;
 *  - RESTRICTED / DISQUALIFIED are only proposed with >= 2 independent families
 *    AND enough overall confidence;
 *  - none of this is applied automatically beyond REVIEW: a person decides.
 */

/** What one signal contributes: points scaled by how sure we are (integer). */
export const contribution = (s: Signal) => Math.floor((s.points * s.confidence) / 100);

export function recommend(score: number, families: number, confidence: number): AbuseStatus {
  const t = C.score;
  if (score >= t.disqualified && families >= 2 && confidence >= t.disqualifiedMinConfidence) return "DISQUALIFIED";
  if (score >= t.restricted && families >= 2 && confidence >= t.restrictedMinConfidence) return "RESTRICTED";
  if (score >= t.review) return "REVIEW";
  return "NORMAL";
}

export function scoreWallet(wallet: string, signals: Signal[]): Finding {
  const perFamily = new Map<SignalFamily, number>();
  let weightedConfidence = 0;
  let totalContribution = 0;
  for (const s of signals) {
    const c = contribution(s);
    perFamily.set(s.family, (perFamily.get(s.family) ?? 0) + c);
    weightedConfidence += c * s.confidence;
    totalContribution += c;
  }
  const capped = [...perFamily.entries()].map(([family, c]) => [family, Math.min(C.score.maxPerFamily, c)] as const);
  const score = Math.min(C.score.max, capped.reduce((sum, [, c]) => sum + c, 0));
  const families = capped.filter(([, c]) => c > 0).map(([f]) => f);
  const confidence = totalContribution > 0 ? Math.floor(weightedConfidence / totalContribution) : 0;

  return {
    wallet,
    score,
    confidence,
    families,
    reasonCodes: [...new Set(signals.map((s) => s.code))].sort(),
    signals,
    recommended: recommend(score, families.length, confidence),
  };
}

/** The full analysis: findings for every wallet with any evidence, riskiest first. Wallets without evidence are simply absent. */
export function analyze(input: AnalysisInput, eventCap: number): Finding[] {
  return [...collectSignals(input, eventCap).entries()]
    .map(([wallet, signals]) => scoreWallet(wallet, signals))
    .filter((f) => f.score > 0)
    .sort((a, b) => b.score - a.score || (a.wallet < b.wallet ? -1 : 1));
}
