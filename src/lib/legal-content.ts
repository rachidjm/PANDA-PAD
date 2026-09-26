import { Lang } from "@/lib/i18n/translations";
import { PANDA_FEE_BPS } from "@/lib/pump/constants";
import { PANDA_SHARE_BPS } from "@/lib/config/protocol";
import { MARKET_CONFIG } from "@/lib/market/config";
import { STRATEGY_FEE_BPS } from "@/lib/strategy/plan";

export type LegalSlug = "legal-notice" | "terms-of-service" | "privacy-policy" | "risk-disclosure" | "cookie-policy" | "disclaimer";

export type LegalPage = { slug: LegalSlug; title: Record<Lang, string>; body: Record<Lang, string[]>; /** ISO date (YYYY-MM-DD) of the last change to these texts. */ updated: string };

/**
 * The date these texts were last changed. Bump it whenever anything in this file (or a fee, a flag or a data practice the texts describe)
 * changes: src/lib/legal-content.test.ts fails if it is in the future or malformed.
 */
export const LEGAL_LAST_UPDATED = "2026-09-26";

/**
 * Every percentage below comes from the constant the code charges with, so a text can't drift from what is really collected
 * (src/lib/legal-content.test.ts also checks this).
 */
const pct = (bps: number, lang: Lang): string => {
  const v = bps / 100;
  return `${lang === "es" ? String(v).replace(".", ",") : String(v)}%`;
};
const both = (bps: number) => ({ en: pct(bps, "en"), es: pct(bps, "es") });
const TRADE = both(PANDA_FEE_BPS); // 0.5% on each buy and each sell
const SHARE = both(PANDA_SHARE_BPS); // PANDA's fixed share of a coin's creator fees
const REST = both(10_000 - PANDA_SHARE_BPS);
const STRATEGY = both(STRATEGY_FEE_BPS); // Draw Your Trade: the buy's and the sell's fee together
const MARKET = both(MARKET_CONFIG.feeBps); // NFT marketplace

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
        `Fees. PANDA's trading fee is ${TRADE.en} on every buy and ${TRADE.en} on every sell, on any coin traded through PANDA (Pump.fun's bonding curve, PumpSwap, and other coins routed through Jupiter). It is paid in SOL to PANDA's treasury wallet as a separate transfer inside the same transaction you sign: on a buy it is ${TRADE.en} of the SOL you spend, added on top; on a sell it is ${TRADE.en} of the SOL you receive, estimated when the transaction is built. If you pay with another token, the fee is still charged in SOL, on top. The same ${TRADE.en} applies to the "Buy $PANDA" button once the token exists.`,
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
        `Comisiones. La comisión de trading de PANDA es del ${TRADE.es} en cada compra y del ${TRADE.es} en cada venta, de cualquier moneda operada a través de PANDA (la bonding curve de Pump.fun, PumpSwap y otras monedas enrutadas por Jupiter). Se paga en SOL a la wallet de tesorería de PANDA, como una transferencia aparte dentro de la misma transacción que firmas: en una compra es el ${TRADE.es} del SOL que gastas, añadido encima; en una venta es el ${TRADE.es} del SOL que recibes, estimado al construir la transacción. Si pagas con otro token, la comisión se cobra igualmente en SOL, encima. El mismo ${TRADE.es} se aplica al botón "Buy $PANDA" cuando el token exista.`,
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
        "Third-party services. To show real data and build real transactions, your browser or PANDA's servers make requests to: Pump.fun (public API and coin images), GeckoTerminal and Dexscreener (market and pool data, prices, token names and logos), Jupiter (swap quotes and routing), RugCheck (a coin's risk indicator: PANDA's servers send it only the coin's address, your browser never connects to it, and the \"View on RugCheck\" link takes you to rugcheck.xyz, which has its own policies), a Solana RPC provider (reading balances, sending transactions — your browser talks to PANDA's own server, which calls the provider), the European Central Bank's euro reference rate through Frankfurter (currency conversion), and the public hosts where coin creators keep their images (your browser loads those directly, so those hosts see your IP address). These requests carry the technical information any web or API request does (for example the IP address, at network level). PANDA doesn't combine this with your wallet address or build a profile of you.",
      ],
      es: [
        DRAFT_NOTICE.es,
        "La versión corta: PANDA recopila muy poco, porque no necesita mucho para funcionar. Esta página describe lo que la aplicación realmente hace, no una plantilla genérica.",
        "Datos de la wallet y registros. Al conectar una wallet, PANDA lee tu dirección pública y, para la página de Portfolio, tus saldos reales de tokens en Solana — datos públicos, leídos en vivo. PANDA también guarda, asociados a direcciones públicas de wallet: el registro de las operaciones que haces a través de PANDA (moneda, sentido, importes, precio del SOL en ese momento, firma pública de la transacción, hora) y, para el Portfolio, operaciones leídas de tu historial público on-chain, marcadas como estimaciones; registros de actividad on-chain que PANDA verificó (lanzamientos, operaciones, repartos de comisiones), que alimentan las páginas de Actividad y Analítica; los desafíos de inicio de sesión y las sesiones de las wallets que inician sesión (dirección de wallet, un identificador aleatorio de sesión, horas de emisión y caducidad, y si la sesión fue revocada); la wallet del creador de una moneda y su reparto de comisiones mientras se confirma un lanzamiento; y un registro de auditoría de acciones sensibles (dirección de wallet, acción, objeto, firma pública, hora). Ninguno de estos registros contiene tu dirección IP. PANDA nunca recibe, solicita ni almacena tu frase semilla o clave privada.",
        "Dónde se guarda. Los registros están en una base de datos Postgres alojada en Neon. Los contadores de límite de peticiones y los informes agregados de seguridad del navegador están en Upstash (Redis). Vercel ejecuta el sitio; sus funciones, la base de datos de Neon y Upstash funcionan en Estados Unidos (US East), así que los datos que procesan se transfieren fuera de la Unión Europea. Las imágenes y metadatos que subes para una moneda — y los archivos de cualquier función que aún no esté en la base de datos — están en Vercel Blob, en París (Francia), en direcciones públicas. Durante el traslado del almacenamiento de archivos a la base de datos, quedan copias antiguas de algunos registros en Vercel Blob durante un periodo de transición, tras el cual se eliminan.",
        "Cuánto tiempo. Las sesiones duran 2 horas; las sesiones y los desafíos de inicio de sesión caducados se borran automáticamente (los desafíos un día después de caducar, las sesiones una semana después). Los contadores de límite de peticiones caducan con su ventana. Las entradas de auditoría no se pueden editar ni borrar — la base de datos lo rechaza, por diseño, para que el historial no pueda reescribirse. Los registros de operaciones, actividad y lanzamientos se conservan durante 5 años.",
        "Dirección IP. Para proteger el servicio de abusos, tu dirección IP se usa como clave de un contador en Upstash solo durante la ventana del límite de peticiones (normalmente un minuto, hasta una hora en unas pocas acciones), y después caduca. El proveedor de hosting (Vercel) también puede conservar registros de acceso estándar, con direcciones IP, por seguridad y fiabilidad. PANDA no los usa para rastreo ni marketing.",
        "Cookies y almacenamiento local. Consulta la Política de Cookies: una cookie técnica, que solo se establece si inicias sesión, y ninguna herramienta de analítica, publicidad ni grabación de sesiones.",
        "Servicios de terceros. Para mostrar datos reales y construir transacciones reales, tu navegador o los servidores de PANDA hacen peticiones a: Pump.fun (API pública e imágenes de monedas), GeckoTerminal y Dexscreener (datos de mercado y de pools, precios, nombres y logos de tokens), Jupiter (cotizaciones y enrutamiento de swaps), RugCheck (el indicador de riesgo de una moneda: los servidores de PANDA solo le envían la dirección de la moneda, tu navegador nunca se conecta a él, y el enlace \"Ver en RugCheck\" te lleva a rugcheck.xyz, que tiene sus propias políticas), un proveedor de RPC de Solana (lectura de saldos, envío de transacciones — tu navegador habla con el propio servidor de PANDA, que llama al proveedor), el tipo de cambio de referencia del euro del Banco Central Europeo a través de Frankfurter (conversión de moneda) y los hosts públicos donde los creadores guardan las imágenes de sus monedas (tu navegador las carga directamente, así que esos hosts ven tu dirección IP). Estas peticiones llevan la información técnica habitual de cualquier petición web o de API (por ejemplo, la dirección IP, a nivel de red). PANDA no combina esto con tu dirección de wallet ni construye un perfil sobre ti.",
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
        "Local storage in your browser (it stays in your browser and is never sent to PANDA): panda-lang remembers your display language (English or Spanish); panda.buy.unit remembers, on coin pages, the currency you prefer to type amounts in; walletName, set by the wallet library PANDA uses, remembers the name of the last wallet you connected so the app can reconnect it. It stays until you clear your browser data. PANDA does not use sessionStorage.",
        "Your wallet extension (for example Phantom or Solflare) may use its own browser storage to remember your connection preferences — that storage is controlled entirely by the extension, not by PANDA, and is covered by that extension's own privacy practices, not this one.",
        "If this ever changes — for example, if PANDA adds another feature that needs a cookie or local storage — this page will be updated to describe exactly what is stored and why, and the date above will change.",
      ],
      es: [
        DRAFT_NOTICE.es,
        "PANDA establece una sola cookie, y solo cuando decides iniciar sesión con tu wallet (una firma gratuita de un mensaje). Nombre: panda_session. Finalidad: acredita con qué wallet iniciaste sesión, para que las acciones que lo necesitan puedan fiarse de la petición; contiene un token firmado y un identificador aleatorio de sesión, y nada más sobre ti. Duración: 2 horas, o hasta que te desconectes o cierres tus sesiones. Propiedades: HttpOnly, Secure, SameSite=Strict. Es una cookie de sesión estrictamente necesaria. Navegar por PANDA sin iniciar sesión no establece ninguna cookie.",
        "PANDA no usa cookies ni scripts de analítica, publicidad, rastreo o grabación de sesiones, así que no muestra ningún banner de cookies.",
        "Almacenamiento local en tu navegador (se queda en tu navegador y nunca se envía a PANDA): panda-lang recuerda tu idioma (inglés o español); panda.buy.unit recuerda, en las páginas de moneda, la moneda en que prefieres escribir los importes; walletName, que establece la librería de wallets que usa PANDA, recuerda el nombre de la última wallet que conectaste para poder reconectarla. Permanece hasta que borres los datos de tu navegador. PANDA no usa sessionStorage.",
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
      "Stop Loss / Take Profit orders and Draw Your Trade strategies are custodial. They are built on Jupiter's Trigger API, which moves the deposited tokens into a vault managed by Jupiter and held by Privy until the order or strategy fills or is cancelled. PANDA has no keys and no access to that vault and cannot move or withdraw the funds; only you can take them out, by signing the cancellation in your wallet. It is still a genuine exception to PANDA's otherwise non-custodial design, and the app says so before any deposit.",
    ],
    es: [
      "Las órdenes de Stop Loss / Take Profit y las estrategias de Draw Your Trade son custodiales. Se construyen sobre la Trigger API de Jupiter, que traslada los tokens depositados a una bóveda gestionada por Jupiter y custodiada por Privy hasta que la orden o estrategia se ejecuta o se cancela. PANDA no tiene claves ni acceso a esa bóveda y no puede mover ni retirar los fondos; solo tú puedes sacarlos, firmando la cancelación en tu wallet. Aun así es una excepción real al diseño no custodial del resto de PANDA, y la app lo indica antes de cualquier depósito.",
    ],
  },
  "terms-of-service": {
    en: [
      "Custodial exception: Stop Loss / Take Profit and Draw Your Trade. Setting one up deposits your tokens (or the SOL / USDC that will fund the buy) into a Jupiter Trigger vault — a custodial account managed by Privy on Jupiter's service, not PANDA's — until the order fills or you cancel it. PANDA has no keys or access to the vault; Jupiter's service executes the order when it triggers, and only you can withdraw, by signing the cancellation, which returns the funds to your wallet. Using this feature is optional and you accept the custody terms of Jupiter and Privy when you do.",
      `Fees of these features. PANDA charges no fee on Stop Loss / Take Profit orders. A Draw Your Trade strategy carries a PANDA fee of ${STRATEGY.en} in total (${TRADE.en} for its buy plus ${TRADE.en} for its sell), paid up front when you confirm; it is not returned if you cancel before the strategy buys. Jupiter's own fees and network fees are separate and are not PANDA's.`,
    ],
    es: [
      "Excepción custodial: Stop Loss / Take Profit y Draw Your Trade. Configurar una deposita tus tokens (o el SOL / USDC que financiará la compra) en una bóveda de Jupiter Trigger — una cuenta custodial gestionada por Privy en el servicio de Jupiter, no por PANDA — hasta que la orden se ejecuta o la cancelas. PANDA no tiene claves ni acceso a la bóveda; el servicio de Jupiter ejecuta la orden cuando se activa, y solo tú puedes retirar, firmando la cancelación, que devuelve los fondos a tu wallet. Usar esta función es opcional y, al hacerlo, aceptas las condiciones de custodia de Jupiter y Privy.",
      `Comisiones de estas funciones. PANDA no cobra ninguna comisión por las órdenes de Stop Loss / Take Profit. Una estrategia de Draw Your Trade lleva una comisión de PANDA del ${STRATEGY.es} en total (${TRADE.es} por su compra más ${TRADE.es} por su venta), que se paga por adelantado al confirmar; no se devuelve si cancelas antes de que la estrategia compre. Las comisiones propias de Jupiter y las de red son aparte y no son de PANDA.`,
    ],
  },
  "privacy-policy": {
    en: [
      "Stop Loss / Take Profit and Draw Your Trade. Only if you set one up, your wallet address, the order details and a Jupiter sign-in are sent to Jupiter's Trigger API and its vault provider Privy. PANDA also stores your strategies (prices, amounts, state, public transaction signatures) tied to your wallet address; the Jupiter session token is kept only in your browser's memory, and PANDA's server only forwards it to Jupiter, never storing it.",
    ],
    es: [
      "Stop Loss / Take Profit y Draw Your Trade. Solo si configuras una, tu dirección de wallet, los datos de la orden y un inicio de sesión de Jupiter se envían a la Trigger API de Jupiter y a su proveedor de bóvedas, Privy. PANDA además guarda tus estrategias (precios, importes, estado, firmas públicas de transacciones) asociadas a tu dirección de wallet; el token de sesión de Jupiter solo se mantiene en la memoria de tu navegador, y el servidor de PANDA solo lo reenvía a Jupiter, sin guardarlo.",
    ],
  },
  "cookie-policy": {
    en: ["Draw Your Trade also keeps, in your browser's local storage, the drafts of strategies you have drawn but not confirmed, under a key named panda.draw.v1 followed by the coin's address. It stays in your browser until you delete it or clear your data."],
    es: ["Draw Your Trade guarda además, en el almacenamiento local de tu navegador, los borradores de las estrategias que has dibujado pero no confirmado, bajo una clave llamada panda.draw.v1 seguida de la dirección de la moneda. Permanece en tu navegador hasta que la borres o borres tus datos."],
  },
  "risk-disclosure": {
    en: [
      "Stop Loss / Take Profit and Draw Your Trade are custodial — a different risk than the rest of PANDA. Setting one up moves your funds into a Jupiter Trigger vault, a custodial account managed by Privy on Jupiter's service, to which PANDA has no keys and no access. For as long as an order or strategy is open you are trusting Jupiter's and Privy's infrastructure, security and availability, not just Solana's. If those services fail, are attacked, or are unavailable, your funds may be inaccessible or lost, and PANDA cannot recover them. An order may not execute at your price (slippage, thin liquidity, network congestion) or at all, and a strategy that buys can leave you holding tokens if its exit does not fill. Only deposit what you are comfortable holding in a third-party custodian, and get your own legal and tax advice — custody and crypto-asset services are regulated in many jurisdictions.",
    ],
    es: [
      "Stop Loss / Take Profit y Draw Your Trade son custodiales — un riesgo distinto al del resto de PANDA. Configurar una traslada tus fondos a una bóveda de Jupiter Trigger, una cuenta custodial gestionada por Privy en el servicio de Jupiter, a la que PANDA no tiene claves ni acceso. Mientras una orden o estrategia esté abierta confías en la infraestructura, la seguridad y la disponibilidad de Jupiter y Privy, no solo en las de Solana. Si esos servicios fallan, sufren un ataque o no están disponibles, tus fondos pueden quedar inaccesibles o perderse, y PANDA no puede recuperarlos. Una orden puede no ejecutarse a tu precio (slippage, poca liquidez, congestión de red) o no ejecutarse en absoluto, y una estrategia que compra puede dejarte con tokens si su salida no se ejecuta. Deposita solo lo que te sientas cómodo manteniendo en un custodio externo y busca tu propio asesoramiento legal y fiscal — la custodia y los servicios con criptoactivos están regulados en muchas jurisdicciones.",
    ],
  },
  disclaimer: {
    en: ["Stop Loss / Take Profit and Draw Your Trade use a third-party custodial vault (Jupiter, held by Privy) — see Risk Disclosure and Legal Notice."],
    es: ["Stop Loss / Take Profit y Draw Your Trade usan una bóveda custodial de un tercero (Jupiter, custodiada por Privy) — ver Divulgación de Riesgos y Aviso Legal."],
  },
};

