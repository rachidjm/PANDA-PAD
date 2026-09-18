"use client";

import { useWallet } from "@solana/wallet-adapter-react";
import Panda from "@/components/panda/Panda";

export default function RewardsClient() {
  const { connected } = useWallet();

  return (
    <div className="mt-12 rounded-[24px] border border-paper/10 bg-ink-raised p-6">
      {connected ? (
        <div className="flex items-center justify-between gap-6">
          <div>
            <p className="text-sm text-panda-grey">Your rewards</p>
            <p className="mt-1 font-display text-3xl font-bold">1,842 $PANDA</p>
            <p className="mt-2 text-sm text-panda-grey">Pending: $46.20</p>
          </div>
          <Panda pose="success" size={88} />
        </div>
      ) : (
        <div className="flex items-center justify-between gap-6">
          <div>
            <p className="font-medium">Connect your wallet to see your rewards</p>
            <p className="mt-1 text-sm text-panda-grey">Trade any GIF coin to start earning $PANDA.</p>
          </div>
          <Panda pose="empty" size={80} />
        </div>
      )}
    </div>
  );
}
