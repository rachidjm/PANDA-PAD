import { isEnabled } from "@/lib/config/flags";
import { oauthHeader, type XCredentials } from "./oauth";

/**
 * PANDA's account on X (@LaunchOnPanda), through the official API v2 with OAuth 1.0a user credentials: read the signed-in
 * user (a read-only check), upload one image, create one post. Nothing here retries: every call to X is billed, so a
 * failure is reported once, with its reason, and a person decides what happens next.
 *
 * The four credentials live only in the deployment's environment. They are never logged, returned or put in an error.
 */

export const X_ENV = ["X_API_KEY", "X_API_SECRET", "X_ACCESS_TOKEN", "X_ACCESS_TOKEN_SECRET"] as const;
const API = "https://api.x.com";
const TIMEOUT_MS = 15_000;
export const MAX_IMAGE_BYTES = 5 * 1024 * 1024; // X's limit for a post's image

export type XConfig = {
  /** FEATURE_X_POSTING. Off = drafts can be reviewed, nothing can be published. */
  enabled: boolean;
  creds: XCredentials | null;
  /** The NAMES of the credentials that are not set (never a value). */
  missing: string[];
  maxPerDay: number;
  defaultImageUrl: string | null;
};

type Env = Record<string, string | undefined>;

export const httpsUrl = (v: string | undefined | null): string | null => {
  try {
    const u = new URL((v ?? "").trim());
    return u.protocol === "https:" && u.hostname.includes(".") && !/^[\d.]+$/.test(u.hostname) ? u.toString() : null;
  } catch {
    return null;
  }
};

export function xConfig(env: Env = process.env): XConfig {
  const get = (name: string) => env[name]?.trim() ?? "";
  const missing = X_ENV.filter((n) => !get(n));
  const max = Number(env.X_MAX_POSTS_PER_DAY);
  return {
    enabled: isEnabled("X_POSTING", env),
    creds: missing.length ? null : { apiKey: get("X_API_KEY"), apiSecret: get("X_API_SECRET"), accessToken: get("X_ACCESS_TOKEN"), accessTokenSecret: get("X_ACCESS_TOKEN_SECRET") },
    missing: [...missing],
    maxPerDay: Number.isInteger(max) && max >= 1 && max <= 50 ? max : 1,
    defaultImageUrl: httpsUrl(env.X_DEFAULT_IMAGE_URL),
  };
}

/**
 * `rejected`: X answered and said no — nothing was created. `unknown`: no answer, or a server error — for a post, it MAY
 * have been created, so it must never be sent again without a person looking first.
 */
export type XResult<T> = { ok: true; value: T } | { ok: false; kind: "rejected" | "unknown"; status: number | null; reason: string };

export type XClient = {
  verify: () => Promise<XResult<{ id: string; username: string }>>;
  uploadImage: (bytes: Uint8Array, mime: string) => Promise<XResult<{ mediaId: string }>>;
  post: (text: string, mediaId?: string) => Promise<XResult<{ id: string }>>;
};

/** What X said went wrong, in a few words — only fields of its own error body, never anything of ours. */
export function xReason(status: number, body: unknown): string {
  const b = (body && typeof body === "object" ? body : {}) as { detail?: unknown; title?: unknown; errors?: { message?: unknown; detail?: unknown }[]; error?: unknown };
  const first = Array.isArray(b.errors) ? b.errors[0] : undefined;
  const text = [b.detail, first?.message, first?.detail, b.title, b.error].find((x) => typeof x === "string" && x.trim()) as string | undefined;
  const hint =
    status === 401 ? "credentials not accepted" : status === 402 ? "no credits left on the X developer account" : status === 403 ? "not allowed (permissions, duplicate text or the account's limits)" : status === 429 ? "rate limit reached" : `HTTP ${status}`;
  return (text ? `${text.trim()} (${hint})` : hint).replace(/\s+/g, " ").slice(0, 300);
}

