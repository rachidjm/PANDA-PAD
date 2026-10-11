"use client";

import { useEffect, useState } from "react";
import { FALLBACK_LAUNCH_INFO, type LaunchInfo } from "@/lib/pump/launch-info";

/** Create's real figures (/api/pump/launch-info). Starts from the stored reference, so nothing is ever blank or invented. */
export function useLaunchInfo(): LaunchInfo {
  const [info, setInfo] = useState<LaunchInfo>(FALLBACK_LAUNCH_INFO);
  useEffect(() => {
    let cancelled = false;
    fetch("/api/pump/launch-info")
      .then((r) => (r.ok ? r.json() : null))
      .then((data: LaunchInfo | null) => {
        if (!cancelled && data && typeof data.graduationSol === "number" && typeof data.createLamports === "number" && typeof data.supply === "number") setInfo(data);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);
  return info;
}
