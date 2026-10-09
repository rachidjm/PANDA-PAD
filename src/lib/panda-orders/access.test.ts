import { test } from "node:test";
import assert from "node:assert/strict";
import { Keypair } from "@solana/web3.js";
import { ordersAllowed } from "./access";

const w = () => Keypair.generate().publicKey.toBase58();

test("rollout: admins always; listed wallets too; nobody else — and with no list, admins only", () => {
  const admin = w(), friend = w(), stranger = w();
  const env = { ADMIN_WALLETS: admin, PANDA_ORDERS_ALLOWLIST: ` ${friend} , ` };
  assert.equal(ordersAllowed(admin, env), true);
  assert.equal(ordersAllowed(friend, env), true);
  assert.equal(ordersAllowed(stranger, env), false);
  assert.equal(ordersAllowed(friend, { ADMIN_WALLETS: admin }), false, "unset list = admins only");
  assert.equal(ordersAllowed(admin, { ADMIN_WALLETS: admin }), true);
  assert.equal(ordersAllowed(stranger, {}), false);
});

test("'*' opens PANDA orders to everyone", () => {
  assert.equal(ordersAllowed(w(), { PANDA_ORDERS_ALLOWLIST: "*" }), true);
});
