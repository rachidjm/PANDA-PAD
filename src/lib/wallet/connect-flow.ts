/**
 * Decides what "Conectar wallet" does on click. Pure on purpose (the inputs are read by the caller), so every
 * branch is tested without a browser. Before a wallet is connected its identity isn't known, so "this wallet
 * was already linked or already traded" can only be remembered per device: once the modal was answered in this
 * browser, the modal never comes back here (see markConnectModalAnswered).
 */

export type ConnectStep = "modal" | "connect" | "redirect" | "install";

export type ConnectInput = {
  referralsOn: boolean;
  hasPendingLink: boolean;
  hasPendingCode: boolean;
  answeredBefore: boolean;
  walletInstalled: boolean;
  mobile: boolean;
};

/** After the modal (or when it's skipped): connect in place if a wallet is here; on a phone without one, open
 *  PANDA inside the Phantom app; on desktop without one, show the install link. */
export function afterAnswer(input: Pick<ConnectInput, "walletInstalled" | "mobile">): Exclude<ConnectStep, "modal"> {
  if (input.walletInstalled) return "connect";
  return input.mobile ? "redirect" : "install";
}

/** The modal is skipped when a recruiter's link or code is already here (the page was opened through one), when
 *  the program is off, or when this browser already answered the question. */
export function connectStep(input: ConnectInput): ConnectStep {
  const skipModal = !input.referralsOn || input.hasPendingLink || input.hasPendingCode || input.answeredBefore;
  return skipModal ? afterAnswer(input) : "modal";
}

const ANSWERED_KEY = "panda:connect-answered";

export function hasAnsweredConnectModal(): boolean {
  try {
    return window.localStorage.getItem(ANSWERED_KEY) === "1";
  } catch {
    return false;
  }
}

export function markConnectModalAnswered(): void {
  try {
    window.localStorage.setItem(ANSWERED_KEY, "1");
  } catch {
    // Private window — the question just comes back next time.
  }
}

/**
 * How to ask the wallet to connect, given where things really are. The wallet library keeps TWO states: its own
 * ("is a wallet selected / connected?") and the wallet adapter's. They can drift apart — the adapter connected while
 * the library shows "disconnected" (a connect that ran right after a disconnect, once the library had already let go of
 * the wallet). In that state every further connect returns at once without telling anyone, and the button looks dead.
 *
 *  - `resetAdapter`: the adapter is connected behind the library's back → disconnect it first, then start clean.
 *  - `how`: "connect" only when the wallet is still selected and nothing had to be reset; otherwise "select" it again,
 *    which is what makes the library open the wallet.
 */
export function connectPlan(s: { walletSelected: boolean; libraryConnected: boolean; adapterConnected: boolean }): { resetAdapter: boolean; how: "connect" | "select" } {
  const resetAdapter = !s.libraryConnected && s.adapterConnected;
  return { resetAdapter, how: s.walletSelected && !resetAdapter ? "connect" : "select" };
}

/**
 * "Cambiar de cuenta" is two steps that must NOT overlap: first the wallet is disconnected (and the PANDA session
 * closed); only once the library has really let go of it is the wallet asked to connect again. True = now is that moment.
 */
export function readyToReconnect(s: { switching: boolean; libraryConnected: boolean; connecting: boolean; disconnecting: boolean }): boolean {
  return s.switching && !s.libraryConnected && !s.connecting && !s.disconnecting;
}
