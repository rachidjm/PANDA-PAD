"use client";

import { useRef } from "react";

/**
 * Accessible tabs: the row is a tablist, each tab is a button that is `aria-selected` and reachable with the
 * arrow keys (Left/Right move and select, Home/End jump), the way people expect. Only the selected tab is in the
 * tab order. The panel that belongs to a tab is the caller's: give it `role="tabpanel"`, `id={tabPanelId(idBase, id)}`
 * and `aria-labelledby={tabId(idBase, id)}`.
 */
export const tabId = (base: string, id: string) => `${base}-tab-${id}`;
export const tabPanelId = (base: string, id: string) => `${base}-panel-${id}`;

export type TabItem<T extends string> = { id: T; label: string; count?: number };

export default function Tabs<T extends string>({
  idBase,
  label,
  tabs,
  value,
  onChange,
  variant = "pill",
}: {
  idBase: string;
  label: string;
  tabs: TabItem<T>[];
  value: T;
  onChange: (id: T) => void;
  variant?: "pill" | "underline";
}) {
  const refs = useRef<Record<string, HTMLButtonElement | null>>({});

  function onKeyDown(e: React.KeyboardEvent, index: number) {
    const last = tabs.length - 1;
    const next = e.key === "ArrowRight" ? (index === last ? 0 : index + 1) : e.key === "ArrowLeft" ? (index === 0 ? last : index - 1) : e.key === "Home" ? 0 : e.key === "End" ? last : null;
    if (next === null) return;
    e.preventDefault();
    onChange(tabs[next].id);
    refs.current[tabs[next].id]?.focus();
  }

  return (
    <div
      role="tablist"
      aria-label={label}
      className={`flex gap-1.5 overflow-x-auto [scrollbar-width:none] sm:flex-wrap sm:overflow-visible [&::-webkit-scrollbar]:hidden ${variant === "underline" ? "border-b border-paper/10" : ""}`}
    >
      {tabs.map((tab, i) => {
        const selected = tab.id === value;
        return (
          <button
            key={tab.id}
            ref={(el) => {
              refs.current[tab.id] = el;
            }}
            role="tab"
            id={tabId(idBase, tab.id)}
            aria-selected={selected}
            aria-controls={tabPanelId(idBase, tab.id)}
            tabIndex={selected ? 0 : -1}
            onClick={() => onChange(tab.id)}
            onKeyDown={(e) => onKeyDown(e, i)}
            className={
              variant === "underline"
                ? `shrink-0 border-b-2 px-3 py-2.5 text-sm font-medium transition-colors ${selected ? "border-paper text-paper" : "border-transparent text-paper/60 hover:text-paper"}`
                : `shrink-0 rounded-full px-3.5 py-1.5 text-sm font-medium transition-colors ${selected ? "bg-paper text-ink" : "bg-ink-raised text-paper/60 hover:text-paper"}`
            }
          >
            {tab.label}
            {tab.count !== undefined && <span className={`ml-1.5 text-xs ${selected && variant === "pill" ? "text-ink/60" : "text-panda-grey"}`}>{tab.count}</span>}
          </button>
        );
      })}
    </div>
  );
}
