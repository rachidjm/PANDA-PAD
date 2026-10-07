/**
 * The Recruiters panel's invitee-list filter/sort — pure, so the rules are tested without a browser. The list
 * itself is fetched whole (one wallet's invitees is never huge enough to need server-side paging yet); this is
 * what the filter bar, the state dropdown and the sort dropdown actually do to it.
 */

export type Invitee = {
  wallet: string;
  state: "bound" | "pending" | "rejected";
  boundAt: number;
  source: "link" | "code";
  code: string | null;
  active: boolean;
  everActivated: boolean;
  streakDays: number;
  earnedLamports: number;
  tradedVolumeUsd: number;
  discountActive: boolean;
  lastTradeAt: number | null;
};

export const INVITEE_FILTER_STATES = ["all", "bound", "pending", "rejected", "active", "onTrack", "inactive", "validFounder", "notValidFounder"] as const;
export type InviteeFilterState = (typeof INVITEE_FILTER_STATES)[number];

export const INVITEE_SORT_KEYS = ["default", "earned", "recent", "volume", "streak"] as const;
export type InviteeSortKey = (typeof INVITEE_SORT_KEYS)[number];

/** `active`/`onTrack`/`inactive` all narrow to `state === "bound"` first — a pending/rejected row never matches
 *  any of them. `onTrack` = bound, not (yet) active, with no activation behind it either (still building a
 *  first streak); `inactive` = WAS active at least once and currently isn't. */
export function filterInvitees(invitees: Invitee[], filter: { state: InviteeFilterState; q: string }, founderMinVolumeUsd: number): Invitee[] {
  const q = filter.q.trim().toLowerCase();
  return invitees.filter((inv) => {
    if (q && !inv.wallet.toLowerCase().includes(q)) return false;
    switch (filter.state) {
      case "all":
        return true;
      case "bound":
      case "pending":
      case "rejected":
        return inv.state === filter.state;
      case "active":
        return inv.state === "bound" && inv.active;
      case "onTrack":
        return inv.state === "bound" && !inv.active && !inv.everActivated;
      case "inactive":
        return inv.state === "bound" && !inv.active && inv.everActivated;
      case "validFounder":
        return inv.state === "bound" && inv.tradedVolumeUsd >= founderMinVolumeUsd;
      case "notValidFounder":
        return inv.state === "bound" && inv.tradedVolumeUsd < founderMinVolumeUsd;
    }
  });
}

export function sortInvitees(invitees: Invitee[], sort: InviteeSortKey): Invitee[] {
  const out = [...invitees];
  switch (sort) {
    case "earned":
      return out.sort((a, b) => b.earnedLamports - a.earnedLamports);
    case "recent":
      return out.sort((a, b) => b.boundAt - a.boundAt);
    case "volume":
      return out.sort((a, b) => b.tradedVolumeUsd - a.tradedVolumeUsd);
    case "streak":
      return out.sort((a, b) => b.streakDays - a.streakDays);
    case "default":
    default:
      // Most recently generated something first (last trade), then most recently bound — a reasonable "what
      // needs my attention" order with no extra inputs, never a black-box "relevance" score.
      return out.sort((a, b) => (b.lastTradeAt ?? 0) - (a.lastTradeAt ?? 0) || b.boundAt - a.boundAt);
  }
}

/** Earned-per-invitee, counting only invitees who have earned something at all — an invitee who never traded
 *  shouldn't dilute the average toward zero for every OTHER one who did. 0 with no earners at all. */
export function averageEarnedLamports(invitees: Invitee[]): number {
  const earners = invitees.filter((i) => i.earnedLamports > 0);
  if (earners.length === 0) return 0;
  return Math.round(earners.reduce((s, i) => s + i.earnedLamports, 0) / earners.length);
}
