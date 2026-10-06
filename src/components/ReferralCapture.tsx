"use client";

import { useEffect } from "react";
import { captureCodeFromUrl, captureReferralFromUrl } from "@/lib/referrals/client";

/** Mounted once at the root: remembers a `?ref=` link's wallet and a `?code=` recruiter code, if this page load has one. Renders nothing. */
export default function ReferralCapture() {
  useEffect(() => {
    captureReferralFromUrl();
    captureCodeFromUrl();
  }, []);
  return null;
}
