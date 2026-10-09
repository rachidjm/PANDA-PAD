import { Lang } from "@/lib/i18n/translations";
import { PANDA_FEE_BPS, PANDA_REFERRED_FEE_BPS } from "@/lib/pump/constants";
import { PANDA_SHARE_BPS } from "@/lib/config/protocol";
import { MARKET_CONFIG } from "@/lib/market/config";
import { strategyFeeBps } from "@/lib/strategy/plan";
import { HOLDER_PAYOUT_MIN_LAMPORTS } from "@/lib/rewards/limits";
import { SELL_MARGIN_BPS, STOP_MARGIN_BPS } from "@/lib/panda-orders/math";
import { siteDomain } from "@/lib/config/site";
import {
  DEFAULT_FOUNDER_MIN_TRADER_VOLUME_USD,
  DEFAULT_FOUNDER_REQUIRED_TRADERS,
  DEFAULT_REFERRAL_TIERS,
  DEFAULT_REFERRED_DISCOUNT_MIN_VOLUME_USD,
  FOUNDER_SHARE_BPS,
} from "@/lib/referrals/tiers-config";

export type LegalSlug = "legal-notice" | "terms-of-service" | "privacy-policy" | "risk-disclosure" | "cookie-policy" | "disclaimer";

export type LegalPage = { slug: LegalSlug; title: Record<Lang, string>; body: Record<Lang, string[]>; /** ISO date (YYYY-MM-DD) of the last change to these texts. */ updated: string };

/**
 * The date these texts were last changed. Bump it whenever anything in this file (or a fee, a flag or a data practice the texts describe)
 * changes: src/lib/legal-content.test.ts fails if it is in the future or malformed.
 */
export const LEGAL_LAST_UPDATED = "2026-10-09";

/**
 * Every percentage below comes from the constant the code charges with, so a text can't drift from what is really collected
 * (src/lib/legal-content.test.ts also checks this).
 */
const pct = (bps: number, lang: Lang): string => {
  const v = bps / 100;
  return `${lang === "es" ? String(v).replace(".", ",") : String(v)}%`;
};
const both = (bps: number) => ({ en: pct(bps, "en"), es: pct(bps, "es") });
// Two-tier trading fee (src/lib/pump/fee-tier.ts): TRADE is the default rate everyone starts on; TRADE_REFERRED
// is the permanent half-price rate a wallet gets once it's bound to a recruiter, or was already trading on
// PANDA before this system shipped (grandfathered).
const TRADE = both(PANDA_FEE_BPS); // 1% default, on each buy and each sell
const TRADE_REFERRED = both(PANDA_REFERRED_FEE_BPS); // 0.5% — half price, for life, once the threshold below is reached
const DISCOUNT_MIN_VOLUME = DEFAULT_REFERRED_DISCOUNT_MIN_VOLUME_USD;
const SHARE = both(PANDA_SHARE_BPS); // PANDA's fixed share of a coin's creator fees
const REST = both(10_000 - PANDA_SHARE_BPS);
const STRATEGY = both(strategyFeeBps(PANDA_FEE_BPS)); // Draw Your Trade at the default rate: the buy's and the sell's fee together
const STRATEGY_REFERRED = both(strategyFeeBps(PANDA_REFERRED_FEE_BPS)); // same, at the referred/legacy rate
const MARKET = both(MARKET_CONFIG.feeBps); // NFT marketplace
const HOLDER_PAYOUT_MIN_SOL = HOLDER_PAYOUT_MIN_LAMPORTS / 1e9; // the real threshold src/lib/rewards/run-payout.ts waits for before paying a coin's holders
const SITE_DOMAIN = siteDomain(); // the real domain (src/lib/config/site.ts) — never a hardcoded example that can drift from a real domain change
// Recruiters: marginal tiers, by a recruiter's live count of active invitees (src/lib/referrals/tiers.ts) — each
// expressed both as a share of PANDA's own trade fee and as that same share's % of the trade itself. A
// recruiter only ever earns from a REFERRED trade (that's who their invitees are, by definition), so the base
// here is PANDA_REFERRED_FEE_BPS (0.5%), not the default rate.
const ofTrade = (bps: number) => both(Math.round((PANDA_REFERRED_FEE_BPS * bps) / 10_000));
const TIER1 = both(DEFAULT_REFERRAL_TIERS[0].bps); // 1st–500th active invitee
const TIER1_OF_TRADE = ofTrade(DEFAULT_REFERRAL_TIERS[0].bps);
const TIER2 = both(DEFAULT_REFERRAL_TIERS[1].bps); // 501st–1,500th
const TIER2_OF_TRADE = ofTrade(DEFAULT_REFERRAL_TIERS[1].bps);
const TIER3 = both(DEFAULT_REFERRAL_TIERS[2].bps); // 1,501st+
const TIER3_OF_TRADE = ofTrade(DEFAULT_REFERRAL_TIERS[2].bps);
const FOUNDER_SHARE = both(FOUNDER_SHARE_BPS); // Founders: this flat share, always, regardless of rank

/**
 * A short, honest caveat kept at the top of every page (styled as a warning in LegalPageLayout): this was drafted by PANDA's own team, not
 * reviewed by a lawyer. The rest of each page describes what PANDA actually does at the current configuration — not filler.
 *
 * Which features these pages talk about follows the feature flags (see getLegalPage): the base text below describes the launch
 * configuration (buying, selling and launching coins, nothing else); every optional feature has an ADDENDA block that is appended only
 * while that feature is switched on. With a flag off, no text may present its feature as available (src/lib/legal-content.test.ts).
 */
const DRAFT_NOTICE: Record<Lang, string> = {
  en: "Draft prepared by the PANDA team, not by a lawyer — treat this as a good-faith starting point, not final legal advice, until it's reviewed by qualified counsel in the relevant jurisdiction.",
  es: "Borrador preparado por el equipo de PANDA, no por un abogado — trátalo como un punto de partida de buena fe, no como asesoramiento legal definitivo, hasta que lo revise un profesional cualificado en la jurisdicción correspondiente.",
};

/** The $PANDA paragraph of the Disclaimer while the token doesn't exist yet; getLegalPage swaps it when NEXT_PUBLIC_PANDA_TOKEN_MINT is set. */
const PANDA_TOKEN_NOT_LAUNCHED: Record<Lang, string> = {
  en: "$PANDA, PANDA's own token, has not been launched. The \"Buy $PANDA\" button stays inactive until the token exists on-chain, and no balance or price is shown for it before then. Any reference to it in the app describes something that does not exist yet.",
  es: "$PANDA, el token propio de PANDA, no se ha lanzado. El botón \"Buy $PANDA\" permanece inactivo hasta que el token exista on-chain, y no se muestra ningún saldo ni precio suyo antes de eso. Cualquier referencia a él en la app describe algo que todavía no existe.",
};
const PANDA_TOKEN_LAUNCHED: Record<Lang, string> = {
  en: `$PANDA is PANDA's own token. Its price is set by the market, and nothing in PANDA is a promise about its value, its uses or any reward attached to it. Buying it through PANDA carries the same ${TRADE.en} fee as any other trade.`,
  es: `$PANDA es el token propio de PANDA. Su precio lo fija el mercado, y nada en PANDA es una promesa sobre su valor, sus usos ni ninguna recompensa asociada. Comprarlo a través de PANDA lleva la misma comisión del ${TRADE.es} que cualquier otra operación.`,
};

