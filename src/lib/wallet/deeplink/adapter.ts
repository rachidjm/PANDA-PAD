import {
  BaseMessageSignerWalletAdapter,
  isVersionedTransaction,
  WalletConnectionError,
  WalletNotConnectedError,
  WalletReadyState,
  WalletSendTransactionError,
  WalletSignMessageError,
  WalletSignTransactionError,
  type SendTransactionOptions,
  type WalletName,
} from "@solana/wallet-adapter-base";
import { PublicKey, Transaction, VersionedTransaction, type Connection, type TransactionSignature, type TransactionVersion } from "@solana/web3.js";
import bs58 from "bs58";
import { connectUrl, DeepLinkError, newDappKeys, newRelayId, PROVIDERS, readConnect, readResult, redirectUrl, requestUrl, type DappKeys, type DeepLinkMethod, type DeepLinkProvider, type WalletSession } from "./protocol";

/**
 * A wallet adapter that talks to the user's own wallet APP through its official deep links (./protocol.ts), for the
 * Telegram Mini App — where no wallet extension exists. Because it is an ordinary adapter, everything the website
 * already does with a wallet (TradingPanel's buys and sells, with the same fees, recruiters, warnings and routes) works
 * unchanged on top of it: PANDA builds the same transaction, and the wallet app shows it, signs it and sends it.
 *
 * Non-custodial by construction: the only things kept in this browser are the connection's own encryption key and the
 * wallet's session id — neither can sign anything. Every signature is approved by the user inside the wallet app.
 */

/** What the Mini App's shell provides: its session with PANDA, a way to open a link outside Telegram's browser, the site. */
export type DeepLinkBridge = { token: () => string | null; openLink: (url: string) => void; siteUrl: string };
let bridge: DeepLinkBridge | null = null;
export function setDeepLinkBridge(b: DeepLinkBridge | null): void {
  bridge = b;
}

export const DEEPLINK_WALLET_NAMES: Record<DeepLinkProvider, string> = { phantom: "Phantom · Telegram", solflare: "Solflare · Telegram" };
const ICON =
  "data:image/svg+xml;base64," +
  btoaSafe('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><rect width="32" height="32" rx="8" fill="#1c1c17"/><path d="M9 12.5h14a2 2 0 0 1 2 2v7a2 2 0 0 1-2 2H9a2 2 0 0 1-2-2v-9a2 2 0 0 1 2-2h11" fill="none" stroke="#f4f1e8" stroke-width="1.8" stroke-linecap="round"/><circle cx="21" cy="18" r="1.4" fill="#c8dc4a"/></svg>');

function btoaSafe(s: string): string {
  return typeof btoa === "function" ? btoa(s) : Buffer.from(s).toString("base64");
}

const SESSION_KEY = (p: DeepLinkProvider) => `panda.tg.wallet.${p}`;
const PENDING_KEY = (p: DeepLinkProvider) => `panda.tg.wallet.${p}.pending`;
const PENDING_MAX_AGE_MS = 10 * 60_000;
export const RELAY_WAIT_MS = 4 * 60_000;

type PendingConnect = { relayId: string; dapp: DappKeys; at: number };

const store = {
  get<T>(key: string): T | null {
    try {
      const raw = localStorage.getItem(key);
      return raw ? (JSON.parse(raw) as T) : null;
    } catch {
      return null;
    }
  },
  set(key: string, value: unknown) {
    try {
      localStorage.setItem(key, JSON.stringify(value));
    } catch {}
  },
  del(key: string) {
    try {
      localStorage.removeItem(key);
    } catch {}
  },
};

export class DeepLinkWalletAdapter extends BaseMessageSignerWalletAdapter {
  name: WalletName;
  url: string;
  icon = ICON;
  supportedTransactionVersions: ReadonlySet<TransactionVersion> = new Set(["legacy", 0] as TransactionVersion[]);
  readonly provider: DeepLinkProvider;
  private _session: WalletSession | null = null;
  private _publicKey: PublicKey | null = null;
  private _connecting = false;

  constructor(provider: DeepLinkProvider) {
    super();
    this.provider = provider;
    this.name = DEEPLINK_WALLET_NAMES[provider] as WalletName;
    this.url = provider === "phantom" ? "https://phantom.app" : "https://solflare.com";
  }

