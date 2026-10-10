import { createHmac, randomBytes } from "node:crypto";

/**
 * OAuth 1.0a (user context) for X's API: the `Authorization` header of one request, signed with HMAC-SHA1. Only the
 * OAuth parameters and the URL's query parameters are signed — a JSON or multipart body is not part of the signature
 * (RFC 5849 §3.4.1.3). Pure given a nonce and a timestamp, so it is tested against X's own published example.
 */

export type XCredentials = { apiKey: string; apiSecret: string; accessToken: string; accessTokenSecret: string };

/** RFC 3986 percent-encoding (encodeURIComponent leaves ! ' ( ) * alone). */
export const pct = (s: string) => encodeURIComponent(s).replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);

export function oauthHeader(
  method: string,
  url: string,
  creds: XCredentials,
  opts: { params?: Record<string, string>; nonce?: string; timestamp?: number } = {}
): string {
  const u = new URL(url);
  const oauth: Record<string, string> = {
    oauth_consumer_key: creds.apiKey,
    oauth_nonce: opts.nonce ?? randomBytes(16).toString("hex"),
    oauth_signature_method: "HMAC-SHA1",
    oauth_timestamp: String(opts.timestamp ?? Math.floor(Date.now() / 1000)),
    oauth_token: creds.accessToken,
    oauth_version: "1.0",
  };
  const signed: [string, string][] = [...Object.entries(oauth), ...[...u.searchParams.entries()], ...Object.entries(opts.params ?? {})];
  const normalized = signed
    .map(([k, v]) => [pct(k), pct(v)] as const)
    .sort((a, b) => (a[0] === b[0] ? (a[1] < b[1] ? -1 : 1) : a[0] < b[0] ? -1 : 1))
    .map(([k, v]) => `${k}=${v}`)
    .join("&");
  const base = [method.toUpperCase(), pct(`${u.origin}${u.pathname}`), pct(normalized)].join("&");
  const key = `${pct(creds.apiSecret)}&${pct(creds.accessTokenSecret)}`;
  const signature = createHmac("sha1", key).update(base).digest("base64");
  const header = { ...oauth, oauth_signature: signature };
  return `OAuth ${Object.keys(header).sort().map((k) => `${pct(k)}="${pct(header[k as keyof typeof header])}"`).join(", ")}`;
}
