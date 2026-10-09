import { parseAdminWallets } from "@/lib/auth/admin-policy";

/**
 * Who may use PANDA orders while they're being rolled out. FEATURE_PANDA_ORDERS switches the feature on; this decides
 * for WHOM: the ADMIN_WALLETS always, plus the wallets in PANDA_ORDERS_ALLOWLIST (comma-separated). Unset or empty =
 * admins only (fails closed). "*" = everyone — the step that opens it to all users.
 */
export function ordersAllowed(wallet: string, env: Record<string, string | undefined> = process.env): boolean {
  const list = env.PANDA_ORDERS_ALLOWLIST?.trim() ?? "";
  if (list === "*") return true;
  return parseAdminWallets(env.ADMIN_WALLETS).has(wallet) || parseAdminWallets(list).has(wallet);
}
