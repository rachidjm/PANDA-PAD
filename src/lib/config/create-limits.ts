/**
 * Smallest first buy (in SOL) a new coin's launch may declare — the Create
 * form keeps its Launch button disabled below it, and the "create" step of
 * /api/pump/create refuses to build a transaction without it, so this is
 * enforced on both sides, not just shown as a hint.
 */
export function createMinFirstBuySol(): number {
  const v = Number(process.env.CREATE_MIN_FIRST_BUY_SOL);
  return Number.isFinite(v) && v > 0 ? v : 0.01;
}
