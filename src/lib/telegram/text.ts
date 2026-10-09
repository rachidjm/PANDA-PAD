import type { Lang } from "@/lib/db/telegram";

/**
 * Everything the bot says, in English (default) and Spanish (when Telegram says the user's language starts with "es").
 * Plain facts only: no promise of gains, rises, rewards or future features. Telegram HTML: only <b>, <i>, <code>, <a>.
 */

const EN = {
  welcome:
    "🐼 <b>PANDA bot</b>\nLaunch and trade Solana coins on {site}.\n\nWhat I can do:\n/new — latest coins launched on PANDA\n/trending — most traded coins (24h volume)\n/token &lt;address or ticker&gt; — a coin's price, market cap and liquidity\n/watch, /watchlist, /unwatch — your watchlist\n/alert — a one-time price or market-cap alert (private chat)\n/link — link your wallet (you sign on {domain})\n/suggest — send us an idea\n/help — this list",
  help: "Commands:\n/new · /trending · /token &lt;address or ticker&gt;\n/watch &lt;address&gt; · /unwatch &lt;address&gt; · /watchlist\n/alert &lt;address&gt; price|mcap above|below &lt;value&gt;\n/alerts · /alert remove &lt;n&gt;\n/link · /unlink · /suggest &lt;text&gt;\n\nPANDA will never ask for your seed phrase or private key. Not financial advice.",
  nfa: "Not financial advice.",
  refWelcome: "You came with a recruiter link. Open PANDA with it, so it is applied when you connect your wallet:",
  openPanda: "Open PANDA",
  privateOnly: "That works in a private chat with me: {link}",
  rateLimited: "Too many messages — wait a minute and try again.",
  unknown: "I don't know that command. /help lists what I can do.",
  unavailable: "Data isn't available right now — try again in a minute.",
  // /new
  newTitle: "🆕 <b>Latest coins launched on PANDA</b>",
  newNone: "No coin has been launched on PANDA yet.",
  // /trending
  trendingTitle: "📊 <b>Most traded coins (24h volume)</b>\nRanked by trading volume only — not a recommendation.",
  // /token
  tokenUsage: "Usage: /token &lt;contract address or ticker&gt;",
  tokenNotFound: "I couldn't find that coin.",
  tokenMatches: "Several coins use that ticker — tickers are not unique. Check the contract address before buying anything:",
  official: "official",
  price: "Price",
  mcap: "Market cap",
  liquidity: "Liquidity",
  change24h: "24h",
  volume24h: "24h volume",
  viewOnPanda: "View on PANDA",
  // watchlist
  watchUsage: "Usage: /watch &lt;contract address&gt; (addresses only — tickers are not unique).",
  watchAdded: "Added {ticker} to your watchlist.",
  watchExists: "{ticker} is already in your watchlist.",
  watchFull: "Your watchlist is full ({max}). Remove one with /unwatch.",
  unwatchUsage: "Usage: /unwatch &lt;contract address&gt;",
  unwatched: "Removed from your watchlist.",
  notWatched: "That coin isn't in your watchlist.",
  watchlistEmpty: "Your watchlist is empty. Add a coin with /watch &lt;address&gt;.",
  watchlistTitle: "👀 <b>Your watchlist</b>",
  // alerts
  alertUsage: "Usage: /alert &lt;contract address&gt; price|mcap above|below &lt;value&gt;\nExample: /alert {example} mcap above 100000\nAn alert fires once, then it is removed.",
  alertCreated: "🔔 Alert set: {ticker} {metric} {direction} {value}. It fires once, by private message.",
  alertFull: "You have {max} alerts, the maximum. Remove one with /alert remove &lt;n&gt;.",
  alertAlreadyTrue: "That condition is already true right now ({metric} {current}) — pick a level it hasn't reached yet.",
  alertsEmpty: "You have no active alerts.",
  alertsTitle: "🔔 <b>Your alerts</b> (each fires once)",
  alertRemoved: "Alert removed.",
  alertRemoveUsage: "Usage: /alert remove &lt;n&gt; (n from /alerts)",
  alertFired: "🔔 <b>{ticker}</b>: {metric} is now {direction} {value} (now {current}).\nThis alert is done. Not financial advice.",
  above: "above",
  below: "below",
  metricPrice: "price",
  metricMcap: "market cap",
  // linking
  linkIntro:
    "🔗 Link your wallet to this Telegram account. The link opens {domain}, where you sign a free message with your wallet. It works once and expires in 10 minutes.\n\n⚠️ PANDA will NEVER ask for your seed phrase or private key. Only sign on {domain}.",
  linkButton: "Link my wallet",
  linkDone: "✅ Wallet {wallet} is now linked to this Telegram account.",
  linkMovedAway: "ℹ️ Wallet {wallet} was linked to another Telegram account by its owner (they signed with that wallet). It is no longer linked here.",
  unlinked: "Your wallet is no longer linked to this Telegram account.",
  notLinked: "No wallet is linked to this Telegram account.",
  linkTooMany: "You asked for several links in a short time — wait a while and try again.",
  // suggest
  suggestUsage: "Usage: /suggest &lt;your idea&gt; (up to 1000 characters)",
  suggestSaved: "Thanks — your suggestion was saved for the team.",
  suggestTooMany: "You've sent several suggestions today — thanks! Try again tomorrow.",
  // admin
  chatId: "Chat id: <code>{chatId}</code>\nType: {type}{title}{thread}",
  stats: "Users: {users} · linked wallets: {linked}\nActive alerts: {alerts} · watched coins: {watched}\nSuggestions: {suggestions}\nUpdates received (1h): {updates1h}\nOutbox: {pending} pending · {failed} failed · {sent24h} sent in 24h",
  // automatic posts
  launchPost: "🆕 <b>New coin launched on PANDA</b>\n<b>{name}</b> (${ticker})\nFee split: {split}\n<code>{mint}</code>\n\n{nfa}",
  buyPost: "🟢 <b>$PANDA buy</b> · {usd}{sol}\nWallet: <code>{wallet}</code>\n<a href=\"{tx}\">Transaction</a>\n\n{nfa}",
  buyMore: "…and {n} more $PANDA buys above {min} in the last minutes.",
  payoutsTitle: "💸 <b>Holder payouts (last hour)</b> — paid on-chain:",
  payoutLine: "• {ticker}: {sol} SOL to {holders} holders",
  splitPanda: "PANDA",
  splitCreator: "creator",
  splitHolders: "holders",
  splitPartner: "partner",
  splitUnknown: "not readable right now",
};

