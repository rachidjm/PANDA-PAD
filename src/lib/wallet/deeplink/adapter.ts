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
import { deepLinkBridge, DeepLinkFlowError, DEEPLINK_WALLET_NAMES, LOGIN_KEY, type DeepLinkBridge, type FlowCode, type WalletStep, type WalletStepUi } from "./bridge";
import { connectUrl, DeepLinkError, newDappKeys, newRelayId, readConnect, readResult, redirectUrl, requestUrl, type DappKeys, type DeepLinkMethod, type DeepLinkProvider, type WalletSession } from "./protocol";

/**
 * A wallet adapter that talks to the user's own wallet APP through its official deep links (./protocol.ts), for the
 * Telegram Mini App — where no wallet extension exists. Because it is an ordinary adapter, everything the website
 * already does with a wallet (TradingPanel's buys and sells, Draw Your Trade and its orders — same fees, recruiters,
 * warnings and routes) works unchanged on top of it: PANDA builds the same transaction, and the wallet app shows it,
 * signs it and sends it.
 *
 * Non-custodial by construction: the only things kept in this browser are the connection's own encryption key and the
 * wallet's session id — neither can sign anything. Every signature is approved by the user inside the wallet app.
 *
 * Two facts of Telegram shape the flow:
 *  - A link can only be opened OUTSIDE Telegram from inside a tap (Telegram.WebApp.openLink). Connecting opens it in the
 *    tap on "Connect"; a signature — which is only ready after PANDA has built the transaction — first shows a sheet
 *    whose button the user taps, and THAT tap opens the wallet.
 *  - The moment the wallet opens, Telegram's browser may be frozen. So nothing the wallet's answer depends on may still
 *    be "about to be sent": the answer is accepted by the relay whether or not its slot was opened in time, and is
 *    simply collected when the user is back.
 */

const ICON =
  "data:image/svg+xml;base64," +
  btoaSafe('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><rect width="32" height="32" rx="8" fill="#1c1c17"/><path d="M9 12.5h14a2 2 0 0 1 2 2v7a2 2 0 0 1-2 2H9a2 2 0 0 1-2-2v-9a2 2 0 0 1 2-2h11" fill="none" stroke="#f4f1e8" stroke-width="1.8" stroke-linecap="round"/><circle cx="21" cy="18" r="1.4" fill="#c8dc4a"/></svg>');

function btoaSafe(s: string): string {
  return typeof btoa === "function" ? btoa(s) : Buffer.from(s).toString("base64");
}

const SESSION_KEY = (p: DeepLinkProvider) => `panda.tg.wallet.${p}`;
const PENDING_KEY = (p: DeepLinkProvider) => `panda.tg.wallet.${p}.pending`;
const PENDING_MAX_AGE_MS = 10 * 60_000;
/** How long the Mini App waits for the wallet's answer before it stops and says what to do. */
export const RELAY_WAIT_MS = 2 * 60_000;
export const RELAY_POLL_MS = 2_000;

