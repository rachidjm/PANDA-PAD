import { Lang } from "@/lib/i18n/translations";

export type LegalSlug = "legal-notice" | "terms-of-service" | "privacy-policy" | "risk-disclosure" | "cookie-policy" | "disclaimer";

export type LegalPage = { slug: LegalSlug; title: Record<Lang, string>; body: Record<Lang, string[]> };

/**
 * A short, honest caveat kept at the top of every page (styled as a warning
 * in LegalPageLayout): this was drafted by PANDA's own team, not reviewed by
 * a lawyer. The rest of each page is real, substantive content grounded in
 * what PANDA actually does — not filler — but the operator-identity fields
 * below (entity name, address, jurisdiction, contact email) are left as
 * explicit "to be added" placeholders because we don't have real values for
 * them yet; inventing a company name or address here would be worse than
 * leaving it blank. Kept up to date with what PANDA actually does — e.g. the
 * optional Stop Loss / Take Profit feature is genuinely custodial (a
 * Jupiter/Privy-managed vault), which is a real exception to the
 * "non-custodial" claims elsewhere and is called out explicitly rather than
 * glossed over.
 */
const DRAFT_NOTICE: Record<Lang, string> = {
  en: "Draft prepared by the PANDA team, not by a lawyer — treat this as a good-faith starting point, not final legal advice, until it's reviewed by qualified counsel in the relevant jurisdiction.",
  es: "Borrador preparado por el equipo de PANDA, no por un abogado — trátalo como un punto de partida de buena fe, no como asesoramiento legal definitivo, hasta que lo revise un profesional cualificado en la jurisdicción correspondiente.",
};

