import type { Metadata } from "next";
import RecruitersClient from "@/components/recruiters/RecruitersClient";

// The Spanish-named mirror of /recruiters — same client component, its own metadata for a Spanish share.
export const metadata: Metadata = {
  title: "PANDA — Reclutadores",
  description: "Gana el 30% de las comisiones de PANDA por cada trader que traigas — pagado al instante en SOL, de por vida.",
  openGraph: {
    title: "PANDA Reclutadores",
    description: "Gana el 30% de las comisiones de PANDA por cada trader que traigas — pagado al instante en SOL, de por vida.",
    type: "website",
  },
  twitter: {
    card: "summary",
    title: "PANDA Reclutadores",
    description: "Gana el 30% de las comisiones de PANDA por cada trader que traigas — pagado al instante en SOL, de por vida.",
  },
};

export default function ReclutadoresPage() {
  return (
    <div className="mx-auto max-w-3xl px-5 py-12">
      <RecruitersClient />
    </div>
  );
}
