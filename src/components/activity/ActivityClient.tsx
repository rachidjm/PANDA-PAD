"use client";

import { useEffect, useState } from "react";
import ActivityView, { LoadState } from "./ActivityView";
import type { FeedResult } from "@/lib/activity/service";
import type { FeedFilter } from "@/lib/activity/types";

const POLL_MS = 30_000;

/** Holds the selected filter and re-checks the real feed now and then; the page itself is ActivityView. */
export default function ActivityClient({ initial }: { initial: FeedResult | null }) {
  const [filter, setFilter] = useState<FeedFilter>("all");
  const [result, setResult] = useState<FeedResult | null>(initial);
  const [state, setState] = useState<LoadState>(initial ? "ready" : "loading");

  useEffect(() => {
    const controller = new AbortController();
    const load = (showLoading: boolean) => {
      if (showLoading) {
        // A different filter: never show the previous filter's events under the new label while it loads.
        setResult(null);
        setState("loading");
      }
      fetch(`/api/activity/feed?filter=${filter}`, { signal: controller.signal })
        .then((r) => (r.ok ? (r.json() as Promise<FeedResult>) : Promise.reject(new Error("feed"))))
        .then((data) => {
          setResult(data);
          setState("ready");
        })
        .catch((err) => {
          if (err?.name !== "AbortError") setState("error");
        });
    };
    // The server already rendered the "all" feed; only fetch immediately for a different filter.
    load(filter !== "all" || !initial);
    const id = setInterval(() => load(false), POLL_MS);
    return () => {
      controller.abort();
      clearInterval(id);
    };
  }, [filter, initial]);

  return <ActivityView events={result?.events ?? []} sources={result?.sources ?? null} filter={filter} onFilter={setFilter} state={state} />;
}