export const LEGAL_PAGES: Record<LegalSlug, LegalPage> = {
  "legal-notice": {
    slug: "legal-notice",
    updated: LEGAL_LAST_UPDATED,
    title: { en: "Legal Notice", es: "Aviso Legal" },
    body: {
      en: [
        DRAFT_NOTICE.en,
        "PANDA is a software interface for interacting with public, permissionless Solana programs: Pump.fun's bonding curve, PumpSwap and, for other coins, Solana DEXes through Jupiter's aggregator. For buying, selling and creating coins PANDA never holds your funds, private keys or seed phrase: each of those transactions is built unsigned and only becomes real once you review and sign it in your own wallet (for example Phantom or Solflare).",
        "Coins created through PANDA are created by their users through Pump.fun's public program. PANDA does not issue, endorse or guarantee any coin created or traded through it, including $PANDA.",
        "Market and pool data shown in the app comes from Pump.fun's public API, Dexscreener and GeckoTerminal — independent third parties that index public Solana activity — swap quotes come from Jupiter, and the risk indicator on each coin comes from RugCheck (rugcheck.xyz), also a third party. PANDA sets aside coins whose data looks unreliable (for example a huge market cap on almost no liquidity); that is a data-quality filter, not a judgment on any coin.",
      ],
      es: [
        DRAFT_NOTICE.es,
        "PANDA es una interfaz de software para interactuar con programas públicos y sin permisos de Solana: la bonding curve de Pump.fun, PumpSwap y, para otras monedas, DEXes de Solana a través del agregador de Jupiter. Para comprar, vender y crear monedas, PANDA nunca retiene tus fondos, claves privadas ni frase semilla: cada una de esas transacciones se construye sin firmar y solo se vuelve real cuando la revisas y la firmas en tu propia wallet (por ejemplo, Phantom o Solflare).",
        "Las monedas creadas a través de PANDA las crean sus propios usuarios mediante el programa público de Pump.fun. PANDA no emite, avala ni garantiza ninguna moneda creada u operada a través de ella, incluyendo $PANDA.",
        "Los datos de mercado y de pools que se muestran en la app proceden de la API pública de Pump.fun, Dexscreener y GeckoTerminal — terceros independientes que indexan actividad pública de Solana — las cotizaciones de swap proceden de Jupiter, y el indicador de riesgo de cada moneda procede de RugCheck (rugcheck.xyz), también un tercero. PANDA aparta las monedas cuyos datos parecen poco fiables (por ejemplo, una capitalización enorme con casi nada de liquidez); es un filtro de calidad de datos, no un juicio sobre ninguna moneda.",
      ],
    },
  },
  "terms-of-service": {
    slug: "terms-of-service",
    updated: LEGAL_LAST_UPDATED,
    title: { en: "Terms of Service", es: "Términos del Servicio" },
    body: {
      en: [
        DRAFT_NOTICE.en,
        "By using PANDA, you agree to these terms. If you don't agree, don't use the app.",
        "Who may use PANDA. You must be at least 18 years old, and it is your responsibility to check that using PANDA and trading crypto-assets is lawful where you live. PANDA is not offered to people who are in, or are residents of, the United States, or of countries or territories subject to sanctions by the European Union, the United Nations or OFAC (the U.S. Treasury's sanctions office). If that is your case, do not use PANDA.",
        "Non-custodial trading and creation. PANDA never takes custody of your funds, tokens, or private keys for trading, coin creation or fee-split setup — each of those is a transaction you review and sign yourself, in your own wallet.",
        "Your responsibility. You are solely responsible for your wallet, its seed phrase, and every transaction you approve. PANDA will never ask for your seed phrase or private key, in the app or otherwise. Double-check every transaction's details in your wallet before signing — PANDA cannot undo a signed transaction.",
        `Fees. PANDA's default trading fee is ${TRADE.en} on every buy and ${TRADE.en} on every sell, on any coin traded through PANDA (Pump.fun's bonding curve, PumpSwap, and other coins routed through Jupiter). A wallet that connects through a recruiter's link or code, or that applies one by hand before its first trade, pays that same default rate until its own cumulative trade volume on PANDA (buys and sells together) reaches $${DISCOUNT_MIN_VOLUME} — from then on it pays half: ${TRADE_REFERRED.en} on every buy and ${TRADE_REFERRED.en} on every sell — permanently, for as long as it trades on PANDA; a wallet that was already trading on PANDA before this two-tier system existed was moved onto that same ${TRADE_REFERRED.en} rate immediately, automatically, permanently, with nothing to do on its part. Whichever rate applies, it is paid in SOL to PANDA's treasury wallet as a separate transfer inside the same transaction you sign: on a buy it is that rate's share of the SOL you spend, added on top; on a sell it is that rate's share of the SOL you receive, estimated when the transaction is built. If you pay with another token, the fee is still charged in SOL, on top. The same rate applies to the "Buy $PANDA" button once the token exists.`,
        `Share of creator fees. Every coin created through PANDA gives PANDA ${SHARE.en} of that coin's creator fees (the part of trading fees that Pump.fun pays to a coin's creator). It is the same on every coin, and it is written into the coin's on-chain fee configuration when the coin is created; it cannot be changed or removed. The remaining ${REST.en} is assigned by the creator to the wallets they choose. PANDA charges no separate fee for creating a coin.`,
        "What is not PANDA's fee. Solana network fees, account rent, priority fees (a fraction of a cent per trade) and the fees of Pump.fun, PumpSwap, Jupiter routes and DEX pools go to those networks and protocols, not to PANDA. The amounts are shown before you sign, in PANDA and in your wallet. With none of PANDA's optional features switched on, the two fees above are the only ones PANDA charges; the fees of an optional feature are described where that feature is described.",
        "Acceptable use. You agree not to use PANDA to violate applicable law, to manipulate markets, to launder funds, or to infringe anyone else's rights. PANDA may restrict access to the app (though not to the underlying public Solana programs, which anyone can interact with directly) for accounts that clearly abuse it.",
        "Availability. PANDA can pause parts of the service — for example coin launches — for security or maintenance; when it does, the app says so. If the app cannot confirm that it is connected to the right Solana network, it pauses everything that moves money and says so.",
        "No warranty. PANDA is provided \"as is,\" without warranties of any kind. Market data and risk indicators come from third parties (Pump.fun's public API, Dexscreener, GeckoTerminal and RugCheck) and can be delayed, rate-limited, or temporarily unavailable — the app shows this honestly (a \"live\" indicator) rather than pretending stale data is current, but you should not rely on it for time-critical decisions.",
        "Limitation of liability. To the maximum extent permitted by law, PANDA and its operator aren't liable for losses arising from your use of the app, including losses from market volatility, smart-contract risk, third-party services (Solana RPC providers, Pump.fun, Jupiter, GeckoTerminal, Dexscreener, RugCheck), or your own transaction mistakes.",
        "Changes. These terms may be updated as PANDA evolves; the date of the last change is shown on this page, and continued use after a change means you accept the new terms. Governing law: these terms are governed by Spanish law.",
      ],
      es: [
        DRAFT_NOTICE.es,
        "Al usar PANDA, aceptas estos términos. Si no estás de acuerdo, no uses la aplicación.",
        "Quién puede usar PANDA. Debes tener al menos 18 años, y es tu responsabilidad comprobar que usar PANDA y operar con criptoactivos es legal donde vives. PANDA no se ofrece a personas que estén en Estados Unidos o sean residentes en él, ni en países o territorios sujetos a sanciones de la Unión Europea, las Naciones Unidas o la OFAC (la oficina de sanciones del Tesoro de EE. UU.). Si ese es tu caso, no uses PANDA.",
        "Operar y crear sin custodia. PANDA nunca custodia tus fondos, tokens o claves privadas para operar, crear monedas o configurar el reparto de comisiones — cada una de esas acciones es una transacción que revisas y firmas tú mismo, en tu propia wallet.",
        "Tu responsabilidad. Eres el único responsable de tu wallet, su frase semilla y cada transacción que apruebas. PANDA nunca te pedirá tu frase semilla ni tu clave privada, ni dentro de la app ni fuera de ella. Revisa siempre los detalles de cada transacción en tu wallet antes de firmar — PANDA no puede deshacer una transacción ya firmada.",
        `Comisiones. La comisión de trading de PANDA por defecto es del ${TRADE.es} en cada compra y del ${TRADE.es} en cada venta, de cualquier moneda operada a través de PANDA (la bonding curve de Pump.fun, PumpSwap y otras monedas enrutadas por Jupiter). Una wallet que se conecta a través del enlace o código de un reclutador, o que aplica uno a mano antes de su primera operación, paga esa misma tarifa por defecto hasta que su propio volumen de operación acumulado en PANDA (compras y ventas juntas) llega a ${DISCOUNT_MIN_VOLUME} $ — a partir de ahí paga la mitad: el ${TRADE_REFERRED.es} en cada compra y el ${TRADE_REFERRED.es} en cada venta — de forma permanente, mientras siga operando en PANDA; una wallet que ya operaba en PANDA antes de que existiera este sistema de dos niveles pasó automáticamente a esa misma tarifa del ${TRADE_REFERRED.es} de inmediato, de forma permanente y sin que tuviera que hacer nada. Sea cual sea la tarifa que te corresponda, se paga en SOL a la wallet de tesorería de PANDA, como una transferencia aparte dentro de la misma transacción que firmas: en una compra es esa parte del SOL que gastas, añadida encima; en una venta es esa parte del SOL que recibes, estimada al construir la transacción. Si pagas con otro token, la comisión se cobra igualmente en SOL, encima. La misma tarifa se aplica al botón "Buy $PANDA" cuando el token exista.`,
        `Parte de las comisiones de creador. Cada moneda creada a través de PANDA otorga a PANDA el ${SHARE.es} de las comisiones de creador de esa moneda (la parte de las comisiones de trading que Pump.fun paga al creador de la moneda). Es igual en todas las monedas, y queda escrito en la configuración de comisiones on-chain de la moneda al crearla; no se puede cambiar ni quitar. El ${REST.es} restante lo asigna el creador a las wallets que elija. PANDA no cobra ninguna comisión aparte por crear una moneda.`,
        "Qué no es comisión de PANDA. Las comisiones de red de Solana, la renta de cuentas, las comisiones de prioridad (una fracción de céntimo por operación) y las comisiones de Pump.fun, PumpSwap, las rutas de Jupiter y los pools de los DEX van a esas redes y protocolos, no a PANDA. Los importes se muestran antes de firmar, en PANDA y en tu wallet. Con ninguna de las funciones opcionales de PANDA activada, las dos comisiones anteriores son las únicas que cobra PANDA; las comisiones de una función opcional se describen donde se describe esa función.",
        "Uso aceptable. Aceptas no usar PANDA para infringir la ley aplicable, manipular mercados, blanquear fondos o vulnerar los derechos de terceros. PANDA puede restringir el acceso a la aplicación (aunque no a los programas públicos subyacentes de Solana, con los que cualquiera puede interactuar directamente) a cuentas que abusen claramente de ella.",
        "Disponibilidad. PANDA puede pausar partes del servicio — por ejemplo, el lanzamiento de monedas — por seguridad o mantenimiento; cuando lo hace, la app lo indica. Si la app no puede confirmar que está conectada a la red de Solana correcta, pausa todo lo que mueve dinero y lo indica.",
        "Sin garantías. PANDA se ofrece \"tal cual\", sin garantías de ningún tipo. Los datos de mercado y los indicadores de riesgo provienen de terceros (la API pública de Pump.fun, Dexscreener, GeckoTerminal y RugCheck) y pueden llegar con retraso, estar limitados por rate-limit o no estar disponibles temporalmente — la app lo indica honestamente (un indicador \"en vivo\") en lugar de aparentar que unos datos desactualizados son actuales, pero no deberías depender de ello para decisiones críticas de tiempo.",
        "Limitación de responsabilidad. En la medida máxima permitida por la ley, PANDA y su operador no son responsables de las pérdidas derivadas del uso de la aplicación, incluyendo pérdidas por volatilidad de mercado, riesgo de los contratos inteligentes, servicios de terceros (proveedores de RPC de Solana, Pump.fun, Jupiter, GeckoTerminal, Dexscreener, RugCheck) o tus propios errores al operar.",
        "Cambios. Estos términos pueden actualizarse a medida que PANDA evolucione; la fecha del último cambio figura en esta página, y seguir usando la app tras un cambio implica aceptar los nuevos términos. Legislación aplicable: estos términos se rigen por la ley española.",
      ],
    },
  },
  "privacy-policy": {
    slug: "privacy-policy",
    updated: LEGAL_LAST_UPDATED,
    title: { en: "Privacy Policy", es: "Política de Privacidad" },
    body: {
      en: [
        DRAFT_NOTICE.en,
        "The short version: PANDA collects very little, because it doesn't need much to work. This page describes what the app actually does, not a generic template.",
        "Wallet data and records. When you connect a wallet, PANDA reads its public address and, for the Portfolio page, your real token balances on Solana — public data, read live. PANDA also stores, tied to public wallet addresses: the log of trades you make through PANDA (coin, side, amounts, the SOL price at that moment, public transaction signature, time) and, for Portfolio, trades read back from your public on-chain history, marked as estimates; records of on-chain activity PANDA verified (launches, trades, fee distributions), which feed the Activity and Analytics pages; the sign-in challenges and sessions of wallets that sign in (wallet address, a random session id, issue and expiry times, and whether the session was revoked); a coin's creator wallet and fee split while a launch is being confirmed; and an audit trail of sensitive actions (wallet address, action, object, public signature, time). None of these records contains your IP address. PANDA never receives, requests, or stores your seed phrase or private key.",
        "Where it is stored. Records live in a Postgres database hosted by Neon. Rate-limit counters and aggregated browser-security reports live in Upstash (Redis). Vercel runs the site; its functions, Neon's database and Upstash run in the United States (US East), so the data they process is transferred outside the European Union. Images and metadata you upload for a coin — and files of any feature that is not yet in the database — live in Vercel Blob, in Paris (France), at public addresses. During the move from file storage to the database, older copies of some records remain in Vercel Blob for a transition period and are then deleted.",
        "How long. Sessions last 2 hours; expired sessions and sign-in challenges are deleted automatically (challenges a day after they expire, sessions a week after). Rate-limit counters expire with their window. Audit entries can't be edited or deleted — the database refuses it, by design, so history can't be rewritten. Trade, activity and launch records are kept for 5 years.",
        "IP address. To protect the service from abuse, your IP address is used as a counter key in Upstash for the length of the rate-limit window only (normally one minute, up to one hour for a few actions), and then it expires. The hosting provider (Vercel) may also keep standard access logs, with IP addresses, for security and reliability. PANDA does not use them for tracking or marketing.",
        "Cookies and local storage. See the Cookie Policy: one technical cookie, set only if you sign in, and no analytics, advertising or session-replay tools.",
        "Third-party services. To show real data and build real transactions, your browser or PANDA's servers make requests to: Pump.fun (public API and coin images), GeckoTerminal and Dexscreener (market and pool data, prices, token names and logos), Jupiter (swap quotes and routing, and names, logos and prices of tokens in your wallet), RugCheck (a coin's risk indicator: PANDA's servers send it only the coin's address, your browser never connects to it, and the \"View on RugCheck\" link takes you to rugcheck.xyz, which has its own policies), a Solana RPC provider (reading balances, sending transactions — your browser talks to PANDA's own server, which calls the provider), the European Central Bank's euro reference rate through Frankfurter (currency conversion), and the public hosts where coin creators keep their images (your browser loads those directly, so those hosts see your IP address). These requests carry the technical information any web or API request does (for example the IP address, at network level). PANDA doesn't combine this with your wallet address or build a profile of you.",
      ],
      es: [
        DRAFT_NOTICE.es,
        "La versión corta: PANDA recopila muy poco, porque no necesita mucho para funcionar. Esta página describe lo que la aplicación realmente hace, no una plantilla genérica.",
        "Datos de la wallet y registros. Al conectar una wallet, PANDA lee tu dirección pública y, para la página de Portfolio, tus saldos reales de tokens en Solana — datos públicos, leídos en vivo. PANDA también guarda, asociados a direcciones públicas de wallet: el registro de las operaciones que haces a través de PANDA (moneda, sentido, importes, precio del SOL en ese momento, firma pública de la transacción, hora) y, para el Portfolio, operaciones leídas de tu historial público on-chain, marcadas como estimaciones; registros de actividad on-chain que PANDA verificó (lanzamientos, operaciones, repartos de comisiones), que alimentan las páginas de Actividad y Analítica; los desafíos de inicio de sesión y las sesiones de las wallets que inician sesión (dirección de wallet, un identificador aleatorio de sesión, horas de emisión y caducidad, y si la sesión fue revocada); la wallet del creador de una moneda y su reparto de comisiones mientras se confirma un lanzamiento; y un registro de auditoría de acciones sensibles (dirección de wallet, acción, objeto, firma pública, hora). Ninguno de estos registros contiene tu dirección IP. PANDA nunca recibe, solicita ni almacena tu frase semilla o clave privada.",
        "Dónde se guarda. Los registros están en una base de datos Postgres alojada en Neon. Los contadores de límite de peticiones y los informes agregados de seguridad del navegador están en Upstash (Redis). Vercel ejecuta el sitio; sus funciones, la base de datos de Neon y Upstash funcionan en Estados Unidos (US East), así que los datos que procesan se transfieren fuera de la Unión Europea. Las imágenes y metadatos que subes para una moneda — y los archivos de cualquier función que aún no esté en la base de datos — están en Vercel Blob, en París (Francia), en direcciones públicas. Durante el traslado del almacenamiento de archivos a la base de datos, quedan copias antiguas de algunos registros en Vercel Blob durante un periodo de transición, tras el cual se eliminan.",
        "Cuánto tiempo. Las sesiones duran 2 horas; las sesiones y los desafíos de inicio de sesión caducados se borran automáticamente (los desafíos un día después de caducar, las sesiones una semana después). Los contadores de límite de peticiones caducan con su ventana. Las entradas de auditoría no se pueden editar ni borrar — la base de datos lo rechaza, por diseño, para que el historial no pueda reescribirse. Los registros de operaciones, actividad y lanzamientos se conservan durante 5 años.",
        "Dirección IP. Para proteger el servicio de abusos, tu dirección IP se usa como clave de un contador en Upstash solo durante la ventana del límite de peticiones (normalmente un minuto, hasta una hora en unas pocas acciones), y después caduca. El proveedor de hosting (Vercel) también puede conservar registros de acceso estándar, con direcciones IP, por seguridad y fiabilidad. PANDA no los usa para rastreo ni marketing.",
        "Cookies y almacenamiento local. Consulta la Política de Cookies: una cookie técnica, que solo se establece si inicias sesión, y ninguna herramienta de analítica, publicidad ni grabación de sesiones.",
        "Servicios de terceros. Para mostrar datos reales y construir transacciones reales, tu navegador o los servidores de PANDA hacen peticiones a: Pump.fun (API pública e imágenes de monedas), GeckoTerminal y Dexscreener (datos de mercado y de pools, precios, nombres y logos de tokens), Jupiter (cotizaciones y enrutamiento de swaps, y nombres, logos y precios de los tokens de tu wallet), RugCheck (el indicador de riesgo de una moneda: los servidores de PANDA solo le envían la dirección de la moneda, tu navegador nunca se conecta a él, y el enlace \"Ver en RugCheck\" te lleva a rugcheck.xyz, que tiene sus propias políticas), un proveedor de RPC de Solana (lectura de saldos, envío de transacciones — tu navegador habla con el propio servidor de PANDA, que llama al proveedor), el tipo de cambio de referencia del euro del Banco Central Europeo a través de Frankfurter (conversión de moneda) y los hosts públicos donde los creadores guardan las imágenes de sus monedas (tu navegador las carga directamente, así que esos hosts ven tu dirección IP). Estas peticiones llevan la información técnica habitual de cualquier petición web o de API (por ejemplo, la dirección IP, a nivel de red). PANDA no combina esto con tu dirección de wallet ni construye un perfil sobre ti.",
      ],
    },
  },
  "risk-disclosure": {
    slug: "risk-disclosure",
    updated: LEGAL_LAST_UPDATED,
    title: { en: "Risk Disclosure", es: "Divulgación de Riesgos" },
    body: {
      en: [
        DRAFT_NOTICE.en,
        "Trading and creating coins through PANDA involves real, significant financial risk. Read this before you connect a wallet.",
        "Extreme volatility and total loss. Memecoins, including every coin created through PANDA and $PANDA itself, are highly speculative. Prices can move dramatically in minutes and can go to zero. Only ever risk money you can afford to lose completely.",
        "No guarantee of gains. Nothing in PANDA — a chart, a ranking, a past result — promises or suggests that you will make money. Most people who trade memecoins lose.",
        "No vetting, no endorsement. PANDA doesn't review, approve, or vouch for any coin created or traded through it. Anyone can create a coin with any name, image, or description — that alone says nothing about its legitimacy or future value.",
        "Third-party risk indicators. The RugCheck badge on a coin is an automatic check by a third party. It can be wrong, incomplete or out of date; a good badge doesn't mean a coin is safe, and PANDA neither runs nor vouches for it.",
        "Smart contract and program risk. Trades and coin creation execute through Pump.fun's, PumpSwap's, and (for non-Pump.fun coins) third-party DEXes' public Solana programs, plus Jupiter's routing. PANDA didn't write these programs and can't guarantee they're free of bugs or exploits.",
        `Network and execution risk. Solana network congestion, RPC issues, or slippage can cause a transaction to fail, execute at a worse price than expected, or take longer than expected to confirm. Network fees are real and non-refundable once a transaction confirms, even if the trade itself doesn't go the way you hoped. PANDA's ${TRADE.en} fee is charged on every buy and sell, including trades that end at a loss.`,
        "Price impact on large orders. A buy or sell that is large relative to a coin's own liquidity moves its price as it executes — you can receive noticeably less (selling) or pay noticeably more (buying) than the price shown when you started. PANDA estimates and shows this before you confirm a large trade, but it is an estimate, not a guarantee, and market conditions can change between the estimate and execution.",
        "Launching a coin. A launch is real and cannot be undone: the coin, and PANDA's fixed share of its creator fees, are written on-chain. Creating a coin does not create demand for it.",
        "Not investment advice. Nothing in PANDA — including market data, stats, or any coin's presence in a \"Trending\" or \"Top Gainers\" list — is a recommendation to buy, sell, or hold anything. See also: Disclaimer.",
      ],
      es: [
        DRAFT_NOTICE.es,
        "Operar y crear monedas a través de PANDA implica un riesgo financiero real y significativo. Lee esto antes de conectar una wallet.",
        "Volatilidad extrema y pérdida total. Las memecoins, incluida cualquier moneda creada a través de PANDA y $PANDA misma, son altamente especulativas. Los precios pueden moverse drásticamente en minutos y pueden llegar a cero. Arriesga únicamente dinero que puedas permitirte perder por completo.",
        "Sin garantía de ganancias. Nada en PANDA — un gráfico, un ranking, un resultado pasado — promete ni sugiere que vayas a ganar dinero. La mayoría de las personas que operan con memecoins pierden.",
        "Sin revisión ni respaldo. PANDA no revisa, aprueba ni avala ninguna moneda creada u operada a través de ella. Cualquiera puede crear una moneda con cualquier nombre, imagen o descripción — eso por sí solo no dice nada sobre su legitimidad o valor futuro.",
        "Indicadores de riesgo de terceros. La insignia de RugCheck de una moneda es una comprobación automática de un tercero. Puede equivocarse, estar incompleta o desactualizada; una insignia buena no significa que una moneda sea segura, y PANDA ni la realiza ni la avala.",
        "Riesgo de contratos inteligentes y programas. Las operaciones y la creación de monedas se ejecutan a través de los programas públicos de Solana de Pump.fun, PumpSwap y (para monedas que no son de Pump.fun) DEXes de terceros, además del enrutamiento de Jupiter. PANDA no escribió estos programas y no puede garantizar que estén libres de errores o vulnerabilidades.",
        `Riesgo de red y ejecución. La congestión de la red Solana, problemas de RPC o el slippage pueden hacer que una transacción falle, se ejecute a un precio peor del esperado, o tarde más de lo previsto en confirmarse. Las comisiones de red son reales y no reembolsables una vez confirmada la transacción, aunque la operación en sí no salga como esperabas. La comisión del ${TRADE.es} de PANDA se cobra en cada compra y venta, también en las que terminan con pérdidas.`,
        "Impacto de precio en órdenes grandes. Una compra o venta grande respecto a la liquidez propia de una moneda mueve su precio al ejecutarse — puedes recibir notablemente menos (al vender) o pagar notablemente más (al comprar) que el precio mostrado al empezar. PANDA estima y muestra esto antes de confirmar una operación grande, pero es una estimación, no una garantía, y las condiciones del mercado pueden cambiar entre la estimación y la ejecución.",
        "Lanzar una moneda. Un lanzamiento es real y no se puede deshacer: la moneda, y la parte fija de PANDA en sus comisiones de creador, quedan escritas on-chain. Crear una moneda no crea demanda para ella.",
        "No es asesoramiento de inversión. Nada en PANDA — incluyendo datos de mercado, estadísticas, o la presencia de una moneda en una lista de \"Tendencia\" o \"Mayores subidas\" — es una recomendación para comprar, vender o mantener nada. Ver también: Aviso General (Disclaimer).",
      ],
    },
  },
  "cookie-policy": {
    slug: "cookie-policy",
    updated: LEGAL_LAST_UPDATED,
    title: { en: "Cookie Policy", es: "Política de Cookies" },
    body: {
      en: [
        DRAFT_NOTICE.en,
        "PANDA sets one cookie, and only when you choose to sign in with your wallet (a free message signature). Name: panda_session. Purpose: it proves which wallet you signed in with, so that actions that need it can trust the request; it holds a signed token and a random session id, and nothing else about you. Duration: 2 hours, or until you disconnect or close your sessions. Properties: HttpOnly, Secure, SameSite=Strict. It is a strictly necessary session cookie. Browsing PANDA without signing in sets no cookie at all.",
        "PANDA doesn't use analytics, advertising, tracking or session-replay cookies or scripts, so it shows no cookie banner.",
        "Local storage in your browser (it stays in your browser and is never sent to PANDA): panda-lang remembers your display language (English or Spanish); panda.buy.unit remembers, on coin pages, the currency you prefer to type amounts in; panda.sell.unit remembers, on coin pages, which currency you prefer to see a sell's proceeds in (SOL, dollars or euros); panda.chart.unit remembers whether a coin's chart shows price or market cap; walletName, set by the wallet library PANDA uses, remembers the name of the last wallet you connected so the app can reconnect it. It stays until you clear your browser data.",
        "Your wallet extension (for example Phantom or Solflare) may use its own browser storage to remember your connection preferences — that storage is controlled entirely by the extension, not by PANDA, and is covered by that extension's own privacy practices, not this one.",
        "If this ever changes — for example, if PANDA adds another feature that needs a cookie or local storage — this page will be updated to describe exactly what is stored and why, and the date above will change.",
      ],
      es: [
        DRAFT_NOTICE.es,
        "PANDA establece una sola cookie, y solo cuando decides iniciar sesión con tu wallet (una firma gratuita de un mensaje). Nombre: panda_session. Finalidad: acredita con qué wallet iniciaste sesión, para que las acciones que lo necesitan puedan fiarse de la petición; contiene un token firmado y un identificador aleatorio de sesión, y nada más sobre ti. Duración: 2 horas, o hasta que te desconectes o cierres tus sesiones. Propiedades: HttpOnly, Secure, SameSite=Strict. Es una cookie de sesión estrictamente necesaria. Navegar por PANDA sin iniciar sesión no establece ninguna cookie.",
        "PANDA no usa cookies ni scripts de analítica, publicidad, rastreo o grabación de sesiones, así que no muestra ningún banner de cookies.",
        "Almacenamiento local en tu navegador (se queda en tu navegador y nunca se envía a PANDA): panda-lang recuerda tu idioma (inglés o español); panda.buy.unit recuerda, en las páginas de moneda, la moneda en que prefieres escribir los importes; panda.sell.unit recuerda, en las páginas de moneda, en qué moneda prefieres ver lo que recibes al vender (SOL, dólares o euros); panda.chart.unit recuerda si el gráfico de una moneda muestra el precio o la capitalización de mercado; walletName, que establece la librería de wallets que usa PANDA, recuerda el nombre de la última wallet que conectaste para poder reconectarla. Permanece hasta que borres los datos de tu navegador.",
        "Tu extensión de wallet (por ejemplo, Phantom o Solflare) puede usar su propio almacenamiento del navegador para recordar tus preferencias de conexión — ese almacenamiento lo controla la propia extensión, no PANDA, y se rige por las prácticas de privacidad de esa extensión, no por esta.",
        "Si esto cambia alguna vez — por ejemplo, si PANDA añade otra función que necesite una cookie o almacenamiento local — esta página se actualizará para describir exactamente qué se guarda y por qué, y cambiará la fecha de arriba.",
      ],
    },
  },
  disclaimer: {
    slug: "disclaimer",
    updated: LEGAL_LAST_UPDATED,
    title: { en: "Disclaimer", es: "Aviso General" },
    body: {
      en: [
        DRAFT_NOTICE.en,
        "PANDA is a software interface for creating and trading coins on Solana. Its buying, selling and coin-creation flows are non-custodial: PANDA does not hold your funds or keys for them. PANDA is not a financial advisor, broker, dealer, exchange, or bank, and nothing in the app constitutes financial, investment, legal, or tax advice.",
        "Market data, stats, and charts shown in PANDA (including on the Analytics page and Home sections) come from Pump.fun's public API, Dexscreener and GeckoTerminal (and the coin risk indicators from RugCheck) and reflect real on-chain activity — but can be incomplete, delayed, or temporarily unavailable. Coins whose numbers look unreliable are left out of the lists. The app is built to say when data is not live rather than silently show stale numbers as current.",
        PANDA_TOKEN_NOT_LAUNCHED.en,
        "Any third-party links (a coin's website, X/Twitter, or Telegram, as supplied by its creator) are provided as-is. PANDA doesn't control or vet that content.",
        "You are solely responsible for your own decisions when using PANDA. Do your own research before creating, buying, selling, or holding any coin. Nothing here guarantees a profit or protects you from a loss.",
      ],
      es: [
        DRAFT_NOTICE.es,
        "PANDA es una interfaz de software para crear y operar monedas en Solana. Sus flujos de compra, venta y creación de monedas son no custodiales: PANDA no retiene tus fondos ni tus claves para ellos. PANDA no es un asesor financiero, bróker, dealer, exchange ni banco, y nada en la aplicación constituye asesoramiento financiero, de inversión, legal o fiscal.",
        "Los datos de mercado, estadísticas y gráficos que se muestran en PANDA (incluyendo la página de Analítica y las secciones de Inicio) proceden de la API pública de Pump.fun, Dexscreener y GeckoTerminal (y los indicadores de riesgo de las monedas, de RugCheck) y reflejan actividad real on-chain — pero pueden estar incompletos, retrasados o no disponibles temporalmente. Las monedas cuyas cifras parecen poco fiables se dejan fuera de las listas. La app está construida para indicar cuándo los datos no son en vivo en lugar de mostrar en silencio datos desactualizados como si fueran actuales.",
        PANDA_TOKEN_NOT_LAUNCHED.es,
        "Cualquier enlace a terceros (el sitio web, X/Twitter o Telegram de una moneda, tal como los proporciona su creador) se ofrece tal cual. PANDA no controla ni verifica ese contenido.",
        "Eres el único responsable de tus propias decisiones al usar PANDA. Investiga por tu cuenta antes de crear, comprar, vender o mantener cualquier moneda. Nada de esto garantiza un beneficio ni te protege de una pérdida.",
      ],
    },
  },
};

