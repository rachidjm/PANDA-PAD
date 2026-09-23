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
 * leaving it blank. Kept up to date with what PANDA actually does at the launch configuration; the custodial
 * Stop Loss / Take Profit and Draw Your Trade feature (Jupiter/Privy vault) is described only by CUSTODY_ADDENDA below,
 * which getLegalPage appends when FEATURE_STRATEGIES is on — with the flag off those pages must not mention it.
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
        "Holder rewards are the one place PANDA holds funds. If a coin's creator assigns part of its creator fees to \"Holders\", those fees are paid on-chain to PANDA's Rewards Pool wallet, whose key is held by PANDA's servers; PANDA then pays each holder their share when they claim it (claiming needs a free message signature from your wallet, not a transaction). Until claimed, those funds sit in that wallet — you are trusting PANDA's infrastructure with them.",
        "Coins created through PANDA are minted directly by users via Pump.fun's public program. PANDA does not issue, endorse, or guarantee any coin created or traded through it, including $PANDA itself.",
        "Market and pool data shown in the app comes from Pump.fun's public API, Dexscreener and GeckoTerminal — independent third parties that index public Solana on-chain activity. PANDA sets aside coins whose data looks unreliable (for example a huge market cap on almost no liquidity); that is a data-quality filter, not a judgment on any coin.",
      ],
      es: [
        DRAFT_NOTICE.es,
        "Operador: [nombre de la entidad legal o persona física pendiente de añadir]. Domicilio registrado: [pendiente]. Jurisdicción aplicable: [pendiente]. Contacto: [pendiente]. Estos datos se completarán cuando la entidad operadora de PANDA quede definida — no debe asumirse nada al respecto hasta entonces.",
        "PANDA es una interfaz de software para interactuar con programas públicos y sin permisos de Solana (Pump.fun, PumpSwap, y DEXes de Solana de terceros a través del agregador de Jupiter). PANDA no opera como banco, bróker-dealer, custodio ni transmisor de dinero para el trading habitual: nunca retiene fondos de usuarios, claves privadas ni frases semilla para comprar, vender o crear monedas. Cada una de esas transacciones se construye sin firmar y solo se vuelve real cuando el usuario la revisa y la firma en su propia wallet (por ejemplo, Phantom o Solflare).",
        "Las recompensas de holders son el único punto donde PANDA retiene fondos. Si el creador de una moneda asigna parte de sus comisiones a \"Holders\", esas comisiones se pagan on-chain a la wallet del Rewards Pool de PANDA, cuya clave custodian los servidores de PANDA; PANDA paga después a cada holder su parte cuando la reclama (reclamar requiere una firma gratuita de un mensaje desde tu wallet, no una transacción). Hasta que se reclaman, esos fondos están en esa wallet — confías su custodia a la infraestructura de PANDA.",
        "Las monedas creadas a través de PANDA son acuñadas directamente por los usuarios mediante el programa público de Pump.fun. PANDA no emite, avala ni garantiza ninguna moneda creada u operada a través de ella, incluyendo $PANDA.",
        "Los datos de mercado y de pools que se muestran en la app proceden de la API pública de Pump.fun, Dexscreener y GeckoTerminal — terceros independientes que indexan actividad real on-chain de Solana. PANDA aparta las monedas cuyos datos parecen poco fiables (por ejemplo, una capitalización enorme con casi nada de liquidez); es un filtro de calidad de datos, no un juicio sobre ninguna moneda.",
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
        "Non-custodial trading and creation. PANDA never takes custody of your funds, tokens, or private keys for trading, coin creation or fee-distribution setup — each of those is a transaction you review and sign yourself, in your own wallet. Holder rewards are the one place PANDA holds funds. If a coin's creator assigns part of its creator fees to \"Holders\", those fees are paid on-chain to PANDA's Rewards Pool wallet, whose key is held by PANDA's servers; PANDA then pays each holder their share when they claim it (claiming needs a free message signature from your wallet, not a transaction). Until claimed, those funds sit in that wallet — you are trusting PANDA's infrastructure with them.",
        "Your responsibility. You are solely responsible for your wallet, its seed phrase, and every transaction you approve. PANDA will never ask for your seed phrase or private key, in the app or otherwise. Double-check every transaction's details in your wallet before signing — PANDA cannot undo a signed transaction.",
        "Acceptable use. You agree not to use PANDA to violate applicable law, to manipulate markets, to launder funds, or to infringe anyone else's rights. PANDA may restrict access to the app (though not to the underlying public Solana programs, which anyone can interact with directly) for accounts that clearly abuse it.",
        "No warranty. PANDA is provided \"as is,\" without warranties of any kind. Market data comes from third parties (Pump.fun's public API, Dexscreener and GeckoTerminal) and can be delayed, rate-limited, or temporarily unavailable — the app shows this honestly (a \"live\" indicator) rather than pretending stale data is current, but you should not rely on it for time-critical decisions.",
        "Limitation of liability. To the maximum extent permitted by law, PANDA and its operator aren't liable for losses arising from your use of the app, including losses from market volatility, smart-contract risk, third-party services (Solana RPC providers, Pump.fun, Jupiter, GeckoTerminal, Dexscreener), or your own transaction mistakes.",
        "Changes. These terms may be updated as PANDA evolves; continued use after a change means you accept the new terms. Governing law: [to be added].",
      ],
      es: [
        DRAFT_NOTICE.es,
        "Al usar PANDA, aceptas estos términos. Si no estás de acuerdo, no uses la aplicación.",
        "Operar y crear sin custodia. PANDA nunca custodia tus fondos, tokens o claves privadas para operar, crear monedas o configurar el reparto de comisiones — cada una de esas acciones es una transacción que revisas y firmas tú mismo, en tu propia wallet. Las recompensas de holders son el único punto donde PANDA retiene fondos. Si el creador de una moneda asigna parte de sus comisiones a \"Holders\", esas comisiones se pagan on-chain a la wallet del Rewards Pool de PANDA, cuya clave custodian los servidores de PANDA; PANDA paga después a cada holder su parte cuando la reclama (reclamar requiere una firma gratuita de un mensaje desde tu wallet, no una transacción). Hasta que se reclaman, esos fondos están en esa wallet — confías su custodia a la infraestructura de PANDA.",
        "Tu responsabilidad. Eres el único responsable de tu wallet, su frase semilla y cada transacción que apruebas. PANDA nunca te pedirá tu frase semilla ni tu clave privada, ni dentro de la app ni fuera de ella. Revisa siempre los detalles de cada transacción en tu wallet antes de firmar — PANDA no puede deshacer una transacción ya firmada.",
        "Uso aceptable. Aceptas no usar PANDA para infringir la ley aplicable, manipular mercados, blanquear fondos o vulnerar los derechos de terceros. PANDA puede restringir el acceso a la aplicación (aunque no a los programas públicos subyacentes de Solana, con los que cualquiera puede interactuar directamente) a cuentas que abusen claramente de ella.",
        "Sin garantías. PANDA se ofrece \"tal cual\", sin garantías de ningún tipo. Los datos de mercado provienen de terceros (la API pública de Pump.fun, Dexscreener y GeckoTerminal) y pueden llegar con retraso, estar limitados por rate-limit o no estar disponibles temporalmente — la app lo indica honestamente (un indicador \"en vivo\") en lugar de aparentar que unos datos desactualizados son actuales, pero no deberías depender de ello para decisiones críticas de tiempo.",
        "Limitación de responsabilidad. En la medida máxima permitida por la ley, PANDA y su operador no son responsables de las pérdidas derivadas del uso de la aplicación, incluyendo pérdidas por volatilidad de mercado, riesgo de los contratos inteligentes, servicios de terceros (proveedores de RPC de Solana, Pump.fun, Jupiter, GeckoTerminal, Dexscreener) o tus propios errores al operar.",
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
        "Wallet data. When you connect a wallet, PANDA reads your public wallet address and, for the Portfolio and Rewards pages, your real on-chain token balances — all of this is already public on the Solana blockchain and is read live each time you view those pages. PANDA also keeps a few records tied to public wallet addresses, none of them secret: the log of trades you make through PANDA (used for Portfolio), the ledger of holder rewards owed and claimed, and audit entries (wallet address, action, public transaction signature). These are stored as files that anyone holding their URL can read. PANDA never receives, requests, or stores your seed phrase or private key.",
        "One session cookie, no tracking. PANDA does not use analytics, ad pixels or session replay. The only cookie it sets is a strictly necessary sign-in cookie, and only after you sign in with your wallet (a free message signature, needed to claim rewards): HttpOnly, SameSite=Strict, Secure, expiring after 2 hours. Your browser's localStorage is used to remember your display language and, on coin pages, your preferred amount currency; nothing else is stored there and it never leaves your browser.",
        "Third-party services. To show real data and build real transactions, your browser or PANDA's servers make requests to: Pump.fun's public API, GeckoTerminal and Dexscreener (market and pool data — prices, volume, trades), Jupiter's public swap API (quotes and swap routing for non-Pump.fun coins and for paying with other tokens), and a Solana RPC provider (reading balances, sending transactions). These requests carry the technical information any web or API request does (e.g. IP address, at the network level) — PANDA doesn't combine this with your wallet address or build a profile of you.",
        "Hosting logs. Like any hosted web app, standard infrastructure-level access logs may exist at the hosting provider level for security and reliability purposes. PANDA doesn't use these for tracking or marketing.",
        "Your rights and contact. To ask about data PANDA might hold about you, contact: [to be added].",
      ],
      es: [
        DRAFT_NOTICE.es,
        "La versión corta: PANDA recopila muy poco, porque no necesita mucho para funcionar. Esta sección describe lo que la aplicación realmente hace, no una plantilla genérica.",
        "Datos de la wallet. Al conectar una wallet, PANDA lee tu dirección pública y, para las páginas de Portfolio y Rewards, tus saldos reales de tokens on-chain — todo esto ya es público en la blockchain de Solana y se lee en vivo cada vez que visitas esas páginas. PANDA también guarda algunos registros asociados a direcciones públicas de wallet, ninguno secreto: el registro de las operaciones que haces a través de PANDA (para el Portfolio), el libro de recompensas de holders pendientes y reclamadas, y entradas de auditoría (dirección de wallet, acción, firma pública de la transacción). Se almacenan como archivos que puede leer cualquiera que tenga su URL. PANDA nunca recibe, solicita ni almacena tu frase semilla o clave privada.",
        "Una cookie de sesión, sin rastreo. PANDA no usa analítica, píxeles publicitarios ni session replay. La única cookie que establece es una cookie de inicio de sesión estrictamente necesaria, y solo después de que inicies sesión con tu wallet (una firma gratuita de un mensaje, necesaria para reclamar recompensas): HttpOnly, SameSite=Strict, Secure y con caducidad de 2 horas. El localStorage de tu navegador se usa para recordar tu idioma y, en las páginas de moneda, la moneda en que prefieres escribir los importes; no se guarda nada más ahí y nunca sale de tu navegador.",
        "Servicios de terceros. Para mostrar datos reales y construir transacciones reales, tu navegador o los servidores de PANDA hacen peticiones a: la API pública de Pump.fun, GeckoTerminal y Dexscreener (datos de mercado y de pools — precios, volumen, operaciones), la API pública de swap de Jupiter (cotizaciones y enrutamiento para monedas que no son de Pump.fun y para pagar con otros tokens), y un proveedor de RPC de Solana (lectura de saldos, envío de transacciones). Estas peticiones llevan la información técnica habitual de cualquier petición web o de API (por ejemplo, la dirección IP, a nivel de red) — PANDA no combina esto con tu dirección de wallet ni construye un perfil sobre ti.",
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
        "Fee distribution and holder rewards are real but still evolving. A coin's on-chain \"Holder\" fee share (see Fee Distribution in Create) determines how much of its creator fees route toward holders; those fees are paid to PANDA's Rewards Pool wallet, which PANDA's servers control, and PANDA pays them out when holders claim — so for holder rewards you are trusting PANDA's infrastructure and key management. Collection only happens above a minimum on-chain dust threshold, and payouts depend on that automated collection actually running — past fee activity is never a guarantee of future rewards, and \"entitled\" amounts can lag real-time trading until the next collection cycle.",
        "Network and execution risk. Solana network congestion, RPC issues, or slippage can cause a transaction to fail, execute at a worse price than expected, or take longer than expected to confirm. Network fees are real and non-refundable once a transaction confirms, even if the trade itself doesn't go the way you hoped.",
        "Not investment advice. Nothing in PANDA — including market data, stats, or any coin's presence in a \"Trending\" or \"Top Gainers\" list — is a recommendation to buy, sell, or hold anything. See also: Disclaimer.",
      ],
      es: [
        DRAFT_NOTICE.es,
        "Operar y crear monedas a través de PANDA implica un riesgo financiero real y significativo. Lee esto antes de conectar una wallet.",
        "Volatilidad extrema y pérdida total. Las memecoins, incluida cualquier moneda creada a través de PANDA y $PANDA misma, son altamente especulativas. Los precios pueden moverse drásticamente en minutos y pueden llegar a cero. Arriesga únicamente dinero que puedas permitirte perder por completo.",
        "Sin revisión ni respaldo. PANDA no revisa, aprueba ni avala ninguna moneda creada u operada a través de ella. Cualquiera puede crear una moneda con cualquier nombre, imagen o descripción — eso por sí solo no dice nada sobre su legitimidad o valor futuro.",
        "Riesgo de contratos inteligentes y programas. Las operaciones y la creación de monedas se ejecutan a través de los programas públicos de Solana de Pump.fun, PumpSwap y (para monedas que no son de Pump.fun) DEXes de terceros, además del enrutamiento de Jupiter. PANDA no escribió estos programas y no puede garantizar que estén libres de errores o vulnerabilidades.",
        "El reparto de comisiones y las recompensas a holders son reales, pero siguen evolucionando. El porcentaje on-chain de \"Holders\" de una moneda (ver Fee Distribution en Create) determina qué parte de las comisiones del creador va a los holders; esas comisiones se pagan a la wallet del Rewards Pool de PANDA, que controlan los servidores de PANDA, y PANDA las paga cuando los holders las reclaman — así que, para las recompensas de holders, confías en la infraestructura y la gestión de claves de PANDA. La recolección solo ocurre por encima de un umbral mínimo on-chain, y los pagos dependen de que esa recolección automática se ejecute realmente — la actividad pasada de comisiones nunca garantiza recompensas futuras, y los importes \"pendientes de cobro\" pueden ir por detrás del trading en tiempo real hasta el siguiente ciclo de recolección.",
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
        "PANDA sets one cookie, and only when you choose to sign in with your wallet: a strictly necessary session cookie (HttpOnly, SameSite=Strict, Secure, expiring after 2 hours) that proves the wallet you signed with, needed to claim rewards. There are no advertising, analytics or tracking cookies.",
        "PANDA uses your browser's localStorage to remember your display language (English/Spanish) and, on coin pages, the currency you prefer to type amounts in, so it doesn't ask again on your next visit. It doesn't use sessionStorage or any third-party tracking or analytics scripts.",
        "Your wallet extension (e.g. Phantom, Solflare) may use its own browser storage to remember your connection preferences — that storage is controlled entirely by the extension, not by PANDA, and is covered by that extension's own privacy practices, not this one.",
        "If this ever changes — for example, if PANDA adds another optional feature that needs local storage for your convenience — this page will be updated to describe exactly what's stored and why, honestly and specifically, not with a generic cookie-consent template.",
      ],
      es: [
        DRAFT_NOTICE.es,
        "PANDA establece una sola cookie, y solo cuando decides iniciar sesión con tu wallet: una cookie de sesión estrictamente necesaria (HttpOnly, SameSite=Strict, Secure y con caducidad de 2 horas) que acredita la wallet con la que firmaste, necesaria para reclamar recompensas. No hay cookies publicitarias, de analítica ni de rastreo.",
        "PANDA usa el localStorage de tu navegador para recordar el idioma que elegiste (inglés/español) y, en las páginas de moneda, la moneda en que prefieres escribir los importes, para no volver a preguntarlo en tu siguiente visita. No usa sessionStorage ni scripts de rastreo o analítica de terceros.",
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
        "PANDA is a non-custodial software interface for creating and trading coins on Solana — the exception being holder rewards, whose fees sit in a wallet controlled by PANDA's servers until claimed (see Risk Disclosure and Legal Notice). PANDA is not a financial advisor, broker, dealer, exchange, or bank, and nothing in the app constitutes financial, investment, legal, or tax advice.",
        "Market data, stats, and charts shown in PANDA (including on the Analytics page and Home sections) come from Pump.fun's public API, Dexscreener and GeckoTerminal and reflect real on-chain activity — but can be incomplete, delayed, or temporarily unavailable. Coins whose numbers look unreliable are left out of the lists. The app is built to say when data is not live rather than silently show stale numbers as current.",
        "$PANDA, PANDA's own token, has not launched at the time of writing. Any reference to it in the app describes planned functionality, not a live, tradeable asset, until it actually exists on-chain — the app itself reflects this honestly rather than showing a fake balance or price.",
        "Any third-party links (a coin's website, X/Twitter, or Telegram, as supplied by its creator) are provided as-is. PANDA doesn't control or vet that content.",
        "You are solely responsible for your own decisions when using PANDA. Do your own research before creating, buying, selling, or holding any coin.",
      ],
      es: [
        DRAFT_NOTICE.es,
        "PANDA es una interfaz de software no custodial para crear y operar monedas en Solana — con la excepción de las recompensas de holders, cuyas comisiones están en una wallet controlada por los servidores de PANDA hasta que se reclaman (ver Divulgación de Riesgos y Aviso Legal). PANDA no es un asesor financiero, bróker, dealer, exchange ni banco, y nada en la aplicación constituye asesoramiento financiero, de inversión, legal o fiscal.",
        "Los datos de mercado, estadísticas y gráficos que se muestran en PANDA (incluyendo la página de Analítica y las secciones de Inicio) proceden de la API pública de Pump.fun, Dexscreener y GeckoTerminal y reflejan actividad real on-chain — pero pueden estar incompletos, retrasados o no disponibles temporalmente. Las monedas cuyas cifras parecen poco fiables se dejan fuera de las listas. La app está construida para indicar cuándo los datos no son en vivo en lugar de mostrar en silencio datos desactualizados como si fueran actuales.",
        "$PANDA, el token propio de PANDA, no se ha lanzado en el momento de escribir esto. Cualquier referencia a él en la app describe una funcionalidad planeada, no un activo real y operable, hasta que exista de verdad on-chain — la propia app lo refleja honestamente en lugar de mostrar un saldo o un precio falsos.",
        "Cualquier enlace a terceros (el sitio web, X/Twitter o Telegram de una moneda, tal como los proporciona su creador) se ofrece tal cual. PANDA no controla ni verifica ese contenido.",
        "Eres el único responsable de tus propias decisiones al usar PANDA. Investiga por tu cuenta antes de crear, comprar, vender o mantener cualquier moneda.",
      ],
    },
  },
};

