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