type Key = keyof typeof EN;

const ES: Record<Key, string> = {
  welcome:
    "🐼 <b>Bot de PANDA</b>\nLanza y opera monedas de Solana en {site}.\n\nLo que puedo hacer:\n/new — últimas monedas lanzadas en PANDA\n/trending — monedas más operadas (volumen 24 h)\n/token &lt;dirección o ticker&gt; — precio, cap. de mercado y liquidez\n/watch, /watchlist, /unwatch — tu lista de seguimiento\n/alert — una alerta de precio o cap. de mercado (por privado)\n/link — vincula tu wallet (firmas en {domain})\n/suggest — envíanos una idea\n/help — esta lista",
  help: "Comandos:\n/new · /trending · /token &lt;dirección o ticker&gt;\n/watch &lt;dirección&gt; · /unwatch &lt;dirección&gt; · /watchlist\n/alert &lt;dirección&gt; price|mcap above|below &lt;valor&gt;\n/alerts · /alert remove &lt;n&gt;\n/link · /unlink · /suggest &lt;texto&gt;\n\nPANDA nunca te pedirá tu frase semilla ni tu clave privada. No es asesoramiento financiero.",
  nfa: "No es asesoramiento financiero.",
  refWelcome: "Has llegado con un enlace de reclutador. Abre PANDA con él para que se aplique al conectar tu wallet:",
  openPanda: "Abrir PANDA",
  privateOnly: "Eso funciona en un chat privado conmigo: {link}",
  rateLimited: "Demasiados mensajes — espera un minuto y vuelve a intentarlo.",
  unknown: "No conozco ese comando. /help muestra lo que puedo hacer.",
  unavailable: "Los datos no están disponibles ahora — inténtalo en un minuto.",
  newTitle: "🆕 <b>Últimas monedas lanzadas en PANDA</b>",
  newNone: "Todavía no se ha lanzado ninguna moneda en PANDA.",
  trendingTitle: "📊 <b>Monedas más operadas (volumen 24 h)</b>\nOrdenadas solo por volumen — no es una recomendación.",
  tokenUsage: "Uso: /token &lt;dirección del contrato o ticker&gt;",
  tokenNotFound: "No he encontrado esa moneda.",
  tokenMatches: "Varias monedas usan ese ticker — los tickers no son únicos. Comprueba la dirección del contrato antes de comprar nada:",
  official: "oficial",
  price: "Precio",
  mcap: "Cap. de mercado",
  liquidity: "Liquidez",
  change24h: "24 h",
  volume24h: "Volumen 24 h",
  viewOnPanda: "Ver en PANDA",
  watchUsage: "Uso: /watch &lt;dirección del contrato&gt; (solo direcciones — los tickers no son únicos).",
  watchAdded: "{ticker} añadida a tu lista de seguimiento.",
  watchExists: "{ticker} ya está en tu lista de seguimiento.",
  watchFull: "Tu lista de seguimiento está llena ({max}). Quita una con /unwatch.",
  unwatchUsage: "Uso: /unwatch &lt;dirección del contrato&gt;",
  unwatched: "Quitada de tu lista de seguimiento.",
  notWatched: "Esa moneda no está en tu lista de seguimiento.",
  watchlistEmpty: "Tu lista de seguimiento está vacía. Añade una moneda con /watch &lt;dirección&gt;.",
  watchlistTitle: "👀 <b>Tu lista de seguimiento</b>",
  alertUsage: "Uso: /alert &lt;dirección del contrato&gt; price|mcap above|below &lt;valor&gt;\nEjemplo: /alert {example} mcap above 100000\nUna alerta salta una vez y después se borra.",
  alertCreated: "🔔 Alerta creada: {ticker} {metric} {direction} {value}. Salta una vez, por mensaje privado.",
  alertFull: "Tienes {max} alertas, el máximo. Quita una con /alert remove &lt;n&gt;.",
  alertAlreadyTrue: "Esa condición ya se cumple ahora mismo ({metric} {current}) — elige un nivel que aún no se haya alcanzado.",
  alertsEmpty: "No tienes alertas activas.",
  alertsTitle: "🔔 <b>Tus alertas</b> (cada una salta una vez)",
  alertRemoved: "Alerta borrada.",
  alertRemoveUsage: "Uso: /alert remove &lt;n&gt; (n de /alerts)",
  alertFired: "🔔 <b>{ticker}</b>: {metric} está ahora {direction} {value} (ahora {current}).\nEsta alerta ha terminado. No es asesoramiento financiero.",
  above: "por encima de",
  below: "por debajo de",
  metricPrice: "el precio",
  metricMcap: "la cap. de mercado",
  linkIntro:
    "🔗 Vincula tu wallet a esta cuenta de Telegram. El enlace abre {domain}, donde firmas un mensaje gratuito con tu wallet. Sirve una sola vez y caduca en 10 minutos.\n\n⚠️ PANDA NUNCA te pedirá tu frase semilla ni tu clave privada. Firma solo en {domain}.",
  linkButton: "Vincular mi wallet",
  linkDone: "✅ La wallet {wallet} ya está vinculada a esta cuenta de Telegram.",
  linkMovedAway: "ℹ️ El dueño de la wallet {wallet} la ha vinculado a otra cuenta de Telegram (firmando con esa wallet). Ya no está vinculada aquí.",
  unlinked: "Tu wallet ya no está vinculada a esta cuenta de Telegram.",
  notLinked: "No hay ninguna wallet vinculada a esta cuenta de Telegram.",
  linkTooMany: "Has pedido varios enlaces en poco tiempo — espera un rato y vuelve a intentarlo.",
  suggestUsage: "Uso: /suggest &lt;tu idea&gt; (hasta 1000 caracteres)",
  suggestSaved: "Gracias — tu sugerencia se ha guardado para el equipo.",
  suggestTooMany: "Hoy ya has enviado varias sugerencias — ¡gracias! Vuelve a intentarlo mañana.",
  chatId: "Id del chat: <code>{chatId}</code>\nTipo: {type}{title}{thread}",
  stats: "Usuarios: {users} · wallets vinculadas: {linked}\nAlertas activas: {alerts} · monedas seguidas: {watched}\nSugerencias: {suggestions}\nActualizaciones recibidas (1 h): {updates1h}\nCola: {pending} pendientes · {failed} fallidos · {sent24h} enviados en 24 h",
  launchPost: "🆕 <b>Nueva moneda lanzada en PANDA</b>\n<b>{name}</b> (${ticker})\nReparto de comisiones: {split}\n<code>{mint}</code>\n\n{nfa}",
  buyPost: "🟢 <b>Compra de $PANDA</b> · {usd}{sol}\nWallet: <code>{wallet}</code>\n<a href=\"{tx}\">Transacción</a>\n\n{nfa}",
  buyMore: "…y {n} compras más de $PANDA por encima de {min} en los últimos minutos.",
  payoutsTitle: "💸 <b>Pagos a holders (última hora)</b> — pagados en la cadena:",
  payoutLine: "• {ticker}: {sol} SOL a {holders} holders",
  splitPanda: "PANDA",
  splitCreator: "creador",
  splitHolders: "holders",
  splitPartner: "socio",
  splitUnknown: "no se puede leer ahora",
};

