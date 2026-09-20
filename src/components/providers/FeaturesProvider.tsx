"use client";

import { createContext, useContext } from "react";

/**
 * Which optional areas of PANDA are switched on, so the navigation only offers pages that exist. These are
 * decided on the server from the feature flags and only say WHAT is on: hiding a link is a courtesy, never a
 * control — every route still checks its own flag on the server.
 */
export type Features = { themes: boolean; branches: boolean; market: boolean; points: boolean; airdrops: boolean; claims: boolean };

const OFF: Features = { themes: false, branches: false, market: false, points: false, airdrops: false, claims: false };
const FeaturesContext = createContext<Features>(OFF);

export function FeaturesProvider({ features, children }: { features: Features; children: React.ReactNode }) {
  return <FeaturesContext.Provider value={features}>{children}</FeaturesContext.Provider>;
}

export const useFeatures = () => useContext(FeaturesContext);
