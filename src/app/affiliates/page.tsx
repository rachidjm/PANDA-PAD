import { redirect } from "next/navigation";

// The old affiliate campaign is gone — the Recruiters program replaces it. Existing links/bookmarks still work.
export default function AffiliatesPage() {
  redirect("/recruiters");
}