  get publicKey(): PublicKey | null {
    return this._publicKey;
  }
  get connecting(): boolean {
    return this._connecting;
  }
  get readyState(): WalletReadyState {
    return typeof window === "undefined" ? WalletReadyState.Unsupported : WalletReadyState.Installed;
  }

  private adopt(session: WalletSession) {
    this._session = session;
    this._publicKey = new PublicKey(session.publicKey);
    store.set(SESSION_KEY(this.provider), session);
    store.del(PENDING_KEY(this.provider));
    this.emit("connect", this._publicKey);
  }

  /** Silent: a connection approved earlier in this browser, or one whose answer arrived while the app was closed. */
  async autoConnect(): Promise<void> {
    if (this._publicKey || this._connecting) return;
    const saved = store.get<WalletSession>(SESSION_KEY(this.provider));
    if (saved?.publicKey && saved.session && saved.provider === this.provider) {
      try {
        this.adopt(saved);
        return;
      } catch {
        store.del(SESSION_KEY(this.provider));
      }
    }
    const pending = store.get<PendingConnect>(PENDING_KEY(this.provider));
    if (!pending) return;
    if (Date.now() - pending.at > PENDING_MAX_AGE_MS) return store.del(PENDING_KEY(this.provider));
    this._connecting = true;
    try {
      const answer = await this.collect(pending.relayId, 20_000);
      this.adopt(readConnect(this.provider, pending.dapp, answer));
    } catch {
      // Nothing arrived (or the user said no): the next tap on "Connect" starts again.
    } finally {
      this._connecting = false;
    }
  }

  async connect(): Promise<void> {
    if (this._publicKey || this._connecting) return;
    await this.autoConnect();
    if (this._publicKey) return;
    this._connecting = true;
    try {
      const b = this.requireBridge();
      const dapp = newDappKeys();
      const relayId = await this.openSlot();
      store.set(PENDING_KEY(this.provider), { relayId, dapp, at: Date.now() } satisfies PendingConnect);
      b.openLink(connectUrl({ provider: this.provider, dappPublicKey: dapp.publicKey, redirect: redirectUrl(b.siteUrl, this.provider, relayId), appUrl: b.siteUrl }));
      this.adopt(readConnect(this.provider, dapp, await this.collect(relayId, RELAY_WAIT_MS)));
    } catch (err) {
      store.del(PENDING_KEY(this.provider));
      const e = new WalletConnectionError(messageOf(err), err);
      this.emit("error", e);
      throw e;
    } finally {
      this._connecting = false;
    }
  }

  async disconnect(): Promise<void> {
    store.del(SESSION_KEY(this.provider));
    store.del(PENDING_KEY(this.provider));
    this._session = null;
    this._publicKey = null;
    this.emit("disconnect");
  }

  /** PANDA builds the transaction; the wallet app shows it, signs it and sends it itself. */
  async sendTransaction<T extends Transaction | VersionedTransaction>(transaction: T, connection: Connection, options: SendTransactionOptions = {}): Promise<TransactionSignature> {
    try {
      const { signers, ...sendOptions } = options;
      let tx: Transaction | VersionedTransaction = transaction;
      if (isVersionedTransaction(tx)) {
        if (signers?.length) tx.sign(signers);
      } else {
        tx = await this.prepareTransaction(tx, connection, sendOptions);
        if (signers?.length) (tx as Transaction).partialSign(...signers);
      }
      const out = await this.request<{ signature?: unknown }>("signAndSendTransaction", { transaction: serialize(tx), sendOptions });
      if (typeof out.signature !== "string" || !out.signature) throw new Error("The wallet did not return a signature.");
      return out.signature;
    } catch (err) {
      const e = err instanceof WalletNotConnectedError ? err : new WalletSendTransactionError(messageOf(err), err);
      this.emit("error", e);
      throw e;
    }
  }

  async signTransaction<T extends Transaction | VersionedTransaction>(transaction: T): Promise<T> {
    try {
      const out = await this.request<{ transaction?: unknown }>("signTransaction", { transaction: serialize(transaction) });
      if (typeof out.transaction !== "string") throw new Error("The wallet did not return the transaction.");
      return deserialize(out.transaction, transaction);
    } catch (err) {
      const e = err instanceof WalletNotConnectedError ? err : new WalletSignTransactionError(messageOf(err), err);
      this.emit("error", e);
      throw e;
    }
  }

