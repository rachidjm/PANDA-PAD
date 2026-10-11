"use client";

import { useCallback, useEffect, useState } from "react";
import { useWallet } from "@solana/wallet-adapter-react";
import type { WalletName } from "@solana/wallet-adapter-base";
import CoinAvatar from "@/components/CoinAvatar";
import RugBadge from "@/components/RugBadge";
import PriceChart from "@/components/coin/PriceChart";
import TradingPanel from "@/components/coin/TradingPanel";
import { truncateAddress } from "@/lib/format";
import { useLanguage } from "@/lib/i18n/LanguageProvider";
import type { DictKey } from "@/lib/i18n/translations";
import type { Coin } from "@/lib/types";
import { DEEPLINK_WALLET_NAMES, deepLinkProviders } from "@/lib/wallet/deeplink/adapter";
import { PROVIDERS, type DeepLinkProvider } from "@/lib/wallet/deeplink/protocol";
import { alertText, Change, money, priceLabel, type TgAlert } from "./TgScreens";
import { useTg } from "./TgShell";

/**
 * A coin inside the Mini App: the website's own chart and data, the watchlist and alert controls of the bot, and —
 * with the user's OWN wallet app connected through its official deep links — the website's own trading panel, so
 * fees, recruiters, warnings and routes are exactly the website's.
 */
export default function TgCoin({ coin, holderCount }: { coin: Coin; holderCount: number | null }) {
  const { t } = useLanguage();
  const { openExternal } = useTg();
  const price = coin.livePriceUsd ?? null;
  const stats: [DictKey, React.ReactNode][] = [
    ["tg.price", priceLabel(price)],
    ["tg.mcapLong", money(coin.marketCap)],
    ["tg.liq", money(coin.liquidityUsd ?? null)],
    ["tg.vol", money(coin.volume24h)],
    ["tg.change", <Change key="c" pct={coin.changeWindows?.h24 ?? coin.changePct} />],
    ["tg.holders", holderCount !== null ? holderCount.toLocaleString() : "—"],
  ];
  return (
    <div>
      <div className="flex items-center gap-3">
        <div className="h-12 w-12 shrink-0 overflow-hidden rounded-2xl border border-paper/10 bg-[#171512]">
          <CoinAvatar image={coin.image} ticker={coin.ticker} mint={coin.mint} priority />
        </div>
        <div className="min-w-0 flex-1">
          <h1 className="truncate font-display text-xl font-bold">${coin.ticker}</h1>
          <p className="truncate text-xs text-panda-grey">{coin.name}</p>
        </div>
        <RugBadge mint={coin.mint} variant="pill" />
      </div>

      <dl className="mt-4 grid grid-cols-3 gap-x-3 gap-y-3">
        {stats.map(([label, value]) => (
          <div key={label} className="min-w-0">
            <dt className="truncate text-[11px] text-panda-grey">{t(label)}</dt>
            <dd className="truncate text-sm font-semibold tabular-nums">{value}</dd>
          </div>
        ))}
      </dl>

      <div className="mt-4">
        <PriceChart poolAddress={coin.poolAddress} initialCloses={coin.priceHistory} changePct={coin.changePct} marketCap={coin.marketCap} />
      </div>

      <WatchAndAlert coin={coin} price={price} />
      <Trade coin={coin} />

      <button type="button" onClick={() => openExternal(`${window.location.origin}/coin/${coin.mint}`)} className="mt-4 w-full rounded-xl border border-paper/15 py-3 text-sm font-semibold text-paper/80">
        {t("tg.openWeb")}
      </button>
      <p className="mt-3 text-center text-[11px] text-panda-grey">{t("tg.nfa")}</p>
    </div>
  );
}

