import { NextResponse } from "next/server";
import { clientIp, rateLimited } from "@/lib/rate-limit";
import { sameOrigin } from "@/lib/auth/session";
import { requireAdmin } from "@/lib/auth/admin";
import { isEnabled } from "@/lib/config/flags";
import { createTheme, listThemes, transitionTheme } from "@/lib/themes/store";
import { THEME_STATUSES, ThemeStatus } from "@/lib/themes/theme";
import { recordAudit } from "@/lib/audit/log";

/**
 * Auth: admin (fresh wallet session of an ADMIN_WALLETS wallet), same-origin, rate limited.
 * GET  -> every theme, drafts included.
 * POST -> { action: "create", ...theme fields, confirm: "CREATE THEME <slug>" }
 *      |  { action: "transition", themeId, to, confirm: "<TO> THEME <id>" }   e.g. "ACTIVE THEME 3"
 * A theme's window is enforced by the server on every mint whatever its status says, so
 * "closing" a theme by hand is only ever a way to stop it EARLIER. Audited. Gated by NFT_THEMES.
 */
export async function GET(req: Request) {
  if (!isEnabled("NFT_THEMES")) return NextResponse.json({ error: "Not available." }, { status: 404 });
  const admin = await requireAdmin(req);
  if (admin instanceof NextResponse) return admin;
  try {
    return NextResponse.json({ themes: await listThemes() }, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return NextResponse.json({ error: "Couldn't load themes." }, { status: 500 });
  }
}

export async function POST(req: Request) {
  if (!isEnabled("NFT_THEMES")) return NextResponse.json({ error: "Not available." }, { status: 404 });
  if (!sameOrigin(req)) return NextResponse.json({ error: "Forbidden origin." }, { status: 403 });
  if (rateLimited(`admin:ip:${clientIp(req)}`, 30, 60_000)) return NextResponse.json({ error: "Too many requests." }, { status: 429 });
  const admin = await requireAdmin(req);
  if (admin instanceof NextResponse) return admin;

  const b = await req.json().catch(() => null);
  const bad = (error: string, status = 400) => NextResponse.json({ error }, { status });
  if (!b || typeof b.action !== "string") return bad("Invalid request.");
  const now = Date.now();

  try {
    if (b.action === "create") {
      if (typeof b.slug !== "string" || b.confirm !== `CREATE THEME ${b.slug}`) return bad(`Confirmation must be exactly "CREATE THEME ${String(b.slug)}".`);
      const r = await createTheme(
        {
          slug: b.slug,
          title: b.title,
          description: b.description,
          banner: b.banner ?? null,
          rules: b.rules,
          startTime: b.startTime,
          endTime: b.endTime,
          creationLimit: b.creationLimit,
          royaltyBps: b.royaltyBps,
          rewardPool: b.rewardPool,
        },
        now
      );
      if (!r.ok) return bad(r.error);
      await recordAudit({ req, actor: admin.wallet, action: "theme.create", object: `theme:${r.theme.themeId}`, newState: r.theme });
      return NextResponse.json({ theme: r.theme });
    }

    if (b.action === "transition") {
      const to = b.to as ThemeStatus;
      if (!Number.isSafeInteger(b.themeId) || b.themeId < 1 || !THEME_STATUSES.includes(to)) return bad("Invalid theme or status.");
      if (b.confirm !== `${to} THEME ${b.themeId}`) return bad(`Confirmation must be exactly "${to} THEME ${b.themeId}".`);
      const r = await transitionTheme(b.themeId, to, now);
      if (!r.ok) return bad(r.error, 409);
      await recordAudit({
        req,
        actor: admin.wallet,
        action: "theme.transition",
        object: `theme:${b.themeId}`,
        oldState: { status: r.before.status },
        newState: { status: r.after.status },
      });
      return NextResponse.json({ theme: r.after });
    }

    return bad("Unknown action.");
  } catch (err) {
    console.error("[PANDA] admin themes failed", String(err));
    return bad("The operation failed — nothing was changed, or the state needs checking.", 500);
  }
}
