export type LegalSlug = "legal-notice" | "terms-of-service" | "privacy-policy" | "risk-disclosure" | "cookie-policy" | "disclaimer";

export type LegalPage = { slug: LegalSlug; title: string; body: string[] };

const PLACEHOLDER =
  "Placeholder — to be replaced with reviewed legal copy before launch. Nothing on this page is legal advice, and none of it should be relied on as final.";

export const LEGAL_PAGES: Record<LegalSlug, LegalPage> = {
  "legal-notice": {
    slug: "legal-notice",
    title: "Legal Notice",
    body: [PLACEHOLDER, "Operator identity, registered address, and contact details go here."],
  },
  "terms-of-service": {
    slug: "terms-of-service",
    title: "Terms of Service",
    body: [
      PLACEHOLDER,
      "Covers acceptable use of PANDA, the non-custodial nature of trading (you sign every transaction yourself), and limitation of liability.",
    ],
  },
  "privacy-policy": {
    slug: "privacy-policy",
    title: "Privacy Policy",
    body: [PLACEHOLDER, "Covers what, if anything, PANDA stores about visitors and wallet interactions."],
  },
  "risk-disclosure": {
    slug: "risk-disclosure",
    title: "Risk Disclosure",
    body: [
      PLACEHOLDER,
      "Memecoins are extremely volatile and can lose all value. PANDA doesn't vet, endorse, or guarantee any coin created or traded through it.",
    ],
  },
  "cookie-policy": {
    slug: "cookie-policy",
    title: "Cookie Policy",
    body: [PLACEHOLDER, "Covers any cookies or local storage PANDA uses."],
  },
  disclaimer: {
    slug: "disclaimer",
    title: "Disclaimer",
    body: [
      PLACEHOLDER,
      "PANDA is a launchpad interface, not a financial advisor, broker, or exchange. Nothing here is investment advice.",
    ],
  },
};

export const LEGAL_SLUGS = Object.keys(LEGAL_PAGES) as LegalSlug[];
