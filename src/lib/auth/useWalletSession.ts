"use client";

import { useCallback } from "react";
import { useWallet } from "@solana/wallet-adapter-react";
import bs58 from "bs58";
import { useLanguage } from "@/lib/i18n/LanguageProvider";
import { ADMIN_FRESH_MS } from "@/lib/auth/admin-policy";

/**
 * Proves the connected wallet is really the user's: asks the server for a
 * one-time challenge, has the wallet sign it (free, moves no funds), and lets
 * the server set an HttpOnly session cookie. The client never sees or stores
 * the session — it only re-runs this when the server says it's needed.
 */
export function useWalletSession() {
  const { publicKey, signMessage } = useWallet();
  const { t } = useLanguage();

  /** `adminFresh`: an admin action needs a sign-in from the last few minutes — an older session is replaced by a new signature. */
  const ensureSession = useCallback(async (opts?: { adminFresh?: boolean }): Promise<void> => {
    if (!publicKey) throw new Error(t("auth.failed"));
    const wallet = publicKey.toBase58();

    const current = await fetch("/api/auth/session", { cache: "no-store" })
      .then((r) => r.json())
      .catch(() => null);
    const fresh = !opts?.adminFresh || (typeof current?.issuedAt === "number" && Date.now() - current.issuedAt < ADMIN_FRESH_MS - 2 * 60_000);
    if (current?.wallet === wallet && fresh) return;

    if (!signMessage) throw new Error(t("auth.noSign"));

    const challengeRes = await fetch("/api/auth/challenge", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ wallet }),
    });
    const challenge = await challengeRes.json().catch(() => ({}));
    if (!challengeRes.ok || !challenge.message) throw new Error(challenge.error || t("auth.failed"));

    let signature: Uint8Array;
    try {
      signature = await signMessage(new TextEncoder().encode(challenge.message));
    } catch {
      throw new Error(t("auth.rejected"));
    }

    const verifyRes = await fetch("/api/auth/verify", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ wallet, nonce: challenge.nonce, signature: bs58.encode(signature) }),
    });
    if (!verifyRes.ok) {
      const data = await verifyRes.json().catch(() => ({}));
      throw new Error(data.error || t("auth.failed"));
    }
  }, [publicKey, signMessage, t]);

  return { ensureSession };
}
