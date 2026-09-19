/**
 * PANDA's translation dictionary — flat dot-keys, English + Spanish side by
 * side so a missing Spanish string is impossible to miss in review. This is
 * a first real increment (see LanguageProvider.tsx): the always-visible
 * chrome (nav, footer, wallet), the home page, the coin page (trading,
 * stop loss/take profit, chart), discover, and the legal pages are covered.
 * Anything not yet in this dictionary still renders in English — that's an
 * honest gap to fill next, not a bug to hide.
 */

export type Lang = "en" | "es";

export const dict = {
  // Navbar
  "nav.discover": { en: "Discover", es: "Descubrir" },
  "nav.create": { en: "Create", es: "Crear" },
  "nav.rewards": { en: "Rewards", es: "Recompensas" },
  "nav.analytics": { en: "Analytics", es: "Analítica" },
  "nav.searchPlaceholder": { en: "Search all Solana coins", es: "Busca cualquier moneda de Solana" },

  // Wallet button
  "wallet.connect": { en: "Connect wallet", es: "Conectar wallet" },
  "wallet.connecting": { en: "Connecting…", es: "Conectando…" },
  "wallet.installPhantom": { en: "Install Phantom", es: "Instalar Phantom" },
  "wallet.installSolflare": { en: "Install Solflare", es: "Instalar Solflare" },
  "wallet.neverSeeKeys": {
    en: "PANDA never sees your seed phrase or keys. You approve everything in your wallet.",
    es: "PANDA nunca ve tu frase semilla ni tus claves. Apruebas todo desde tu wallet.",
  },

  // Footer
  "footer.product": { en: "Product", es: "Producto" },
  "footer.legal": { en: "Legal", es: "Legal" },
  "footer.disclaimer": {
    en: "PANDA is a non-custodial interface for launching and trading coins on Solana. It isn't a financial advisor, broker, or exchange, and nothing on this site is investment advice. Memecoins are extremely volatile and can lose all value.",
    es: "PANDA es una interfaz no custodial para lanzar y operar monedas en Solana. No es un asesor financiero, un bróker ni un exchange, y nada en este sitio es asesoramiento de inversión. Las memecoins son extremadamente volátiles y pueden perder todo su valor.",
  },

  // Home hero
  "home.kicker": { en: "PANDA", es: "PANDA" },
  "home.title1": { en: "The Solana", es: "El launchpad de" },
  "home.title2": { en: "coin launchpad", es: "monedas de Solana" },
  "home.subtitle": {
    en: "Create any coin in a minute — GIFs, memes, or your own idea — or trade what's already live.",
    es: "Crea cualquier moneda en un minuto — GIFs, memes o tu propia idea — o opera con lo que ya está en vivo.",
  },
  "home.createCta": { en: "Create a coin", es: "Crear una moneda" },
  "home.exploreCta": { en: "Explore coins", es: "Explorar monedas" },
  "home.liveCoins": { en: "Live coins", es: "Monedas en vivo" },
  "home.viewAll": { en: "View all", es: "Ver todas" },
  "home.recentActivity": { en: "Recent activity", es: "Actividad reciente" },
  "home.refreshError": {
    en: "Couldn't refresh (data source is rate-limited right now) — showing the last known prices.",
    es: "No se pudo actualizar (la fuente de datos está limitada ahora mismo) — mostrando los últimos precios conocidos.",
  },
  "home.ecosystemLabel": { en: "PANDA ecosystem", es: "Ecosistema PANDA" },
  "home.ecosystemBlurb": { en: "— the token powering the ecosystem", es: "— el token que impulsa el ecosistema" },
  "home.section.new": { en: "New", es: "Nuevas" },
  "home.section.trending": { en: "Trending", es: "Tendencia" },
  "home.section.topGainers": { en: "Top Gainers", es: "Mayores subidas" },
  "home.section.recentlyActive": { en: "Recently Active", es: "Activas recientemente" },
  "home.section.graduated": { en: "Graduated", es: "Graduadas" },

  // Discover
  "discover.title": { en: "Discover", es: "Descubrir" },
  "discover.sort.new": { en: "New", es: "Nuevas" },
  "discover.sort.trending": { en: "Trending", es: "Tendencia" },
  "discover.sort.mcap": { en: "Market cap", es: "Cap. de mercado" },
  "discover.sort.volume": { en: "Volume", es: "Volumen" },
  "discover.noMatch": {
    en: 'No coins match "{query}". Try a different search, or create it yourself.',
    es: 'Ninguna moneda coincide con "{query}". Prueba otra búsqueda, o créala tú mismo.',
  },
  "discover.empty": { en: "No coins to show right now.", es: "No hay monedas que mostrar ahora mismo." },

  // Live badge / refresh
  "live.live": { en: "Live from Solana", es: "En vivo desde Solana" },
  "live.demo": { en: "Demo data", es: "Datos de demostración" },
  "refresh.refresh": { en: "Refresh", es: "Actualizar" },
  "refresh.refreshing": { en: "Refreshing…", es: "Actualizando…" },
  "refresh.updated": { en: "Updated ✓", es: "Actualizado ✓" },

  // Coin card
  "coinCard.mc": { en: "MC", es: "Cap." },
  "coinCard.vol": { en: "Vol", es: "Vol" },

  // Search box
  "search.searching": { en: "Searching…", es: "Buscando…" },
  "search.seeAll": { en: "See all results", es: "Ver todos los resultados" },
  "search.noMatch": { en: 'No coins match "{query}".', es: 'Ninguna moneda coincide con "{query}".' },
  "search.failed": { en: "Search failed. Try again.", es: "Fallo en la búsqueda. Inténtalo de nuevo." },
  "search.failedConnection": { en: "Search failed. Check your connection.", es: "Fallo en la búsqueda. Revisa tu conexión." },

  // Coin page — header/tabs
  "coin.marketCap": { en: "Market cap", es: "Cap. de mercado" },
  "coin.volume24h": { en: "Volume (24h)", es: "Volumen (24h)" },
  "coin.tab.trades": { en: "Trades", es: "Operaciones" },
  "coin.tab.holders": { en: "Holders", es: "Holders" },
  "coin.tab.rewards": { en: "Rewards", es: "Recompensas" },
  "coin.website": { en: "Website", es: "Sitio web" },

  // Trades tab
  "coin.trades.side": { en: "Side", es: "Lado" },
  "coin.trades.trader": { en: "Trader", es: "Trader" },
  "coin.trades.tokens": { en: "Tokens", es: "Tokens" },
  "coin.trades.time": { en: "Time", es: "Hora" },
  "coin.trades.buy": { en: "Buy", es: "Compra" },
  "coin.trades.sell": { en: "Sell", es: "Venta" },
  "coin.trades.emptyTitle": { en: "No trades yet", es: "Aún no hay operaciones" },
  "coin.trades.emptyLive": { en: "This pool hasn't seen a trade recently.", es: "Este pool no ha tenido operaciones recientes." },
  "coin.trades.emptyDown": { en: "Couldn't reach the trade feed — try refreshing.", es: "No se pudo acceder al feed de operaciones — prueba a refrescar." },

  // Holders tab
  "coin.holders.title": { en: "Holder data isn't available yet", es: "Los datos de holders aún no están disponibles" },
  "coin.holders.subtitle": {
    en: "We only have real price and trade data for now — a holder breakdown needs our own indexer, coming soon.",
    es: "Por ahora solo tenemos datos reales de precio y operaciones — un desglose de holders necesita nuestro propio indexador, próximamente.",
  },

  // Rewards tab (on coin page)
  "coin.rewardsTab.blurb": {
    en: "Every trade of ${ticker} pays a small fee. A share flows back to holders as $PANDA rewards.",
    es: "Cada operación de ${ticker} paga una pequeña comisión. Una parte vuelve a los holders como recompensas en $PANDA.",
  },
  "coin.rewardsTab.link": { en: "See how rewards work", es: "Ver cómo funcionan las recompensas" },

  // Market activity card
  "coin.activity.title": { en: "Market activity", es: "Actividad del mercado" },
  "coin.activity.priceChange": { en: "Price change", es: "Cambio de precio" },
  "coin.activity.volume": { en: "Volume", es: "Volumen" },
  "coin.activity.buys": { en: "buys", es: "compras" },
  "coin.activity.sells": { en: "sells", es: "ventas" },
  "coin.activity.buyers": { en: "buyers", es: "compradores" },
  "coin.activity.sellers": { en: "sellers", es: "vendedores" },

  // Pool info card
  "coin.pool.title": { en: "Pool", es: "Pool" },
  "coin.pool.pairedWith": { en: "Paired with", es: "Emparejado con" },
  "coin.pool.liquidity": { en: "Liquidity", es: "Liquidez" },
  "coin.pool.source": { en: "Source", es: "Origen" },
  "coin.pool.sourcePumpFun": { en: "Pump.fun bonding curve", es: "Curva de vinculación de Pump.fun" },
  "coin.pool.sourcePumpSwap": { en: "PumpSwap (graduated)", es: "PumpSwap (graduada)" },

  // Chart
  "chart.low": { en: "Low {value}", es: "Mínimo {value}" },
  "chart.high": { en: "High {value}", es: "Máximo {value}" },
  "chart.noData": { en: "No chart data yet", es: "Aún no hay datos del gráfico" },

  // Trading panel
  "trading.buy": { en: "Buy", es: "Comprar" },
  "trading.sell": { en: "Sell", es: "Vender" },
  "trading.solBalance": { en: "SOL balance", es: "Saldo en SOL" },
  "trading.tokenBalance": { en: "{ticker} balance", es: "Saldo en {ticker}" },
  "trading.max": { en: "Max", es: "Máx" },
  "trading.amount": { en: "Amount", es: "Importe" },
  "trading.pandaFee": { en: "PANDA fee ({pct}%)", es: "Comisión PANDA ({pct}%)" },
  "trading.youPay": { en: "You pay", es: "Pagas" },
  "trading.sellFeeNote": {
    en: "PANDA takes a {pct}% fee out of the SOL you receive — the exact amount depends on the price at the moment you sell, shown in your wallet before you sign.",
    es: "PANDA retiene un {pct}% de comisión del SOL que recibes — el importe exacto depende del precio en el momento de vender, y se muestra en tu wallet antes de firmar.",
  },
  "trading.connectToTrade": { en: "Connect wallet to trade", es: "Conecta tu wallet para operar" },
  "trading.preparing": { en: "Preparing transaction…", es: "Preparando transacción…" },
  "trading.confirmInWallet": { en: "Confirm in wallet…", es: "Confirma en tu wallet…" },
  "trading.sending": { en: "Sending…", es: "Enviando…" },
  "trading.confirmingOnChain": { en: "Confirming on Solana…", es: "Confirmando en Solana…" },
  "trading.bought": { en: "Bought!", es: "¡Comprado!" },
  "trading.buyLabel": { en: "Buy ${ticker}", es: "Comprar ${ticker}" },
  "trading.sellLabel": { en: "Sell ${ticker}", es: "Vender ${ticker}" },
  "trading.viewTransaction": { en: "View transaction", es: "Ver transacción" },
  "trading.disclaimerExternal": {
    en: "Not a Pump.fun coin — routed via Jupiter across {dex} and other Solana DEXes. PANDA never holds your funds.",
    es: "No es una moneda de Pump.fun — enrutada vía Jupiter a través de {dex} y otros DEXes de Solana. PANDA nunca retiene tus fondos.",
  },
  "trading.disclaimerGraduated": {
    en: "Graduated to PumpSwap — real on-chain trade via Pump.fun's AMM. PANDA never holds your funds.",
    es: "Graduada a PumpSwap — operación real on-chain vía el AMM de Pump.fun. PANDA nunca retiene tus fondos.",
  },
  "trading.disclaimerBondingCurve": {
    en: "Real on-chain trade via Pump.fun. PANDA never holds your funds.",
    es: "Operación real on-chain vía Pump.fun. PANDA nunca retiene tus fondos.",
  },

  // Stop loss / take profit
  "sltp.title": { en: "Stop Loss / Take Profit", es: "Stop Loss / Take Profit" },
  "sltp.hide": { en: "Hide", es: "Ocultar" },
  "sltp.setup": { en: "Set up", es: "Configurar" },
  "sltp.disclosure": {
    en: "Setting this up moves your ${ticker} into a Jupiter-managed vault (held by Privy, not PANDA or your own wallet) until the order fills or you cancel it. This is a different trust model than regular trading on PANDA, where your funds never leave your wallet until you sign.",
    es: "Al configurar esto, tus ${ticker} se mueven a una bóveda gestionada por Jupiter (custodiada por Privy, no por PANDA ni por tu propia wallet) hasta que la orden se ejecute o la canceles. Es un modelo de confianza distinto al del trading normal en PANDA, donde tus fondos nunca salen de tu wallet hasta que firmas.",
  },
  "sltp.activeOrders": { en: "Active orders on ${ticker}", es: "Órdenes activas en ${ticker}" },
  "sltp.refresh": { en: "Refresh", es: "Actualizar" },
  "sltp.show": { en: "Show", es: "Mostrar" },
  "sltp.noActiveOrders": { en: "No active orders on this coin.", es: "No hay órdenes activas en esta moneda." },
  "sltp.oco": { en: "Stop Loss / Take Profit", es: "Stop Loss / Take Profit" },
  "sltp.stopLossOrder": { en: "Stop loss", es: "Stop loss" },
  "sltp.takeProfitOrder": { en: "Take profit", es: "Take profit" },
  "sltp.cancel": { en: "Cancel", es: "Cancelar" },
  "sltp.cancelling": { en: "Cancelling…", es: "Cancelando…" },
  "sltp.stopLossLabel": { en: "Stop loss (USD)", es: "Stop loss (USD)" },
  "sltp.takeProfitLabel": { en: "Take profit (USD)", es: "Take profit (USD)" },
  "sltp.amountOf": { en: "Amount of your ${ticker}", es: "Cantidad de tu ${ticker}" },
  "sltp.protects": {
    en: "Protects {amount} ${ticker} · expires in 30 days if it hasn't filled.",
    es: "Protege {amount} ${ticker} · caduca en 30 días si no se ha ejecutado.",
  },
  "sltp.confirmSignIn": { en: "Confirm sign-in in wallet…", es: "Confirma el inicio de sesión en tu wallet…" },
  "sltp.confirmDeposit": { en: "Confirm deposit in wallet…", es: "Confirma el depósito en tu wallet…" },
  "sltp.creatingOrder": { en: "Creating order…", es: "Creando orden…" },
  "sltp.orderSet": { en: "Order set!", es: "¡Orden creada!" },
  "sltp.setOrder": { en: "Set order", es: "Crear orden" },
  "sltp.needBoth": { en: "Set a stop loss price, a take profit price, or both.", es: "Indica un precio de stop loss, de take profit, o ambos." },
  "sltp.noSigning": {
    en: "This wallet doesn't support the signing this order needs.",
    es: "Esta wallet no admite la firma que necesita esta orden.",
  },
  "sltp.noMessageSigning": {
    en: "This wallet doesn't support message signing, which the Trigger vault requires.",
    es: "Esta wallet no admite la firma de mensajes, algo que requiere la bóveda de Trigger.",
  },
} satisfies Record<string, Record<Lang, string>>;

export type DictKey = keyof typeof dict;

export function translate(lang: Lang, key: DictKey, vars?: Record<string, string | number>): string {
  const entry = dict[key];
  let str = entry[lang] || entry.en;
  if (vars) {
    for (const [k, v] of Object.entries(vars)) str = str.split(`{${k}}`).join(String(v));
  }
  return str;
}
