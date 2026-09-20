import type { Metadata } from "next";
import AdminClient from "@/components/admin/AdminClient";

export const metadata: Metadata = {
  title: "PANDA — Admin",
  robots: { index: false, follow: false },
};

export default function AdminPage() {
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
