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

/** `opened`: the wallet's link was already opened (inside the tap) when the sheet appears. */
export type WalletStep = { provider: DeepLinkProvider; kind: "connect" | "sign"; url: string; opened: boolean };
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
  /** The screen the request is made from: where another copy of the app goes to finish it (./ops.ts). */
  path: () => string;
};
let bridge: DeepLinkBridge | null = null;
export function setDeepLinkBridge(b: DeepLinkBridge | null): void {
  bridge = b;
}
export const deepLinkBridge = (): DeepLinkBridge | null => bridge;

export const DEEPLINK_WALLET_NAMES: Record<DeepLinkProvider, string> = { phantom: "Phantom · Telegram", solflare: "Solflare · Telegram" };
export const deepLinkProviders: DeepLinkProvider[] = ["phantom", "solflare"];