export const LEGAL_PAGES: Record<LegalSlug, LegalPage> = {
  "legal-notice": {
    slug: "legal-notice",
    title: { en: "Legal Notice", es: "Aviso Legal" },
    body: {
      en: [
        DRAFT_NOTICE.en,
        "Operator: [legal entity or individual name to be added]. Registered address: [to be added]. Governing jurisdiction: [to be added]. Contact: [to be added]. These details will be filled in once PANDA's operating entity is finalized — nothing here should be assumed until then.",
        "PANDA is a software interface for interacting with public, permissionless Solana programs (Pump.fun, PumpSwap, and third-party Solana DEXes via Jupiter's aggregator). PANDA does not operate as a bank, broker-dealer, custodian, or money transmitter for regular trading: it never holds user funds, private keys, or seed phrases for buying, selling, or creating coins. Every such transaction shown in the app is built unsigned and only becomes real once the user reviews and signs it in their own wallet (e.g. Phantom, Solflare).",
        "One optional feature is different: Stop Loss / Take Profit orders (on a coin's page) are built on Jupiter's Trigger API, which moves the deposited tokens into a Privy-managed custodial vault until the order fills or is cancelled. PANDA doesn't operate or control that vault — Jupiter and Privy do — but it is a genuine exception to PANDA's otherwise non-custodial design, and the app discloses this plainly before any deposit.",
        "Coins created through PANDA are minted directly by users via Pump.fun's public program. PANDA does not issue, endorse, or guarantee any coin created or traded through it, including $PANDA itself.",
        "Market and pool data shown in the app is sourced from GeckoTerminal and, as a fallback when that source is rate-limited, Dexscreener — both independent third parties that index public Solana on-chain activity.",
      ],
      es: [
        DRAFT_NOTICE.es,
        "Operador: [nombre de la entidad legal o persona física pendiente de añadir]. Domicilio registrado: [pendiente]. Jurisdicción aplicable: [pendiente]. Contacto: [pendiente]. Estos datos se completarán cuando la entidad operadora de PANDA quede definida — no debe asumirse nada al respecto hasta entonces.",
        "PANDA es una interfaz de software para interactuar con programas públicos y sin permisos de Solana (Pump.fun, PumpSwap, y DEXes de Solana de terceros a través del agregador de Jupiter). PANDA no opera como banco, bróker-dealer, custodio ni transmisor de dinero para el trading habitual: nunca retiene fondos de usuarios, claves privadas ni frases semilla para comprar, vender o crear monedas. Cada una de esas transacciones se construye sin firmar y solo se vuelve real cuando el usuario la revisa y la firma en su propia wallet (por ejemplo, Phantom o Solflare).",
        "Una función opcional es distinta: las órdenes de Stop Loss / Take Profit (en la página de una moneda) se construyen sobre la Trigger API de Jupiter, que traslada los tokens depositados a una bóveda custodial gestionada por Privy hasta que la orden se ejecuta o se cancela. PANDA no opera ni controla esa bóveda — lo hacen Jupiter y Privy — pero sí es una excepción real al diseño no custodial del resto de PANDA, y la aplicación lo indica claramente antes de cualquier depósito.",
        "Las monedas creadas a través de PANDA son acuñadas directamente por los usuarios mediante el programa público de Pump.fun. PANDA no emite, avala ni garantiza ninguna moneda creada u operada a través de ella, incluyendo $PANDA.",
        "Los datos de mercado y de pools que se muestran en la app proceden de GeckoTerminal y, como respaldo cuando esa fuente está limitada por rate-limit, de Dexscreener — ambos terceros independientes que indexan actividad real on-chain de Solana.",
      ],
    },
  },
  "terms-of-service": {
    slug: "terms-of-service",
    title: { en: "Terms of Service", es: "Términos del Servicio" },
    body: {
      en: [
        DRAFT_NOTICE.en,
        "By using PANDA, you agree to these terms. If you don't agree, don't use the app.",
        "Non-custodial by design, with one disclosed exception. PANDA never takes custody of your funds, tokens, or private keys for trading, coin creation, fee-distribution setup, or reward claims — every one of those is a transaction you review and sign yourself, in your own wallet. The exception is the optional Stop Loss / Take Profit feature: setting one up deposits your tokens into a Jupiter Trigger vault (a Privy-managed custodial account, not PANDA's) until the order fills or you cancel it. This is disclosed plainly in the app before you deposit anything into it, and it's your choice whether to use that feature at all.",
        "Your responsibility. You are solely responsible for your wallet, its seed phrase, and every transaction you approve. PANDA will never ask for your seed phrase or private key, in the app or otherwise. Double-check every transaction's details in your wallet before signing — PANDA cannot undo a signed transaction.",
        "Acceptable use. You agree not to use PANDA to violate applicable law, to manipulate markets, to launder funds, or to infringe anyone else's rights. PANDA may restrict access to the app (though not to the underlying public Solana programs, which anyone can interact with directly) for accounts that clearly abuse it.",
        "No warranty. PANDA is provided \"as is,\" without warranties of any kind. Market data comes from third parties (primarily GeckoTerminal, with Dexscreener as a fallback) and can be delayed, rate-limited, or temporarily unavailable — the app shows this honestly (a \"live\" indicator) rather than pretending stale data is current, but you should not rely on it for time-critical decisions.",
        "Limitation of liability. To the maximum extent permitted by law, PANDA and its operator aren't liable for losses arising from your use of the app, including losses from market volatility, smart-contract risk, third-party services (Solana RPC providers, Pump.fun, Jupiter, Privy, GeckoTerminal, Dexscreener), or your own transaction mistakes.",
        "Changes. These terms may be updated as PANDA evolves; continued use after a change means you accept the new terms. Governing law: [to be added].",
      ],
      es: [
        DRAFT_NOTICE.es,
        "Al usar PANDA, aceptas estos términos. Si no estás de acuerdo, no uses la aplicación.",
        "No custodial por diseño, con una excepción declarada. PANDA nunca custodia tus fondos, tokens o claves privadas para operar, crear monedas, configurar el reparto de comisiones o reclamar recompensas — cada una de esas acciones es una transacción que revisas y firmas tú mismo, en tu propia wallet. La excepción es la función opcional de Stop Loss / Take Profit: al configurarla, tus tokens se depositan en una bóveda de Jupiter Trigger (una cuenta custodial gestionada por Privy, no por PANDA) hasta que la orden se ejecuta o la cancelas. Esto se indica claramente en la app antes de depositar nada ahí, y usar esa función es completamente opcional.",
        "Tu responsabilidad. Eres el único responsable de tu wallet, su frase semilla y cada transacción que apruebas. PANDA nunca te pedirá tu frase semilla ni tu clave privada, ni dentro de la app ni fuera de ella. Revisa siempre los detalles de cada transacción en tu wallet antes de firmar — PANDA no puede deshacer una transacción ya firmada.",
        "Uso aceptable. Aceptas no usar PANDA para infringir la ley aplicable, manipular mercados, blanquear fondos o vulnerar los derechos de terceros. PANDA puede restringir el acceso a la aplicación (aunque no a los programas públicos subyacentes de Solana, con los que cualquiera puede interactuar directamente) a cuentas que abusen claramente de ella.",
        "Sin garantías. PANDA se ofrece \"tal cual\", sin garantías de ningún tipo. Los datos de mercado provienen de terceros (principalmente GeckoTerminal, con Dexscreener como respaldo) y pueden llegar con retraso, estar limitados por rate-limit o no estar disponibles temporalmente — la app lo indica honestamente (un indicador \"en vivo\") en lugar de aparentar que unos datos desactualizados son actuales, pero no deberías depender de ello para decisiones críticas de tiempo.",
        "Limitación de responsabilidad. En la medida máxima permitida por la ley, PANDA y su operador no son responsables de las pérdidas derivadas del uso de la aplicación, incluyendo pérdidas por volatilidad de mercado, riesgo de los contratos inteligentes, servicios de terceros (proveedores de RPC de Solana, Pump.fun, Jupiter, Privy, GeckoTerminal, Dexscreener) o tus propios errores al operar.",
        "Cambios. Estos términos pueden actualizarse a medida que PANDA evolucione; seguir usando la app tras un cambio implica aceptar los nuevos términos. Legislación aplicable: [pendiente].",
      ],
    },
  },
  "privacy-policy": {
    slug: "privacy-policy",
    title: { en: "Privacy Policy", es: "Política de Privacidad" },
    body: {
      en: [
        DRAFT_NOTICE.en,
        "The short version: PANDA collects very little, because it doesn't need much to work. This section describes what the app actually does, not a generic template.",
        "Wallet data. When you connect a wallet, PANDA reads your public wallet address and, for the Portfolio and Rewards pages, your real on-chain token balances — all of this is already public on the Solana blockchain; PANDA doesn't store it anywhere, it's read live from Solana each time you view those pages. PANDA never receives, requests, or stores your seed phrase or private key.",
        "No cookies, no tracking. PANDA does not set cookies and does not use any third-party analytics or tracking scripts (no Google Analytics, no ad pixels, no session replay). It does use your browser's own localStorage for one thing: remembering your chosen display language (English/Spanish) so you don't have to reselect it — nothing else is stored there, and it never leaves your browser.",
        "Third-party services. To show real data and build real transactions, your browser or PANDA's servers make requests to: GeckoTerminal and Dexscreener (market and pool data — prices, volume, trades, used as fallbacks for each other), Jupiter's public swap and Trigger APIs (quotes and swap routing for non-Pump.fun coins, and — only if you set up a Stop Loss / Take Profit order — the vault and order system operated with Privy), and a Solana RPC provider (reading balances, sending transactions). These requests carry the technical information any web or API request does (e.g. IP address, at the network level) — PANDA doesn't combine this with your wallet address or build a profile of you.",
        "Hosting logs. Like any hosted web app, standard infrastructure-level access logs may exist at the hosting provider level for security and reliability purposes. PANDA doesn't use these for tracking or marketing.",
        "Your rights and contact. To ask about data PANDA might hold about you, contact: [to be added].",
      ],
      es: [
        DRAFT_NOTICE.es,
        "La versión corta: PANDA recopila muy poco, porque no necesita mucho para funcionar. Esta sección describe lo que la aplicación realmente hace, no una plantilla genérica.",
        "Datos de la wallet. Al conectar una wallet, PANDA lee tu dirección pública y, para las páginas de Portfolio y Rewards, tus saldos reales de tokens on-chain — todo esto ya es público en la blockchain de Solana; PANDA no lo almacena en ningún sitio, se lee en vivo desde Solana cada vez que visitas esas páginas. PANDA nunca recibe, solicita ni almacena tu frase semilla o clave privada.",
        "Sin cookies, sin rastreo. PANDA no usa cookies ni scripts de analítica o rastreo de terceros (nada de Google Analytics, píxeles publicitarios ni session replay). Sí usa el localStorage de tu navegador para una única cosa: recordar el idioma que elegiste (inglés/español) para que no tengas que volver a seleccionarlo — no se guarda nada más ahí, y nunca sale de tu navegador.",
        "Servicios de terceros. Para mostrar datos reales y construir transacciones reales, tu navegador o los servidores de PANDA hacen peticiones a: GeckoTerminal y Dexscreener (datos de mercado y de pools — precios, volumen, operaciones, usados como respaldo mutuo), las APIs públicas de swap y Trigger de Jupiter (cotizaciones y enrutamiento para monedas que no son de Pump.fun, y — solo si configuras una orden de Stop Loss / Take Profit — el sistema de bóveda y órdenes operado junto con Privy), y un proveedor de RPC de Solana (lectura de saldos, envío de transacciones). Estas peticiones llevan la información técnica habitual de cualquier petición web o de API (por ejemplo, la dirección IP, a nivel de red) — PANDA no combina esto con tu dirección de wallet ni construye un perfil sobre ti.",
        "Registros de hosting. Como cualquier aplicación web alojada, pueden existir registros de acceso estándar a nivel de infraestructura por parte del proveedor de hosting, por motivos de seguridad y fiabilidad. PANDA no los usa para rastreo ni marketing.",
        "Tus derechos y contacto. Para preguntar sobre qué datos podría tener PANDA sobre ti, contacta con: [pendiente].",
      ],
    },
  },
  "risk-disclosure": {
    slug: "risk-disclosure",
    title: { en: "Risk Disclosure", es: "Divulgación de Riesgos" },
    body: {
      en: [
        DRAFT_NOTICE.en,
        "Trading and creating coins through PANDA involves real, significant financial risk. Read this before you connect a wallet.",
        "Extreme volatility and total loss. Memecoins, including every coin created through PANDA and $PANDA itself, are highly speculative. Prices can move dramatically in minutes and can go to zero. Only ever risk money you can afford to lose completely.",
        "No vetting, no endorsement. PANDA doesn't review, approve, or vouch for any coin created or traded through it. Anyone can create a coin with any name, image, or description — that alone says nothing about its legitimacy or future value.",
        "Smart contract and program risk. Trades and coin creation execute through Pump.fun's, PumpSwap's, and (for non-Pump.fun coins) third-party DEXes' public Solana programs, plus Jupiter's routing. PANDA didn't write these programs and can't guarantee they're free of bugs or exploits.",
        "Stop Loss / Take Profit orders are custodial — a different risk than the rest of PANDA. Setting one up moves your tokens into a Jupiter Trigger vault, a Privy-managed custodial account that PANDA doesn't control. That means, for as long as an order is open, you're trusting Jupiter's and Privy's infrastructure and security, not just Solana's — a materially different risk than every other action in PANDA, where your funds never leave your own wallet until you sign. Only deposit what you're comfortable holding in a third-party custodian.",
        "Fee distribution and holder rewards are real but still evolving. A coin's on-chain \"Holder\" fee share (see Fee Distribution in Create) determines how much of its creator fees route toward holders, and PANDA's Rewards Pool collects and pays those out automatically on a real schedule. Collection only happens above a minimum on-chain dust threshold, and payouts depend on that automated collection actually running — past fee activity is never a guarantee of future rewards, and \"entitled\" amounts can lag real-time trading until the next collection cycle.",
        "Network and execution risk. Solana network congestion, RPC issues, or slippage can cause a transaction to fail, execute at a worse price than expected, or take longer than expected to confirm. Network fees are real and non-refundable once a transaction confirms, even if the trade itself doesn't go the way you hoped.",
        "Not investment advice. Nothing in PANDA — including market data, stats, or any coin's presence in a \"Trending\" or \"Top Gainers\" list — is a recommendation to buy, sell, or hold anything. See also: Disclaimer.",
      ],
      es: [
        DRAFT_NOTICE.es,
        "Operar y crear monedas a través de PANDA implica un riesgo financiero real y significativo. Lee esto antes de conectar una wallet.",
        "Volatilidad extrema y pérdida total. Las memecoins, incluida cualquier moneda creada a través de PANDA y $PANDA misma, son altamente especulativas. Los precios pueden moverse drásticamente en minutos y pueden llegar a cero. Arriesga únicamente dinero que puedas permitirte perder por completo.",
        "Sin revisión ni respaldo. PANDA no revisa, aprueba ni avala ninguna moneda creada u operada a través de ella. Cualquiera puede crear una moneda con cualquier nombre, imagen o descripción — eso por sí solo no dice nada sobre su legitimidad o valor futuro.",
        "Riesgo de contratos inteligentes y programas. Las operaciones y la creación de monedas se ejecutan a través de los programas públicos de Solana de Pump.fun, PumpSwap y (para monedas que no son de Pump.fun) DEXes de terceros, además del enrutamiento de Jupiter. PANDA no escribió estos programas y no puede garantizar que estén libres de errores o vulnerabilidades.",
        "Las órdenes de Stop Loss / Take Profit son custodiales — un riesgo distinto al del resto de PANDA. Configurar una traslada tus tokens a una bóveda de Jupiter Trigger, una cuenta custodial gestionada por Privy que PANDA no controla. Eso significa que, mientras una orden esté abierta, confías en la infraestructura y seguridad de Jupiter y Privy, no solo en la de Solana — un riesgo materialmente distinto al de cualquier otra acción en PANDA, donde tus fondos nunca salen de tu propia wallet hasta que firmas. Deposita solo lo que te sientas cómodo manteniendo en un custodio externo.",
        "El reparto de comisiones y las recompensas a holders son reales, pero siguen evolucionando. El porcentaje on-chain de \"Holders\" de una moneda (ver Fee Distribution en Create) determina qué parte de las comisiones del creador va a los holders, y el Rewards Pool de PANDA las recolecta y las paga automáticamente según un calendario real. La recolección solo ocurre por encima de un umbral mínimo on-chain, y los pagos dependen de que esa recolección automática se ejecute realmente — la actividad pasada de comisiones nunca garantiza recompensas futuras, y los importes \"pendientes de cobro\" pueden ir por detrás del trading en tiempo real hasta el siguiente ciclo de recolección.",
        "Riesgo de red y ejecución. La congestión de la red Solana, problemas de RPC o el slippage pueden hacer que una transacción falle, se ejecute a un precio peor del esperado, o tarde más de lo previsto en confirmarse. Las comisiones de red son reales y no reembolsables una vez confirmada la transacción, aunque la operación en sí no salga como esperabas.",
        "No es asesoramiento de inversión. Nada en PANDA — incluyendo datos de mercado, estadísticas, o la presencia de una moneda en una lista de \"Tendencia\" o \"Mayores subidas\" — es una recomendación para comprar, vender o mantener nada. Ver también: Aviso legal general (Disclaimer).",
      ],
    },
  },
  "cookie-policy": {
    slug: "cookie-policy",
    title: { en: "Cookie Policy", es: "Política de Cookies" },
    body: {
      en: [
        DRAFT_NOTICE.en,
        "PANDA does not use cookies of any kind — no session cookies, no advertising cookies, no analytics cookies.",
        "PANDA uses browser localStorage for exactly one thing: remembering your chosen display language (English/Spanish), so it doesn't ask again on your next visit. It doesn't use sessionStorage or any third-party tracking or analytics scripts. There's nothing else to opt out of, because nothing else is being set.",
        "Your wallet extension (e.g. Phantom, Solflare) may use its own browser storage to remember your connection preferences — that storage is controlled entirely by the extension, not by PANDA, and is covered by that extension's own privacy practices, not this one.",
        "If this ever changes — for example, if PANDA adds another optional feature that needs local storage for your convenience — this page will be updated to describe exactly what's stored and why, honestly and specifically, not with a generic cookie-consent template.",
      ],
      es: [
        DRAFT_NOTICE.es,
        "PANDA no usa cookies de ningún tipo — ni cookies de sesión, ni de publicidad, ni de analítica.",
        "PANDA usa el localStorage del navegador para exactamente una cosa: recordar el idioma que elegiste (inglés/español), para no volver a preguntarlo en tu siguiente visita. No usa sessionStorage ni scripts de rastreo o analítica de terceros. No hay nada más de lo que darse de baja, porque no se guarda nada más.",
        "Tu extensión de wallet (por ejemplo, Phantom o Solflare) puede usar su propio almacenamiento del navegador para recordar tus preferencias de conexión — ese almacenamiento lo controla la propia extensión, no PANDA, y se rige por las prácticas de privacidad de esa extensión, no por esta.",
        "Si esto cambia alguna vez — por ejemplo, si PANDA añade otra función opcional que necesite almacenamiento local por comodidad — esta página se actualizará para describir exactamente qué se guarda y por qué, de forma honesta y específica, no con una plantilla genérica de consentimiento de cookies.",
      ],
    },
  },
  disclaimer: {
    slug: "disclaimer",
    title: { en: "Disclaimer", es: "Aviso General" },
    body: {
      en: [
        DRAFT_NOTICE.en,
        "PANDA is a non-custodial software interface for creating and trading coins on Solana, with one disclosed exception: the optional Stop Loss / Take Profit feature, which uses a third-party custodial vault (see Risk Disclosure and Legal Notice). PANDA is not a financial advisor, broker, dealer, exchange, or bank, and nothing in the app constitutes financial, investment, legal, or tax advice.",
        "Market data, stats, and charts shown in PANDA (including on the Analytics page and Home sections) are sourced from GeckoTerminal, with Dexscreener as a fallback when that source is rate-limited, and reflect real on-chain activity — but can be incomplete, delayed, or temporarily unavailable. The app is built to say so honestly (via its \"live\" indicators) rather than silently show stale numbers as current.",
        "$PANDA, PANDA's own token, has not launched at the time of writing. Any reference to it in the app describes planned functionality, not a live, tradeable asset, until it actually exists on-chain — the app itself reflects this honestly rather than showing a fake balance or price.",
        "Any third-party links (a coin's website, X/Twitter, or Telegram, as supplied by its creator) are provided as-is. PANDA doesn't control or vet that content.",
        "You are solely responsible for your own decisions when using PANDA. Do your own research before creating, buying, selling, or holding any coin.",
      ],
      es: [
        DRAFT_NOTICE.es,
        "PANDA es una interfaz de software no custodial para crear y operar monedas en Solana, con una excepción declarada: la función opcional de Stop Loss / Take Profit, que usa una bóveda custodial de un tercero (ver Divulgación de Riesgos y Aviso Legal). PANDA no es un asesor financiero, bróker, dealer, exchange ni banco, y nada en la aplicación constituye asesoramiento financiero, de inversión, legal o fiscal.",
        "Los datos de mercado, estadísticas y gráficos que se muestran en PANDA (incluyendo la página de Analítica y las secciones de Inicio) proceden de GeckoTerminal, con Dexscreener como respaldo cuando esa fuente está limitada por rate-limit, y reflejan actividad real on-chain — pero pueden estar incompletos, retrasados o no disponibles temporalmente. La app está construida para indicarlo honestamente (mediante sus indicadores \"en vivo\") en lugar de mostrar en silencio datos desactualizados como si fueran actuales.",
        "$PANDA, el token propio de PANDA, no se ha lanzado en el momento de escribir esto. Cualquier referencia a él en la app describe una funcionalidad planeada, no un activo real y operable, hasta que exista de verdad on-chain — la propia app lo refleja honestamente en lugar de mostrar un saldo o un precio falsos.",
        "Cualquier enlace a terceros (el sitio web, X/Twitter o Telegram de una moneda, tal como los proporciona su creador) se ofrece tal cual. PANDA no controla ni verifica ese contenido.",
        "Eres el único responsable de tus propias decisiones al usar PANDA. Investiga por tu cuenta antes de crear, comprar, vender o mantener cualquier moneda.",
      ],
    },
  },
};

export const LEGAL_SLUGS = Object.keys(LEGAL_PAGES) as LegalSlug[];
