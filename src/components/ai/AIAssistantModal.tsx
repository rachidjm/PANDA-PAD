"use client";

import { useEffect } from "react";
import { useFeatures } from "@/components/providers/FeaturesProvider";
import { useLanguage } from "@/lib/i18n/LanguageProvider";
import { useAIAssistant } from "./AIAssistantProvider";
import MenuList from "./MenuList";
import CreatePanel from "./CreatePanel";
import AnalyzePanel from "./AnalyzePanel";
import DrawPanel from "./DrawPanel";
import SearchPanel from "./SearchPanel";

/** The one AI Assistant modal, mounted once at the app root — every trigger (floating button, header "AI
 *  Mode", the mobile tab bar entry) opens this same instance. Off entirely unless FEATURE_AI_ASSISTANT is on. */
export default function AIAssistantModal() {
  const { aiAssistant } = useFeatures();
  const { open, panel, close, setPanel } = useAIAssistant();
  const { t } = useLanguage();

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && close();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, close]);

  if (!aiAssistant || !open) return null;

  return (
    <div className="fixed inset-0 z-[60] flex items-end justify-center bg-ink/70 backdrop-blur-sm sm:items-center sm:p-4" role="dialog" aria-modal="true" aria-label={t("ai.menu.title")} onClick={close}>
      <div
        className="max-h-[85vh] w-full overflow-y-auto rounded-t-[26px] border border-paper/10 bg-ink-raised p-5 sm:max-w-md sm:rounded-[26px]"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-3">
          {panel !== "menu" ? (
            <button type="button" onClick={() => setPanel("menu")} className="text-sm font-medium text-paper/60 transition-colors hover:text-paper">
              {t("ai.menu.back")}
            </button>
          ) : (
            <span className="w-0" aria-hidden />
          )}
          <h2 className="flex-1 text-center font-display text-base font-bold">{t("ai.menu.title")}</h2>
          <button type="button" onClick={close} aria-label={t("ai.menu.close")} className="rounded-full p-1 text-panda-grey transition-colors hover:text-paper">
            <svg viewBox="0 0 20 20" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden>
              <path d="M5 5l10 10M15 5 5 15" />
            </svg>
          </button>
        </div>

        <div className="mt-4">
          {panel === "menu" && <MenuList />}
          {panel === "create" && <CreatePanel />}
          {panel === "analyze" && <AnalyzePanel />}
          {panel === "draw" && <DrawPanel />}
          {panel === "search" && <SearchPanel />}
        </div>
      </div>
    </div>
  );
}