export const LEGAL_SLUGS = Object.keys(LEGAL_PAGES) as LegalSlug[];

type Addenda = Partial<Record<LegalSlug, Record<Lang, string[]>>>;

/**
 * Paragraphs that exist ONLY while FEATURE_STRATEGIES is on: the custody of Jupiter's Trigger vault (held by Privy) and
 * its risks. Kept out of LEGAL_PAGES on purpose — with the flag off the app has no such feature, and describing it would
 * be as wrong as hiding it when it is on. Appended by getLegalPage.
 */
export const CUSTODY_ADDENDA: Addenda = {
  "legal-notice": {
    en: [
      "Draw Your Trade strategies that include a buy (buy + sell + stop) are custodial. They are built on Jupiter's Trigger API, which moves the deposited tokens into a vault managed by Jupiter and held by Privy until the order or strategy fills or is cancelled. PANDA has no keys and no access to that vault and cannot move or withdraw the funds; only you can take them out, by signing the cancellation in your wallet. It is still a genuine exception to PANDA's otherwise non-custodial design, and the app says so before any deposit. Sells and stops on a coin you already hold are never placed through Jupiter. The former Stop Loss / Take Profit panel has been removed; any order created with it stays in Jupiter's vault until it fills, expires or you cancel it, and you can still see and cancel it from Draw Your Trade.",
    ],
    es: [
      "Las estrategias de Draw Your Trade que incluyen una compra (compra + venta + stop) son custodiales. Se construyen sobre la Trigger API de Jupiter, que traslada los tokens depositados a una bóveda gestionada por Jupiter y custodiada por Privy hasta que la orden o estrategia se ejecuta o se cancela. PANDA no tiene claves ni acceso a esa bóveda y no puede mover ni retirar los fondos; solo tú puedes sacarlos, firmando la cancelación en tu wallet. Aun así es una excepción real al diseño no custodial del resto de PANDA, y la app lo indica antes de cualquier depósito. Las ventas y los stops sobre una moneda que ya tienes nunca se colocan a través de Jupiter. El antiguo panel de Stop Loss / Take Profit se ha retirado; cualquier orden creada con él sigue en la bóveda de Jupiter hasta que se ejecute, caduque o la canceles, y puedes seguir viéndola y cancelándola desde Draw Your Trade.",
    ],
  },
  "terms-of-service": {
    en: [
      "Custodial exception: Draw Your Trade strategies with a buy. Setting one up deposits the SOL / USDC that will fund the buy (and then the coins it buys) into a Jupiter Trigger vault — a custodial account managed by Privy on Jupiter's service, not PANDA's — until the order fills or you cancel it. PANDA has no keys or access to the vault; Jupiter's service executes the order when it triggers, and only you can withdraw, by signing the cancellation, which returns the funds to your wallet. Using this feature is optional and you accept the custody terms of Jupiter and Privy when you do. Sells and stops on a coin you already hold are never placed through Jupiter.",
      `Fees of these features. A Draw Your Trade strategy carries PANDA's same two-tier trading fee, doubled (its buy leg plus its sell leg, both paid up front when you confirm): ${STRATEGY.en} in total at the default rate, or ${STRATEGY_REFERRED.en} in total at the referred/legacy rate — it is not returned if you cancel before the strategy buys. Jupiter's own fees and network fees are separate and are not PANDA's. Orders left from the former Stop Loss / Take Profit panel carry no PANDA fee, and cancelling them carries none either.`,
    ],
    es: [
      "Excepción custodial: estrategias de Draw Your Trade con compra. Configurar una deposita el SOL / USDC que financiará la compra (y después las monedas que compre) en una bóveda de Jupiter Trigger — una cuenta custodial gestionada por Privy en el servicio de Jupiter, no por PANDA — hasta que la orden se ejecuta o la cancelas. PANDA no tiene claves ni acceso a la bóveda; el servicio de Jupiter ejecuta la orden cuando se activa, y solo tú puedes retirar, firmando la cancelación, que devuelve los fondos a tu wallet. Usar esta función es opcional y, al hacerlo, aceptas las condiciones de custodia de Jupiter y Privy. Las ventas y los stops sobre una moneda que ya tienes nunca se colocan a través de Jupiter.",
      `Comisiones de estas funciones. Una estrategia de Draw Your Trade lleva la misma comisión de trading de dos niveles de PANDA, duplicada (su pata de compra más su pata de venta, ambas pagadas por adelantado al confirmar): el ${STRATEGY.es} en total a la tarifa por defecto, o el ${STRATEGY_REFERRED.es} en total a la tarifa de referido/veterano — no se devuelve si cancelas antes de que la estrategia compre. Las comisiones propias de Jupiter y las de red son aparte y no son de PANDA. Las órdenes que queden del antiguo panel de Stop Loss / Take Profit no llevan comisión de PANDA, y cancelarlas tampoco.`,
    ],
  },
  "privacy-policy": {
    en: [
      "Draw Your Trade strategies with a buy. Only if you set one up — or view or cancel an order left from the former Stop Loss / Take Profit panel — your wallet address, the order details and a Jupiter sign-in are sent to Jupiter's Trigger API and its vault provider Privy. PANDA also stores your strategies (prices, amounts, state, public transaction signatures) tied to your wallet address; the Jupiter session token is kept only in your browser's memory, and PANDA's server only forwards it to Jupiter, never storing it.",
    ],
    es: [
      "Estrategias de Draw Your Trade con compra. Solo si configuras una — o ves o cancelas una orden que quede del antiguo panel de Stop Loss / Take Profit —, tu dirección de wallet, los datos de la orden y un inicio de sesión de Jupiter se envían a la Trigger API de Jupiter y a su proveedor de bóvedas, Privy. PANDA además guarda tus estrategias (precios, importes, estado, firmas públicas de transacciones) asociadas a tu dirección de wallet; el token de sesión de Jupiter solo se mantiene en la memoria de tu navegador, y el servidor de PANDA solo lo reenvía a Jupiter, sin guardarlo.",
    ],
  },
  "cookie-policy": {
    en: [
      "Draw Your Trade also keeps, in your browser's local storage, the drafts of strategies you have drawn but not confirmed, under a key named panda.draw.v1 followed by the coin's address. It stays in your browser until you delete it or clear your data.",
      "The notification bell keeps, in your browser's local storage, how far you have read its history, under a key named panda.notif.seen followed by your wallet address. It stays until you delete it or clear your data; the notifications themselves are not stored there, only that marker.",
    ],
    es: [
      "Draw Your Trade guarda además, en el almacenamiento local de tu navegador, los borradores de las estrategias que has dibujado pero no confirmado, bajo una clave llamada panda.draw.v1 seguida de la dirección de la moneda. Permanece en tu navegador hasta que la borres o borres tus datos.",
      "La campana de avisos guarda, en el almacenamiento local de tu navegador, hasta dónde has leído su historial, bajo una clave llamada panda.notif.seen seguida de tu dirección de wallet. Permanece hasta que la borres o borres tus datos; los avisos en sí no se guardan ahí, solo esa marca.",
    ],
  },
  "risk-disclosure": {
    en: [
      "Draw Your Trade strategies with a buy are custodial — a different risk than the rest of PANDA (and so are any orders left from the former Stop Loss / Take Profit panel, until they fill or you cancel them). Setting one up moves your funds into a Jupiter Trigger vault, a custodial account managed by Privy on Jupiter's service, to which PANDA has no keys and no access. For as long as an order or strategy is open you are trusting Jupiter's and Privy's infrastructure, security and availability, not just Solana's. If those services fail, are attacked, or are unavailable, your funds may be inaccessible or lost, and PANDA cannot recover them. An order may not execute at your price (slippage, thin liquidity, network congestion) or at all, and a strategy that buys can leave you holding tokens if its exit does not fill. Only deposit what you are comfortable holding in a third-party custodian, and get your own legal and tax advice — custody and crypto-asset services are regulated in many jurisdictions.",
      "Target orders execute when the price reaches your level, but slippage and volatility mean the fill can be at a materially different price than the one you set — better or worse. A thin or highly volatile coin (low liquidity, or a large recent price swing) makes this gap larger; the app flags this when it detects it, but the underlying risk exists regardless of the flag.",
    ],
    es: [
      "Las estrategias de Draw Your Trade con compra son custodiales — un riesgo distinto al del resto de PANDA (y también las órdenes que queden del antiguo panel de Stop Loss / Take Profit, hasta que se ejecuten o las canceles). Configurar una traslada tus fondos a una bóveda de Jupiter Trigger, una cuenta custodial gestionada por Privy en el servicio de Jupiter, a la que PANDA no tiene claves ni acceso. Mientras una orden o estrategia esté abierta confías en la infraestructura, la seguridad y la disponibilidad de Jupiter y Privy, no solo en las de Solana. Si esos servicios fallan, sufren un ataque o no están disponibles, tus fondos pueden quedar inaccesibles o perderse, y PANDA no puede recuperarlos. Una orden puede no ejecutarse a tu precio (slippage, poca liquidez, congestión de red) o no ejecutarse en absoluto, y una estrategia que compra puede dejarte con tokens si su salida no se ejecuta. Deposita solo lo que te sientas cómodo manteniendo en un custodio externo y busca tu propio asesoramiento legal y fiscal — la custodia y los servicios con criptoactivos están regulados en muchas jurisdicciones.",
      "Las órdenes con objetivo de precio se ejecutan cuando el precio alcanza tu nivel, pero el slippage y la volatilidad hacen que el precio final pueda ser bastante distinto del que marcaste — mejor o peor. Una moneda con poca liquidez o muy volátil (un movimiento de precio grande y reciente) hace que esa diferencia sea mayor; la app lo avisa cuando lo detecta, pero el riesgo existe independientemente del aviso.",
    ],
  },
  disclaimer: {
    en: ["Draw Your Trade strategies with a buy use a third-party custodial vault (Jupiter, held by Privy) — see Risk Disclosure and Legal Notice."],
    es: ["Las estrategias de Draw Your Trade con compra usan una bóveda custodial de un tercero (Jupiter, custodiada por Privy) — ver Divulgación de Riesgos y Aviso Legal."],
  },
};

