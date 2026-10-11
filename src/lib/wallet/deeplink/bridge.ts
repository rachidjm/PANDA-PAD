import type { DeepLinkProvider } from "./protocol";

/**
 * What the Mini App's shell and the wallet adapter (./adapter.ts) share. Kept apart from the adapter on purpose: the
 * shell is on the phone's first screen and must not bring the wallet libraries with it — those arrive a moment later.
 */

/** Why a wallet step did not finish — the Mini App says each one in its own language. */
export type FlowCode = "start" | "session" | "timeout" | "rejected" | "unreadable" | "outside";
export class DeepLinkFlowError extends Error {
  constructor(public code: FlowCode, message: string) {
    super(message);
  }
}

/**
 * `opened`: the wallet's link was already opened when the sheet appears. `auto`: it was opened WITHOUT a tap (the second
 * step of signing in, straight after connecting) — Telegram may have ignored it, so the sheet offers its button again
 * if the app is still on screen a moment later.
 */
export type WalletStep = { provider: DeepLinkProvider; kind: "connect" | "sign" | "login"; url: string; opened: boolean; auto?: boolean };
/** The sheet the Mini App shows during a wallet step. `ready` resolves once the wallet link has been opened by a tap. */
export type WalletStepUi = { ready: Promise<void>; cancelled: () => boolean; end: (outcome: "ok" | "error" | "timeout") => void };

/** What the Mini App's shell provides. */
export type DeepLinkBridge = {
  /** fetch with the Mini App's session (it signs in again by itself when the session ran out). */
  api: (path: string, init?: { method?: string; body?: unknown; keepalive?: boolean }) => Promise<Response>;
  signedIn: () => boolean;
  /** Telegram's own way of opening a link outside its browser. Only works inside a tap. */
  openLink: (url: string) => void;
  siteUrl: string;
  /** The message for a failure, in the app's language. */
  text: (code: FlowCode) => string;
  begin: (step: WalletStep) => WalletStepUi;
  /** Where the wallet should bring the user back to (the coin being looked at), or null. */
  back: () => string | null;
};
let bridge: DeepLinkBridge | null = null;
export function setDeepLinkBridge(b: DeepLinkBridge | null): void {
  bridge = b;
}
export const deepLinkBridge = (): DeepLinkBridge | null => bridge;

export const DEEPLINK_WALLET_NAMES: Record<DeepLinkProvider, string> = { phantom: "Phantom · Telegram", solflare: "Solflare · Telegram" };
export const deepLinkProviders: DeepLinkProvider[] = ["phantom", "solflare"];

/** A sign-in whose signature is on its way (where its answer will be, which challenge it answers). Not a session. */
export const LOGIN_KEY = (p: DeepLinkProvider) => `panda.tg.wallet.${p}.signin`;
/** True when a sign-in was in the wallet app the last time this page was alive: the start then waits for the wallet code to look for its answer. */
export function hasPendingLogin(): boolean {
  try {
    return deepLinkProviders.some((p) => !!localStorage.getItem(LOGIN_KEY(p)));
  } catch {
    return false;
  }
}
