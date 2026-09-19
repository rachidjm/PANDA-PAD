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

  // Coin age
  "age.graduated": { en: "Grad.", es: "Grad." },
  "age.createdHint": { en: "Time since this coin's pool was created", es: "Tiempo desde que se creó el pool de esta moneda" },
  "age.graduatedHint": {
    en: "Time since this coin graduated to PumpSwap (when its AMM pool was created)",
    es: "Tiempo desde que esta moneda se graduó a PumpSwap (cuando se creó su pool AMM)",
  },

  // Home sidebar
  "side.topTrades": { en: "Your Top Trades", es: "Tus mejores operaciones" },
  "side.sortedNote": { en: "Sorted by profit, biggest winners first", es: "Ordenadas por beneficio, las más rentables primero" },
  "side.connect": {
    en: "Connect your wallet to see your trades ranked by profit and loss — read from what you've traded through PANDA.",
    es: "Conecta tu wallet para ver tus operaciones ordenadas por beneficio y pérdida — a partir de lo que has operado en PANDA.",
  },
  "side.empty": {
    en: "No trades yet — after your first real buy on PANDA, your positions show up here.",
    es: "Aún no hay operaciones — tras tu primera compra real en PANDA, tus posiciones aparecerán aquí.",
  },
  "side.error": { en: "Couldn't load your trades — try again in a moment.", es: "No se pudieron cargar tus operaciones — inténtalo de nuevo en un momento." },
  "side.open": { en: "Open", es: "Abierta" },
  "side.closed": { en: "Closed", es: "Cerrada" },
  "side.held": { en: "Held", es: "En cartera" },
  "side.avgCost": { en: "Avg cost", es: "Coste medio" },
  "side.fullyClosed": { en: "Fully sold", es: "Vendida por completo" },
  "side.pnl": { en: "P&L", es: "Resultado" },
  "side.launches": { en: "Latest Launches", es: "Últimos lanzamientos" },
  "side.launchesNote": {
    en: "Newest real coins, with the X profile each project published itself.",
    es: "Las monedas más nuevas, con el perfil de X que cada proyecto publicó.",
  },
  "side.noX": { en: "No X profile published", es: "Sin perfil de X publicado" },
  "side.prev": { en: "Previous page", es: "Página anterior" },
  "side.next": { en: "Next page", es: "Página siguiente" },

  // Portfolio
  "pf.title": { en: "Portfolio", es: "Portfolio" },
  "pf.connectPrompt": {
    en: "Connect your wallet to see what you really hold — PANDA never custodies it.",
    es: "Conecta tu wallet para ver lo que realmente tienes — PANDA nunca lo custodia.",
  },
  "pf.subtitle": { en: "{addr} — read directly from Solana.", es: "{addr} — leído directamente de Solana." },
  "pf.totalValue": { en: "Total value", es: "Valor total" },
  "pf.reading": { en: "Reading your wallet…", es: "Leyendo tu wallet…" },
  "pf.readError": { en: "Couldn't read your wallet — try again in a moment.", es: "No se pudo leer tu wallet — inténtalo de nuevo en un momento." },
  "pf.noPriced": {
    en: "No priced holdings found — balances below may still be real and unpriced.",
    es: "No se encontraron activos con precio — los saldos de abajo pueden ser reales pero sin precio.",
  },
  "pf.noBalances": { en: "No balances found in this wallet.", es: "No se encontraron saldos en esta wallet." },
  "pf.tabOpen": { en: "Open positions", es: "Posiciones abiertas" },
  "pf.tabClosed": { en: "Closed positions", es: "Posiciones cerradas" },
  "pf.sortRecent": { en: "Recent", es: "Recientes" },
  "pf.sortProfit": { en: "Profit", es: "Beneficio" },
  "pf.tradesError": {
    en: "Couldn't load your trade history — try again in a moment.",
    es: "No se pudo cargar tu historial de operaciones — inténtalo de nuevo en un momento.",
  },
  "pf.emptyOpen": {
    en: "No open positions yet — they show up here after your first real buy on PANDA.",
    es: "Aún no hay posiciones abiertas — aparecerán aquí tras tu primera compra real en PANDA.",
  },
  "pf.emptyClosed": { en: "No closed positions yet.", es: "Aún no hay posiciones cerradas." },
  "pf.heldAvg": { en: "{amount} held · avg {avg}", es: "{amount} en cartera · medio {avg}" },
  "pf.fullyClosed": { en: "Fully closed", es: "Cerrada por completo" },

  // Wallet dropdown
  "wp.value": { en: "Portfolio value", es: "Valor del portfolio" },
  "wp.readError": { en: "Couldn't read your wallet right now — try again in a moment.", es: "No se pudo leer tu wallet ahora — inténtalo de nuevo en un momento." },
  "wp.open": { en: "Open Portfolio", es: "Abrir Portfolio" },
  "wp.disconnect": { en: "Disconnect", es: "Desconectar" },

  // Rewards page
  "rw.title": { en: "Earn with PANDA", es: "Gana con PANDA" },
  "rw.intro": {
    en: "Every trade on PANDA pays a fee. Instead of disappearing, it flows back to the people holding the coin.",
    es: "Cada operación en PANDA paga una comisión. En vez de desaparecer, vuelve a las personas que tienen la moneda.",
  },
  "rw.step1": { en: "Trade", es: "Operar" },
  "rw.step1d": { en: "You buy or sell a coin.", es: "Compras o vendes una moneda." },
  "rw.step2": { en: "Fees", es: "Comisiones" },
  "rw.step2d": { en: "A small fee is taken from the trade.", es: "Se cobra una pequeña comisión de la operación." },
  "rw.step3": { en: "Fee Distribution", es: "Reparto de comisiones" },
  "rw.step3d": { en: "The creator routes a share of it to holders.", es: "El creador destina una parte a los holders." },
  "rw.step4": { en: "Rewards", es: "Recompensas" },
  "rw.step4d": { en: "Your real share becomes claimable in your wallet.", es: "Tu parte real pasa a ser reclamable en tu wallet." },

  // Rewards dashboard
  "rd.poolMissingTitle": { en: "Rewards Pool isn't set up yet", es: "El Rewards Pool aún no está configurado" },
  "rd.poolMissingBody": {
    en: "Once PANDA's Holder Rewards pool is configured, coins with fee distribution enabled will show up here — not before.",
    es: "Cuando el pool de Holder Rewards de PANDA esté configurado, las monedas con reparto de comisiones aparecerán aquí — no antes.",
  },
  "rd.connectTitle": { en: "Connect your wallet to see your rewards", es: "Conecta tu wallet para ver tus recompensas" },
  "rd.connectBody": {
    en: "Hold a coin with fee distribution enabled to start earning.",
    es: "Ten una moneda con reparto de comisiones activado para empezar a ganar.",
  },
  "rd.yourRewards": { en: "Your rewards", es: "Tus recompensas" },
  "rd.totalEarned": { en: "Total earned", es: "Total ganado" },
  "rd.available": { en: "Available to claim", es: "Disponible para reclamar" },
  "rd.pending": { en: "Pending", es: "Pendiente" },
  "rd.pendingHint": {
    en: "Fees that may have accrued in Pump.fun's own vault but haven't been distributed by PANDA's daily collector yet — not tracked here.",
    es: "Comisiones que pueden haberse acumulado en la propia bóveda de Pump.fun pero que el recolector diario de PANDA aún no ha repartido — no se rastrean aquí.",
  },
  "rd.notTracked": { en: "Not tracked", es: "Sin rastrear" },
  "rd.claimed": { en: "Claimed —", es: "Reclamado —" },
  "rd.viewTx": { en: "view tx", es: "ver tx" },
  "rd.onChainNote": {
    en: "Real, on-chain payouts — signed and sent the moment you claim.",
    es: "Pagos reales on-chain — firmados y enviados en el momento en que reclamas.",
  },
  "rd.claiming": { en: "Claiming…", es: "Reclamando…" },
  "rd.claimAll": { en: "Claim all", es: "Reclamar todo" },
  "rd.claimFailed": { en: "Claim failed.", es: "Fallo al reclamar." },
  "rd.claimFailedFor": { en: "Claim failed for ${ticker}.", es: "Fallo al reclamar ${ticker}." },
  "rd.poolTotal": {
    en: "PANDA Rewards Pool — total balance (all coins combined)",
    es: "PANDA Rewards Pool — saldo total (todas las monedas juntas)",
  },
  "rd.yourCoins": { en: "Your coins", es: "Tus monedas" },
  "rd.yourCoinsDesc": {
    en: "Coins with Holders fee distribution turned on, where you hold more than {min} — same real eligibility bar shown at Create.",
    es: "Monedas con el reparto de comisiones a Holders activado, donde tienes más de {min} — el mismo umbral real que se muestra en Crear.",
  },
  "rd.loadError": { en: "Couldn't load your rewards — try again in a moment.", es: "No se pudieron cargar tus recompensas — inténtalo de nuevo en un momento." },
  "rd.noneHeld": {
    en: "You don't currently hold more than {min} of any coin with fee distribution turned on. Coins that route creator fees to holders will show up here once you do.",
    es: "Ahora mismo no tienes más de {min} de ninguna moneda con el reparto de comisiones activado. Las monedas que destinan comisiones del creador a los holders aparecerán aquí cuando los tengas.",
  },
  "rd.heldOfSupply": { en: "{value} held — {pct}% of supply", es: "{value} en cartera — {pct}% del supply" },
  "rd.unclaimed": { en: "Unclaimed", es: "Sin reclamar" },
  "rd.earnings": { en: "Earnings", es: "Ganancias" },
  "rd.earningsEmpty": {
    en: "Not enough reward history to chart yet — this fills in as payouts accumulate.",
    es: "Aún no hay suficiente historial de recompensas para el gráfico — se irá llenando a medida que se acumulen pagos.",
  },
  "rd.history": { en: "Reward history", es: "Historial de recompensas" },
  "rd.historyEmpty": {
    en: "No payouts recorded yet — they'll be listed here as your rewards are distributed.",
    es: "Aún no hay pagos registrados — se listarán aquí a medida que se repartan tus recompensas.",
  },

  // Create
  "cr.heading": { en: "Create your coin", es: "Crea tu moneda" },
  "cr.sub": {
    en: "Upload an image or GIF, name it, launch it — for real, on Solana.",
    es: "Sube una imagen o GIF, ponle nombre y lánzala — de verdad, en Solana.",
  },
  "cr.launchOn": { en: "Launch on", es: "Lanzar en" },
  "cr.uploadImage": { en: "Upload image", es: "Subir imagen" },
  "cr.uploadHint": { en: "GIF, PNG, JPG or WEBP — or drag and drop", es: "GIF, PNG, JPG o WEBP — o arrastra y suelta" },
  "cr.previewAlt": { en: "Uploaded image preview", es: "Vista previa de la imagen subida" },
  "cr.imageType": { en: "Please upload a GIF, PNG, JPG or WEBP image.", es: "Sube una imagen GIF, PNG, JPG o WEBP." },
  "cr.tokenName": { en: "Token name", es: "Nombre del token" },
  "cr.namePh": { en: "Dancing Cat", es: "Gato bailarín" },
  "cr.ticker": { en: "Ticker", es: "Ticker" },
  "cr.description": { en: "Description", es: "Descripción" },
  "cr.descPh": { en: "What's the story behind this coin?", es: "¿Cuál es la historia de esta moneda?" },
  "cr.website": { en: "Website (optional)", es: "Sitio web (opcional)" },
  "cr.xOpt": { en: "X (optional)", es: "X (opcional)" },
  "cr.firstBuy": { en: "Your first buy (optional)", es: "Tu primera compra (opcional)" },
  "cr.firstBuyDesc": {
    en: "Buy some of {coin} the moment it launches, paid in SOL — as its very first trade. This is a second transaction right after creation, so you sign it separately.",
    es: "Compra algo de {coin} en el momento en que se lanza, pagado en SOL — como su primera operación. Es una segunda transacción justo tras la creación, así que la firmas por separado.",
  },
  "cr.yourCoin": { en: "your coin", es: "tu moneda" },
  "cr.none": { en: "None", es: "Ninguna" },
  "cr.feeDistribution": { en: "Fee distribution", es: "Reparto de comisiones" },
  "cr.feeConnect": {
    en: "Connect your wallet to see how this coin's creator fees are split.",
    es: "Conecta tu wallet para ver cómo se reparten las comisiones del creador de esta moneda.",
  },
  "cr.launch": { en: "Launch", es: "Lanzar" },
  "cr.connectToLaunch": { en: "Connect your wallet to launch.", es: "Conecta tu wallet para lanzar." },
  "cr.mintNote": {
    en: "This mints a real coin on Solana mainnet — you sign it in your own wallet, and you're the coin's creator.",
    es: "Esto acuña una moneda real en la mainnet de Solana — la firmas en tu propia wallet y tú eres el creador de la moneda.",
  },
  "cr.launching": { en: "Launching ${ticker}…", es: "Lanzando ${ticker}…" },
  "cr.stageUploading": { en: "Uploading image…", es: "Subiendo imagen…" },
  "cr.stageBuilding": { en: "Preparing transaction…", es: "Preparando transacción…" },
  "cr.stageSigning": { en: "Confirm in wallet…", es: "Confirma en tu wallet…" },
  "cr.stageConfirming": { en: "Confirming on Solana…", es: "Confirmando en Solana…" },
  "cr.stageBuying": { en: "Buying your first ${ticker}…", es: "Comprando tu primer ${ticker}…" },
  "cr.failed": { en: "Launch failed", es: "Fallo en el lanzamiento" },
  "cr.backToForm": { en: "Back to form", es: "Volver al formulario" },
  "cr.isLive": { en: "${ticker} is live", es: "${ticker} ya está en vivo" },
  "cr.createdReal": { en: "{name} was created for real, on-chain.", es: "{name} se creó de verdad, on-chain." },
  "cr.indexNote": {
    en: "It can take a few minutes to show up in Discover while our data source indexes the new pool.",
    es: "Puede tardar unos minutos en aparecer en Descubrir mientras nuestra fuente de datos indexa el nuevo pool.",
  },
  "cr.firstBuyOk": { en: "Your first buy of ${ticker} went through too.", es: "Tu primera compra de ${ticker} también se realizó." },
  "cr.firstBuyFail": {
    en: "The coin launched fine, but your first buy didn't go through: {error} You can still buy it from its page below.",
    es: "La moneda se lanzó bien, pero tu primera compra no se realizó: {error} Todavía puedes comprarla desde su página, abajo.",
  },
  "cr.feeSet": {
    en: "Fee distribution is set, real and on-chain — PANDA 5%, {who}.",
    es: "El reparto de comisiones está fijado, real y on-chain — PANDA 5%, {who}.",
  },
  "cr.holders95": { en: "holders 95%", es: "holders 95%" },
  "cr.you95": { en: "you 95%", es: "tú 95%" },
  "cr.viewTx": { en: "View transaction", es: "Ver transacción" },
  "cr.createAnother": { en: "Create another", es: "Crear otra" },
  "cr.viewCoin": { en: "View coin page", es: "Ver página de la moneda" },
  "cr.err.rejected": { en: "You rejected the transaction.", es: "Rechazaste la transacción." },
  "cr.err.insufficient": { en: "Insufficient SOL to cover the network fee.", es: "SOL insuficiente para cubrir la comisión de red." },
  "cr.err.rateLimit": {
    en: "The Solana RPC is rate-limiting us — wait a moment and retry.",
    es: "El RPC de Solana nos está limitando — espera un momento y reintenta.",
  },
  "cr.err.network": { en: "Network error — check your connection and retry.", es: "Error de red — revisa tu conexión y reintenta." },
  "cr.err.expired": { en: "Transaction expired — try again.", es: "La transacción caducó — inténtalo de nuevo." },
  "cr.err.generic": { en: "Launch failed. Please try again.", es: "Fallo en el lanzamiento. Inténtalo de nuevo." },
  "cr.err.buyWallet": { en: "Wallet not connected.", es: "Wallet no conectada." },
  "cr.err.buyBuild": { en: "Failed to build the first-buy transaction.", es: "No se pudo construir la transacción de la primera compra." },
  "cr.err.buyConfirm": { en: "First buy failed to confirm.", es: "La primera compra no se confirmó." },
  "cr.err.upload": { en: "Upload failed.", es: "Fallo al subir." },
  "cr.err.build": { en: "Failed to build transaction.", es: "No se pudo construir la transacción." },
  "cr.err.confirm": { en: "Transaction failed to confirm.", es: "La transacción no se confirmó." },

  // Fee distribution step
  "fd.title": { en: "Fee distribution", es: "Reparto de comisiones" },
  "fd.protocol": { en: "PANDA Protocol", es: "Protocolo PANDA" },
  "fd.fixed": { en: "{pct}% · fixed", es: "{pct}% · fijo" },
  "fd.sendRemaining": { en: "Send the remaining {pct}% to", es: "Enviar el {pct}% restante a" },
  "fd.creator": { en: "Creator", es: "Creador" },
  "fd.holders": { en: "Holders", es: "Holders" },
  "fd.creatorNote": {
    en: "{pct}% of creator rewards go to you. PANDA takes a fixed {fee}% protocol fee.",
    es: "El {pct}% de las recompensas del creador es para ti. PANDA cobra una comisión de protocolo fija del {fee}%.",
  },
  "fd.holdersNote": {
    en: "{pct}% of creator rewards go to holders. Anyone holding more than ${min} of your coin qualifies. PANDA takes a fixed {fee}% protocol fee.",
    es: "El {pct}% de las recompensas del creador va a los holders. Cualquiera que tenga más de ${min} de tu moneda cumple los requisitos. PANDA cobra una comisión de protocolo fija del {fee}%.",
  },
  "fd.notConfigured": { en: "Holders routing isn't configured on PANDA yet.", es: "El reparto a Holders aún no está configurado en PANDA." },

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
  "chart.price": { en: "Price", es: "Precio" },
  "chart.mc": { en: "Market cap", es: "Cap. de mercado" },

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