function WatchAndAlert({ coin, price }: { coin: Coin; price: number | null }) {
  const { t } = useLanguage();
  const { api } = useTg();
  const [watched, setWatched] = useState<boolean | null>(null);
  const [alerts, setAlerts] = useState<TgAlert[]>([]);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<{ text: string; bad: boolean } | null>(null);
  const [metric, setMetric] = useState<"price" | "mcap">("price");
  const [direction, setDirection] = useState<"above" | "below">("above");
  const [value, setValue] = useState("");

  const load = useCallback(async () => {
    const [w, a] = await Promise.all([api("/api/tg/watchlist"), api("/api/tg/alerts")]);
    const wd = (await w.json().catch(() => null)) as { items?: { mint: string }[] } | null;
    const ad = (await a.json().catch(() => null)) as { alerts?: TgAlert[] } | null;
    if (w.ok && wd?.items) setWatched(wd.items.some((x) => x.mint === coin.mint));
    if (a.ok && ad?.alerts) setAlerts(ad.alerts.filter((x) => x.mint === coin.mint));
  }, [api, coin.mint]);
  useEffect(() => {
    Promise.resolve()
      .then(load)
      .catch(() => {});
  }, [load]);

  async function toggleWatch() {
    setBusy(true);
    setNote(null);
    try {
      const res = await api("/api/tg/watchlist", { method: watched ? "DELETE" : "POST", body: { mint: coin.mint } });
      const data = (await res.json().catch(() => null)) as { code?: string } | null;
      if (res.ok || data?.code === "exists") setWatched(!watched || data?.code === "exists");
      else setNote({ text: t(data?.code === "full" ? "tg.watch.full" : "tg.unavailable"), bad: true });
    } finally {
      setBusy(false);
    }
  }

  async function createAlert() {
    const n = Number(value.replace(",", "."));
    if (!Number.isFinite(n) || n <= 0) return setNote({ text: t("tg.alert.invalid"), bad: true });
    setBusy(true);
    setNote(null);
    try {
      const res = await api("/api/tg/alerts", { method: "POST", body: { mint: coin.mint, metric, direction, value: n } });
      const data = (await res.json().catch(() => null)) as { code?: string } | null;
      if (res.ok) {
        setValue("");
        setNote({ text: t("tg.alert.created"), bad: false });
        await load();
      } else setNote({ text: t(data?.code === "already_true" ? "tg.alert.already" : data?.code === "full" ? "tg.alert.full" : data?.code === "invalid" ? "tg.alert.invalid" : "tg.unavailable"), bad: true });
    } finally {
      setBusy(false);
    }
  }

  async function removeAlert(id: string) {
    setBusy(true);
    try {
      await api("/api/tg/alerts", { method: "DELETE", body: { id } });
      await load();
    } finally {
      setBusy(false);
    }
  }

  const pill = (on: boolean) => `min-h-9 rounded-full px-3 text-xs font-semibold ${on ? "bg-paper text-ink" : "text-panda-grey"}`;
  return (
    <section className="mt-4 rounded-2xl border border-paper/10 bg-ink-raised p-4">
      <button type="button" onClick={toggleWatch} disabled={busy || watched === null} className={`w-full rounded-xl py-3 text-sm font-bold disabled:opacity-50 ${watched ? "border border-paper/15 text-paper/80" : "bg-paper text-ink"}`}>
        {t(watched ? "tg.watch.remove" : "tg.watch.add")}
      </button>

      <h2 className="mt-4 text-sm font-bold">{t("tg.alert.title")}</h2>
      <div className="mt-2 flex flex-wrap gap-2">
        <div className="inline-flex gap-0.5 rounded-full bg-ink p-0.5" role="group" aria-label={t("tg.alert.title")}>
          {(["price", "mcap"] as const).map((m) => (
            <button key={m} type="button" aria-pressed={metric === m} onClick={() => setMetric(m)} className={pill(metric === m)}>
              {t(m === "price" ? "tg.alert.metric.price" : "tg.alert.metric.mcap")}
            </button>
          ))}
        </div>
        <div className="inline-flex gap-0.5 rounded-full bg-ink p-0.5" role="group" aria-label={t("tg.alert.title")}>
          {(["above", "below"] as const).map((d) => (
            <button key={d} type="button" aria-pressed={direction === d} onClick={() => setDirection(d)} className={pill(direction === d)}>
              {t(d === "above" ? "tg.alert.above" : "tg.alert.below")}
            </button>
          ))}
        </div>
      </div>
      <div className="mt-2 flex gap-2">
        <label className="flex min-w-0 flex-1 items-center gap-1.5 rounded-xl border border-paper/15 bg-ink px-3 focus-within:border-paper/40">
          <span className="text-sm text-panda-grey">$</span>
          <input
            value={value}
            onChange={(e) => setValue(e.target.value.replace(/[^0-9.,]/g, "").slice(0, 20))}
            placeholder={metric === "price" ? (price ? String(Number(price.toPrecision(3))) : "0.001") : coin.marketCap > 0 ? String(Math.round(coin.marketCap)) : "100000"}
            inputMode="decimal"
            aria-label={t("tg.alert.value")}
            className="w-full min-w-0 bg-transparent py-2.5 text-sm outline-none placeholder:text-panda-grey"
          />
        </label>
        <button type="button" onClick={createAlert} disabled={busy || !value} className="shrink-0 rounded-xl bg-bamboo px-4 text-sm font-bold text-ink disabled:opacity-40">
          {t("tg.alert.create")}
        </button>
      </div>
      {note && (
        <p className={`mt-2 text-xs ${note.bad ? "text-clay-red" : "text-bamboo"}`} role="status">
          {note.text}
        </p>
      )}
      {alerts.length > 0 && (
        <ul className="mt-3 space-y-1.5">
          {alerts.map((a) => (
            <li key={a.id} className="flex items-center justify-between gap-2 text-xs">
              <span className="min-w-0 truncate text-paper/80">{alertText(a, t)}</span>
              <button type="button" onClick={() => removeAlert(a.id)} disabled={busy} className="min-h-8 shrink-0 px-2 font-semibold text-panda-grey underline underline-offset-2">
                {t("tg.alert.delete")}
              </button>
            </li>
          ))}
        </ul>
      )}
      <p className="mt-3 text-[11px] leading-snug text-panda-grey">{t("tg.alert.note")}</p>
    </section>
  );
}

