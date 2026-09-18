import { getLiveCoins } from "@/lib/live-coins";
import PortfolioClient from "@/components/portfolio/PortfolioClient";

export default async function PortfolioPage() {
  const { coins } = await getLiveCoins();
  return (
    <div className="mx-auto max-w-3xl px-5 py-10">
      <PortfolioClient coins={coins} />
    </div>
  );
}