export const LEGAL_SLUGS = Object.keys(LEGAL_PAGES) as LegalSlug[];


/**
 * Paragraphs that exist ONLY while FEATURE_STRATEGIES is on: the custody of Jupiter's Trigger vault (held by Privy) and
 * its risks. Kept out of LEGAL_PAGES on purpose — with the flag off the app has no such feature, and describing it would
 * be as wrong as hiding it when it is on. Appended by getLegalPage.
 */
export const CUSTODY_ADDENDA: Partial<Record<LegalSlug, Record<Lang, string[]>>> = {
  "legal-notice": {
    en: [
      "Stop Loss / Take Profit orders and Draw Your Trade strategies are custodial. They are built on Jupiter's Trigger API, which moves the deposited tokens into a vault managed by Jupiter and held by Privy until the order or strategy fills or is cancelled. PANDA does not operate or control that vault, but this is a genuine exception to PANDA's otherwise non-custodial design, and the app says so before any deposit.",
    ],
    es: [
      "Las órdenes de Stop Loss / Take Profit y las estrategias de Draw Your Trade son custodiales. Se construyen sobre la Trigger API de Jupiter, que traslada los tokens depositados a una bóveda gestionada por Jupiter y custodiada por Privy hasta que la orden o estrategia se ejecuta o se cancela. PANDA no opera ni controla esa bóveda, pero es una excepción real al diseño no custodial del resto de PANDA, y la app lo indica antes de cualquier depósito.",
    ],
  },
  "terms-of-service": {
    en: [
      "Custodial exception: Stop Loss / Take Profit and Draw Your Trade. Setting one up deposits your tokens (or the SOL / USDC that will fund the buy) into a Jupiter Trigger vault — a Privy-managed custodial account, not PANDA's — until the order fills or you cancel it. Cancelling requires your signature and returns the funds to your wallet. PANDA's fee on a strategy is paid up front and is not returned if you cancel before it buys. Using this feature is optional and you accept the custody terms of Jupiter and Privy when you do.",
    ],
    es: [
      "Excepción custodial: Stop Loss / Take Profit y Draw Your Trade. Configurar una deposita tus tokens (o el SOL / USDC que financiará la compra) en una bóveda de Jupiter Trigger — una cuenta custodial gestionada por Privy, no por PANDA — hasta que la orden se ejecuta o la cancelas. Cancelar requiere tu firma y devuelve los fondos a tu wallet. La comisión de PANDA en una estrategia se paga por adelantado y no se devuelve si cancelas antes de que compre. Usar esta función es opcional y, al hacerlo, aceptas las condiciones de custodia de Jupiter y Privy.",
    ],
  },
  "privacy-policy": {
    en: [
      "Stop Loss / Take Profit and Draw Your Trade. Only if you set one up, your wallet address, the order details and a Jupiter sign-in are sent to Jupiter's Trigger API and its vault provider Privy. PANDA also stores your strategies (prices, amounts, state, public transaction signatures) tied to your wallet address; the Jupiter session token is kept only in your browser's memory.",
    ],
    es: [
      "Stop Loss / Take Profit y Draw Your Trade. Solo si configuras una, tu dirección de wallet, los datos de la orden y un inicio de sesión de Jupiter se envían a la Trigger API de Jupiter y a su proveedor de bóvedas, Privy. PANDA además guarda tus estrategias (precios, importes, estado, firmas públicas de transacciones) asociadas a tu dirección de wallet; el token de sesión de Jupiter solo se mantiene en la memoria de tu navegador.",
    ],
  },
  "risk-disclosure": {
    en: [
      "Stop Loss / Take Profit and Draw Your Trade are custodial — a different risk than the rest of PANDA. Setting one up moves your funds into a Jupiter Trigger vault, a Privy-managed custodial account that PANDA does not control. For as long as an order or strategy is open you are trusting Jupiter's and Privy's infrastructure, security and availability, not just Solana's. If those services fail, are attacked, or are unavailable, your funds may be inaccessible or lost, and PANDA cannot recover them. An order may not execute at your price (slippage, thin liquidity, network congestion) or at all, and a strategy that buys can leave you holding tokens if its exit does not fill. Only deposit what you are comfortable holding in a third-party custodian, and get your own legal and tax advice — custody and crypto-asset services are regulated in many jurisdictions.",
    ],
    es: [
      "Stop Loss / Take Profit y Draw Your Trade son custodiales — un riesgo distinto al del resto de PANDA. Configurar una traslada tus fondos a una bóveda de Jupiter Trigger, una cuenta custodial gestionada por Privy que PANDA no controla. Mientras una orden o estrategia esté abierta confías en la infraestructura, la seguridad y la disponibilidad de Jupiter y Privy, no solo en las de Solana. Si esos servicios fallan, sufren un ataque o no están disponibles, tus fondos pueden quedar inaccesibles o perderse, y PANDA no puede recuperarlos. Una orden puede no ejecutarse a tu precio (slippage, poca liquidez, congestión de red) o no ejecutarse en absoluto, y una estrategia que compra puede dejarte con tokens si su salida no se ejecuta. Deposita solo lo que te sientas cómodo manteniendo en un custodio externo y busca tu propio asesoramiento legal y fiscal — la custodia y los servicios con criptoactivos están regulados en muchas jurisdicciones.",
    ],
  },
  disclaimer: {
    en: ["Stop Loss / Take Profit and Draw Your Trade use a third-party custodial vault (Jupiter, held by Privy) — see Risk Disclosure and Legal Notice."],
    es: ["Stop Loss / Take Profit y Draw Your Trade usan una bóveda custodial de un tercero (Jupiter, custodiada por Privy) — ver Divulgación de Riesgos y Aviso Legal."],
  },
};

/** The legal page as it applies to this deployment: the base text, plus the custody sections only when strategies are on. */
export function getLegalPage(slug: LegalSlug, opts: { custody: boolean }): LegalPage {
  const base = LEGAL_PAGES[slug];
  const extra = opts.custody ? CUSTODY_ADDENDA[slug] : undefined;
  if (!extra) return base;
  return { ...base, body: { en: [...base.body.en, ...extra.en], es: [...base.body.es, ...extra.es] } };
}
