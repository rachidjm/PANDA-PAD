export type ThemeStatusView = "DRAFT" | "SCHEDULED" | "ACTIVE" | "CLOSING" | "CLOSED" | "ENDED" | "ARCHIVED" | "CANCELLED";

/** Shape of a theme as returned by GET /api/themes. */
export type ThemeView = {
  themeId: number;
  slug: string;
  title: string;
  description: string;
  banner: string | null;
  rules: string;
  startTime: number;
  endTime: number;
  creationLimit: number;
  royaltyBps: number;
  rewardPool: { lamports: string; panda: string };
  status: ThemeStatusView;
  version: number;
  nfts: number;
};

export type NftView = {
  contentId: string;
  asset: string;
  creator: string;
  name: string;
  imageUrl: string;
  signature: string;
  publishedAt: number;
  review: string;
};

/** Only ACTIVE themes accept new NFTs (the server enforces this too — this is just for the UI). */
export const isOpen = (t: Pick<ThemeView, "status" | "startTime" | "endTime">, now: number) =>
  t.status === "ACTIVE" && now >= t.startTime && now < t.endTime;
