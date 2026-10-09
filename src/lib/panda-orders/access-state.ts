/**
 * Draw Your Trade's rule, in one place: a sell / stop with no buy is ALWAYS a PANDA order — never Jupiter, not even
 * as a fallback. When PANDA orders aren't available to this wallet or coin, nothing is sent anywhere and the panel
 * says why (`PandaAccess`). Jupiter is only for a drawn buy (buy + sell + stop). Pure, so every case is tested.
 */

export type PandaAccess =
  /** /api/panda-orders/list answered for this wallet. */
  | "ok"
  /** Still asking (or no wallet connected yet). */
  | "checking"
  /** No PANDA session on this browser: sign in. */
  | "signin"
  /** It worked earlier on this page and the session has since ended (expired, logged out elsewhere): sign in again. */
  | "expired"
  /** Not on PANDA_ORDERS_ALLOWLIST yet (or the feature is off): coming soon. */
  | "not_allowed"
  /** Not a Pump.fun / PumpSwap coin. */
  | "unsupported"
  /** The server or the network failed. */
  | "error";

/** What /api/panda-orders/list's answer means. `hadOk`: it already answered 200 earlier on this page. */
export function accessFromStatus(status: number | "network", hadOk: boolean): PandaAccess {
  if (status === 200) return "ok";
  if (status === 401) return hadOk ? "expired" : "signin";
  if (status === 403) return "not_allowed";
  // 404 is what a route answers while its feature flag is off.
  if (status === 404) return "not_allowed";
  return "error";
}

/** The coin- and flag-level answer comes first; only then the server's answer for this wallet. */
export function pandaAccessFor(i: { featureOn: boolean; source: string | undefined; server: PandaAccess }): PandaAccess {
  if (i.source !== "pump-fun" && i.source !== "pumpswap") return "unsupported";
  if (!i.featureOn) return "not_allowed";
  return i.server;
}

/** Where confirming a drawing goes: a drawn buy → Jupiter; sells / stops alone → PANDA, or nowhere. Never Jupiter for them. */
export function confirmRoute(draft: { buy?: number }, access: PandaAccess): "jupiter" | "panda" | "blocked" {
  if (draft.buy !== undefined) return "jupiter";
  return access === "ok" ? "panda" : "blocked";
}

/** The short message (translation key) for each case that isn't "ok". */
export const ACCESS_MESSAGE = {
  checking: "draw.access.checking",
  signin: "draw.access.signin",
  expired: "draw.access.expired",
  not_allowed: "draw.access.not_allowed",
  unsupported: "draw.access.unsupported",
  error: "draw.access.error",
} as const satisfies Record<Exclude<PandaAccess, "ok">, string>;

/** These two get a "sign in" button next to the message. */
export const needsSignIn = (a: PandaAccess) => a === "signin" || a === "expired";
