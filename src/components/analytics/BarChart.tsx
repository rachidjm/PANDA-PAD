"use client";

import { motion } from "framer-motion";
import { BarPoint } from "@/lib/analytics";

export default function BarChart({
  title,
  data,
  formatValue = (v: number) => Math.round(v).toLocaleString(),
}: {
  title: string;
  data: BarPoint[];
  formatValue?: (v: number) => string;
}) {
  const max = Math.max(1, ...data.map((d) => d.value));
  const slot = 300 / data.length;
  const barWidth = slot * 0.55;

  return (
    <div className="rounded-2xl border border-paper/10 bg-ink-raised p-5">
      <p className="text-sm font-medium text-paper/80">{title}</p>
      <svg viewBox="0 0 300 100" className="mt-4 h-28 w-full" preserveAspectRatio="none" aria-hidden>
        {data.map((d, i) => {
          const h = (d.value / max) * 88;
          const x = i * slot + (slot - barWidth) / 2;
          return (
            <motion.rect
              key={d.label}
              x={x}
              width={barWidth}
              rx={4}
              fill="var(--bamboo)"
              initial={{ height: 0, y: 96 }}
              whileInView={{ height: h, y: 96 - h }}
              viewport={{ once: true }}
              transition={{ duration: 0.5, delay: i * 0.08, ease: "easeOut" }}
            />
          );
        })}
      </svg>
      <div className="mt-1 flex text-xs text-panda-grey">
        {data.map((d) => (
          <div key={d.label} className="flex-1 text-center">
            <p>{d.label}</p>
            <p className="text-paper/70">{formatValue(d.value)}</p>
          </div>
        ))}
      </div>
    </div>
  );
}
