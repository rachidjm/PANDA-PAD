import TgCreate from "@/components/tg/TgCreate";
import { createMinFirstBuySol } from "@/lib/config/create-limits";

/** The website's own create form (src/app/create), in the Mini App's frame. */
export default function TgCreatePage() {
  return <TgCreate minFirstBuySol={createMinFirstBuySol()} />;
}