/**
 * Paragraphs that exist ONLY while FEATURE_HOLDER_REWARDS is on: the Holders share of a coin's creator fees is
 * paid to a wallet whose key is held by PANDA's servers, so this is the one place PANDA itself ever holds
 * funds — but only in transit, automatically, never waiting on anyone to claim. With the flag off there is no
 * such flow and these must not appear (see getLegalPage).
 */
export const HOLDER_ADDENDA: Addenda = {
  "legal-notice": {
    en: [
      `Holder rewards are the one feature in which PANDA itself briefly holds funds, only in transit. If a coin's creator assigns part of its creator fees to "Holders", those fees are paid on-chain to PANDA's Rewards Pool wallet (whose key is held by PANDA's servers), and sent straight on to the coin's holders, in SOL and in proportion to what each one holds, automatically — nothing to claim, no signature needed from a holder's wallet. A coin's own Holders share only pays out once it has built up at least ${HOLDER_PAYOUT_MIN_SOL} SOL; below that it simply waits in the Rewards Pool wallet for the next collection to add to it.`,
    ],
    es: [
      `Las recompensas de holders son la única función en la que PANDA retiene fondos por sí misma, y solo de paso. Si el creador de una moneda asigna parte de sus comisiones a "Holders", esas comisiones se pagan on-chain a la wallet del Rewards Pool de PANDA (cuya clave custodian los servidores de PANDA), y se envían directamente a los holders de la moneda, en SOL y en proporción a lo que tiene cada uno, de forma automática — no hay nada que reclamar, ni se necesita ninguna firma de la wallet de un holder. La parte de Holders de una moneda solo se reparte cuando acumula al menos ${HOLDER_PAYOUT_MIN_SOL} SOL; por debajo de eso, simplemente espera en la wallet del Rewards Pool a que la siguiente recolección la aumente.`,
    ],
  },
  "terms-of-service": {
    en: [
      `Holder rewards are paid automatically. Fees a creator assigns to "Holders" are paid to PANDA's Rewards Pool wallet, controlled by PANDA's servers, and sent on to every eligible holder automatically, in SOL, the same run that collects them, once a coin's own Holders balance reaches ${HOLDER_PAYOUT_MIN_SOL} SOL — nothing for a holder to claim or sign. A payout this small it wouldn't survive as a transfer, or that belongs to the bonding curve, the trading pool, a program-owned account, or anyone already paid directly by the coin's own fee split (the creator, PANDA, the Rewards Pool itself), is never sent — it's simply left for the next round. PANDA takes no fee from a holder payout, and the Solana network fee of collecting the coin's creator fees and of sending them on to holders is never taken out of a holder's share either — what is credited to a holder and what actually arrives in their wallet are always the same number. PANDA pays that network fee itself, from the Rewards Pool wallet's own operating balance, which PANDA funds and keeps topped up separately from whatever the pool currently owes holders.`,
    ],
    es: [
      `Las recompensas de holders se pagan automáticamente. Las comisiones que un creador asigna a "Holders" se pagan a la wallet del Rewards Pool de PANDA, controlada por sus servidores, y se envían a cada holder que corresponda de forma automática, en SOL, en la misma ejecución en que se recolectan, en cuanto la parte de Holders de una moneda llega a ${HOLDER_PAYOUT_MIN_SOL} SOL — no hay nada que un holder deba reclamar ni firmar. Un pago tan pequeño que no sobreviviría como transferencia, o que pertenezca a la bonding curve, al pool de trading, a una cuenta de un programa, o a quien ya cobra directamente del propio reparto de comisiones de la moneda (el creador, PANDA, el propio Rewards Pool), nunca se envía — simplemente queda para la siguiente ronda. PANDA no cobra ninguna comisión sobre un pago a holders, y tampoco se descuenta de la parte de un holder la comisión de red de Solana de recolectar las comisiones de creador de la moneda ni la de enviárselas después — lo que se acredita a un holder y lo que de verdad llega a su wallet son siempre el mismo número. Esa comisión de red la paga PANDA de su propio bolsillo, con el saldo operativo de la wallet del Rewards Pool, que PANDA financia y mantiene por separado de lo que el pool deba en cada momento a los holders.`,
    ],
  },
  "privacy-policy": {
    en: ["Holder rewards. PANDA keeps a record, in its database, of the rewards owed to and already paid to each wallet address, and of each automatic payout round."],
    es: ["Recompensas de holders. PANDA guarda en su base de datos un registro de las recompensas pendientes y ya pagadas a cada dirección de wallet, y de cada ronda de reparto automático."],
  },
  "risk-disclosure": {
    en: [
      `Fee distribution and holder rewards are real but still evolving. A coin's on-chain "Holder" fee share (see Fee Distribution in Create) determines how much of its creator fees route toward holders; those fees are paid to PANDA's Rewards Pool wallet, which PANDA's servers control, and PANDA sends them straight on to holders automatically — so for holder rewards you are trusting PANDA's infrastructure and key management, even though funds only ever pass through briefly rather than sitting there waiting to be claimed. Payouts depend on the automated collection and payout job actually running on schedule, and only happen once a coin's Holders balance crosses ${HOLDER_PAYOUT_MIN_SOL} SOL — past fee activity is never a guarantee of future rewards, and a balance below that threshold can sit unpaid for a while.`,
    ],
    es: [
      `El reparto de comisiones y las recompensas a holders son reales, pero siguen evolucionando. El porcentaje on-chain de "Holders" de una moneda (ver Fee Distribution en Create) determina qué parte de las comisiones del creador va a los holders; esas comisiones se pagan a la wallet del Rewards Pool de PANDA, que controlan los servidores de PANDA, y PANDA las envía directamente a los holders de forma automática — así que, para las recompensas de holders, confías en la infraestructura y la gestión de claves de PANDA, aunque los fondos solo pasan por ahí brevemente en vez de quedarse esperando a que alguien los reclame. Los pagos dependen de que la tarea automática de recolección y reparto se ejecute según lo previsto, y solo ocurren cuando la parte de Holders de una moneda supera los ${HOLDER_PAYOUT_MIN_SOL} SOL — la actividad pasada de comisiones nunca garantiza recompensas futuras, y un saldo por debajo de ese umbral puede quedar sin pagar durante un tiempo.`,
    ],
  },
  disclaimer: {
    en: ["Holder rewards are the one exception to PANDA's non-custodial design: their fees pass briefly through a wallet controlled by PANDA's servers before being sent on to holders automatically (see Risk Disclosure and Legal Notice)."],
    es: ["Las recompensas de holders son la única excepción al diseño no custodial de PANDA: sus comisiones pasan brevemente por una wallet controlada por los servidores de PANDA antes de enviarse a los holders de forma automática (ver Divulgación de Riesgos y Aviso Legal)."],
  },
};