export type TextKey = Key;

/** Fills {placeholders}. Values are inserted as given: escape user/third-party text with `esc` BEFORE passing it in. */
export function tt(lang: Lang, key: TextKey, vars: Record<string, string | number> = {}): string {
  const s = (lang === "es" ? ES : EN)[key];
  return s.replace(/\{(\w+)\}/g, (_, k: string) => (k in vars ? String(vars[k]) : `{${k}}`));
}

export const langOf = (code: unknown): Lang => (typeof code === "string" && code.toLowerCase().startsWith("es") ? "es" : "en");

/** Telegram HTML needs only these three escaped. Everything that comes from a user or a third party goes through here. */
export const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

export function usd(n: number | null | undefined, lang: Lang): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return "—";
  const loc = lang === "es" ? "es-ES" : "en-US";
  if (n >= 1_000_000) return `$${(n / 1_000_000).toLocaleString(loc, { maximumFractionDigits: 2 })}M`;
  if (n >= 10_000) return `$${(n / 1_000).toLocaleString(loc, { maximumFractionDigits: 1 })}K`;
  return `$${n.toLocaleString(loc, { maximumFractionDigits: 2 })}`;
}

export function price(n: number | null | undefined, lang: Lang): string {
  if (n === null || n === undefined || !Number.isFinite(n) || n <= 0) return "—";
  const loc = lang === "es" ? "es-ES" : "en-US";
  if (n >= 1) return `$${n.toLocaleString(loc, { maximumFractionDigits: 4 })}`;
  return `$${n.toLocaleString(loc, { maximumSignificantDigits: 4 })}`;
}

export const shortAddr = (a: string) => (a.length > 12 ? `${a.slice(0, 4)}…${a.slice(-4)}` : a);
