"use client";

import { usePathname } from "next/navigation";

export const isTgPath = (pathname: string | null) => pathname === "/tg" || !!pathname?.startsWith("/tg/");

/** The website's own header, footer and bars are not part of the Telegram Mini App (/tg): it has its own frame. */
export default function OutsideTg({ children }: { children: React.ReactNode }) {
  return isTgPath(usePathname()) ? null : <>{children}</>;
}