  async signAllTransactions<T extends Transaction | VersionedTransaction>(transactions: T[]): Promise<T[]> {
    try {
      const out = await this.request<{ transactions?: unknown }>("signAllTransactions", { transactions: transactions.map(serialize) });
      if (!Array.isArray(out.transactions) || out.transactions.length !== transactions.length) throw new Error("The wallet did not return the transactions.");
      return out.transactions.map((raw, i) => deserialize(String(raw), transactions[i]));
    } catch (err) {
      const e = err instanceof WalletNotConnectedError ? err : new WalletSignTransactionError(messageOf(err), err);
      this.emit("error", e);
      throw e;
    }
  }

  async signMessage(message: Uint8Array): Promise<Uint8Array> {
    try {
      const out = await this.request<{ signature?: unknown }>("signMessage", { message: bs58.encode(message), display: "utf8" });
      if (typeof out.signature !== "string") throw new Error("The wallet did not return a signature.");
      return bs58.decode(out.signature);
    } catch (err) {
      const e = err instanceof WalletNotConnectedError ? err : new WalletSignMessageError(messageOf(err), err);
      this.emit("error", e);
      throw e;
    }
  }

  // ── plumbing ────────────────────────────────────────────────────────────────────────────────────
  private requireBridge(): DeepLinkBridge {
    if (!bridge || !bridge.token()) throw new Error("Open PANDA from Telegram to use this wallet.");
    return bridge;
  }

  private async request<T>(method: DeepLinkMethod, body: Record<string, unknown>): Promise<T> {
    const session = this._session;
    if (!session) throw new WalletNotConnectedError();
    const b = this.requireBridge();
    const relayId = await this.openSlot();
    b.openLink(requestUrl(session, method, body, redirectUrl(b.siteUrl, this.provider, relayId)));
    return readResult<T>(session, await this.collect(relayId, RELAY_WAIT_MS));
  }

  private async api(path: string, init?: RequestInit): Promise<Response> {
    const b = this.requireBridge();
    return fetch(path, { ...init, cache: "no-store", headers: { "Content-Type": "application/json", Authorization: `Bearer ${b.token()}` } });
  }

  private async openSlot(): Promise<string> {
    const id = newRelayId();
    const res = await this.api("/api/tg/relay", { method: "POST", body: JSON.stringify({ id }) });
    if (!res.ok) throw new Error(res.status === 401 ? "Your Telegram session expired — reopen PANDA from Telegram." : "Could not start the wallet request — try again.");
    return id;
  }

  /** Waits for the wallet's answer to reach the relay (the user is in the wallet app meanwhile). */
  private async collect(relayId: string, timeoutMs: number): Promise<Record<string, string>> {
    const started = Date.now();
    while (Date.now() - started < timeoutMs) {
      await new Promise((r) => setTimeout(r, 1500));
      let res: Response;
      try {
        res = await this.api(`/api/tg/relay?id=${relayId}`);
      } catch {
        continue; // offline for a moment while the phone switches apps
      }
      if (res.status === 410) throw new Error("The wallet request expired — try again.");
      if (!res.ok) continue;
      const data = (await res.json().catch(() => null)) as { answer?: Record<string, string> } | null;
      if (data?.answer) return data.answer;
    }
    throw new Error("No answer from the wallet in time — try again, or open PANDA in your browser.");
  }
}

function serialize(tx: Transaction | VersionedTransaction): string {
  return bs58.encode(isVersionedTransaction(tx) ? tx.serialize() : tx.serialize({ requireAllSignatures: false, verifySignatures: false }));
}

function deserialize<T extends Transaction | VersionedTransaction>(raw: string, like: T): T {
  const bytes = bs58.decode(raw);
  return (isVersionedTransaction(like) ? VersionedTransaction.deserialize(bytes) : Transaction.from(bytes)) as T;
}

/** The interface elsewhere tells a refusal apart by the words "rejected / cancelled": keep them when the wallet said no. */
function messageOf(err: unknown): string {
  if (err instanceof DeepLinkError && err.rejected) return "User rejected the request.";
  return err instanceof Error ? err.message : String(err);
}

export const deepLinkProviders = Object.keys(PROVIDERS) as DeepLinkProvider[];
