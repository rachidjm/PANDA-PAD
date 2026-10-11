import { asc, desc, eq } from "drizzle-orm";
import type { Db } from "./client";
import { siteUpdates } from "./schema";
import { slugFor, type ImageAssignment, type UpdateEntry, type UpdateTag } from "@/lib/updates/format";

/** The public Updates page's entries (site_updates). Only what was approved is ever written here. */

export type SiteUpdate = { id: string; ts: number; tag: UpdateTag; title: { en: string; es: string }; body: { en: string; es: string }; imageUrl: string | null };

const toPublic = (r: typeof siteUpdates.$inferSelect): SiteUpdate => ({ id: r.id, ts: r.ts, tag: r.tag as UpdateTag, title: { en: r.titleEn, es: r.titleEs }, body: { en: r.bodyEn, es: r.bodyEs }, imageUrl: r.imageUrl });

/**
 * Adds entries, each with its own address (a slug from its day and title; a taken one gets "-2", "-3"…). The same source
 * adding the same title on the same day twice changes nothing — publishing a draft again can't duplicate its entries.
 * Entries of one batch keep their order (each a millisecond after the previous one). Returns the ids written.
 */
export async function pgAddUpdates(db: Db, entries: (UpdateEntry & { ts: number })[], source: string, now: number): Promise<string[]> {
  const ids: string[] = [];
  let k = 0;
  for (const e of entries) {
    const base = slugFor(e.title.en, e.ts);
    for (let n = 1; n <= 50; n++) {
      const id = n === 1 ? base : `${base}-${n}`;
      const [existing] = await db.select({ source: siteUpdates.source, titleEn: siteUpdates.titleEn }).from(siteUpdates).where(eq(siteUpdates.id, id)).limit(1);
      if (existing) {
        if (existing.source === source && existing.titleEn === e.title.en) break; // already there, from this very source
        continue;
      }
      await db.insert(siteUpdates).values({ id, ts: e.ts + k, tag: e.tag, titleEn: e.title.en, titleEs: e.title.es, bodyEn: e.body.en, bodyEs: e.body.es, imageUrl: e.imageUrl, source, createdAt: now }).onConflictDoNothing();
      ids.push(id);
      break;
    }
    k++;
  }
  return ids;
}

export async function pgListUpdates(db: Db, order: "newest" | "oldest" = "newest", limit = 500): Promise<SiteUpdate[]> {
  const rows = await db.select().from(siteUpdates).orderBy(order === "newest" ? desc(siteUpdates.ts) : asc(siteUpdates.ts), order === "newest" ? desc(siteUpdates.id) : asc(siteUpdates.id)).limit(limit);
  return rows.map(toPublic);
}

export async function pgGetUpdate(db: Db, id: string): Promise<SiteUpdate | null> {
  const [row] = await db.select().from(siteUpdates).where(eq(siteUpdates.id, id)).limit(1);
  return row ? toPublic(row) : null;
}

/** Sets (or, with null, removes) the screenshot of entries that already exist. Returns the ids that were changed. */
export async function pgSetUpdateImages(db: Db, items: ImageAssignment[]): Promise<string[]> {
  const changed: string[] = [];
  for (const it of items) {
    const rows = await db.update(siteUpdates).set({ imageUrl: it.imageUrl }).where(eq(siteUpdates.id, it.id)).returning({ id: siteUpdates.id });
    if (rows.length) changed.push(it.id);
  }
  return changed;
}
