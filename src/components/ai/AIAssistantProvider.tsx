"use client";

import { createContext, useContext, useState } from "react";

export type AiPanel = "menu" | "create" | "analyze" | "draw" | "search";

type Ctx = { open: boolean; panel: AiPanel; show: (panel?: AiPanel) => void; close: () => void; setPanel: (panel: AiPanel) => void };

const AIAssistantContext = createContext<Ctx | null>(null);

/** Open/closed state and which of the 4 tools is showing, for the ONE assistant modal mounted at the app
 *  root (src/app/layout.tsx) — every trigger (the floating button, "AI Mode" in the header and the mobile
 *  tab bar) opens the exact same modal, never a separate one per entry point. */
export function AIAssistantProvider({ children }: { children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  const [panel, setPanel] = useState<AiPanel>("menu");
  return (
    <AIAssistantContext.Provider
      value={{
        open,
        panel,
        show: (p) => {
          setPanel(p ?? "menu");
          setOpen(true);
        },
        close: () => setOpen(false),
        setPanel,
      }}
    >
      {children}
    </AIAssistantContext.Provider>
  );
}

export function useAIAssistant(): Ctx {
  const ctx = useContext(AIAssistantContext);
  if (!ctx) throw new Error("useAIAssistant must be used inside AIAssistantProvider");
  return ctx;
}
