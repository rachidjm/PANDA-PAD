import CreateClient from "./CreateClient";
import { createMinFirstBuySol } from "@/lib/config/create-limits";

export default function CreatePage() {
  return (
    <div className="mx-auto max-w-[1100px] px-4 py-8 sm:px-5 sm:py-12">
      <CreateClient minFirstBuySol={createMinFirstBuySol()} />
    </div>
  );
}
