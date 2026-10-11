"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import Logo from "@/components/Logo";
import { useLanguage } from "@/lib/i18n/LanguageProvider";
import type { DictKey } from "@/lib/i18n/translations";
import { setDeepLinkBridge } from "@/lib/wallet/deeplink/adapter";

/**
 * The Telegram Mini App's frame (docs/TELEGRAM.md §12): it loads Telegram's own script, signs in with Telegram's signed
 * `initData` (checked on the server — nothing here is trusted), takes Telegram's colours, and gives every screen the
 * same three things: who is signed in, a `fetch` that carries the session, and a way to open a link outside Telegram.
 */

type TgWebApp = {
  initData: string;
  colorScheme?: "light" | "dark";
  themeParams?: Record<string, string | undefined>;
  ready: () => void;
  expand: () => void;
  openLink: (url: string, options?: { try_instant_view?: boolean }) => void;
  openTelegramLink?: (url: string) => void;
  onEvent?: (event: string, cb: () => void) => void;
  offEvent?: (event: string, cb: () => void) => void;
  setHeaderColor?: (color: string) => void;
  setBackgroundColor?: (color: string) => void;
  BackButton?: { show: () => void; hide: () => void; onClick: (cb: () => void) => void; offClick: (cb: () => void) => void };
};

const TG_SCRIPT = "https://telegram.org/js/telegram-web-app.js";
const webApp = (): TgWebApp | null => (window as unknown as { Telegram?: { WebApp?: TgWebApp } }).Telegram?.WebApp ?? null;

type Status = "loading" | "ready" | "outside" | "expired" | "error";
type Session = { token: string; wallet: string | null };

export type TgContext = {
  status: Status;
  /** The wallet this Telegram account linked with /link (PANDA's own record), or null. */
  wallet: string | null;
  botUsername: string | null;
  /** fetch with the session; signs in again once if the session ran out. */
  api: (path: string, init?: { method?: string; body?: unknown }) => Promise<Response>;
  /** Opens a link in the phone's browser (outside Telegram's in-app one). */
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

export default function TgShell({ children, botUsername }: { children: React.ReactNode; botUsername: string | null }) {
  const { t, setLang } = useLanguage();
  const pathname = usePathname();
  const router = useRouter();
  const [status, setStatus] = useState<Status>("loading");
  const [wallet, setWallet] = useState<string | null>(null);
  const session = useRef<Session | null>(null);
  const signingIn = useRef<Promise<boolean> | null>(null);

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

  const openExternal = useCallback((url: string) => {
    const tg = webApp();
    if (tg?.openLink) tg.openLink(url);
    else window.open(url, "_blank", "noopener,noreferrer");
  }, []);

  const api = useCallback<TgContext["api"]>(
    async (path, init) => {
      const call = () =>
        fetch(path, {
          method: init?.method ?? "GET",
          cache: "no-store",
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

  // Start: Telegram's script, its colours, then the sign-in. The wallet adapters get their bridge to the session here.
  useEffect(() => {
    let undoTheme: (() => void) | null = null;
    let cancelled = false;
    setDeepLinkBridge({ token: () => session.current?.token ?? null, openLink: openExternal, siteUrl: window.location.origin });
    loadScript().then(() => {
      if (cancelled) return;
      const tg = webApp();
      if (tg) {
        try {
          tg.ready();
          tg.expand();
        } catch {}
        undoTheme = applyTheme(tg);
        const onTheme = () => {
          undoTheme?.();
          undoTheme = applyTheme(tg);
        };
        tg.onEvent?.("themeChanged", onTheme);
      }
      signIn();
    });
    return () => {
      cancelled = true;
      undoTheme?.();
      setDeepLinkBridge(null);
    };
  }, [signIn, openExternal]);

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

  const value = useMemo<TgContext>(() => ({ status, wallet, botUsername, api, openExternal, refreshWallet }), [status, wallet, botUsername, api, openExternal, refreshWallet]);
  const botUrl = botUsername ? `https://t.me/${botUsername}` : null;

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
          <button type="button" onClick={() => openExternal(window.location.origin + (pathname.startsWith("/tg/coin/") ? pathname.slice(3) : "/"))} className="min-h-9 rounded-full border border-paper/15 px-3 text-xs font-semibold text-paper/80">
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
      </div>
    </Ctx.Provider>
  );
}