/** Only while FEATURE_OTC_REWARDS is on: the "Rewards" launch mode, built by a third party's launcher. */
export const OTC_ADDENDA: Addenda = {
  "terms-of-service": {
    en: ["Rewards launch mode. Coins launched in \"Rewards\" mode are built by OTC's Meteora launcher, a third-party service, in two transactions you sign in your own wallet; PANDA does not hold your funds or keys in this mode. The fee and reward rules of these launches are OTC's, are shown on screen before you sign, and are not PANDA's."],
    es: ["Modo de lanzamiento Rewards. Las monedas lanzadas en modo \"Rewards\" las construye el launcher de Meteora de OTC, un servicio de terceros, en dos transacciones que firmas en tu propia wallet; PANDA no retiene tus fondos ni tus claves en este modo. Las reglas de comisiones y recompensas de estos lanzamientos son las de OTC, se muestran en pantalla antes de firmar y no son las de PANDA."],
  },
  "privacy-policy": {
    en: ["Rewards launch mode. Only if you launch in \"Rewards\" mode, the coin's name, image and details, your wallet address and the chosen reward asset are sent to OTC's services (otcdesks.cash) so that it can build and list the launch."],
    es: ["Modo de lanzamiento Rewards. Solo si lanzas en modo \"Rewards\", el nombre, la imagen y los datos de la moneda, tu dirección de wallet y el activo de recompensa elegido se envían a los servicios de OTC (otcdesks.cash) para que pueda construir y listar el lanzamiento."],
  },
  "risk-disclosure": {
    en: ["Rewards launches depend on a third party's launcher and rules (OTC, Meteora). PANDA did not write them and cannot guarantee how they behave, or that a reward asset keeps any value."],
    es: ["Los lanzamientos Rewards dependen del launcher y de las reglas de un tercero (OTC, Meteora). PANDA no los escribió y no puede garantizar cómo se comportan, ni que un activo de recompensa conserve ningún valor."],
  },
};

