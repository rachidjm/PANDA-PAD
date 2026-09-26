/**
 * Copies text to the clipboard and says whether it worked. Uses the async Clipboard API where the browser allows it (secure context, user
 * gesture) and falls back to a hidden textarea + execCommand for the browsers/webviews that don't (some in-wallet browsers).
 */
export async function copyText(text: string): Promise<boolean> {
  try {
    if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // permission denied or not a secure context: try the fallback
  }
  try {
    if (typeof document === "undefined") return false;
    const el = document.createElement("textarea");
    el.value = text;
    el.setAttribute("readonly", "");
    el.style.position = "fixed";
    el.style.opacity = "0";
    document.body.appendChild(el);
    el.select();
    const ok = document.execCommand("copy");
    document.body.removeChild(el);
    return ok;
  } catch {
    return false;
  }
}
