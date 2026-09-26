import type { Metadata } from "next";
import { cache } from "react";
import { headers } from "next/headers";
import { notFound } from "next/navigation";
import AdminClient from "@/components/admin/AdminClient";
import { isAdminRequest } from "@/lib/auth/admin";

/**
 * Admin console. Visible ONLY to a live session of a wallet listed in ADMIN_WALLETS: everyone else gets the site's ordinary 404 — same
 * page, same status, no admin text and no metadata — so nothing here reveals that the console exists. The API routes behind it check the
 * session on their own; this only decides what to render.
 */
const allowed = cache(async () => isAdminRequest((await headers()).get("cookie")));

export async function generateMetadata(): Promise<Metadata> {
  // Nothing about the console (not even its title) may reach a visitor who isn't an admin.
  return (await allowed()) ? { title: "PANDA — Admin", robots: { index: false, follow: false } } : {};
}

export default async function AdminPage() {
  if (!(await allowed())) notFound();
  return (
    <div className="mx-auto max-w-4xl px-5 py-12">
      <h1 className="font-display text-3xl font-bold tracking-tight">Admin</h1>
      <p className="mt-2 text-sm text-panda-grey">
        Emergency pause switches and the audit trail. Every change here is enforced and recorded by the server.
      </p>
      <AdminClient />
    </div>
  );
}