/** Only while the NFT themes are on (FEATURE_NFT_THEMES). */
export const NFT_ADDENDA: Addenda = {
  "terms-of-service": {
    en: ["NFT themes. Creating an NFT in a theme has no PANDA fee: you pay only Solana network fees and account rent. The creator royalty of each theme applies to resales made through PANDA's market; other marketplaces may not honour it. What you mint is permanent: its name and image link can't be changed."],
    es: ["Temas de NFT. Crear un NFT en un tema no tiene comisión de PANDA: solo pagas las comisiones de red de Solana y la renta de cuentas. La regalía de creador de cada tema se aplica a las reventas hechas a través del mercado de PANDA; otros mercados pueden no respetarla. Lo que acuñas es permanente: su nombre y el enlace de su imagen no se pueden cambiar."],
  },
  "privacy-policy": {
    en: ["NFT themes. The artwork you upload is stored in Vercel Blob at a public address, and PANDA keeps records of NFTs, themes, branches and sales tied to your wallet address."],
    es: ["Temas de NFT. La ilustración que subes se guarda en Vercel Blob en una dirección pública, y PANDA guarda registros de NFT, temas, ramas y ventas asociados a tu dirección de wallet."],
  },
  "risk-disclosure": {
    en: ["NFTs may be hard or impossible to resell, and their value can fall to zero. A theme closing means no more NFTs can be made in it; it says nothing about their value."],
    es: ["Un NFT puede ser difícil o imposible de revender, y su valor puede caer a cero. Que un tema se cierre significa que no se pueden crear más NFT en él; no dice nada de su valor."],
  },
};

/** Only while the NFT marketplace is on (FEATURE_NFT_THEMES and FEATURE_NFT_MARKET). */
export const MARKET_ADDENDA: Addenda = {
  "terms-of-service": {
    en: [`NFT marketplace fee. PANDA charges ${MARKET.en} on every sale made in its marketplace, on top of the creator's royalty (which is not reduced). The buy screen shows the exact split — to the seller, to the creator, to PANDA — before you sign.`],
    es: [`Comisión del mercado de NFT. PANDA cobra el ${MARKET.es} de cada venta realizada en su mercado, además de la regalía del creador (que no se reduce). La pantalla de compra muestra el reparto exacto — al vendedor, al creador, a PANDA — antes de firmar.`],
  },
};

/** Only while PANDA Points are on (FEATURE_PANDA_POINTS). */
export const POINTS_ADDENDA: Addenda = {
  "terms-of-service": {
    en: ["PANDA Points. Points are a record of activity through PANDA. They aren't money, have no guaranteed value, and past activity doesn't guarantee future rewards. PANDA's checks can restrict a wallet's points or exclude them from an epoch when activity looks like abuse; a person reviews every case, and you can appeal."],
    es: ["PANDA Points. Los puntos son un registro de actividad a través de PANDA. No son dinero, no tienen valor garantizado, y la actividad pasada no garantiza recompensas futuras. Las comprobaciones de PANDA pueden restringir los puntos de una wallet o excluirlos de un epoch cuando la actividad parece abuso; una persona revisa cada caso, y puedes apelar."],
  },
  "privacy-policy": {
    en: ["PANDA Points. PANDA keeps your points events and totals, and the results of its abuse checks (for example wallets funded by the same source or trades of identical size), tied to your wallet address; appeals you send are stored with it."],
    es: ["PANDA Points. PANDA guarda tus eventos y totales de puntos, y los resultados de sus comprobaciones de abuso (por ejemplo, wallets financiadas por la misma fuente u operaciones de idéntico tamaño), asociados a tu dirección de wallet; las apelaciones que envíes se guardan con ellos."],
  },
};

/** Only while PANDA airdrops are on (FEATURE_PANDA_AIRDROPS). */
export const AIRDROP_ADDENDA: Addenda = {
  "terms-of-service": {
    en: ["Airdrops. An epoch's airdrop is paid in PANDA tokens, in proportion to your points, and is claimed with a proof against a published Merkle root. An airdrop is not guaranteed, and its tokens carry no promised value."],
    es: ["Airdrops. El airdrop de un epoch se paga en tokens PANDA, en proporción a tus puntos, y se reclama con una prueba frente a una raíz de Merkle publicada. Un airdrop no está garantizado, y sus tokens no tienen ningún valor prometido."],
  },
  "risk-disclosure": {
    en: ["Airdrop tokens can lose all value, and claims can be paused if an epoch's data can't be verified."],
    es: ["Los tokens de un airdrop pueden perder todo su valor, y los reclamos pueden pausarse si los datos de un epoch no se pueden verificar."],
  },
};