/**
 * Paragraphs that exist ONLY while FEATURE_HOLDER_REWARDS is on: the Holders share of a coin's creator fees is paid to a
 * wallet whose key is held by PANDA's servers, so this is the one place PANDA itself holds funds. With the flag off there is no
 * such flow and these must not appear (see getLegalPage).
 */
export const HOLDER_ADDENDA: Addenda = {
  "legal-notice": {
    en: ["Holder rewards are the one feature in which PANDA itself holds funds. If a coin's creator assigns part of its creator fees to \"Holders\", those fees are paid on-chain to PANDA's Rewards Pool wallet, whose key is held by PANDA's servers; PANDA then pays each holder their share when they claim it (claiming needs a free message signature from your wallet, not a transaction). Until claimed, those funds sit in that wallet — you are trusting PANDA's infrastructure with them."],
    es: ["Las recompensas de holders son la única función en la que PANDA retiene fondos por sí misma. Si el creador de una moneda asigna parte de sus comisiones a \"Holders\", esas comisiones se pagan on-chain a la wallet del Rewards Pool de PANDA, cuya clave custodian los servidores de PANDA; PANDA paga después a cada holder su parte cuando la reclama (reclamar requiere una firma gratuita de un mensaje desde tu wallet, no una transacción). Hasta que se reclaman, esos fondos están en esa wallet — confías su custodia a la infraestructura de PANDA."],
  },
  "terms-of-service": {
    en: ["Holder rewards are custodied by PANDA. Fees a creator assigns to \"Holders\" are paid to PANDA's Rewards Pool wallet, controlled by PANDA's servers, and paid out when holders claim them (a free message signature, not a transaction). Until then those funds are in that wallet. PANDA takes no fee when a holder claims."],
    es: ["Las recompensas de holders las custodia PANDA. Las comisiones que un creador asigna a \"Holders\" se pagan a la wallet del Rewards Pool de PANDA, controlada por sus servidores, y se pagan cuando los holders las reclaman (una firma gratuita de un mensaje, no una transacción). Hasta entonces esos fondos están en esa wallet. PANDA no cobra ninguna comisión cuando un holder reclama."],
  },
  "privacy-policy": {
    en: ["Holder rewards. PANDA keeps a ledger of the rewards owed to and claimed by each wallet address, in its database, and the claims in progress."],
    es: ["Recompensas de holders. PANDA guarda en su base de datos un libro de las recompensas pendientes y reclamadas por cada dirección de wallet, y de los reclamos en curso."],
  },
  "risk-disclosure": {
    en: ["Fee distribution and holder rewards are real but still evolving. A coin's on-chain \"Holder\" fee share (see Fee Distribution in Create) determines how much of its creator fees route toward holders; those fees are paid to PANDA's Rewards Pool wallet, which PANDA's servers control, and PANDA pays them out when holders claim — so for holder rewards you are trusting PANDA's infrastructure and key management. Collection only happens above a minimum on-chain dust threshold, and payouts depend on that automated collection actually running — past fee activity is never a guarantee of future rewards, and \"entitled\" amounts can lag real-time trading until the next collection cycle."],
    es: ["El reparto de comisiones y las recompensas a holders son reales, pero siguen evolucionando. El porcentaje on-chain de \"Holders\" de una moneda (ver Fee Distribution en Create) determina qué parte de las comisiones del creador va a los holders; esas comisiones se pagan a la wallet del Rewards Pool de PANDA, que controlan los servidores de PANDA, y PANDA las paga cuando los holders las reclaman — así que, para las recompensas de holders, confías en la infraestructura y la gestión de claves de PANDA. La recolección solo ocurre por encima de un umbral mínimo on-chain, y los pagos dependen de que esa recolección automática se ejecute realmente — la actividad pasada de comisiones nunca garantiza recompensas futuras, y los importes \"pendientes de cobro\" pueden ir por detrás del trading en tiempo real hasta el siguiente ciclo de recolección."],
  },
  disclaimer: {
    en: ["Holder rewards are the exception to PANDA's non-custodial design: their fees sit in a wallet controlled by PANDA's servers until claimed (see Risk Disclosure and Legal Notice)."],
    es: ["Las recompensas de holders son la excepción al diseño no custodial de PANDA: sus comisiones están en una wallet controlada por los servidores de PANDA hasta que se reclaman (ver Divulgación de Riesgos y Aviso Legal)."],
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

export type LegalOptions = {
  /** FEATURE_STRATEGIES */ custody: boolean;
  /** FEATURE_HOLDER_REWARDS */ holders?: boolean;
  /** FEATURE_OTC_REWARDS */ otc?: boolean;
  /** FEATURE_NFT_THEMES */ nft?: boolean;
  /** FEATURE_NFT_THEMES and FEATURE_NFT_MARKET */ market?: boolean;
  /** FEATURE_PANDA_POINTS */ points?: boolean;
  /** FEATURE_PANDA_AIRDROPS */ airdrops?: boolean;
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
  ].filter((e): e is Record<Lang, string[]> => !!e);
  const withToken = opts.pandaToken && slug === "disclaimer";
  if (extras.length === 0 && !withToken) return base;
  const swap = (lang: Lang, list: string[]) => (withToken ? list.map((p) => (p === PANDA_TOKEN_NOT_LAUNCHED[lang] ? PANDA_TOKEN_LAUNCHED[lang] : p)) : list);
  return { ...base, body: { en: [...swap("en", base.body.en), ...extras.flatMap((e) => e.en)], es: [...swap("es", base.body.es), ...extras.flatMap((e) => e.es)] } };
}
