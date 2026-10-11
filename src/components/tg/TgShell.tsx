"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import Logo from "@/components/Logo";
import { useLanguage } from "@/lib/i18n/LanguageProvider";
import type { DictKey } from "@/lib/i18n/translations";
import { setDeepLinkBridge, type FlowCode, type WalletStep, type WalletStepUi } from "@/lib/wallet/deeplink/adapter";
import { PROVIDERS } from "@/lib/wallet/deeplink/protocol";

/**
 * The Telegram Mini App's frame (docs/TELEGRAM.md §12): it loads Telegram's own script, signs in with Telegram's signed
 * `initData` (checked on the server — nothing here is trusted), takes Telegram's colours, and gives every screen the
 * same things: who is signed in, a `fetch` that carries the session, a way to open a link outside Telegram, and the
 * sheet shown while the user's wallet app is asked to connect or sign.
 */

type TgWebApp = {
  initData: string;
  initDataUnsafe?: { start_param?: string };
  platform?: string;
  colorScheme?: "light" | "dark";
  themeParams?: Record<string, string | undefined>;
  ready: () => void;
  expand: () => void;
  openLink: (url: string, options?: { try_instant_view?: boolean }) => void;
  onEvent?: (event: string, cb: () => void) => void;
  offEvent?: (event: string, cb: () => void) => void;
  setHeaderColor?: (color: string) => void;
  setBackgroundColor?: (color: string) => void;
  BackButton?: { show: () => void; hide: () => void; onClick: (cb: () => void) => void; offClick: (cb: () => void) => void };
};

const TG_SCRIPT = "https://telegram.org/js/telegram-web-app.js";
const webApp = (): TgWebApp | null => (window as unknown as { Telegram?: { WebApp?: TgWebApp } }).Telegram?.WebApp ?? null;

/** Only Telegram's phone apps can hand over to a wallet app; on a computer (Telegram Desktop, Telegram Web) there is none to open. */
export const isPhonePlatform = (platform: string | undefined | null) => /^(android|android_x|ios)$/.test(platform ?? "");
/** "c_<coin address>": the coin the bot's link brings the user back to after the wallet. */
export const coinOfStartParam = (v: string | undefined | null) => /^c_([1-9A-HJ-NP-Za-km-z]{32,44})$/.exec(v ?? "")?.[1] ?? null;

