"use client";

import { useMemo } from "react";
import { Connection, clusterApiUrl } from "@solana/web3.js";

/**
 * A Connection for READ-ONLY queries (balances, token accounts, supply) that
 * goes through PANDA's own /api/rpc proxy, so the RPC provider key stays on
 * the server. Sending and confirming transactions still use the wallet
 * adapter's connection.
 */
export function useReadConnection(): Connection {
  return useMemo(
    () =>
      new Connection(typeof window !== "undefined" ? `${window.location.origin}/api/rpc` : clusterApiUrl("mainnet-beta"), {
        commitment: "confirmed",
      }),
    []
  );
}
