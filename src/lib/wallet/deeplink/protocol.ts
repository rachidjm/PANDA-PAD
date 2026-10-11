import bs58 from "bs58";
import nacl from "tweetnacl";

/**
 * The wallets' official deep-link protocol (Phantom: docs.phantom.com → "Deeplinks"; Solflare implements the same one).
 * It is how a page that can't reach a wallet extension — Telegram's in-app browser — still gets the USER'S OWN wallet
 * app to connect and sign: the page opens a link, the wallet app shows the request, the user approves there, and the
 * wallet comes back through a redirect link. Everything after the first step is encrypted end to end between this page
 * and the wallet app (X25519 + XSalsa20-Poly1305, i.e. NaCl "box"). PANDA never sees a key or a seed phrase: there is
 * none here to see.
 *
 * Pure functions only (the adapter in ./adapter.ts does the opening and the waiting), so all of it is unit-tested
 * against a simulated wallet.
 */

export type DeepLinkProvider = "phantom" | "solflare";

export const PROVIDERS: Record<DeepLinkProvider, { label: string; base: string; keyParam: string }> = {
  phantom: { label: "Phantom", base: "https://phantom.app/ul/v1", keyParam: "phantom_encryption_public_key" },
  solflare: { label: "Solflare", base: "https://solflare.com/ul/v1", keyParam: "solflare_encryption_public_key" },
};

export type DappKeys = { publicKey: string; secretKey: string }; // base58
export type WalletSession = { provider: DeepLinkProvider; dapp: DappKeys; walletKey: string; session: string; publicKey: string };

export function newDappKeys(): DappKeys {
  const kp = nacl.box.keyPair();
  return { publicKey: bs58.encode(kp.publicKey), secretKey: bs58.encode(kp.secretKey) };
}

const shared = (walletKey: string, dappSecret: string) => nacl.box.before(bs58.decode(walletKey), bs58.decode(dappSecret));

export function encryptPayload(payload: unknown, walletKey: string, dappSecret: string, nonce: Uint8Array = nacl.randomBytes(24)): { nonce: string; payload: string } {
  const box = nacl.box.after(new TextEncoder().encode(JSON.stringify(payload)), nonce, shared(walletKey, dappSecret));
  return { nonce: bs58.encode(nonce), payload: bs58.encode(box) };
}

/** Throws when the data wasn't encrypted for this key (or was tampered with). */
export function decryptPayload<T>(data: string, nonce: string, walletKey: string, dappSecret: string): T {
  const open = nacl.box.open.after(bs58.decode(data), bs58.decode(nonce), shared(walletKey, dappSecret));
  if (!open) throw new Error("The wallet's answer could not be read.");
  return JSON.parse(new TextDecoder().decode(open)) as T;
}

const link = (provider: DeepLinkProvider, method: string, params: Record<string, string>) => `${PROVIDERS[provider].base}/${method}?${new URLSearchParams(params).toString()}`;

export function connectUrl(i: { provider: DeepLinkProvider; dappPublicKey: string; redirect: string; appUrl: string }): string {
  return link(i.provider, "connect", { app_url: i.appUrl, dapp_encryption_public_key: i.dappPublicKey, redirect_link: i.redirect, cluster: "mainnet-beta" });
}

export type DeepLinkMethod = "signAndSendTransaction" | "signTransaction" | "signAllTransactions" | "signMessage";

/** Any request after connecting: the payload (which always carries the wallet's session) is encrypted for the wallet. */
export function requestUrl(s: WalletSession, method: DeepLinkMethod, body: Record<string, unknown>, redirect: string): string {
  const enc = encryptPayload({ ...body, session: s.session }, s.walletKey, s.dapp.secretKey);
  return link(s.provider, method, { dapp_encryption_public_key: s.dapp.publicKey, nonce: enc.nonce, redirect_link: redirect, payload: enc.payload });
}

export class DeepLinkError extends Error {
  constructor(message: string, public code: string) {
    super(message);
  }
  /** 4001 is the wallets' "the user said no". */
  get rejected(): boolean {
    return this.code === "4001";
  }
}

/** What came back on the redirect: the wallet's error, or the fields to decrypt. */
export function readAnswer(provider: DeepLinkProvider, answer: Record<string, string>): { walletKey: string | null; nonce: string; data: string } {
  if (answer.errorCode) throw new DeepLinkError(answer.errorMessage || "The wallet refused the request.", answer.errorCode);
  if (!answer.nonce || !answer.data) throw new DeepLinkError("The wallet's answer is incomplete.", "incomplete");
  return { walletKey: answer[PROVIDERS[provider].keyParam] ?? null, nonce: answer.nonce, data: answer.data };
}

/** The answer to `connect`: the wallet's address and the session every later request must carry. */
export function readConnect(provider: DeepLinkProvider, dapp: DappKeys, answer: Record<string, string>): WalletSession {
  const a = readAnswer(provider, answer);
  if (!a.walletKey) throw new DeepLinkError("The wallet's answer is incomplete.", "incomplete");
  const out = decryptPayload<{ public_key?: unknown; session?: unknown }>(a.data, a.nonce, a.walletKey, dapp.secretKey);
  if (typeof out.public_key !== "string" || typeof out.session !== "string") throw new DeepLinkError("The wallet's answer is incomplete.", "incomplete");
  if (bs58.decode(out.public_key).length !== 32) throw new DeepLinkError("The wallet's answer is incomplete.", "incomplete");
  return { provider, dapp, walletKey: a.walletKey, session: out.session, publicKey: out.public_key };
}

export function readResult<T>(s: WalletSession, answer: Record<string, string>): T {
  const a = readAnswer(s.provider, answer);
  return decryptPayload<T>(a.data, a.nonce, s.walletKey, s.dapp.secretKey);
}

/** 32 URL-safe characters: the relay slot's id (src/app/api/tg/relay). */
export function newRelayId(): string {
  return btoa(String.fromCharCode(...nacl.randomBytes(24))).replace(/\+/g, "-").replace(/\//g, "_");
}

/** Where the wallet app comes back to: a PANDA page in the phone's browser that hands the answer to the relay. */
export function redirectUrl(siteUrl: string, provider: DeepLinkProvider, relayId: string): string {
  return `${siteUrl.replace(/\/+$/, "")}/telegram/wallet?w=${provider}&r=${relayId}`;
}
