"use client";

import { useCountUp } from "@/lib/hooks/useCountUp";
import Tooltip from "@/components/Tooltip";

export default function StatCard({
  label,
  value,
  format = (v: number) => Math.round(v).toLocaleString(),
  progressPct,
  tooltip,
}: {
  label: string;
  value: number;
  format?: (v: number) => string;
  /** 0-100, renders a thin accent bar under the number when set. */
  progressPct?: number;
  tooltip?: string;
}) {
  const animated = useCountUp(value);

  return (
    <div className="rounded-2xl border border-paper/10 bg-ink-raised p-5">
      <div className="flex items-center gap-1.5 text-xs text-panda-grey">
        <span>{label}</span>
        {tooltip && (
          <Tooltip label={tooltip}>
            <span className="cursor-help text-panda-grey/70">ⓘ</span>
          </Tooltip>
        )}
      </div>
      <p className="mt-1.5 font-display text-2xl font-bold">{format(animated)}</p>
      {progressPct !== undefined && (
        <div className="mt-3 h-1 overflow-hidden rounded-full bg-paper/10">
          <div
            className="h-full rounded-full bg-bamboo transition-[width] duration-500"
            style={{ width: `${Math.min(100, Math.max(0, progressPct))}%` }}
          />
        </div>
      )}
    </div>
  );
}
