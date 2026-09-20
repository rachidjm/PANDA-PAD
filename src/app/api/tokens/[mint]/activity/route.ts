import { serveFeed } from "@/lib/activity/route";

/** Public: the activity feed of one coin. Same query as /api/activity/feed (without `mint`). */
export async function GET(req: Request, ctx: { params: Promise<{ mint: string }> }) {
  const { mint } = await ctx.params;
  return serveFeed(req, mint);
}