/**
 * Trading, non-custodial: the user's own wallet app signs. Only the wallet this Telegram account linked with /link can
 * trade here; without one (or with another) the screen says what to do instead of offering a button that can't work.
 */
function Trade({ coin }: { coin: Coin }) {
  const { t } = useLanguage();
  const { wallet: linked, botUsername, openExternal, refreshWallet } = useTg();
  const { select, connect, disconnect, connected, connecting, publicKey, wallet } = useWallet();
  const [error, setError] = useState<string | null>(null);
  const address = connected ? publicKey?.toBase58() ?? null : null;

  async function start(p: DeepLinkProvider) {
    setError(null);
    const name = DEEPLINK_WALLET_NAMES[p] as WalletName;
    try {
      // Selecting makes the provider connect; an already-selected wallet is connected directly.
      if (wallet?.adapter.name === name) await connect();
      else select(name);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }
  useEffect(() => {
    const adapter = wallet?.adapter;
    if (!adapter) return;
    const onError = (e: Error) => setError(e.message);
    adapter.on("error", onError);
    return () => {
      adapter.off("error", onError);
    };
  }, [wallet]);

  const openWeb = () => openExternal(`${window.location.origin}/coin/${coin.mint}`);
  const ghost = "w-full rounded-xl border border-paper/15 py-3 text-sm font-semibold text-paper/80";

  return (
    <section className="mt-4">
      <div className="rounded-2xl border border-paper/10 bg-ink-raised p-4">
        <h2 className="text-sm font-bold">{t("tg.wallet.title")}</h2>
        <p className="mt-1 text-xs leading-snug text-panda-grey">{t("tg.wallet.body")}</p>

        {!linked ? (
          <>
            <p className="mt-3 text-xs leading-snug text-paper/80">{t("tg.wallet.notLinked")}</p>
            <div className="mt-3 grid gap-2">
              {botUsername && (
                <a href={`https://t.me/${botUsername}?start=link`} className="block w-full rounded-xl bg-paper py-3 text-center text-sm font-bold text-ink">
                  {t("tg.wallet.linkButton")}
                </a>
              )}
              <button type="button" onClick={() => refreshWallet()} className={ghost}>
                {t("tg.wallet.linkedCheck")}
              </button>
            </div>
          </>
        ) : !address ? (
          <>
            <p className="mt-3 text-xs text-paper/80">{t("tg.wallet.linked", { address: truncateAddress(linked) })}</p>
            <div className="mt-3 grid gap-2">
              {deepLinkProviders.map((p) => (
                <button key={p} type="button" onClick={() => start(p)} disabled={connecting} className="w-full rounded-xl bg-paper py-3 text-sm font-bold text-ink disabled:opacity-50">
                  {t("tg.wallet.connect", { wallet: PROVIDERS[p].label })}
                </button>
              ))}
            </div>
            {connecting && (
              <p className="mt-2 text-xs text-bamboo" role="status">
                {t("tg.wallet.connecting")}
              </p>
            )}
          </>
        ) : (
          <div className="mt-3 flex items-center justify-between gap-2 text-xs">
            <span className="min-w-0 truncate text-paper/80">{t("tg.wallet.connected", { address: truncateAddress(address) })}</span>
            <button type="button" onClick={() => disconnect().catch(() => {})} className="min-h-8 shrink-0 px-2 font-semibold text-panda-grey underline underline-offset-2">
              {t("tg.wallet.disconnect")}
            </button>
          </div>
        )}
        {address && linked && address !== linked && <p className="mt-2 text-xs leading-snug text-clay-red">{t("tg.wallet.mismatch", { address: truncateAddress(linked) })}</p>}
        {error && (
          <p className="mt-2 text-xs leading-snug text-clay-red" role="alert">
            {error}
          </p>
        )}
        <button type="button" onClick={openWeb} className={`${ghost} mt-3`}>
          {t("tg.wallet.browser")}
        </button>
        <p className="mt-2 text-[11px] leading-snug text-panda-grey">{t("tg.wallet.browserNote")}</p>
      </div>

      {address && linked && address === linked && (
        <div className="mt-4">
          <TradingPanel coin={coin} />
          <p className="mt-2 text-[11px] leading-snug text-panda-grey">{t("tg.wallet.signNote")}</p>
        </div>
      )}
    </section>
  );
}