type PendingConnect = { relayId: string; dapp: DappKeys; at: number };
/** A sign-in whose signature is on its way: where its answer will be, and which challenge it answers. Not a session. */
type PendingLogin = { relayId: string; nonce: string; at: number };
type RequestOptions = { kind?: WalletStep["kind"]; open?: "sheet" | "now" | "auto"; onRelay?: (relayId: string) => void };

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

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

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

  /** A connection approved earlier in this browser: nothing to open, nothing to wait for. */
  private restore(): boolean {
    const saved = store.get<WalletSession>(SESSION_KEY(this.provider));
    if (!saved?.publicKey || !saved.session || saved.provider !== this.provider) return false;
    try {
      this.adopt(saved);
      return true;
    } catch {
      store.del(SESSION_KEY(this.provider));
      return false;
    }
  }

  /** True when this wallet is connected, or was connected earlier in this browser (then it is again, with nothing to open). Synchronous: safe inside a tap. */
  restoreSaved(): boolean {
    if (!this._publicKey) return this.restore();
    // Said again on purpose: whoever started listening after the connection was made (the wallet library, once this
    // wallet is the selected one) must still learn that it is connected.
    this.emit("connect", this._publicKey);
    return true;
  }

  /** Silent: a saved connection, or one whose answer arrived while the app was closed (it came back through the bot's link). */
  async autoConnect(): Promise<void> {
    if (this._publicKey) return void this.emit("connect", this._publicKey); // already connected: say so to whoever is listening now
    if (this._connecting) return;
    if (this.restore()) return;
    const pending = store.get<PendingConnect>(PENDING_KEY(this.provider));
    if (!pending) return;
    if (Date.now() - pending.at > PENDING_MAX_AGE_MS) return store.del(PENDING_KEY(this.provider));
    this._connecting = true;
    try {
      // The shell signs in a moment after the page opens: give it that moment.
      for (let i = 0; i < 20 && !deepLinkBridge()?.signedIn(); i++) await sleep(500);
      const answer = await this.collect(pending.relayId, 30_000, () => false);
      this.adopt(readConnect(this.provider, pending.dapp, answer));
    } catch {
      // Nothing arrived (or the user said no): the next tap on "Connect" starts again.
      store.del(PENDING_KEY(this.provider));
    } finally {
      this._connecting = false;
    }
  }

  /**
   * MUST be called straight from a tap: the wallet's link is opened before anything is awaited, because Telegram only
   * lets a link leave its browser from inside a tap.
   */
  async connect(): Promise<void> {
    if (this._publicKey || this._connecting) return;
    if (this.restore()) return;
    this._connecting = true;
    let ui: WalletStepUi | null = null;
    try {
      const b = this.requireBridge();
      const dapp = newDappKeys();
      const relayId = newRelayId();
      store.set(PENDING_KEY(this.provider), { relayId, dapp, at: Date.now() } satisfies PendingConnect);
      const url = connectUrl({ provider: this.provider, dappPublicKey: dapp.publicKey, redirect: redirectUrl(b.siteUrl, this.provider, relayId, b.back()), appUrl: b.siteUrl });
      b.openLink(url);
      ui = b.begin({ provider: this.provider, kind: "connect", url, opened: true });
      this.openSlot(relayId);
      const answer = await this.collect(relayId, RELAY_WAIT_MS, ui.cancelled);
      this.adopt(this.read(() => readConnect(this.provider, dapp, answer)));
      ui.end("ok");
    } catch (err) {
      store.del(PENDING_KEY(this.provider));
      const flow = this.flowError(err);
      ui?.end(flow.code === "timeout" ? "timeout" : "error");
      const e = new WalletConnectionError(flow.message, flow);
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
      if (typeof out.signature !== "string" || !out.signature) throw new DeepLinkFlowError("unreadable", this.say("unreadable"));
      return out.signature;
    } catch (err) {
      throw this.fail(err, (m, c) => new WalletSendTransactionError(m, c));
    }
  }

  async signTransaction<T extends Transaction | VersionedTransaction>(transaction: T): Promise<T> {
    try {
      const out = await this.request<{ transaction?: unknown }>("signTransaction", { transaction: serialize(transaction) });
      if (typeof out.transaction !== "string") throw new DeepLinkFlowError("unreadable", this.say("unreadable"));
      return deserialize(out.transaction, transaction);
    } catch (err) {
      throw this.fail(err, (m, c) => new WalletSignTransactionError(m, c));
    }
  }

  async signAllTransactions<T extends Transaction | VersionedTransaction>(transactions: T[]): Promise<T[]> {
    try {
      const out = await this.request<{ transactions?: unknown }>("signAllTransactions", { transactions: transactions.map(serialize) });
      if (!Array.isArray(out.transactions) || out.transactions.length !== transactions.length) throw new DeepLinkFlowError("unreadable", this.say("unreadable"));
      return out.transactions.map((raw, i) => deserialize(String(raw), transactions[i]));
    } catch (err) {
      throw this.fail(err, (m, c) => new WalletSignTransactionError(m, c));
    }
  }

  async signMessage(message: Uint8Array): Promise<Uint8Array> {
    try {
      const out = await this.request<{ signature?: unknown }>("signMessage", { message: bs58.encode(message), display: "utf8" });
      if (typeof out.signature !== "string") throw new DeepLinkFlowError("unreadable", this.say("unreadable"));
      return bs58.decode(out.signature);
    } catch (err) {
      throw this.fail(err, (m, c) => new WalletSignMessageError(m, c));
    }
  }

  /**
   * PANDA's sign-in message, for the Mini App's own sign-in. `open: "now"` opens the wallet at once — call it straight
   * from a tap; `"auto"` tries without one (right after connecting). The request is written down (not the session), so
   * if Telegram restarts the app on the way back, resumeLogin() still finds the signature.
   */
  async signLogin(message: Uint8Array, nonce: string, open: "now" | "auto"): Promise<Uint8Array> {
    try {
      const out = await this.request<{ signature?: unknown }>(
        "signMessage",
        { message: bs58.encode(message), display: "utf8" },
        { kind: "login", open, onRelay: (relayId) => store.set(LOGIN_KEY(this.provider), { relayId, nonce, at: Date.now() } satisfies PendingLogin) }
      );
      if (typeof out.signature !== "string") throw new DeepLinkFlowError("unreadable", this.say("unreadable"));
      return bs58.decode(out.signature);
    } catch (err) {
      throw this.fail(err, (m, c) => new WalletSignMessageError(m, c));
    } finally {
      store.del(LOGIN_KEY(this.provider));
    }
  }

  /** A sign-in that was in the wallet when the app was restarted: its signature and the challenge it answers, or null. */
  async resumeLogin(): Promise<{ nonce: string; signature: Uint8Array } | null> {
    const pending = store.get<PendingLogin>(LOGIN_KEY(this.provider));
    if (!pending) return null;
    store.del(LOGIN_KEY(this.provider));
    if (Date.now() - pending.at > PENDING_MAX_AGE_MS) return null;
    if (!this._session && !this.restore()) return null;
    const session = this._session;
    if (!session) return null;
    try {
      const answer = await this.collect(pending.relayId, 20_000, () => false);
      const out = readResult<{ signature?: unknown }>(session, answer);
      return typeof out.signature === "string" ? { nonce: pending.nonce, signature: bs58.decode(out.signature) } : null;
    } catch {
      return null;
    }
  }

  // ── plumbing ────────────────────────────────────────────────────────────────────────────────────
  private say(code: FlowCode): string {
    return deepLinkBridge()?.text(code) ?? code;
  }

  private requireBridge(): DeepLinkBridge {
    const bridge = deepLinkBridge();
    if (!bridge || !bridge.signedIn()) throw new DeepLinkFlowError("outside", this.say("outside"));
    return bridge;
  }

  /** Any failure, as one the Mini App can say in its own language. The words "rejected" stay in a refusal: the website's own panels look for them. */
  private flowError(err: unknown): DeepLinkFlowError {
    if (err instanceof DeepLinkFlowError) return err;
    if (err instanceof DeepLinkError) return new DeepLinkFlowError(err.rejected ? "rejected" : "unreadable", err.rejected ? `${this.say("rejected")} (User rejected the request.)` : this.say("unreadable"));
    return new DeepLinkFlowError("start", err instanceof Error && err.message ? err.message : this.say("start"));
  }

  private fail<E extends Error>(err: unknown, wrap: (message: string, cause: unknown) => E): Error {
    if (err instanceof WalletNotConnectedError) return err;
    const flow = this.flowError(err);
    const e = wrap(flow.message, flow);
    this.emit("error", e as never);
    return e;
  }

  private read<T>(decode: () => T): T {
    try {
      return decode();
    } catch (err) {
      throw this.flowError(err instanceof DeepLinkError ? err : new DeepLinkError("unreadable", "unreadable"));
    }
  }

  /** A signature: the sheet first (its button opens the wallet, inside that tap), then the wait for the answer. */
  private async request<T>(method: DeepLinkMethod, body: Record<string, unknown>, o: RequestOptions = {}): Promise<T> {
    const session = this._session;
    if (!session) throw new WalletNotConnectedError();
    const b = this.requireBridge();
    const relayId = newRelayId();
    const url = requestUrl(session, method, body, redirectUrl(b.siteUrl, this.provider, relayId, b.back()));
    o.onRelay?.(relayId);
    // Inside a tap the wallet opens before anything is awaited (Telegram allows it nowhere else).
    const open = o.open ?? "sheet";
    if (open !== "sheet") b.openLink(url);
    this.openSlot(relayId);
    const ui = b.begin({ provider: this.provider, kind: o.kind ?? "sign", url, opened: open !== "sheet", auto: open === "auto" });
    try {
      await ui.ready;
      const answer = await this.collect(relayId, RELAY_WAIT_MS, ui.cancelled);
      const out = this.read(() => readResult<T>(session, answer));
      ui.end("ok");
      return out;
    } catch (err) {
      const flow = this.flowError(err);
      ui.end(flow.code === "timeout" ? "timeout" : "error");
      throw flow;
    }
  }

  /**
   * Tells the relay which Telegram account this slot belongs to. Best effort and never awaited: the wallet may open (and
   * freeze this page) before it is sent, and the relay accepts the wallet's answer either way.
   */
  private openSlot(id: string): void {
    deepLinkBridge()?.api("/api/tg/relay", { method: "POST", body: { id }, keepalive: true }).catch(() => undefined);
  }

  /** Asks the relay every couple of seconds until the wallet's answer is there (the user is in the wallet app meanwhile). */
  private async collect(relayId: string, timeoutMs: number, cancelled: () => boolean): Promise<Record<string, string>> {
    const b = this.requireBridge();
    const started = Date.now();
    while (Date.now() - started < timeoutMs) {
      await sleep(RELAY_POLL_MS);
      if (cancelled()) throw new DeepLinkFlowError("rejected", `${this.say("rejected")} (cancelled)`);
      let res: Response;
      try {
        res = await b.api(`/api/tg/relay?id=${relayId}`);
      } catch {
        continue; // offline for a moment while the phone switches apps
      }
      if (res.status === 401) throw new DeepLinkFlowError("session", this.say("session"));
      if (!res.ok) continue;
      const data = (await res.json().catch(() => null)) as { answer?: Record<string, string> } | null;
      if (data?.answer) return data.answer;
    }
    throw new DeepLinkFlowError("timeout", this.say("timeout"));
  }
}

function serialize(tx: Transaction | VersionedTransaction): string {
  return bs58.encode(isVersionedTransaction(tx) ? tx.serialize() : tx.serialize({ requireAllSignatures: false, verifySignatures: false }));
}

function deserialize<T extends Transaction | VersionedTransaction>(raw: string, like: T): T {
  const bytes = bs58.decode(raw);
  return (isVersionedTransaction(like) ? VersionedTransaction.deserialize(bytes) : Transaction.from(bytes)) as T;
}


export { DeepLinkFlowError, DEEPLINK_WALLET_NAMES, deepLinkProviders, setDeepLinkBridge, type DeepLinkBridge, type FlowCode, type WalletStep, type WalletStepUi } from "./bridge";
