"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { AnimatePresence, motion } from "framer-motion";
import Doodle from "@/components/doodles/Doodle";
import { ActivityEvent } from "@/lib/types";

const POLL_MS = 30_000;

/** Real recent trades, server-fetched once then re-polled — "feels alive"
 * because it genuinely re-checks real data, not because anything is faked. */
export default function ActivityFeed({ initialEvents, limit }: { initialEvents: ActivityEvent[]; limit?: number }) {
  const [events, setEvents] = useState(initialEvents);

  useEffect(() => {
    const id = setInterval(() => {
      fetch("/api/activity")
        .then((r) => r.json())
        .then((data: { events?: ActivityEvent[] }) => {
          if (data.events?.length) setEvents(data.events);
        })
        .catch(() => {});
    }, POLL_MS);
    return () => clearInterval(id);
  }, []);

  const list = limit ? events.slice(0, limit) : events;

  if (list.length === 0) {
    return (
      <div className="rounded-2xl border border-paper/10 bg-ink-raised px-4 py-6 text-center text-sm text-panda-grey">
        No recent trades yet.
      </div>
    );
  }

  return (
    <div className="overflow-hidden rounded-2xl border border-paper/10">
      <AnimatePresence initial={false}>
        {list.map((e) => (
          <motion.div
            key={e.id}
            layout
            initial={{ opacity: 0, y: -8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.25 }}
          >
            <Link
              href={`/coin/${e.coinMint}`}
              className="flex items-center gap-3 border-b border-paper/10 bg-ink-raised px-4 py-3 transition-colors last:border-b-0 hover:bg-paper/5"
            >
              <div
                className="h-8 w-8 shrink-0 overflow-hidden rounded-full"
                style={{ backgroundColor: e.coinImage ? undefined : e.coinBg }}
              >
                {e.coinImage ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={e.coinImage} alt="" className="h-full w-full object-cover" />
                ) : (
                  <Doodle kind={e.coinDoodle} className="h-full w-full" />
                )}
              </div>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-semibold">
                  <span className={e.side === "buy" ? "text-bamboo" : "text-clay-red"}>
                    {e.side === "buy" ? "Buy" : "Sell"}
                  </span>{" "}
                  ${e.coinTicker}
                </p>
                <p className="truncate text-xs text-panda-grey">{e.trader}</p>
              </div>
              <div className="shrink-0 text-right">
                <p className="text-sm font-medium">{e.sol.toFixed(3)} SOL</p>
                <p className="text-xs text-panda-grey">{e.time}</p>
              </div>
            </Link>
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  );
}
