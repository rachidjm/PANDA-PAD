/**
 * Create's own field rules — the limits the form shows in its counters are these, and the upload route enforces the same
 * ones. Name and ticker are Pump.fun's (32 and 10); the description is PANDA's; the image limit is what a single upload
 * request to the site can carry.
 */
export const NAME_MAX = 32;
export const TICKER_MAX = 10;
export const DESCRIPTION_MAX = 280;
export const IMAGE_MAX_MB = 4;
export const IMAGE_MAX_BYTES = IMAGE_MAX_MB * 1024 * 1024;
export const IMAGE_TYPES = ["image/gif", "image/png", "image/jpeg", "image/webp"];
export const LINK_MAX = 200;

const clean = (v: string) => v.trim().slice(0, LINK_MAX);
const hasScheme = (v: string) => /^https?:\/\//i.test(v);
const HANDLE = /^@?([A-Za-z0-9_]{1,32})$/;

/** What is typed in "X": a handle ("@panda" or "panda") becomes its profile address; an address is kept as typed. */
export function xLink(input: string): string {
  const v = clean(input);
  if (!v) return "";
  const handle = HANDLE.exec(v);
  if (handle) return `https://x.com/${handle[1]}`;
  return hasScheme(v) ? v : `https://${v}`;
}

/** What is typed in "Telegram": a username ("@panda" or "panda") becomes its t.me address; an address is kept as typed. */
export function telegramLink(input: string): string {
  const v = clean(input);
  if (!v) return "";
  const handle = HANDLE.exec(v);
  if (handle) return `https://t.me/${handle[1]}`;
  return hasScheme(v) ? v : `https://${v}`;
}

/** What is typed in "Website": an address without "https://" gets it. */
export function websiteLink(input: string): string {
  const v = clean(input);
  if (!v) return "";
  return hasScheme(v) ? v : `https://${v}`;
}

export type ImageIssue = "type" | "size" | null;

export function imageIssue(file: { type: string; size: number }): ImageIssue {
  if (!IMAGE_TYPES.includes(file.type)) return "type";
  if (file.size > IMAGE_MAX_BYTES) return "size";
  return null;
}
