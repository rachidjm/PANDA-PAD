import RewardsClient from "./RewardsClient";

const steps = [
  { label: "Trade", detail: "You buy or sell a GIF coin." },
  { label: "Fees", detail: "A small fee is taken from the trade." },
  { label: "Rewards", detail: "That fee is pooled for holders." },
  { label: "$PANDA", detail: "Your share lands in your wallet." },
];

export default function RewardsPage() {
  return (
    <div className="mx-auto max-w-2xl px-5 py-12">
      <h1 className="font-display text-3xl font-bold">Earn with PANDA</h1>
      <p className="mt-2 max-w-md text-paper/70">
        Every trade on PANDA pays a fee. Instead of disappearing, it flows back to the people holding the coin.
      </p>

      <ol className="mt-10 space-y-0">
        {steps.map((step, i) => (
          <li key={step.label} className="relative flex gap-4 pb-8 last:pb-0">
            {i < steps.length - 1 && (
              <span className="absolute left-[15px] top-8 h-[calc(100%-1.25rem)] w-px bg-paper/15" aria-hidden />
            )}
            <span className="relative z-10 flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-paper/20 bg-ink-raised text-xs font-semibold text-meme-orange">
              {i + 1}
            </span>
            <div className="pt-0.5">
              <p className="font-display font-semibold">{step.label}</p>
              <p className="text-sm text-panda-grey">{step.detail}</p>
            </div>
          </li>
        ))}
      </ol>

      <RewardsClient />
    </div>
  );
}
