import { serveFeed } from "@/lib/activity/route";

/** Public: the activity feed. Query: filter (all | created | trades | large | graduation | fees | rewards), mint, limit. */
export async function GET(req: Request) {
  return serveFeed(req);
}