/** Only while the Recruiters program is on (FEATURE_REFERRALS) — permanent (not a time-limited campaign). */
export const REFERRAL_ADDENDA: Addenda = {
  "terms-of-service": {
    en: [
      `Recruiters program. Every connected wallet has its own link and can pick its own short code (its link becomes ${SITE_DOMAIN}/r/<code>) once PANDA accepts it (format rules and a reserved/offensive-word check — PANDA can still remove a code by hand if something slips through); a code is permanent once set. The page of any coin launched through PANDA's own Create flow doubles as its creator's link. The wallet that connects through a link or code for the first time is permanently credited to whoever shared it — first one wins, it cannot be changed later, a wallet cannot refer itself, and there is no limit to how many people one recruiter can bring in. A wallet that didn't arrive through a link can instead type a code by hand, on the Recruiters page or when it first connects — but only once, and only before its first trade; after that, no code can be applied. Only one level counts — you are never paid for who your own invitees bring in. A wallet whose very first SOL came from the wallet inviting it does not count as a referral (checked against its on-chain history when the link is created, and retried on a later sign-in if that check can't be completed yet — a referral is never accepted blindly). The direct benefit to being referred: half of PANDA's trading fee, for life, once your own volume reaches the threshold — see the Fees section above.`,
      `Trader status and tiers. An invited wallet becomes "active" once it trades on PANDA on 3 consecutive UTC days with its own volume that day at or above the published minimum, and becomes inactive again after 3 consecutive days with no qualifying day (it reactivates the same way). A recruiter earns a share of PANDA's own trading fee — whatever rate the invitee is actually paying at the time (the default rate until that invitee's own volume reaches $${DISCOUNT_MIN_VOLUME}, ${TRADE_REFERRED.en} from then on — see the Fees section) — on every trade its invitees make from their very first one, active or not — paid at the tier the invitee would be on if they were active. Tiers are marginal, by live rank among a recruiter's currently active invitees, in order of when each first became active: ${TIER1.en} of that fee (${TIER1_OF_TRADE.en} of the trade once the invitee pays the referred rate, more of the trade before that, since the fee itself is bigger) for the 1st–500th, ${TIER2.en} (${TIER2_OF_TRADE.en} of the trade) for the 501st–1,500th, ${TIER3.en} (${TIER3_OF_TRADE.en} of the trade) for the 1,501st on. When an active invitee goes inactive, everyone who ranked after them moves up — bringing in more people, or someone else going inactive, never lowers the % anyone else already earns. The payment is a separate transfer inside the trader's own transaction, straight from their wallet to the recruiter's, alongside PANDA's trade fee — PANDA never holds this money, not even briefly. If a recruiter's own wallet can't receive the payment, that share goes to PANDA's treasury instead and the trade is never affected, delayed, or changed in any other way for the person trading.`,
      `Founders. The first 1,000 recruiters to reach ${DEFAULT_FOUNDER_REQUIRED_TRADERS} invitees who have each traded at least $${DEFAULT_FOUNDER_MIN_TRADER_VOLUME_USD} of their own volume (buys and sells together, anti-abuse already required of every invitee — see above) get a permanent Founder allocation: a flat ${FOUNDER_SHARE.en} of PANDA's trade fee on every trade their invitees ever make, for life, regardless of rank or how many tiers would otherwise apply. This advantage is active from the moment the slot is reserved, even before PANDA creates the Founder NFT collection; once created, each reserved slot mints a non-transferable ("soulbound") NFT recording it — the NFT itself carries no promised or guaranteed market value, and PANDA makes no representation that it can be sold or will ever be worth anything. Founders may also accrue a variable, additional share of their invitees' trading activity, automatically converted to $PANDA and claimable on demand once PANDA turns this on — the % and whether it runs at all can change, nothing about its amount or any return is ever promised, and it uses the same signed-session, rate-limited, solvency-checked claim system as PANDA's other rewards.`,
      `PANDA can review any account it suspects is gaming this program (self-funded wallets, coordinated wash trading between a recruiter's own wallets, and similar) and can adjust, pause, or close an account's participation if it finds abuse — trading itself, and PANDA's own trading fee, are never affected by this review.`,
    ],
    es: [
      `Programa de Reclutadores. Cada wallet conectada tiene su propio enlace y puede elegir su propio código corto (su enlace pasa a ser ${SITE_DOMAIN}/r/<código>) en cuanto PANDA lo acepta (reglas de formato y una comprobación de palabras reservadas u ofensivas — PANDA puede quitar un código a mano si algo se cuela); un código es permanente una vez elegido. La página de cualquier moneda lanzada a través del propio flujo de Creación de PANDA funciona también como el enlace de su creador. La wallet que se conecta a través de un enlace o código por primera vez queda vinculada de forma permanente a quien lo compartió — el primero gana, no se puede cambiar después, una wallet no puede autorreferirse, y no hay límite de cuánta gente puede traer un reclutador. Una wallet que no llegó por un enlace puede en su lugar escribir un código a mano, en la página de Reclutadores o al conectar por primera vez — pero solo una vez, y solo antes de su primera operación; después, no se puede aplicar ningún código. Solo cuenta un nivel — nunca se cobra por los invitados de tus propios invitados. Una wallet cuyo primer SOL vino de la wallet que la invita no cuenta como referido (se comprueba su historial on-chain al crear el vínculo, y se reintenta en un inicio de sesión posterior si esa comprobación no se puede completar todavía — un referido nunca se acepta a ciegas). La ventaja directa de ser referido: la mitad de la comisión de trading de PANDA, de por vida, a partir de que tu propio volumen llegue al umbral — ver la sección de Comisiones más arriba.`,
      `Estado de trader y tramos. Una wallet invitada se vuelve "activa" cuando opera en PANDA durante 3 días UTC consecutivos con un volumen propio ese día igual o superior al mínimo publicado, y vuelve a ser inactiva tras 3 días consecutivos sin ningún día que cuente (se reactiva de la misma forma). Un reclutador cobra una parte de la propia comisión de trading de PANDA — la tarifa que ese invitado esté pagando realmente en cada momento (la tarifa por defecto hasta que el volumen propio de ese invitado llega a ${DISCOUNT_MIN_VOLUME} $, el ${TRADE_REFERRED.es} a partir de ahí — ver la sección de Comisiones) — en cada operación de sus invitados desde la primera, estén activos o no — pagada en el tramo que le correspondería al invitado si estuviera activo. Los tramos son marginales, por orden de llegada en vivo entre los invitados actualmente activos del reclutador, según cuándo se activó cada uno por primera vez: ${TIER1.es} de esa comisión (${TIER1_OF_TRADE.es} de la operación una vez el invitado paga la tarifa referida, más de la operación mientras tanto, porque la comisión de base es mayor) del 1º al 500º, ${TIER2.es} (${TIER2_OF_TRADE.es} de la operación) del 501º al 1.500º, ${TIER3.es} (${TIER3_OF_TRADE.es} de la operación) del 1.501º en adelante. Cuando un invitado activo pasa a inactivo, todos los que iban por detrás suben de puesto — traer más gente, o que otro se desactive, nunca baja el % que ya cobra alguien más. El pago es una transferencia aparte dentro de la propia transacción de quien opera, directa de su wallet a la del reclutador, junto a la comisión de PANDA — PANDA nunca retiene ese dinero, ni siquiera un instante. Si la wallet del reclutador no puede recibir el pago, esa parte va a la tesorería de PANDA y la operación nunca se ve afectada, retrasada ni alterada de ninguna otra forma para quien opera.`,
      `Fundadores. Los primeros 1.000 reclutadores en llegar a ${DEFAULT_FOUNDER_REQUIRED_TRADERS} invitados que hayan tradeado cada uno al menos ${DEFAULT_FOUNDER_MIN_TRADER_VOLUME_USD} $ de volumen propio (compras y ventas juntas, el antiabuso ya es obligatorio para todo invitado — ver arriba) reciben una plaza de Fundador permanente: un ${FOUNDER_SHARE.es} fijo de la comisión de trading de PANDA en cada operación de sus invitados, de por vida, sin importar el tramo que correspondería sin ella. Esta ventaja está activa desde que se reserva la plaza, incluso antes de que PANDA cree la colección de NFT de Fundador; una vez creada, cada plaza reservada mintea un NFT intransferible ("soulbound") que la registra — el NFT en sí no lleva ningún valor de mercado prometido ni garantizado, y PANDA no asegura que se pueda vender ni que vaya a valer nada. Los Fundadores también pueden acumular una parte variable y adicional de la actividad de sus invitados, convertida automáticamente a $PANDA y reclamable cuando PANDA lo active — el porcentaje, y si llega a funcionar, pueden cambiar, no se promete ningún importe ni rentabilidad, y usa el mismo sistema de reclamos con sesión firmada, límites y comprobación de solvencia que el resto de recompensas de PANDA.`,
      `PANDA puede revisar cualquier cuenta que sospeche que abusa de este programa (wallets autofinanciadas, wash trading coordinado entre wallets del mismo reclutador y casos similares) y puede ajustar, pausar o cerrar la participación de una cuenta si encuentra abuso — el trading en sí, y la comisión de trading de PANDA, nunca se ven afectados por esta revisión.`,
    ],
  },
  "privacy-policy": {
    en: [
      "Recruiters program. PANDA keeps, in its database: which wallet referred which (permanent, never changed) and when; each recruiter's own short code, if it has one; each invitee's daily trading-volume-vs-threshold record and the resulting active/inactive streak; a record of each recruiter commission payment it verified on-chain (amount, coin and transaction); which coins were launched through PANDA's own Create flow and by whom (used for the coin-page-as-recruiter-link feature and the \"Launched on PANDA\" showcase); which wallets are on the referred/legacy fee rate and since when; and Founder slot allocations (rank, reservation and mint status). This is what powers the /recruiters page's own stats and a wallet's tier and fee rate.",
    ],
    es: [
      "Programa de Reclutadores. PANDA guarda en su base de datos: qué wallet refirió a cuál (permanente, no se cambia) y cuándo; el código corto propio de cada reclutador, si tiene uno; el registro diario de volumen de cada invitado frente al mínimo exigido y la racha activa/inactiva resultante; un registro de cada pago de comisión de reclutador que verifica on-chain (importe, moneda y transacción); qué monedas se lanzaron a través del propio flujo de Creación de PANDA y por quién (usado para que la página de una moneda funcione como enlace de reclutador de su creador, y para el escaparate \"Lanzada en PANDA\"); qué wallets están en la tarifa de comisión de referido/veterano y desde cuándo; y las plazas de Fundador asignadas (puesto, reserva y estado de minteo). Esto es lo que alimenta las propias estadísticas de la página /reclutadores y el tramo y la tarifa de cada wallet.",
    ],
  },
  "risk-disclosure": {
    en: [
      "The Recruiters program's percentages, tiers, the daily-volume minimum, and whether the $PANDA Founder reward runs at all can change going forward. Past earnings — as a recruiter or a Founder — are never a guarantee of future ones. The anti-abuse check (a wallet's first SOL) and the active-trader streak are both automated and can be wrong in edge cases; PANDA's manual review of suspected abuse can also reach the wrong conclusion. A Founder NFT carries no promised or guaranteed market value.",
    ],
    es: [
      "Los porcentajes y tramos del programa de Reclutadores, el mínimo de volumen diario, y si la recompensa en $PANDA para Fundadores llega a funcionar, pueden cambiar en el futuro. Las ganancias pasadas — como reclutador o como Fundador — nunca garantizan ganancias futuras. La comprobación antiabuso (el primer SOL de una wallet) y la racha de trader activo son automáticas y pueden equivocarse en casos límite; la revisión manual de PANDA ante un abuso sospechado también puede llegar a una conclusión equivocada. Un NFT de Fundador no lleva ningún valor de mercado prometido ni garantizado.",
    ],
  },
};

/** Only while the AI Assistant is on (FEATURE_AI_ASSISTANT) — OpenAI as a third party PANDA sends data to, and the "not financial advice" notice for its coin-analysis tool. */
export const AI_ADDENDA: Addenda = {
  "terms-of-service": {
    en: ["AI Assistant. PANDA's AI Assistant (GPT-6 Luna, by OpenAI) can propose a coin's name/ticker/description, explain a coin's already-public data in plain language, turn a described strategy into a Draw Your Trade draft, or turn a search into filters — it never signs, sends, or confirms anything itself; you always review and confirm any resulting action yourself. Its coin-analysis tool never recommends buying, selling, or holding anything, and is not financial, investment, legal or tax advice — do your own research. It is rate-limited per wallet and per visitor, and OpenAI's own use policies apply to it."],
    es: ["Asistente IA. El Asistente IA de PANDA (GPT-6 Luna, de OpenAI) puede proponer el nombre/ticker/descripción de una moneda, explicar en lenguaje sencillo los datos ya públicos de una moneda, convertir una estrategia descrita en un borrador de Draw Your Trade, o convertir una búsqueda en filtros — nunca firma, envía ni confirma nada por sí mismo; siempre revisas y confirmas tú cualquier acción resultante. Su herramienta de análisis de monedas nunca recomienda comprar, vender ni mantener nada, y no es asesoramiento financiero, de inversión, legal ni fiscal — investiga por tu cuenta. Tiene un límite de uso por wallet y por visitante, y se le aplican las propias políticas de uso de OpenAI."],
  },
  "cookie-policy": {
    en: ["The AI Assistant's \"Search coins\" also keeps, in your browser's local storage, the last filter it worked out from your search, under a key named panda.ai.filter, so Discover can apply it — cleared by its own \"Clear AI filter\" button, or when you clear your browser data."],
    es: ["\"Buscar monedas\" del Asistente IA guarda además, en el almacenamiento local de tu navegador, el último filtro que calculó a partir de tu búsqueda, bajo una clave llamada panda.ai.filter, para que Descubrir pueda aplicarlo — se borra con su propio botón \"Quitar filtro de IA\", o al borrar los datos de tu navegador."],
  },
  "privacy-policy": {
    en: ["AI Assistant (OpenAI). Only when you use the AI Assistant, the text you type and the coin data relevant to your request (ticker, price, liquidity, RugCheck's summary, and similar already-public figures) are sent to OpenAI to generate a reply — never your private keys, never a transaction signature, never a password. Your wallet address, when connected, is sent only to apply your daily question limit, not to OpenAI. PANDA does not store the assistant's replies once your session ends. See OpenAI's own privacy policy for how it handles what it receives."],
    es: ["Asistente IA (OpenAI). Solo cuando usas el Asistente IA, el texto que escribes y los datos de la moneda relevantes para tu petición (ticker, precio, liquidez, el resumen de RugCheck y cifras similares ya públicas) se envían a OpenAI para generar una respuesta — nunca tus claves privadas, nunca una firma de transacción, nunca una contraseña. Tu dirección de wallet, si está conectada, se envía solo para aplicar tu límite diario de consultas, no a OpenAI. PANDA no guarda las respuestas del asistente una vez termina tu sesión. Consulta la política de privacidad de OpenAI para saber cómo trata lo que recibe."],
  },
  "risk-disclosure": {
    en: ["The AI Assistant is an automated tool (OpenAI's GPT-6 Luna) and can be wrong, out of date, or misunderstand what you typed. Its coin-analysis explanations are drawn only from real data PANDA already reads (RugCheck, liquidity, market activity) but can still misstate or misjudge it — never treat them as advice, and never as a substitute for reading the underlying data yourself. Anything it proposes for Draw Your Trade or for a coin's name/ticker/description is only ever a draft: nothing is bought, sold, launched or confirmed until you review it and act yourself."],
    es: ["El Asistente IA es una herramienta automática (GPT-6 Luna de OpenAI) y puede equivocarse, estar desactualizado o malinterpretar lo que escribiste. Sus explicaciones al analizar una moneda se basan solo en datos reales que PANDA ya lee (RugCheck, liquidez, actividad de mercado), pero aun así puede expresarlos mal o valorarlos mal — nunca las trates como asesoramiento, ni como sustituto de leer tú los datos originales. Lo que proponga para Draw Your Trade o para el nombre/ticker/descripción de una moneda es siempre solo un borrador: no se compra, vende, lanza ni confirma nada hasta que tú lo revises y actúes."],
  },
};

