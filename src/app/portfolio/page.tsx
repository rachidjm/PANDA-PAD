import { getLiveCoins } from "@/lib/live-coins";
import PortfolioClient from "@/components/portfolio/PortfolioClient";

export default async function PortfolioPage() {
  // A held coin needs its name and logo even if its numbers are suspect, so both lists are passed (the marks travel with each coin).
  const { coins, suspect } = await getLiveCoins();
  return (
    <div className="mx-auto max-w-3xl px-5 py-10">
      <PortfolioClient coins={[...coins, ...suspect]} />
    </div>
  );
}
