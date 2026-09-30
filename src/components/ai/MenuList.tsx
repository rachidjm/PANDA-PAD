"use client";

import { useLanguage } from "@/lib/i18n/LanguageProvider";
import type { DictKey } from "@/lib/i18n/translations";
import { useAIAssistant, type AiPanel } from "./AIAssistantProvider";

const ITEMS: { id: Exclude<AiPanel, "menu">; titleKey: DictKey; descKey: DictKey }[] = [
  { id: "create", titleKey: "ai.menu.create.title", descKey: "ai.menu.create.desc" },
  { id: "analyze", titleKey: "ai.menu.analyze.title", descKey: "ai.menu.analyze.desc" },
  { id: "draw", titleKey: "ai.menu.draw.title", descKey: "ai.menu.draw.desc" },
  { id: "search", titleKey: "ai.menu.search.title", descKey: "ai.menu.search.desc" },
];

export default function MenuList() {
  const { t } = useLanguage();
  const { setPanel } = useAIAssistant();
  return (
    <div className="space-y-2">
      {ITEMS.map((it) => (
        <button
          key={it.id}
          type="button"
          onClick={() => setPanel(it.id)}
          className="w-full rounded-2xl border border-paper/10 bg-ink px-4 py-3.5 text-left transition-colors hover:border-paper/25"
        >
          <p className="font-semibold text-paper">{t(it.titleKey)}</p>
          <p className="mt-0.5 text-xs text-panda-grey">{t(it.descKey)}</p>
        </button>
      ))}
    </div>
  );
}