type Status = "loading" | "ready" | "outside" | "expired" | "error";
type Session = { token: string; wallet: string | null };

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
  const [wallet, setWallet] = useState<string | null>(null);
  const [phone, setPhone] = useState(false);
  const [sheet, setSheet] = useState<Sheet | null>(null);
  const session = useRef<Session | null>(null);
  const signingIn = useRef<Promise<boolean> | null>(null);
  // The latest translator and path, for the wallet bridge (which lives outside React).
  const tRef = useRef(t);
  const pathRef = useRef(pathname);
  useEffect(() => {
    tRef.current = t;
    pathRef.current = pathname;
  }, [t, pathname]);

  const signIn = useCallback((): Promise<boolean> => {
    if (signingIn.current) return signingIn.current;
    const run = (async () => {
      await loadScript();
      const tg = webApp();
      if (!tg || !tg.initData) {
        setStatus("outside");
        return false;
      }
      try {
        const res = await fetch("/api/tg/session", { method: "POST", cache: "no-store", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ initData: tg.initData }) });
        const data = (await res.json().catch(() => null)) as { token?: string; wallet?: string | null; lang?: string; code?: string } | null;
        if (!res.ok || !data?.token) {
          setStatus(data?.code === "expired" ? "expired" : "error");
          return false;
        }
        session.current = { token: data.token, wallet: data.wallet ?? null };
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

  // Start: Telegram's script, its colours, then the sign-in. The wallet adapters get their bridge to the session here.
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
      back: () => /^\/tg\/coin\/([1-9A-HJ-NP-Za-km-z]{32,44})$/.exec(pathRef.current)?.[1] ?? null,
    });
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
      }
      signIn().then((ok) => {
        // Back from the wallet through the bot's link: straight to the coin the user was on.
        const coin = ok && !cancelled ? coinOfStartParam(tg?.initDataUnsafe?.start_param) : null;
        if (coin && pathRef.current === "/tg") router.replace(`/tg/coin/${coin}`);
      });
    });
    return () => {
      cancelled = true;
      undoTheme?.();
      setDeepLinkBridge(null);
    };
  }, [signIn, openExternal, api, begin, router]);

  // Telegram's own back arrow, on every screen below the first.
  const deep = pathname !== "/tg";
  useEffect(() => {
    const back = webApp()?.BackButton;
    if (!back || status !== "ready") return;
    const go = () => router.back();
    if (deep) {
      back.show();
      back.onClick(go);
    } else back.hide();
    return () => back.offClick(go);
  }, [deep, router, status]);

  const value = useMemo<TgContext>(() => ({ status, wallet, botUsername, phone, api, openExternal, refreshWallet }), [status, wallet, botUsername, phone, api, openExternal, refreshWallet]);
  const botUrl = botUsername ? `https://t.me/${botUsername}` : null;
  const openWeb = () => openExternal(window.location.origin + webAddressOf(pathname));
  const walletName = sheet ? PROVIDERS[sheet.step.provider].label : "";

  return (
    <Ctx.Provider value={value}>
      <div className="mx-auto flex min-h-[100dvh] w-full max-w-xl flex-col bg-ink text-paper">
        <header className="flex items-center justify-between gap-3 px-4 pb-2 pt-3">
          <Link href="/tg" className="flex items-center gap-2" aria-label="PANDA">
            {/* The logo is drawn for a dark page: it keeps its own dark disc when Telegram's theme is light. */}
            <span className="flex h-8 w-8 items-center justify-center overflow-hidden rounded-full bg-black">
              <Logo size={26} />
            </span>
            <span className="font-display text-base font-bold tracking-tight">PANDA</span>
          </Link>
          <button type="button" onClick={openWeb} className="min-h-9 rounded-full border border-paper/15 px-3 text-xs font-semibold text-paper/80">
            {t("tg.wallet.browser")}
          </button>
        </header>

        <div className="flex-1 px-4 pb-24">
          {status === "ready" ? (
            children
          ) : status === "loading" ? (
            <p className="py-16 text-center text-sm text-panda-grey" role="status">
              {t("tg.loading")}
            </p>
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
        </div>

        {status === "ready" && (
          <nav className="fixed inset-x-0 bottom-0 z-30 border-t border-paper/10 bg-ink/95 pb-[env(safe-area-inset-bottom)] backdrop-blur" aria-label="PANDA">
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
          <div className="fixed inset-0 z-[90] flex items-end justify-center bg-black/70 p-3" role="dialog" aria-modal="true" aria-labelledby="tg-wallet-sheet">
            <div className="w-full max-w-md rounded-3xl border border-paper/10 bg-ink-raised p-5 pb-[calc(env(safe-area-inset-bottom)+1.25rem)] shadow-2xl">
              <h2 id="tg-wallet-sheet" className="font-display text-lg font-bold">
                {t(sheet.phase === "timeout" ? "tg.sheet.timeoutTitle" : sheet.step.kind === "connect" ? "tg.sheet.connectTitle" : "tg.sheet.signTitle", { wallet: walletName })}
              </h2>
              <p className="mt-1.5 text-sm leading-relaxed text-paper/80" role="status">
                {t(sheet.phase === "timeout" ? "tg.err.timeout" : sheet.phase === "ask" ? "tg.sheet.ask" : "tg.sheet.waiting", { wallet: walletName })}
              </p>
              <div className="mt-4 grid gap-2">
                {sheet.phase !== "timeout" && (
                  <button type="button" onClick={sheet.open} className={`w-full rounded-xl py-3 text-sm font-bold ${sheet.phase === "ask" ? "bg-bamboo text-ink" : "border border-paper/15 text-paper/80"}`}>
                    {t(sheet.phase === "ask" ? "tg.sheet.open" : "tg.sheet.openAgain", { wallet: walletName })}
                  </button>
                )}
                {sheet.phase === "timeout" && (
                  <button type="button" onClick={openWeb} className="w-full rounded-xl bg-paper py-3 text-sm font-bold text-ink">
                    {t("tg.wallet.browser")}
                  </button>
                )}
                <button type="button" onClick={sheet.cancel} className="w-full rounded-xl py-2.5 text-sm font-semibold text-panda-grey">
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
