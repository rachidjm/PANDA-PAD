/**
 * Inside the Telegram Mini App the session is the app's own (src/components/tg/session.ts): in memory, sent in a
 * header, signed in once when the app opens. Its shell registers itself here, and from then on "make sure there is a
 * session" (useWalletSession) is answered by it — the website's cookie sign-in never runs there.
 */
type Delegate = (wallet: string) => Promise<void>;
let delegate: Delegate | null = null;
export function setSessionDelegate(fn: Delegate | null): void {
  delegate = fn;
}
export const sessionDelegate = (): Delegate | null => delegate;