const SELL_MARGIN = both(SELL_MARGIN_BPS);
const STOP_MARGIN = both(STOP_MARGIN_BPS);

/**
 * Paragraphs that exist ONLY while FEATURE_PANDA_ORDERS is on: PANDA orders — sells and stops on a coin the user already
 * holds, pre-signed by the user and sent by PANDA when the price is reached. Not custodial (the coins never leave the
 * wallet until the sale itself), but PANDA keeps signed transactions and decides WHEN to send them: that is declared.
 */
export const PANDA_ORDERS_ADDENDA: Addenda = {
  "legal-notice": {
    en: [
      "PANDA orders (sells and stops on a coin you already hold, on Pump.fun or PumpSwap) are not custodial: your coins stay in your wallet until the sale itself executes. You sign each order in advance; PANDA stores the signed transaction encrypted and only decides WHEN to send it — it cannot change it, its amount, its minimum price, its fees or where the money goes, because any change would invalidate your signature.",
    ],
    es: [
      "Las órdenes PANDA (ventas y stops sobre una moneda que ya tienes, en Pump.fun o PumpSwap) no son custodiales: tus monedas siguen en tu wallet hasta que la venta se ejecuta. Firmas cada orden por adelantado; PANDA guarda la transacción firmada cifrada y solo decide CUÁNDO enviarla — no puede cambiarla, ni su cantidad, ni su precio mínimo, ni sus comisiones, ni a dónde va el dinero, porque cualquier cambio invalidaría tu firma.",
    ],
  },
  "terms-of-service": {
    en: [
      `PANDA orders. You can set a sell, a stop, or both (whichever executes first cancels the other) on any share of a Pump.fun or PumpSwap coin you hold, with no minimum amount. Each order is a transaction you sign in advance: it sells an exact number of tokens for at least a minimum amount of SOL, fixed when you sign (your price minus ${SELL_MARGIN.en} for a sell, minus ${STOP_MARGIN.en} for a stop). PANDA keeps it, encrypted, and sends it when its live check shows your level has been reached; if the market can't pay that minimum, the sale does not happen. A stop can therefore fail to sell in a fast drop and you keep the coin — you accept this explicitly before signing a stop.`,
      `Fees and costs of PANDA orders. PANDA's usual trading fee — ${TRADE.en} at the default rate, ${TRADE_REFERRED.en} at the referred/legacy rate — of the guaranteed minimum, included in the order and paid only if it executes (with the recruiter's share, when there is one, paid straight to them in the same transaction). Each order needs a small "nonce" account in your wallet's name holding a refundable deposit (about 0.001 SOL), returned to you when you cancel or after the order executes; and the network fee of the sale is paid by your wallet when it executes. Cancelling (closing that account) is free apart from the network fee.`,
      "PANDA orders can stop being valid without anyone's fault: if the coin moves from the bonding curve to PumpSwap, if Pump changes its programs, or if your wallet no longer holds the coins. PANDA then tells you in the app and asks you to sign again; it never re-signs or substitutes anything for you.",
    ],
    es: [
      `Órdenes PANDA. Puedes poner una venta, un stop, o ambos (el que se ejecute primero cancela el otro) sobre cualquier parte de una moneda de Pump.fun o PumpSwap que tengas, sin importe mínimo. Cada orden es una transacción que firmas por adelantado: vende una cantidad exacta de tokens por al menos una cantidad mínima de SOL, fijada al firmar (tu precio menos un ${SELL_MARGIN.es} en una venta, menos un ${STOP_MARGIN.es} en un stop). PANDA la guarda, cifrada, y la envía cuando su comprobación en vivo muestra que se ha alcanzado tu nivel; si el mercado no puede pagar ese mínimo, la venta no se produce. Por eso un stop puede no vender en una caída rápida y seguir teniendo la moneda — lo aceptas expresamente antes de firmar un stop.`,
      `Comisiones y costes de las órdenes PANDA. La comisión de trading habitual de PANDA — el ${TRADE.es} a la tarifa por defecto, el ${TRADE_REFERRED.es} a la de referido/veterano — sobre el mínimo garantizado, incluida en la orden y pagada solo si se ejecuta (con la parte del reclutador, si lo hay, pagada directamente a él en la misma transacción). Cada orden necesita una pequeña cuenta "nonce" a nombre de tu wallet con un depósito reembolsable (unos 0,001 SOL), que vuelve a ti al cancelar o después de ejecutarse la orden; y la comisión de red de la venta la paga tu wallet cuando se ejecuta. Cancelar (cerrar esa cuenta) es gratis salvo la comisión de red.`,
      "Las órdenes PANDA pueden dejar de valer sin culpa de nadie: si la moneda pasa de la curva a PumpSwap, si Pump cambia sus programas, o si tu wallet ya no tiene las monedas. PANDA te avisa en la app y te pide volver a firmar; nunca vuelve a firmar ni sustituye nada por ti.",
    ],
  },
  "privacy-policy": {
    en: [
      "PANDA orders. Only if you set one up, PANDA stores the order (coin, amounts, prices, state) tied to your wallet address, and the transaction you signed, encrypted with a key only PANDA's server holds. The signed transaction is deleted as soon as the order is executed, cancelled or no longer valid.",
    ],
    es: [
      "Órdenes PANDA. Solo si configuras una, PANDA guarda la orden (moneda, cantidades, precios, estado) asociada a tu dirección de wallet, y la transacción que firmaste, cifrada con una clave que solo tiene el servidor de PANDA. La transacción firmada se borra en cuanto la orden se ejecuta, se cancela o deja de valer.",
    ],
  },
  "risk-disclosure": {
    en: [
      `PANDA orders execute only within what you signed. A sell may fill up to ${SELL_MARGIN.en} under your price and a stop up to ${STOP_MARGIN.en} under it; beyond that the order does not execute — in a fast drop a stop may not sell and you keep the coin, possibly at a much lower price. Orders depend on PANDA's server watching the price and on the Solana network being available: a delay, an outage or congestion can mean an order executes late or not at all. An order can stop being valid (the coin graduates, Pump changes its programs, you move your coins), and you must sign it again. Keep a little SOL in your wallet for the network fee.`,
    ],
    es: [
      `Las órdenes PANDA solo se ejecutan dentro de lo que firmaste. Una venta puede ejecutarse hasta un ${SELL_MARGIN.es} por debajo de tu precio y un stop hasta un ${STOP_MARGIN.es}; más allá, la orden no se ejecuta — en una caída rápida un stop puede no vender y sigues teniendo la moneda, quizá a un precio mucho más bajo. Las órdenes dependen de que el servidor de PANDA vigile el precio y de que la red de Solana esté disponible: un retraso, una caída o congestión pueden hacer que una orden se ejecute tarde o no se ejecute. Una orden puede dejar de valer (la moneda se gradúa, Pump cambia sus programas, mueves tus monedas) y tendrás que volver a firmarla. Mantén un poco de SOL en tu wallet para la comisión de red.`,
    ],
  },
};

export type LegalOptions = {
  /** FEATURE_STRATEGIES */ custody: boolean;
  /** FEATURE_HOLDER_REWARDS */ holders?: boolean;
  /** FEATURE_OTC_REWARDS */ otc?: boolean;
  /** FEATURE_NFT_THEMES */ nft?: boolean;
  /** FEATURE_NFT_THEMES and FEATURE_NFT_MARKET */ market?: boolean;
  /** FEATURE_PANDA_POINTS */ points?: boolean;
  /** FEATURE_PANDA_AIRDROPS */ airdrops?: boolean;
  /** FEATURE_REFERRALS */ referrals?: boolean;
  /** FEATURE_AI_ASSISTANT */ aiAssistant?: boolean;
  /** FEATURE_PANDA_ORDERS */ pandaOrders?: boolean;
  /** NEXT_PUBLIC_PANDA_TOKEN_MINT is set: $PANDA exists */ pandaToken?: boolean;
};

/** The legal page as it applies to this deployment: the base text, plus the sections of only the features that are on. */
export function getLegalPage(slug: LegalSlug, opts: LegalOptions): LegalPage {
  const base = LEGAL_PAGES[slug];
  const extras = [
    opts.custody ? CUSTODY_ADDENDA[slug] : undefined,
    opts.holders ? HOLDER_ADDENDA[slug] : undefined,
    opts.otc ? OTC_ADDENDA[slug] : undefined,
    opts.nft ? NFT_ADDENDA[slug] : undefined,
    opts.market ? MARKET_ADDENDA[slug] : undefined,
    opts.points ? POINTS_ADDENDA[slug] : undefined,
    opts.airdrops ? AIRDROP_ADDENDA[slug] : undefined,
    opts.referrals ? REFERRAL_ADDENDA[slug] : undefined,
    opts.aiAssistant ? AI_ADDENDA[slug] : undefined,
    opts.pandaOrders ? PANDA_ORDERS_ADDENDA[slug] : undefined,
  ].filter((e): e is Record<Lang, string[]> => !!e);
  const withToken = opts.pandaToken && slug === "disclaimer";
  if (extras.length === 0 && !withToken) return base;
  const swap = (lang: Lang, list: string[]) => (withToken ? list.map((p) => (p === PANDA_TOKEN_NOT_LAUNCHED[lang] ? PANDA_TOKEN_LAUNCHED[lang] : p)) : list);
  return { ...base, body: { en: [...swap("en", base.body.en), ...extras.flatMap((e) => e.en)], es: [...swap("es", base.body.es), ...extras.flatMap((e) => e.es)] } };
}
