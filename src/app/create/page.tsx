import CreateClient from "./CreateClient";
import { createMinFirstBuySol } from "@/lib/config/create-limits";

export default function CreatePage() {
  return (
    <div className="mx-auto max-w-2xl px-5 py-12">
      <CreateClient minFirstBuySol={createMinFirstBuySol()} />
    </div>
  );
}
