"use client";

import { useEffect, useState } from "react";
import { useWallet } from "@solana/wallet-adapter-react";
import type { WalletName } from "@solana/wallet-adapter-base";
import { truncateAddress } from "@/lib/format";
import { useLanguage } from "@/lib/i18n/LanguageProvider";
import { DEEPLINK_WALLET_NAMES, deepLinkProviders } from "@/lib/wallet/deeplink/bridge";
import { PROVIDERS, type DeepLinkProvider } from "@/lib/wallet/deeplink/protocol";
import { cleanError, useTg } from "./TgShell";

/**
 * Connecting the user's own wallet app, where an operation needs it (trading, Draw Your Trade, creating a coin).
 * Signing in to PANDA does not need the wallet; SIGNING does — and it is always the wallet linked to this Telegram
 * account. The connection is made once per phone (it is remembered) and can sign nothing by itself.
 */
export function useLinkedWallet(): { ready: boolean; address: string | null } {
  const { wallet: linked, authed, phone } = useTg();
  const { connected, publicKey } = useWallet();
  const address = connected ? publicKey?.toBase58() ?? null : null;
  return { ready: phone && authed && !!address && address === linked, address };
}

export default function TgConnect() {
  const { t } = useLanguage();
  const { wallet: linked } = useTg();
  const { wallets, select, disconnect, connected, connecting, publicKey, wallet } = useWallet();
  const [error, setError] = useState<string | null>(null);
  const address = connected ? publicKey?.toBase58() ?? null : null;

  function start(p: DeepLinkProvider) {
    setError(null);
    const name = DEEPLINK_WALLET_NAMES[p] as WalletName;
    const adapter = wallets.find((w) => w.adapter.name === name)?.adapter;
    // The wallet's link is opened by the adapter RIGHT NOW, inside this tap (Telegram allows it nowhere else); the
    // wallet library is told which wallet it is straight after, and follows the same connection.
    adapter?.connect().catch(() => undefined); // its failure reaches this card through the adapter's own error event
    select(name);
  }
  useEffect(() => {
    const adapter = wallet?.adapter;
    if (!adapter) return;
    const onError = (e: Error) => setError(cleanError(e.message));
    adapter.on("error", onError);
    return () => {
      adapter.off("error", onError);
    };
  }, [wallet]);

  if (address && address === linked) return null;
  return (
    <div className="mt-3">
      {address ? (
        <>
          <p className="text-xs leading-snug text-clay-red">{t("tg.wallet.mismatch", { address: truncateAddress(linked ?? "") })}</p>
          <button type="button" onClick={() => disconnect().catch(() => {})} className="mt-2 min-h-12 w-full rounded-xl border border-paper/15 px-4 text-sm font-semibold text-paper/80">
            {t("tg.wallet.disconnect")}
          </button>
        </>
      ) : (
        <>
          <p className="text-xs leading-snug text-paper/80">{t("tg.connect.body")}</p>
          <div className="mt-3 grid gap-2">
            {deepLinkProviders.map((p, i) => (
              <button key={p} type="button" onClick={() => start(p)} disabled={connecting} className={`min-h-12 w-full rounded-xl px-4 text-sm font-bold disabled:opacity-50 ${i === 0 ? "bg-bamboo text-ink" : "bg-paper text-ink"}`}>
                {t("tg.wallet.connect", { wallet: PROVIDERS[p].label })}
              </button>
            ))}
          </div>
        </>
      )}
      {error && (
        <p className="mt-2 text-xs leading-snug text-clay-red" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
