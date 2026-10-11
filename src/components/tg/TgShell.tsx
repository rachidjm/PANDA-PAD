"use client";

import { createContext, lazy, Suspense, useCallback, useContext, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import type { WalletName } from "@solana/wallet-adapter-base";
import bs58 from "bs58";
import Logo from "@/components/Logo";
import { setSessionDelegate } from "@/lib/auth/session-delegate";
import { truncateAddress } from "@/lib/format";
import { useLanguage } from "@/lib/i18n/LanguageProvider";
import type { DictKey } from "@/lib/i18n/translations";
import type { DeepLinkWalletAdapter } from "@/lib/wallet/deeplink/adapter";
import { DEEPLINK_WALLET_NAMES, deepLinkProviders, hasPendingLogin, setDeepLinkBridge, type FlowCode, type WalletStep, type WalletStepUi } from "@/lib/wallet/deeplink/bridge";
import { PROVIDERS, type DeepLinkProvider } from "@/lib/wallet/deeplink/protocol";
import { FIRST_LISTS, isListPath, refresh } from "./cache";
import { ScreenSkeleton } from "./TgSkeleton";
import type { WalletKit } from "./TgWalletRoot";
import { appSession, endWalletTrip, installSessionFetch, inWalletTrip, startWalletTrip, takeTicket, type AppSession } from "./session";

/**
 * The Telegram Mini App's frame (docs/TELEGRAM.md §12): it loads Telegram's own script, signs in with Telegram's signed
 * `initData` (checked on the server — nothing here is trusted), takes Telegram's colours, and gives every screen the
 * same things: who is signed in, a `fetch` that carries the session, a way to open a link outside Telegram, and the
 * sheet shown while the user's wallet app is asked to connect or sign.
 *
 * Two sessions, on purpose. Telegram's (who this Telegram account is) is enough to look around, keep a watchlist and
 * set alerts. PANDA's (./session.ts) is the wallet's: the first screen asks for it — "Connect and sign in" — and from
 * then on buying, selling, Draw Your Trade, orders and creating a coin never ask again while the app stays open.
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
type LoginChallenge = { nonce: string; message: string; expiresAt: number };
/** A sign-in message fetched ahead of time, while it still has time left to be signed. */
const usable = (c: LoginChallenge | null) => (c && c.expiresAt - Date.now() > 30_000 ? c : null);
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
  refreshWallet: () => Promise<void>;
  /** Signed in to PANDA with the linked wallet, for this opening of the app. */
  authed: boolean;
  /** From "just looking": shows the sign-in screen. */
  askLogin: () => void;
  /** Ends the session (here and on the server) and forgets the wallet connection. */
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
  { href: "/tg/watchlist", label: "tg.nav.watchlist", icon: "m12 3 2.7 5.6 6.1.8-4.5 4.3 1.1 6.1L12 16.9 6.6 19.8l1.1-6.1L3.2 9.4l6.1-.8L12 3Z" },
  { href: "/tg/alerts", label: "tg.nav.alerts", icon: "M12 3a6 6 0 0 0-6 6v3.6L4.3 16a1 1 0 0 0 .9 1.5h13.6a1 1 0 0 0 .9-1.5L18 12.6V9a6 6 0 0 0-6-6Zm-2 16a2 2 0 0 0 4 0h-4Z" },
];

const FLOW_TEXT: Record<FlowCode, DictKey> = { start: "tg.err.start", session: "tg.err.session", timeout: "tg.err.timeout", rejected: "tg.err.rejected", unreadable: "tg.err.unreadable", outside: "tg.err.outside" };

/** The wallet step on screen: ask (its button opens the wallet), waiting, or given up after two minutes. */
type Sheet = { step: WalletStep; phase: "ask" | "waiting" | "timeout"; open: () => void; cancel: () => void };

/** The address of the page on the website that matches this screen of the Mini App (a coin opens with Draw Your Trade). */
export const webAddressOf = (pathname: string) => (pathname.startsWith("/tg/coin/") ? `${pathname.slice(3)}?draw=1` : "/");

