"use client";

import { usePathname } from "next/navigation";
import Logo from "@/components/Logo";
import { useFeatures } from "@/components/providers/FeaturesProvider";
import { useLanguage } from "@/lib/i18n/LanguageProvider";
import { useAIAssistant } from "@/components/ai/AIAssistantProvider";

/** Round floating button, bottom-right, HOME PAGE ONLY (spec) — PANDA's own logo plus a small ✨ sparkle to
 *  say "this one's AI", never an OpenAI/ChatGPT mark. The header's "AI Mode" button and the mobile tab bar's
 *  entry open the exact same modal from every other page. */
export default function AIAssistantFab() {
  const pathname = usePathname();
  const { aiAssistant } = useFeatures();
  const { t } = useLanguage();
  const { show } = useAIAssistant();

  if (!aiAssistant || pathname !== "/") return null;

  return (
    <button
      type="button"
      onClick={() => show()}
      aria-label={t("ai.fab")}
      title={t("ai.fab")}
      className="fixed bottom-20 right-5 z-40 flex h-14 w-14 items-center justify-center rounded-full bg-ink-raised shadow-[0_8px_24px_rgba(0,0,0,0.5)] ring-1 ring-paper/15 transition-transform hover:scale-105 sm:bottom-6"
    >
      <Logo size={30} />
      <span className="absolute -right-0.5 -top-0.5 flex h-5 w-5 items-center justify-center rounded-full bg-meme-orange text-[11px] leading-none" aria-hidden>
        ✨
      </span>
    </button>
  );
}
