import type { Metadata, Viewport } from "next";
import { headers } from "next/headers";
import { notFound } from "next/navigation";
import TgShell from "@/components/tg/TgShell";
import { miniappEnabled } from "@/lib/telegram/miniapp";
import { publicBotUsername } from "@/lib/telegram/public";

export const metadata: Metadata = { title: "PANDA", robots: { index: false, follow: false } };

/** The page reaches the phone's edges (so the bars can be drawn to them) and reports its notch and home bar: env(safe-area-inset-*). */
export const viewport: Viewport = { width: "device-width", initialScale: 1, viewportFit: "cover" };

const TG_SCRIPT = "https://telegram.org/js/telegram-web-app.js";
/**
 * The first thing the page does, before the app's own code has even been downloaded: Telegram hands its signed data
 * over in the address (#tgWebAppData=…), so the Telegram sign-in can be on its way already. The shell picks the answer
 * up (TgShell: earlyBoot) instead of asking again. Nothing here is trusted: the server checks that data's signature.
 */
const EARLY_BOOT = `(function(){try{var m=/[#&]tgWebAppData=([^&]*)/.exec(location.hash);if(!m)return;var d=decodeURIComponent(m[1].split("+").join("%20"));if(!d)return;window.__tgBoot={initData:d,session:fetch("/api/tg/session",{method:"POST",cache:"no-store",headers:{"Content-Type":"application/json"},body:JSON.stringify({initData:d})}).then(function(r){return r.json().then(function(j){return{ok:r.ok,data:j}},function(){return{ok:false,data:null}})}).catch(function(){return null})}}catch(e){}})();`;

/** The Telegram Mini App (docs/TELEGRAM.md, section 12). With FEATURE_TELEGRAM_MINIAPP off, none of /tg exists. */
export default async function TgLayout({ children }: LayoutProps<"/tg">) {
  if (!miniappEnabled()) notFound();
  const nonce = (await headers()).get("x-nonce") ?? undefined;
  return (
    <>
      <script nonce={nonce} dangerouslySetInnerHTML={{ __html: EARLY_BOOT }} />
      {/* Telegram's own script, downloaded alongside the app's code instead of after it. */}
      <script nonce={nonce} src={TG_SCRIPT} async />
      <TgShell botUsername={publicBotUsername()}>{children}</TgShell>
    </>
  );
}
