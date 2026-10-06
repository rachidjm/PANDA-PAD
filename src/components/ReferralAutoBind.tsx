"use client";

import { useEffect, useRef } from "react";
import { useWallet } from "@solana/wallet-adapter-react";
import { useWalletSession } from "@/lib/auth/useWalletSession";
import { pendingCode, pendingReferrer } from "@/lib/referrals/client";
import { useFeatures } from "@/components/providers/FeaturesProvider";

/**
 * A referral still waiting to be completed (a `?ref=` link captured earlier, or a recruiter code applied before
 * connecting) finishes on its own the moment its wallet connects — the invitee never has to go back and type the
 * code again. Once per wallet per page load; if the wallet's signature is declined, the referral simply stays
 * pending and the next connect tries again.
 */
export default function ReferralAutoBind() {
  const { referrals } = useFeatures();
  const { connected, publicKey } = useWallet();
  const { ensureSession } = useWalletSession();
  const doneFor = useRef<string | null>(null);

  useEffect(() => {
    if (!referrals || !connected || !publicKey) return;
    const wallet = publicKey.toBase58();
    if (doneFor.current === wallet) return;
    if (!pendingReferrer() && !pendingCode()) return;
    doneFor.current = wallet;
    ensureSession().catch(() => {});
  }, [referrals, connected, publicKey, ensureSession]);

  return null;
}