export function realXClient(creds: XCredentials, fetchImpl: typeof fetch = fetch): XClient {
  async function call<T>(method: "GET" | "POST", path: string, init: { json?: unknown; form?: FormData }, pick: (body: unknown) => T | null): Promise<XResult<T>> {
    const url = `${API}${path}`;
    let res: Response;
    try {
      res = await fetchImpl(url, {
        method,
        headers: { Authorization: oauthHeader(method, url, creds), ...(init.json !== undefined ? { "Content-Type": "application/json" } : {}) },
        ...(init.json !== undefined ? { body: JSON.stringify(init.json) } : init.form ? { body: init.form } : {}),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
    } catch (err) {
      return { ok: false, kind: "unknown", status: null, reason: err instanceof Error && err.name === "TimeoutError" ? "X didn't answer in time" : "couldn't reach X" };
    }
    const body: unknown = await res.json().catch(() => null);
    if (!res.ok) return { ok: false, kind: res.status >= 500 ? "unknown" : "rejected", status: res.status, reason: xReason(res.status, body) };
    const value = pick(body);
    // A 2xx we can't read: for a post it was most likely created.
    return value === null ? { ok: false, kind: "unknown", status: res.status, reason: "X answered, but not with what was expected" } : { ok: true, value };
  }
  const data = (body: unknown) => ((body && typeof body === "object" ? (body as { data?: unknown }).data : null) ?? null) as Record<string, unknown> | null;
  const str = (v: unknown) => (typeof v === "string" && v ? v : null);

  return {
    verify: () =>
      call("GET", "/2/users/me", {}, (b) => {
        const d = data(b);
        const id = str(d?.id);
        const username = str(d?.username);
        return id && username ? { id, username } : null;
      }),
    uploadImage: (bytes, mime) => {
      const form = new FormData();
      form.set("media", new Blob([bytes as BlobPart], { type: mime }));
      form.set("media_category", "tweet_image");
      return call("POST", "/2/media/upload", { form }, (b) => {
        const id = str(data(b)?.id);
        return id ? { mediaId: id } : null;
      });
    },
    post: (text, mediaId) =>
      call("POST", "/2/tweets", { json: { text, ...(mediaId ? { media: { media_ids: [mediaId] } } : {}) } }, (b) => {
        const id = str(data(b)?.id);
        return id ? { id } : null;
      }),
  };
}

const IMAGE_TYPES = ["image/png", "image/jpeg", "image/webp", "image/gif"];

/** Downloads the image a post will carry. Only https, only a real image, at most X's size limit. */
export async function fetchImage(url: string, fetchImpl: typeof fetch = fetch): Promise<{ ok: true; bytes: Uint8Array; mime: string } | { ok: false; reason: string }> {
  const safe = httpsUrl(url);
  if (!safe) return { ok: false, reason: "the image address isn't a valid https link" };
  try {
    const res = await fetchImpl(safe, { signal: AbortSignal.timeout(TIMEOUT_MS), redirect: "follow" });
    if (!res.ok) return { ok: false, reason: `the image couldn't be downloaded (HTTP ${res.status})` };
    const mime = (res.headers.get("content-type") ?? "").split(";")[0].trim().toLowerCase();
    if (!IMAGE_TYPES.includes(mime)) return { ok: false, reason: "that address isn't a PNG, JPEG, WebP or GIF image" };
    const bytes = new Uint8Array(await res.arrayBuffer());
    if (bytes.length === 0 || bytes.length > MAX_IMAGE_BYTES) return { ok: false, reason: "the image is empty or larger than 5 MB" };
    return { ok: true, bytes, mime };
  } catch {
    return { ok: false, reason: "the image couldn't be downloaded" };
  }
}

/** Everything the approval flow needs from X, injectable so tests never touch the network. */
export type XDeps = {
  config: XConfig;
  client: XClient | null;
  fetchImage: (url: string) => Promise<{ ok: true; bytes: Uint8Array; mime: string } | { ok: false; reason: string }>;
  /** The emergency pause from /admin ("x_posting"). */
  paused: () => Promise<boolean>;
};