export default function TgShell({ children, botUsername }: { children: React.ReactNode; botUsername: string | null }) {
  const { t, setLang } = useLanguage();
  const pathname = usePathname();
  const router = useRouter();
  const [status, setStatus] = useState<Status>("loading");
  /** True until the start has also looked for a session to pick up again (back from the wallet after a restart). */
  const [booting, setBooting] = useState(true);
  const [wallet, setWallet] = useState<string | null>(null);
  const [phone, setPhone] = useState(false);
  const [sheet, setSheet] = useState<Sheet | null>(null);
  const [browse, setBrowse] = useState(false);
  const [login, setLogin] = useState<{ busy: boolean; error: string | null }>({ busy: false, error: null });
  const authed = useSyncExternalStore(appSession.subscribe, () => !!appSession.get(), () => false);
  const session = useRef<Session | null>(null);
  const signingIn = useRef<Promise<boolean> | null>(null);
  const usedEarly = useRef(false);
  const challenge = useRef<LoginChallenge | null>(null);
  const lastHidden = useRef(0);
  // The latest translator, path and wallets, for what lives outside React (the wallet bridge, the start).
  const tRef = useRef(t);
  const pathRef = useRef(pathname);
  // The wallets, once their code has arrived (TgWalletRoot hands them over).
  const [kit, setKit] = useState<WalletKit | null>(null);
  const kitRef = useRef<WalletKit | null>(null);
  const kitWaiters = useRef<((k: WalletKit) => void)[]>([]);
  const onKit = useCallback((k: WalletKit | null) => {
    kitRef.current = k;
    setKit(k);
    if (k) kitWaiters.current.splice(0).forEach((w) => w(k));
  }, []);
  useEffect(() => {
    tRef.current = t;
    pathRef.current = pathname;
  }, [t, pathname]);

  const signIn = useCallback((): Promise<boolean> => {
    if (signingIn.current) return signingIn.current;
    const run = (async () => {
      type Answer = { token?: string; wallet?: string | null; lang?: string; code?: string } | null;
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

  const refreshWallet = useCallback(async () => {
    const res = await api("/api/tg/session");
    if (!res.ok) return;
    const data = (await res.json().catch(() => null)) as { wallet?: string | null } | null;
    setWallet(data?.wallet ?? null);
  }, [api]);

  // ── PANDA's session (src/components/tg/session.ts): in memory, for this opening of the app ───────────────────────
  /** The sign-in message for the linked wallet, asked for ahead of time so the tap on the button can open the wallet at once. */
  const fetchChallenge = useCallback(async (): Promise<LoginChallenge | null> => {
    try {
      const res = await api("/api/tg/login", { method: "POST" });
      const data = (await res.json().catch(() => null)) as (Partial<LoginChallenge> & { code?: string }) | null;
      if (res.ok && data?.nonce && data.message && data.expiresAt) return (challenge.current = { nonce: data.nonce, message: data.message, expiresAt: data.expiresAt });
      if (data?.code === "not_linked") setWallet(null);
    } catch {}
    return (challenge.current = null);
  }, [api]);

  const finishLogin = useCallback(
    async (nonce: string, signature: Uint8Array) => {
      const res = await api("/api/tg/login", { method: "PUT", body: { nonce, signature: bs58.encode(signature) } });
      const data = (await res.json().catch(() => null)) as Partial<AppSession> | null;
      if (!res.ok || !data?.token || !data.jti || !data.resume || !data.wallet || !data.expiresAt) throw new Error(tRef.current("tg.login.failed"));
      appSession.set({ token: data.token, jti: data.jti, resume: data.resume, wallet: data.wallet, expiresAt: data.expiresAt });
    },
    [api]
  );

  /** The session ends here and on the server. Leaving the app (not for the wallet) does this; so does "Sign out". */
  const closeSession = useCallback(() => {
    const s = appSession.get();
    if (!s) return;
    fetch("/api/tg/login", { method: "DELETE", keepalive: true, cache: "no-store", headers: appSession.headers() }).catch(() => undefined);
    appSession.set(null);
    setBrowse(false);
  }, []);

  /**
   * "Connect and sign in": straight from the tap. With the wallet already connected in this phone it is ONE trip — the
   * wallet opens on the sign-in message. The first time it is two: connecting, and then the message, which opens by
   * itself when the user is back (and offers its button if Telegram didn't let it).
   */
  function startLogin(p: DeepLinkProvider) {
    if (login.busy || !wallet || !kit) return;
    const name = DEEPLINK_WALLET_NAMES[p] as WalletName;
    const adapter = kit.wallets.find((w) => w.adapter.name === name)?.adapter as DeepLinkWalletAdapter | undefined;
    if (!adapter) return;
    const linked = wallet;
    const ready = usable(challenge.current);
    challenge.current = null;
    setLogin({ busy: true, error: null });
    const run = (async () => {
      let open: "now" | "auto" = "now";
      if (!adapter.restoreSaved()) {
        await adapter.connect(); // opens the wallet before anything is awaited
        open = "auto";
      }
      if (adapter.publicKey?.toBase58() !== linked) {
        await adapter.disconnect();
        throw new Error(tRef.current("tg.wallet.mismatch", { address: truncateAddress(linked) }));
      }
      let c = ready;
      if (!c) {
        c = await fetchChallenge();
        challenge.current = null;
        open = "auto";
      }
      if (!c) throw new Error(tRef.current("tg.login.failed"));
      const signature = await adapter.signLogin(new TextEncoder().encode(c.message), c.nonce, open);
      await finishLogin(c.nonce, signature);
    })();
    kit.select(name);
    run.then(
      () => setLogin({ busy: false, error: null }),
      (e: unknown) => {
        setLogin({ busy: false, error: cleanError(e instanceof Error && e.message ? e.message : tRef.current("tg.login.failed")) });
        fetchChallenge();
      }
    );
  }

  const logout = useCallback(() => {
    closeSession();
    kitRef.current?.disconnect().catch(() => undefined);
  }, [closeSession]);
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
      if (step.opened) {
        startWalletTrip();
        resolveReady();
      }
      // A rejection nobody is waiting for yet must not surface as an unhandled one.
      ready.catch(() => undefined);
      const open = () => {
        startWalletTrip();
        openExternal(step.url); // inside the tap on the sheet's button
        resolveReady();
        setSheet((s) => (s && s.step === step ? { ...s, phase: "waiting" } : s));
      };
      const cancel = () => {
        cancelled = true;
        endWalletTrip();
        rejectReady(new Error(`${tRef.current("tg.err.rejected")} (cancelled)`));
        setSheet((s) => (s && s.step === step ? null : s));
      };
      setSheet({ step, phase: step.opened ? "waiting" : "ask", open, cancel });
      if (step.auto) {
        // Opened without a tap: if the app is still on screen a moment later, Telegram ignored it — offer the button.
        const at = Date.now();
        setTimeout(() => {
          if (cancelled || lastHidden.current >= at || document.visibilityState !== "visible") return;
          setSheet((s) => (s && s.step === step && s.phase === "waiting" ? { ...s, phase: "ask" } : s));
        }, 1600);
      }
      return {
        ready,
        cancelled: () => cancelled,
        end: (outcome) => {
          endWalletTrip();
          setSheet((s) => (s && s.step === step ? (outcome === "timeout" ? { ...s, phase: "timeout" } : null) : s));
        },
      };
    },
    [openExternal]
  );

  // Start: Telegram's script, its colours and safe areas, the Telegram sign-in — and a PANDA session to pick up again,
  // if this start is the way back from the wallet. The wallet adapters get their bridge to all of it here.
  useEffect(() => {
    let undoTheme: (() => void) | null = null;
    let cancelled = false;
    setDeepLinkBridge({
      api,
      signedIn: () => !!session.current?.token,
      openLink: (url) => {
        startWalletTrip();
        openExternal(url);
      },
      siteUrl: window.location.origin,
      text: (code) => tRef.current(FLOW_TEXT[code]),
      begin,
      back: () => /^\/tg\/coin\/([1-9A-HJ-NP-Za-km-z]{32,44})$/.exec(pathRef.current)?.[1] ?? null,
    });
    const undoFetch = installSessionFetch();
    // "Make sure there is a session", asked by the website's own panels: here it is the app's, or the sign-in screen.
    setSessionDelegate(async (w) => {
      if (appSession.get()?.wallet === w) return;
      setBrowse(false);
      throw new Error(tRef.current("tg.login.needed"));
    });

    /** Back from the wallet after Telegram restarted the app: the same session (its one-time ticket), or a sign-in whose signature is waiting. */
    const pickUp = async () => {
      const ticket = takeTicket();
      if (ticket) {
        const res = await api("/api/tg/login", { method: "PATCH", body: ticket }).catch(() => null);
        const data = res?.ok ? ((await res.json().catch(() => null)) as Partial<AppSession> | null) : null;
        if (data?.token && data.jti && data.resume && data.wallet && data.expiresAt) return appSession.set({ token: data.token, jti: data.jti, resume: data.resume, wallet: data.wallet, expiresAt: data.expiresAt });
      }
      // Only when a sign-in was in the wallet: that needs the wallet code, so the start waits for it (not otherwise).
      if (!hasPendingLogin()) return;
      const k = kitRef.current ?? (await Promise.race([new Promise<WalletKit>((resolve) => kitWaiters.current.push(resolve)), new Promise<null>((resolve) => setTimeout(() => resolve(null), 20_000))]));
      for (const w of k?.wallets ?? []) {
        const adapter = w.adapter as Partial<DeepLinkWalletAdapter> & { name: WalletName };
        const found = await adapter.resumeLogin?.();
        if (!found) continue;
        await finishLogin(found.nonce, found.signature).catch(() => undefined);
        if (appSession.get()) k?.select(adapter.name);
        return;
      }
    };

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
      started.then(async (ok) => {
        if (ok) {
          // A website cookie left in this browser never stands in for the app's session.
          for (const key of FIRST_LISTS) refresh(api, key); // the first lists, on their way before any screen asks
          fetch("/api/auth/logout", { method: "POST" }).catch(() => undefined);
          await pickUp().catch(() => undefined);
        }
        if (cancelled) return;
        setBooting(false);
        // Back from the wallet through the bot's link: straight to the coin the user was on.
        const coin = ok ? coinOfStartParam(tg?.initDataUnsafe?.start_param) : null;
        if (coin && pathRef.current === "/tg") router.replace(`/tg/coin/${coin}`);
      });
    });
    return () => {
      cancelled = true;
      undoTheme?.();
      undoFetch();
      setSessionDelegate(null);
      setDeepLinkBridge(null);
    };
  }, [signIn, openExternal, api, begin, router, finishLogin]);

  // Leaving the app — closing it, or leaving Telegram — ends the session, here and on the server. Stepping out to the
  // wallet app to sign is not leaving: the session is still there on the way back.
  useEffect(() => {
    const left = () => {
      lastHidden.current = Date.now();
      if (!inWalletTrip()) closeSession();
    };
    const onVisibility = () => {
      if (document.visibilityState === "hidden") left();
    };
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("pagehide", left);
    return () => {
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("pagehide", left);
    };
  }, [closeSession]);

  const gate = status === "ready" && !booting && !authed && !browse;
  // The sign-in message is fetched while the sign-in screen is up (and again before it gets old): the tap then opens the wallet with no wait.
  useEffect(() => {
    if (!gate || !wallet || !phone) return;
    Promise.resolve().then(fetchChallenge);
    const id = setInterval(fetchChallenge, 4 * 60_000);
    return () => clearInterval(id);
  }, [gate, wallet, phone, fetchChallenge]);

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
  const sheetTitle: DictKey = !sheet ? "tg.sheet.signTitle" : sheet.phase === "timeout" ? "tg.sheet.timeoutTitle" : sheet.step.kind === "connect" ? "tg.sheet.connectTitle" : sheet.step.kind === "login" ? "tg.sheet.loginTitle" : "tg.sheet.signTitle";
  const sheetText: DictKey = !sheet ? "tg.sheet.ask" : sheet.phase === "timeout" ? "tg.err.timeout" : sheet.step.kind === "login" ? (sheet.phase === "ask" ? "tg.sheet.loginAsk" : "tg.sheet.loginWaiting") : sheet.phase === "ask" ? "tg.sheet.ask" : "tg.sheet.waiting";
  const primary = "flex min-h-12 w-full items-center justify-center rounded-xl px-4 text-sm font-bold disabled:opacity-50";
  const ghost = "flex min-h-12 w-full items-center justify-center rounded-xl border border-paper/15 px-4 text-sm font-semibold text-paper/80";

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
              {!phone ? (
                <>
                  <p className="mt-3 text-sm leading-relaxed text-paper/80">{t("tg.login.desktop")}</p>
                  <div className="mt-5 grid gap-2">
                    <button type="button" onClick={openWeb} className={`${primary} bg-paper text-ink`}>
                      {t("tg.wallet.browser")}
                    </button>
                  </div>
                </>
              ) : !wallet ? (
                <>
                  <p className="mt-3 text-sm leading-relaxed text-paper/80">{t("tg.login.link1")}</p>
                  <p className="mt-1.5 text-sm leading-relaxed text-paper/80">{t("tg.login.link2")}</p>
                  <div className="mt-5 grid gap-2">
                    {botUsername && (
                      <a href={`https://t.me/${botUsername}?start=link`} className={`${primary} bg-bamboo text-ink`}>
                        {t("tg.wallet.linkButton")}
                      </a>
                    )}
                    <button type="button" onClick={() => refreshWallet()} className={ghost}>
                      {t("tg.wallet.linkedCheck")}
                    </button>
                  </div>
                </>
              ) : (
                <>
                  <p className="mt-3 text-sm leading-relaxed text-paper/80">{t("tg.login.body")}</p>
                  <p className="mt-2 text-xs text-panda-grey">{t("tg.wallet.linked", { address: truncateAddress(wallet) })}</p>
                  <div className="mt-5 grid gap-2">
                    {deepLinkProviders.map((p, i) => (
                      <button key={p} type="button" onClick={() => startLogin(p)} disabled={login.busy || !kit} className={`${primary} ${i === 0 ? "bg-bamboo text-ink" : "bg-paper text-ink"}`}>
                        {login.busy ? t("tg.login.working") : t("tg.login.button", { wallet: PROVIDERS[p].label })}
                      </button>
                    ))}
                  </div>
                  {login.error && (
                    <p className="mt-3 text-xs leading-snug text-clay-red" role="alert">
                      {login.error}
                    </p>
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
                      signIn();
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
              screen, with nothing in it, so the wallets are ready for the tap on "Connect and sign in". */}
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
      </div>
    </Ctx.Provider>
  );
}
