"use client";

import { createContext, lazy, Suspense, useCallback, useContext, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import Logo from "@/components/Logo";
import { setSessionDelegate } from "@/lib/auth/session-delegate";
import { truncateAddress } from "@/lib/format";
import { useLanguage } from "@/lib/i18n/LanguageProvider";
import type { DictKey } from "@/lib/i18n/translations";
import type { DeepLinkWalletAdapter } from "@/lib/wallet/deeplink/adapter";
import { DEEPLINK_WALLET_NAMES, setDeepLinkBridge, type FlowCode, type WalletStep, type WalletStepUi } from "@/lib/wallet/deeplink/bridge";
import { clearOp, readOp, relayOfStartParam, type PendingOp } from "@/lib/wallet/deeplink/ops";
import { PROVIDERS } from "@/lib/wallet/deeplink/protocol";
import { FIRST_LISTS, isListPath, refresh } from "./cache";
import { ScreenSkeleton } from "./TgSkeleton";
import type { WalletKit } from "./TgWalletRoot";
import { takePendingLaunch } from "./launch";
import { completeOp, type Resumed, type WalletAnswer } from "./resume";
import { appSession, installSessionFetch, type AppSession } from "./session";

/**
 * The Telegram Mini App's frame (docs/TELEGRAM.md §12): it loads Telegram's own script, signs in with Telegram's signed
 * `initData` (checked on the server — nothing here is trusted), takes Telegram's colours, and gives every screen the
 * same things: who is signed in, a `fetch` that carries the session, a way to open a link outside Telegram, and the
 * sheet shown while the user's wallet app is asked to connect or sign.
 *
 * Two sessions, on purpose. Telegram's (who this Telegram account is) is enough to look around, keep a watchlist and
 * set alerts. PANDA's (./session.ts, src/lib/telegram/app-login.ts) says which wallet that account acts as — the one
 * it linked with /link. Signing in is one tap and asks the wallet for nothing; it lasts 30 minutes from its last use,
 * wherever the user went meanwhile. It moves no money: every operation is still signed in the user's own wallet app.
 */

type TgWebApp = {
  initData: string;
  initDataUnsafe?: { start_param?: string };
  platform?: string;
  colorScheme?: "light" | "dark";
  themeParams?: Record<string, string | undefined>;
  safeAreaInset?: Partial<Record<Edge, number>>;
  contentSafeAreaInset?: Partial<Record<Edge, number>>;
  ready: () => void;
  expand: () => void;
  openLink: (url: string, options?: { try_instant_view?: boolean }) => void;
  onEvent?: (event: string, cb: () => void) => void;
  offEvent?: (event: string, cb: () => void) => void;
  setHeaderColor?: (color: string) => void;
  setBackgroundColor?: (color: string) => void;
  BackButton?: { show: () => void; hide: () => void; onClick: (cb: () => void) => void; offClick: (cb: () => void) => void };
};

type Edge = "top" | "bottom" | "left" | "right";
const EDGES: Edge[] = ["top", "bottom", "left", "right"];
const SAFE_EVENTS = ["safeAreaChanged", "contentSafeAreaChanged", "fullscreenChanged", "viewportChanged"];

/**
 * Telegram's safe areas onto the page (globals.css adds them to the phone's own as --safe-top / --safe-bottom): the
 * phone's notch and home bar, and — when the app is full screen — the strip where Telegram draws its own "Close" and
 * "..." buttons. Telegram's script publishes the same variables; they are written here too so the page never depends on
 * which version of that script arrived, and again on every change (rotation, full screen on or off).
 */
export function applySafeAreas(tg: Pick<TgWebApp, "safeAreaInset" | "contentSafeAreaInset">, root: { style: { setProperty: (name: string, value: string) => void } }): void {
  const px = (v: unknown) => `${typeof v === "number" && Number.isFinite(v) && v > 0 ? Math.min(Math.round(v), 200) : 0}px`;
  for (const e of EDGES) {
    root.style.setProperty(`--tg-safe-area-inset-${e}`, px(tg.safeAreaInset?.[e]));
    root.style.setProperty(`--tg-content-safe-area-inset-${e}`, px(tg.contentSafeAreaInset?.[e]));
  }
}

// The wallet libraries are the heavy part of the app. They are downloaded once the first screen is already on the
// phone (the start asks for them right away, in the background) and every other screen is rendered inside them.
const loadWalletRoot = () => import("./TgWalletRoot");
const TgWalletRoot = lazy(loadWalletRoot);

/** What the page's first lines already started while the rest of the app was still downloading (src/app/tg/layout.tsx). */
type EarlyBoot = { initData: string; session: Promise<{ ok: boolean; data: unknown } | null> };
const earlyBoot = (): EarlyBoot | null => (window as unknown as { __tgBoot?: EarlyBoot }).__tgBoot ?? null;

const TG_SCRIPT = "https://telegram.org/js/telegram-web-app.js";
const webApp = (): TgWebApp | null => (window as unknown as { Telegram?: { WebApp?: TgWebApp } }).Telegram?.WebApp ?? null;

/** Only Telegram's phone apps can hand over to a wallet app; on a computer (Telegram Desktop, Telegram Web) there is none to open. */
export const isPhonePlatform = (platform: string | undefined | null) => /^(android|android_x|ios)$/.test(platform ?? "");
/** "c_<coin address>": the coin the bot's link brings the user back to after the wallet. */
export const coinOfStartParam = (v: string | undefined | null) => /^c_([1-9A-HJ-NP-Za-km-z]{32,44})$/.exec(v ?? "")?.[1] ?? null;

type Status = "loading" | "ready" | "outside" | "expired" | "error";
type Session = { token: string; wallet: string | null };
/** The adapter keeps an English marker at the end of a refusal for the website's own panels; the Mini App doesn't show it. */
export const cleanError = (message: string) => message.replace(/\s*\((?:cancelled|User rejected the request\.)\)$/, "");

export type TgContext = {
  status: Status;
  /** The wallet this Telegram account linked with /link (PANDA's own record), or null. */
  wallet: string | null;
  botUsername: string | null;
  /** True on Telegram's phone apps: the only place a wallet app can be opened from. */
  phone: boolean;
  /** fetch with the session; signs in again once if the session ran out. */
  api: (path: string, init?: { method?: string; body?: unknown; keepalive?: boolean }) => Promise<Response>;
  /** Opens a link in the phone's browser (outside Telegram's in-app one). Call it from a tap. */
  openExternal: (url: string) => void;
  refreshWallet: () => Promise<string | null | undefined>;
  /** Signed in to PANDA as the linked wallet (a session on the server: 30 minutes from its last use). */
  authed: boolean;
  /** From "just looking": shows the sign-in screen. */
  askLogin: () => void;
  /** "Sign out": ends the session on the server. */
  logout: () => void;
};

const Ctx = createContext<TgContext | null>(null);
export function useTg(): TgContext {
  const v = useContext(Ctx);
  if (!v) throw new Error("useTg must be used inside the Mini App shell");
  return v;
}

const HEX = /^#[0-9a-fA-F]{6}$/;
/** Telegram's colours onto the site's own variables: every existing component follows without knowing. */
function applyTheme(tg: TgWebApp): () => void {
  const p = tg.themeParams ?? {};
  const map: [string, string | undefined][] = [
    ["--ink", p.bg_color],
    ["--ink-raised", p.secondary_bg_color],
    ["--paper", p.text_color],
    ["--panda-grey", p.hint_color],
  ];
  const root = document.documentElement;
  const set: string[] = [];
  for (const [name, value] of map) {
    if (!value || !HEX.test(value)) continue;
    root.style.setProperty(name, value);
    set.push(name);
  }
  const scheme = tg.colorScheme === "light" ? "light" : "dark";
  // The site's accents are made for a dark page: on Telegram's light theme the chart's line and the green and yellow
  // texts would almost vanish, so they get darker versions of themselves.
  if (scheme === "light") {
    for (const [name, value] of [["--bamboo", "#4d7c0f"], ["--sun", "#a16207"], ["--clay-red", "#c2410c"], ["--meme-orange", "#c2410c"]] as const) {
      root.style.setProperty(name, value);
      set.push(name);
    }
  }
  root.style.colorScheme = scheme;
  root.dataset.tgScheme = scheme;
  if (p.bg_color && HEX.test(p.bg_color)) {
    try {
      tg.setHeaderColor?.(p.bg_color);
      tg.setBackgroundColor?.(p.bg_color);
    } catch {}
  }
  return () => {
    for (const name of set) root.style.removeProperty(name);
    root.style.removeProperty("color-scheme");
    delete root.dataset.tgScheme;
  };
}

function loadScript(): Promise<void> {
  return new Promise((resolve) => {
    if (webApp()) return resolve();
    const existing = document.querySelector<HTMLScriptElement>(`script[src="${TG_SCRIPT}"]`);
    const el = existing ?? document.createElement("script");
    el.addEventListener("load", () => resolve());
    el.addEventListener("error", () => resolve());
    if (!existing) {
      el.src = TG_SCRIPT;
      el.async = true;
      document.head.appendChild(el);
    }
    // Never hang the app on a script that doesn't arrive.
    setTimeout(resolve, 6000);
  });
}

const NAV: { href: string; label: DictKey; icon: string }[] = [
  { href: "/tg", label: "tg.nav.explore", icon: "M11 4a7 7 0 1 0 4.2 12.6l3.6 3.6 1.4-1.4-3.6-3.6A7 7 0 0 0 11 4Zm0 2a5 5 0 1 1 0 10 5 5 0 0 1 0-10Z" },
  { href: "/tg/create", label: "tg.nav.create", icon: "M11 5h2v6h6v2h-6v6h-2v-6H5v-2h6V5Z" },
  { href: "/tg/watchlist", label: "tg.nav.watchlist", icon: "m12 3 2.7 5.6 6.1.8-4.5 4.3 1.1 6.1L12 16.9 6.6 19.8l1.1-6.1L3.2 9.4l6.1-.8L12 3Z" },
  { href: "/tg/alerts", label: "tg.nav.alerts", icon: "M12 3a6 6 0 0 0-6 6v3.6L4.3 16a1 1 0 0 0 .9 1.5h13.6a1 1 0 0 0 .9-1.5L18 12.6V9a6 6 0 0 0-6-6Zm-2 16a2 2 0 0 0 4 0h-4Z" },
];

const FLOW_TEXT: Record<FlowCode, DictKey> = { start: "tg.err.start", session: "tg.err.session", timeout: "tg.err.timeout", rejected: "tg.err.rejected", unreadable: "tg.err.unreadable", outside: "tg.err.outside" };

/** The wallet step on screen: ask (its button opens the wallet), waiting, or given up after two minutes. */
type Sheet = { step: WalletStep; phase: "ask" | "waiting" | "timeout"; open: () => void; cancel: () => void };

/** The address of the page on the website that matches this screen of the Mini App (a coin opens with Draw Your Trade). */
export const webAddressOf = (pathname: string) => (pathname.startsWith("/tg/coin/") ? `${pathname.slice(3)}?draw=1` : pathname === "/tg/create" ? "/create" : "/");

type SessionAnswer = { active?: boolean; wallet?: string | null; expiresAt?: number | null; code?: string } | null;
/** What the server says about PANDA's session, taken as it is. */
const adopt = (data: SessionAnswer) => appSession.set(data?.active && data.wallet && data.expiresAt ? { wallet: data.wallet, expiresAt: data.expiresAt } : null);

export default function TgShell({ children, botUsername }: { children: React.ReactNode; botUsername: string | null }) {
  const { t, setLang } = useLanguage();
  const pathname = usePathname();
  const router = useRouter();
  const [status, setStatus] = useState<Status>("loading");
  /** True until the start has also looked for something to pick up again (the way back from the wallet). */
  const [booting, setBooting] = useState(true);
  const [wallet, setWallet] = useState<string | null>(null);
  const [phone, setPhone] = useState(false);
  const [sheet, setSheet] = useState<Sheet | null>(null);
  const [browse, setBrowse] = useState(false);
  const [login, setLogin] = useState<{ busy: boolean; error: string | null }>({ busy: false, error: null });
  /** Linking a wallet from the first screen: idle, the link page is being opened, or the app is waiting for the link to be made. */
  const [linking, setLinking] = useState<{ phase: "idle" | "opening" | "waiting" | "checking"; note: string | null }>({ phase: "idle", note: null });
  const linkUrl = useRef<{ url: string; expiresAt: number } | null>(null);
  const [resumed, setResumed] = useState<Resumed | null>(null);
  const authed = useSyncExternalStore(appSession.subscribe, () => !!appSession.get(), () => false);
  const session = useRef<Session | null>(null);
  const signingIn = useRef<Promise<boolean> | null>(null);
  const loggingIn = useRef(false);
  const signedInOnce = useRef(false);
  const usedEarly = useRef(false);
  // The latest translator and path, for what lives outside React (the wallet bridge, the start).
  const tRef = useRef(t);
  const pathRef = useRef(pathname);
  // The wallets, once their code has arrived (TgWalletRoot hands them over).
  const kitRef = useRef<WalletKit | null>(null);
  const kitWaiters = useRef<((k: WalletKit) => void)[]>([]);
  const onKit = useCallback((k: WalletKit | null) => {
    kitRef.current = k;
    if (k) kitWaiters.current.splice(0).forEach((w) => w(k));
  }, []);
  useEffect(() => {
    tRef.current = t;
    pathRef.current = pathname;
  }, [t, pathname]);

  const signIn = useCallback((): Promise<boolean> => {
    if (signingIn.current) return signingIn.current;
    const run = (async () => {
      type Answer = { token?: string; wallet?: string | null; lang?: string; code?: string; app?: AppSession | null } | null;
      // Used once: the request the page's first lines sent while the app was still downloading.
      const early = usedEarly.current ? null : earlyBoot();
      usedEarly.current = true;
      let initData = early?.initData ?? "";
      let answer = early ? await early.session : null;
      if (!answer?.ok) {
        await loadScript();
        const tg = webApp();
        if (!tg || !tg.initData) {
          setStatus("outside");
          return false;
        }
        initData = tg.initData;
        answer = null;
      }
      try {
        let res: { ok: boolean; data: unknown } | null = answer;
        if (!res) {
          const r = await fetch("/api/tg/session", { method: "POST", cache: "no-store", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ initData }) });
          res = { ok: r.ok, data: (await r.json().catch(() => null)) as unknown };
        }
        const data = res.data as Answer;
        if (!res.ok || !data?.token) {
          setStatus(data?.code === "expired" ? "expired" : "error");
          return false;
        }
        session.current = { token: data.token, wallet: data.wallet ?? null };
        appSession.setInitData(initData);
        // PANDA's own session, when this account has a live one: it is on the server, so it is still there after a reload.
        appSession.set(data.app?.wallet ? { wallet: data.app.wallet, expiresAt: data.app.expiresAt } : null);
        setWallet(data.wallet ?? null);
        if (data.lang === "es" || data.lang === "en") setLang(data.lang);
        setStatus("ready");
        return true;
      } catch {
        setStatus("error");
        return false;
      }
    })();
    signingIn.current = run;
    run.finally(() => {
      signingIn.current = null;
    });
    return run;
  }, [setLang]);

  /** Telegram's official way out of its own browser (Telegram.WebApp.openLink). It only works inside a tap. */
  const openExternal = useCallback((url: string) => {
    const tg = webApp();
    if (tg?.openLink) tg.openLink(url, { try_instant_view: false });
    else window.open(url, "_blank", "noopener,noreferrer");
  }, []);

  const api = useCallback<TgContext["api"]>(
    async (path, init) => {
      const call = () =>
        fetch(path, {
          method: init?.method ?? "GET",
          cache: "no-store",
          keepalive: init?.keepalive,
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${session.current?.token ?? ""}` },
          ...(init?.body !== undefined ? { body: JSON.stringify(init.body) } : {}),
        });
      let res = await call();
      if (res.status === 401 && (await signIn())) res = await call();
      return res;
    },
    [signIn]
  );

  /** The wallet linked to this Telegram account, asked from the server. `undefined`: the server couldn't be asked. */
  const refreshWallet = useCallback(async (): Promise<string | null | undefined> => {
    try {
      const res = await api("/api/tg/session");
      if (!res.ok) return undefined;
      const data = (await res.json().catch(() => null)) as { wallet?: string | null } | null;
      const w = data?.wallet ?? null;
      setWallet(w);
      return w;
    } catch {
      return undefined;
    }
  }, [api]);

  // ── PANDA's session (src/lib/telegram/app-login.ts): on the server, 30 minutes from its last use ──────────────────

  /**
   * "Sign in": one tap, nothing to approve in the wallet. Telegram has already proven whose account this is, and the
   * wallet is the one that account linked. (Every operation with money is still signed in the wallet app.)
   */
  const startLogin = useCallback(async (): Promise<boolean> => {
    if (loggingIn.current) return false;
    loggingIn.current = true;
    setLogin({ busy: true, error: null });
    try {
      const res = await api("/api/tg/login", { method: "POST" });
      const data = (await res.json().catch(() => null)) as SessionAnswer;
      if (data?.code === "not_linked") setWallet(null);
      if (!res.ok || !data?.active) throw new Error("failed");
      adopt(data);
      setLogin({ busy: false, error: null });
      return true;
    } catch {
      setLogin({ busy: false, error: tRef.current("tg.login.failed") });
      return false;
    } finally {
      loggingIn.current = false;
    }
  }, [api]);

  // ── linking a wallet, from the first screen (no message is sent to the bot) ───────────────────────────────────────
  /** The one-time link to the page where the wallet signs the link — the same one the bot's /link gives. Kept while it is valid: asking twice makes one link. */
  const fetchLink = useCallback(async (): Promise<{ url: string } | { error: string }> => {
    const have = linkUrl.current;
    if (have && have.expiresAt - Date.now() > 60_000) return have;
    try {
      const res = await api("/api/tg/link", { method: "POST" });
      const data = (await res.json().catch(() => null)) as { url?: string; expiresAt?: number; code?: string; minutes?: number } | null;
      if (res.ok && data?.url && data.expiresAt) {
        linkUrl.current = { url: data.url, expiresAt: data.expiresAt };
        return { url: data.url };
      }
      return { error: data?.code === "rate" ? tRef.current("tg.login.linkRate", { minutes: data.minutes ?? 10 }) : tRef.current("tg.login.linkFailed") };
    } catch {
      return { error: tRef.current("tg.login.linkFailed") };
    }
  }, [api]);

  /**
   * "Link my wallet": opens the link page with Telegram's own way of opening links. The link was asked for when this
   * screen appeared, so the tap opens it at once; from then on the app asks the server every few seconds and signs in
   * by itself the moment the wallet is linked.
   */
  function openLinkPage() {
    const ready = linkUrl.current && linkUrl.current.expiresAt - Date.now() > 60_000 ? linkUrl.current : null;
    if (ready) {
      openExternal(ready.url);
      return setLinking({ phase: "waiting", note: null });
    }
    setLinking({ phase: "opening", note: null });
    fetchLink().then((r) => {
      if ("error" in r) return setLinking({ phase: "idle", note: r.error });
      openExternal(r.url);
      setLinking({ phase: "waiting", note: null });
    });
  }

  /** "I've linked it · check": asks the server now. Linked: signed in at once. Not linked: says so. */
  async function checkLinked() {
    setLinking((l) => ({ phase: "checking", note: l.note }));
    const w = await refreshWallet();
    if (w) {
      setLinking({ phase: "idle", note: null });
      await startLogin();
    } else setLinking({ phase: "waiting", note: t(w === null ? "tg.login.linkNone" : "tg.unavailable") });
  }

  /** Is the session still live? Asked when the app comes back to the screen (30 minutes may have gone by) and from time to time. */
  const checkSession = useCallback(async () => {
    if (!session.current || !appSession.get()) return;
    try {
      const res = await api("/api/tg/login");
      if (!res.ok) return; // not being able to ask is not being signed out
      const data = (await res.json().catch(() => null)) as SessionAnswer;
      if (data) adopt(data);
    } catch {}
  }, [api]);

  const logout = useCallback(() => {
    api("/api/tg/login", { method: "DELETE" }).catch(() => undefined);
    appSession.set(null);
    setBrowse(false);
  }, [api]);
  const askLogin = useCallback(() => setBrowse(false), []);

  /** The sheet of a wallet step, as the wallet adapter drives it. */
  const begin = useCallback(
    (step: WalletStep): WalletStepUi => {
      let cancelled = false;
      let resolveReady: () => void = () => {};
      let rejectReady: (e: Error) => void = () => {};
      const ready = new Promise<void>((resolve, reject) => {
        resolveReady = resolve;
        rejectReady = reject;
      });
      if (step.opened) resolveReady();
      // A rejection nobody is waiting for yet must not surface as an unhandled one.
      ready.catch(() => undefined);
      const open = () => {
        openExternal(step.url); // inside the tap on the sheet's button
        resolveReady();
        setSheet((s) => (s && s.step === step ? { ...s, phase: "waiting" } : s));
      };
      const cancel = () => {
        cancelled = true;
        rejectReady(new Error(`${tRef.current("tg.err.rejected")} (cancelled)`));
        setSheet((s) => (s && s.step === step ? null : s));
      };
      setSheet({ step, phase: step.opened ? "waiting" : "ask", open, cancel });
      return {
        ready,
        cancelled: () => cancelled,
        end: (outcome) => setSheet((s) => (s && s.step === step ? (outcome === "timeout" ? { ...s, phase: "timeout" } : null) : s)),
      };
    },
    [openExternal]
  );

  /**
   * Telegram opened this copy of the app on the way back from the wallet (its link carried the request's one-time
   * code). The copy that asked may be gone, so this one finishes what it started: same screen, and the calls the
   * request left written down (src/lib/wallet/deeplink/ops.ts).
   */
  const finishOp = useCallback(
    async (op: PendingOp, quiet: boolean) => {
      if (op.method === "connect") return; // the wallet adapter picks its own pending connection up (autoConnect)
      if (op.settled) {
        clearOp(op.relayId);
        return void setResumed(op.settled.ok ? { phase: op.settled.signature ? "sent" : "done", signature: op.settled.signature } : null);
      }
      // `quiet`: nothing says the wallet answered (the app was simply opened again). It is looked for briefly and
      // without a word; only an answer that is really there is shown and finished.
      if (!quiet) setResumed({ phase: "working" });
      try {
        const kit = kitRef.current ?? (await Promise.race([new Promise<WalletKit>((resolve) => kitWaiters.current.push(resolve)), new Promise<null>((resolve) => setTimeout(() => resolve(null), 25_000))]));
        const name = DEEPLINK_WALLET_NAMES[op.provider];
        const adapter = kit?.wallets.find((w) => w.adapter.name === name)?.adapter as DeepLinkWalletAdapter | undefined;
        if (!adapter) throw new Error(tRef.current("tg.err.start"));
        const answer = await adapter.resumeAnswer<WalletAnswer>(op.relayId, quiet ? 5_000 : 30_000);
        setResumed({ phase: "working" });
        const outcome = await completeOp(op, answer, fetch.bind(window));
        clearOp(op.relayId);
        setResumed(outcome);
      } catch (err) {
        if (quiet) return; // nothing there (yet): the note stays for its few minutes, and nothing is said
        clearOp(op.relayId);
        setResumed({ phase: "error", message: cleanError(err instanceof Error && err.message ? err.message : tRef.current("tg.resume.error")) });
      }
    },
    []
  );

  /**
   * What follows Telegram's sign-in, ONCE — whether it worked at the start or after "Try again": the first lists, and
   * whatever a wallet request left to finish (this start may be the way back from the wallet).
   */
  const afterSignIn = useCallback(() => {
    if (signedInOnce.current) return;
    signedInOnce.current = true;
    for (const key of FIRST_LISTS) refresh(api, key); // the first lists, on their way before any screen asks
    // A website cookie left in this browser never stands in for the app's session.
    fetch("/api/auth/logout", { method: "POST" }).catch(() => undefined);
    const start = webApp()?.initDataUnsafe?.start_param;
    const op = readOp();
    const code = relayOfStartParam(start);
    if (op && code && op.relayId === code) {
      // Opened through a link that carries the request's own code: the wallet answered.
      if (op.path !== pathRef.current) router.replace(op.path);
      finishOp(op, false);
    } else if (op && op.method !== "connect") {
      // The app was started again while a request was in the wallet (Telegram reloaded it): same screen, and if the
      // wallet's answer is there, the operation is finished here.
      if (op.path !== pathRef.current) router.replace(op.path);
      finishOp(op, true);
    } else {
      const coin = coinOfStartParam(start);
      if (coin && pathRef.current === "/tg") router.replace(`/tg/coin/${coin}`);
      // A coin that was being created when Telegram restarted the app: if it was launched, it is recorded now and opened.
      else
        takePendingLaunch(api)
          .then((mint) => mint && router.replace(`/tg/coin/${mint}`))
          .catch(() => undefined);
    }
  }, [api, router, finishOp]);

  // Start: Telegram's script, its colours and safe areas, the Telegram sign-in (which also says whether PANDA's own
  // session is live) — and, if this start is the way back from the wallet, what that request left to finish.
  useEffect(() => {
    let undoTheme: (() => void) | null = null;
    let cancelled = false;
    setDeepLinkBridge({
      api,
      signedIn: () => !!session.current?.token,
      openLink: openExternal,
      siteUrl: window.location.origin,
      text: (code) => tRef.current(FLOW_TEXT[code]),
      begin,
      path: () => pathRef.current,
    });
    const undoFetch = installSessionFetch();
    // "Make sure there is a session", asked by the website's own panels: here it is the app's, or the sign-in screen.
    setSessionDelegate(async (w) => {
      if (appSession.get()?.wallet === w) return;
      setBrowse(false);
      throw new Error(tRef.current("tg.login.needed"));
    });

    loadWalletRoot().catch(() => undefined); // in the background, from the very start
    const started = signIn();
    loadScript().then(() => {
      if (cancelled) return;
      const tg = webApp();
      if (tg) {
        try {
          tg.ready();
          tg.expand();
        } catch {}
        setPhone(isPhonePlatform(tg.platform));
        undoTheme = applyTheme(tg);
        const onTheme = () => {
          undoTheme?.();
          undoTheme = applyTheme(tg);
        };
        tg.onEvent?.("themeChanged", onTheme);
        const onSafe = () => applySafeAreas(tg, document.documentElement);
        onSafe();
        for (const e of SAFE_EVENTS) tg.onEvent?.(e, onSafe);
      }
      started.then((ok) => {
        if (cancelled) return;
        if (ok) afterSignIn();
        setBooting(false);
      });
    });
    return () => {
      cancelled = true;
      undoTheme?.();
      undoFetch();
      setSessionDelegate(null);
      setDeepLinkBridge(null);
    };
  }, [signIn, openExternal, api, begin, afterSignIn]);

  // The session lasts 30 minutes from its last use, wherever the user went meanwhile. Coming back to the app (or
  // staying on it for long) asks whether it is still live — which is itself a use.
  useEffect(() => {
    const onVisibility = () => {
      if (document.visibilityState === "visible") checkSession();
    };
    document.addEventListener("visibilitychange", onVisibility);
    const id = setInterval(() => document.visibilityState === "visible" && checkSession(), 5 * 60_000);
    return () => {
      document.removeEventListener("visibilitychange", onVisibility);
      clearInterval(id);
    };
  }, [checkSession]);

  const gate = status === "ready" && !booting && !authed && !browse && !resumed;

  // The first screen with no wallet linked: the link is asked for ahead of the tap, and the server is asked every few
  // seconds whether the wallet has been linked meanwhile (on the link page, in the browser) — then the app signs in
  // by itself, with nothing more to press.
  const unlinked = gate && !wallet;
  useEffect(() => {
    if (!unlinked) return;
    Promise.resolve().then(fetchLink);
    let busy = false;
    const look = async () => {
      if (busy || document.visibilityState !== "visible") return;
      busy = true;
      try {
        if (await refreshWallet()) await startLogin();
      } finally {
        busy = false;
      }
    };
    const id = setInterval(look, 4_000);
    document.addEventListener("visibilitychange", look);
    return () => {
      clearInterval(id);
      document.removeEventListener("visibilitychange", look);
    };
  }, [unlinked, fetchLink, refreshWallet, startLogin]);

  // Telegram's own back arrow, on every screen below the first.
  const deep = pathname !== "/tg";
  useEffect(() => {
    const back = webApp()?.BackButton;
    if (!back || status !== "ready") return;
    const go = () => router.back();
    if (deep && !gate) {
      back.show();
      back.onClick(go);
    } else back.hide();
    return () => back.offClick(go);
  }, [deep, gate, router, status]);

  const value = useMemo<TgContext>(
    () => ({ status, wallet, botUsername, phone, api, openExternal, refreshWallet, authed, askLogin, logout }),
    [status, wallet, botUsername, phone, api, openExternal, refreshWallet, authed, askLogin, logout]
  );
  const botUrl = botUsername ? `https://t.me/${botUsername}` : null;
  const openWeb = () => openExternal(window.location.origin + webAddressOf(pathname));
  const walletName = sheet ? PROVIDERS[sheet.step.provider].label : "";
  const sheetTitle: DictKey = !sheet ? "tg.sheet.signTitle" : sheet.phase === "timeout" ? "tg.sheet.timeoutTitle" : sheet.step.kind === "connect" ? "tg.sheet.connectTitle" : "tg.sheet.signTitle";
  const sheetText: DictKey = !sheet ? "tg.sheet.ask" : sheet.phase === "timeout" ? "tg.err.timeout" : sheet.phase === "ask" ? "tg.sheet.ask" : "tg.sheet.waiting";
  const primary = "flex min-h-12 w-full items-center justify-center rounded-xl px-4 text-sm font-bold disabled:opacity-50";
  const ghost = "flex min-h-12 w-full items-center justify-center rounded-xl border border-paper/15 px-4 text-sm font-semibold text-paper/80";
  const resumedTitle: DictKey = !resumed ? "tg.resume.working" : resumed.phase === "working" ? "tg.resume.working" : resumed.phase === "sent" ? "tg.resume.sent" : resumed.phase === "done" ? "tg.resume.done" : resumed.phase === "repeat" ? "tg.resume.repeatTitle" : "tg.resume.errorTitle";

  return (
    <Ctx.Provider value={value}>
      {/* Nothing under Telegram's own buttons or the phone's edges: the frame starts below --safe-top and ends above --safe-bottom. */}
      <div className="mx-auto flex min-h-[100dvh] w-full max-w-xl flex-col bg-ink pl-[var(--safe-left)] pr-[var(--safe-right)] pt-[var(--safe-top)] text-paper">
        <header className="flex items-center justify-between gap-3 px-4 pb-2 pt-2">
          <Link href="/tg" className="flex min-h-11 items-center gap-2" aria-label="PANDA">
            {/* The logo is drawn for a dark page: it keeps its own dark disc when Telegram's theme is light. */}
            <span className="flex h-8 w-8 items-center justify-center overflow-hidden rounded-full bg-black">
              <Logo size={26} />
            </span>
            <span className="font-display text-base font-bold tracking-tight">PANDA</span>
          </Link>
          <button type="button" onClick={openWeb} className="min-h-11 rounded-full border border-paper/15 px-4 text-xs font-semibold text-paper/80">
            {t("tg.wallet.browser")}
          </button>
        </header>

        <div className="flex-1 px-4 pb-[calc(var(--safe-bottom)+6rem)]">
          {gate ? (
            <div className="mx-auto max-w-sm pb-4 pt-6 text-center">
              <h1 className="font-display text-2xl font-bold leading-tight">{t("tg.login.title")}</h1>
              {!wallet ? (
                <>
                  <p className="mt-3 text-sm leading-relaxed text-paper/80">{t("tg.login.link1")}</p>
                  <p className="mt-1.5 text-sm leading-relaxed text-paper/80">{t("tg.login.link2")}</p>
                  <div className="mt-5 grid gap-2">
                    {/* A button, not a link to the bot: it opens the link page itself, and sends the bot nothing. */}
                    <button type="button" onClick={openLinkPage} disabled={linking.phase === "opening"} className={`${primary} bg-bamboo text-ink`}>
                      {t(linking.phase === "opening" ? "tg.login.linkOpening" : "tg.wallet.linkButton")}
                    </button>
                    <button type="button" onClick={checkLinked} disabled={linking.phase === "checking"} className={ghost}>
                      {t(linking.phase === "checking" ? "tg.login.checking" : "tg.wallet.linkedCheck")}
                    </button>
                  </div>
                  {(linking.note || linking.phase === "waiting") && (
                    <p className={`mt-3 text-xs leading-snug ${linking.note ? "text-clay-red" : "text-panda-grey"}`} role="status">
                      {linking.note ?? t("tg.login.linkWaiting")}
                    </p>
                  )}
                </>
              ) : (
                <>
                  <p className="mt-3 text-sm leading-relaxed text-paper/80">{t("tg.login.body")}</p>
                  <p className="mt-2 text-xs text-panda-grey">{t("tg.wallet.linked", { address: truncateAddress(wallet) })}</p>
                  <div className="mt-5 grid gap-2">
                    <button type="button" onClick={() => startLogin()} disabled={login.busy} className={`${primary} bg-bamboo text-ink`}>
                      {login.busy ? t("tg.login.working") : t("tg.login.button")}
                    </button>
                  </div>
                  {login.error && (
                    <div className="mt-3" role="alert">
                      <p className="text-xs leading-snug text-clay-red">{login.error}</p>
                      <button type="button" onClick={openWeb} className={`${ghost} mt-2`}>
                        {t("tg.wallet.browser")}
                      </button>
                    </div>
                  )}
                  <p className="mt-3 text-[11px] leading-snug text-panda-grey">{t("tg.login.closes")}</p>
                </>
              )}
              <button type="button" onClick={() => setBrowse(true)} className="mt-4 min-h-12 w-full rounded-xl text-sm font-semibold text-paper/80 underline underline-offset-4">
                {t("tg.login.browse")}
              </button>
              <p className="mt-1 text-[11px] leading-snug text-panda-grey">{t("tg.login.browseNote")}</p>
            </div>
          ) : status === "loading" || status === "ready" ? (
            // Something on screen at once: the shape of the screen that is coming.
            booting || status === "loading" ? <ScreenSkeleton /> : null
          ) : (
            <div className="mx-auto max-w-sm py-14 text-center">
              <h1 className="font-display text-xl font-bold">{t(status === "outside" ? "tg.outside.title" : "tg.error.title")}</h1>
              <p className="mt-2 text-sm leading-relaxed text-panda-grey">{t(status === "outside" ? "tg.outside.body" : status === "expired" ? "tg.error.expired" : "tg.error.body")}</p>
              <div className="mt-5 flex flex-col items-center gap-2">
                {status === "outside" && botUrl && (
                  <a href={botUrl} className="inline-flex min-h-11 items-center rounded-full bg-bamboo px-5 text-sm font-bold text-ink">
                    {t("tg.outside.button")}
                  </a>
                )}
                {status !== "outside" && (
                  <button
                    type="button"
                    onClick={() => {
                      setStatus("loading");
                      signIn().then((ok) => ok && afterSignIn());
                    }}
                    className="inline-flex min-h-11 items-center rounded-full bg-paper px-5 text-sm font-bold text-ink"
                  >
                    {t("tg.retry")}
                  </button>
                )}
              </div>
            </div>
          )}
          {/* The wallets and every screen. Mounted as soon as Telegram's sign-in is done — also behind the sign-in
              screen, with nothing in it, so the wallets are already there when a screen needs them. */}
          {status === "ready" && (
            // Until the wallet code is here, the screens that don't need it (the lists) are shown as they are.
            <Suspense fallback={gate || booting ? null : isListPath(pathname) ? children : <ScreenSkeleton />}>
              <TgWalletRoot onKit={onKit}>{gate || booting ? null : children}</TgWalletRoot>
            </Suspense>
          )}
        </div>

        {status === "ready" && !booting && !gate && (
          <nav data-bottom-bar className="fixed inset-x-0 bottom-0 z-30 border-t border-paper/10 bg-ink/95 pb-[calc(var(--safe-bottom)+0.25rem)] pl-[var(--safe-left)] pr-[var(--safe-right)] backdrop-blur" aria-label="PANDA">
            <ul className="mx-auto flex max-w-xl">
              {NAV.map((n) => {
                const active = n.href === "/tg" ? pathname === "/tg" || pathname.startsWith("/tg/coin/") : pathname.startsWith(n.href);
                return (
                  <li key={n.href} className="flex-1">
                    <Link href={n.href} aria-current={active ? "page" : undefined} className={`flex min-h-14 flex-col items-center justify-center gap-0.5 text-[11px] font-semibold ${active ? "text-paper" : "text-panda-grey"}`}>
                      <svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor" aria-hidden>
                        <path d={n.icon} />
                      </svg>
                      {t(n.label)}
                    </Link>
                  </li>
                );
              })}
            </ul>
          </nav>
        )}

        {sheet && (
          <div className="fixed inset-0 z-[90] flex items-end justify-center bg-black/70 p-3 pt-[calc(var(--safe-top)+0.75rem)]" role="dialog" aria-modal="true" aria-labelledby="tg-wallet-sheet">
            <div className="w-full max-w-md rounded-3xl border border-paper/10 bg-ink-raised p-5 pb-[calc(var(--safe-bottom)+1.25rem)] shadow-2xl">
              <h2 id="tg-wallet-sheet" className="font-display text-lg font-bold">
                {t(sheetTitle, { wallet: walletName })}
              </h2>
              <p className="mt-1.5 text-sm leading-relaxed text-paper/80" role="status">
                {t(sheetText, { wallet: walletName })}
              </p>
              <div className="mt-4 grid gap-2">
                {sheet.phase !== "timeout" && (
                  <button type="button" onClick={sheet.open} className={`min-h-12 w-full rounded-xl px-4 text-sm font-bold ${sheet.phase === "ask" ? "bg-bamboo text-ink" : "border border-paper/15 text-paper/80"}`}>
                    {t(sheet.phase === "ask" ? "tg.sheet.open" : "tg.sheet.openAgain", { wallet: walletName })}
                  </button>
                )}
                {sheet.phase === "timeout" && (
                  <button type="button" onClick={openWeb} className="min-h-12 w-full rounded-xl bg-paper px-4 text-sm font-bold text-ink">
                    {t("tg.wallet.browser")}
                  </button>
                )}
                <button type="button" onClick={sheet.cancel} className="min-h-11 w-full rounded-xl py-2.5 text-sm font-semibold text-panda-grey">
                  {t(sheet.phase === "timeout" ? "updates.close" : "tg.sheet.cancel")}
                </button>
              </div>
              {sheet.phase !== "timeout" && <p className="mt-2 text-center text-[11px] leading-snug text-panda-grey">{t("tg.sheet.note")}</p>}
            </div>
          </div>
        )}

        {/* Back from the wallet in a copy of the app that Telegram opened anew: what became of the operation. */}
        {resumed && !sheet && (
          <div className="fixed inset-0 z-[90] flex items-end justify-center bg-black/70 p-3 pt-[calc(var(--safe-top)+0.75rem)]" role="dialog" aria-modal="true" aria-labelledby="tg-resume-sheet">
            <div className="w-full max-w-md rounded-3xl border border-paper/10 bg-ink-raised p-5 pb-[calc(var(--safe-bottom)+1.25rem)] shadow-2xl">
              <h2 id="tg-resume-sheet" className="font-display text-lg font-bold">
                {t(resumedTitle)}
              </h2>
              <p className="mt-1.5 text-sm leading-relaxed text-paper/80" role="status">
                {resumed.phase === "working" ? t("tg.resume.workingBody") : resumed.phase === "sent" ? t("tg.resume.sentBody") : resumed.phase === "done" ? t("tg.resume.doneBody") : resumed.phase === "repeat" ? t("tg.resume.repeatBody") : resumed.message || t("tg.resume.error")}
              </p>
              {resumed.phase !== "working" && (
                <div className="mt-4 grid gap-2">
                  {resumed.phase === "sent" && resumed.signature && (
                    <button type="button" onClick={() => openExternal(`https://solscan.io/tx/${resumed.signature}`)} className={ghost}>
                      {t("cr.viewTx")}
                    </button>
                  )}
                  {(resumed.phase === "error" || resumed.phase === "repeat") && (
                    <button type="button" onClick={openWeb} className={ghost}>
                      {t("tg.wallet.browser")}
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => {
                      setResumed(null);
                      router.refresh();
                    }}
                    className="min-h-12 w-full rounded-xl bg-paper px-4 text-sm font-bold text-ink"
                  >
                    {t("tg.resume.continue")}
                  </button>
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </Ctx.Provider>
  );
}
