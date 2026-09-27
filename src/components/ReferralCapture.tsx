"use client";

import { useEffect } from "react";
import { captureReferralFromUrl } from "@/lib/referrals/client";

/** Mounted once at the root: remembers a `?ref=` link's wallet, if this page load has one. Renders nothing. */
export default function ReferralCapture() {
  useEffect(() => {
    captureReferralFromUrl();
  }, []);
  return null;
}
