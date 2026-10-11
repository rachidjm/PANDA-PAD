import { test } from "node:test";
import assert from "node:assert/strict";
import bs58 from "bs58";
import nacl from "tweetnacl";
import { Keypair } from "@solana/web3.js";
import { connectUrl, DeepLinkError, decryptPayload, encryptPayload, newDappKeys, newRelayId, parseReturnAnswer, parseReturnPath, PROVIDERS, readConnect, readResult, redirectUrl, requestUrl, type DeepLinkProvider } from "./protocol";

/**
 * The wallets' deep-link protocol, exercised against a SIMULATED wallet app: it holds its own encryption key and the
 * user's signing key, reads PANDA's links exactly as the documentation describes and answers the same way. PANDA's side
 * never holds anything that can sign.
 */

function simulatedWallet(provider: DeepLinkProvider) {
  const box = nacl.box.keyPair();
  const user = Keypair.generate();
  const session = "session-" + bs58.encode(nacl.randomBytes(8));
  const key = bs58.encode(box.publicKey);
  const secret = bs58.encode(box.secretKey);
  return {
    user,
    /** Answers a `connect` link: its own encryption key in the clear, the address and the session encrypted. */
    connect(url: string): Record<string, string> {
      const q = new URL(url).searchParams;
      const dappKey = q.get("dapp_encryption_public_key")!;
      const enc = encryptPayload({ public_key: user.publicKey.toBase58(), session }, dappKey, secret);
      return { [PROVIDERS[provider].keyParam]: key, nonce: enc.nonce, data: enc.payload };
    },
    /** Reads any later request (it must carry the session) and answers with `result`, encrypted. */
    answer(url: string, result: (payload: Record<string, unknown>) => unknown): Record<string, string> {
      const q = new URL(url).searchParams;
      const payload = decryptPayload<Record<string, unknown>>(q.get("payload")!, q.get("nonce")!, q.get("dapp_encryption_public_key")!, secret);
      assert.equal(payload.session, session, "every request carries the wallet's session");
      const enc = encryptPayload(result(payload), q.get("dapp_encryption_public_key")!, secret);
      return { nonce: enc.nonce, data: enc.payload };
    },
  };
}

test("connect: the link is the wallet's official one, and only the wallet's answer yields the address and a session", () => {
  for (const provider of ["phantom", "solflare"] as const) {
    const wallet = simulatedWallet(provider);
    const dapp = newDappKeys();
    const url = connectUrl({ provider, dappPublicKey: dapp.publicKey, redirect: redirectUrl("https://launchonpanda.app/", provider, "r".repeat(32)), appUrl: "https://launchonpanda.app" });
    const u = new URL(url);
    assert.equal(u.origin + u.pathname, provider === "phantom" ? "https://phantom.app/ul/v1/connect" : "https://solflare.com/ul/v1/connect");
    assert.equal(u.searchParams.get("cluster"), "mainnet-beta");
    assert.equal(u.searchParams.get("redirect_link"), `https://launchonpanda.app/telegram/wallet/${provider}/${"r".repeat(32)}`, "no query of its own: the wallet adds its answer as one");
    assert.ok(!url.includes(dapp.secretKey), "the connection's private key never leaves the page");

    const session = readConnect(provider, dapp, wallet.connect(url));
    assert.equal(session.publicKey, wallet.user.publicKey.toBase58());
    assert.equal(session.provider, provider);
  }
});

test("a refusal, a missing field or an answer meant for someone else is an error — never a connection", () => {
  const wallet = simulatedWallet("phantom");
  const dapp = newDappKeys();
  const url = connectUrl({ provider: "phantom", dappPublicKey: dapp.publicKey, redirect: "https://launchonpanda.app/telegram/wallet?w=phantom&r=x", appUrl: "https://launchonpanda.app" });
  const good = wallet.connect(url);
  assert.throws(
    () => readConnect("phantom", dapp, { errorCode: "4001", errorMessage: "User rejected the request." }),
    (e: unknown) => e instanceof DeepLinkError && e.rejected && e.code === "4001"
  );
  assert.throws(() => readConnect("phantom", dapp, { nonce: good.nonce }), DeepLinkError);
  assert.throws(() => readConnect("phantom", dapp, { nonce: good.nonce, data: good.data }), DeepLinkError, "no wallet key");
  // The right answer, read with another page's key: unreadable.
  assert.throws(() => readConnect("phantom", newDappKeys(), good), /could not be read/);
  // Tampered with on the way.
  const data = bs58.decode(good.data);
  data[5] ^= 1;
  assert.throws(() => readConnect("phantom", dapp, { ...good, data: bs58.encode(data) }), /could not be read/);
});

test("requests: the transaction travels encrypted, with the session; the wallet signs and answers; PANDA only reads the result", () => {
  const wallet = simulatedWallet("phantom");
  const dapp = newDappKeys();
  const session = readConnect("phantom", dapp, wallet.connect(connectUrl({ provider: "phantom", dappPublicKey: dapp.publicKey, redirect: "https://x.test/r", appUrl: "https://x.test" })));

  const tx = bs58.encode(nacl.randomBytes(200));
  const url = requestUrl(session, "signAndSendTransaction", { transaction: tx, sendOptions: { maxRetries: 3 } }, "https://launchonpanda.app/telegram/wallet?w=phantom&r=y");
  const u = new URL(url);
  assert.equal(u.origin + u.pathname, "https://phantom.app/ul/v1/signAndSendTransaction");
  assert.ok(!url.includes(tx) && !url.includes(session.session), "nothing readable in the link itself");
  const answer = wallet.answer(url, (p) => {
    assert.equal(p.transaction, tx);
    return { signature: "5ig" };
  });
  assert.deepEqual(readResult<{ signature: string }>(session, answer), { signature: "5ig" });

  // signMessage: the wallet signs with the USER'S key; the page can verify it but could never have produced it.
  const message = new TextEncoder().encode("PANDA sign-in");
  const signed = wallet.answer(requestUrl(session, "signMessage", { message: bs58.encode(message), display: "utf8" }, "https://x.test/r"), (p) => ({
    signature: bs58.encode(nacl.sign.detached(bs58.decode(String(p.message)), wallet.user.secretKey)),
  }));
  const sig = bs58.decode(readResult<{ signature: string }>(session, signed).signature);
  assert.ok(nacl.sign.detached.verify(message, sig, wallet.user.publicKey.toBytes()));

  assert.throws(() => readResult(session, { errorCode: "4001" }), (e: unknown) => e instanceof DeepLinkError && e.rejected);
});

test("relay ids are 32 URL-safe characters of fresh randomness", () => {
  const ids = new Set(Array.from({ length: 200 }, newRelayId));
  assert.equal(ids.size, 200);
  for (const id of ids) assert.match(id, /^[A-Za-z0-9_-]{32}$/);
});

test("the way back: the slot and the coin travel in the PATH, and the wallet's answer is read however it was attached", () => {
  const mint = "zefa42tKR24WwpYZJujta7CDkD43n47soQwCoJpanda";
  const id = "A".repeat(32);
  assert.equal(redirectUrl("https://launchonpanda.app", "solflare", id, mint), `https://launchonpanda.app/telegram/wallet/solflare/${id}/${mint}`);
  assert.equal(redirectUrl("https://launchonpanda.app/", "phantom", id, "../../admin"), `https://launchonpanda.app/telegram/wallet/phantom/${id}`, "only a coin address goes in");
  assert.deepEqual(parseReturnPath(`/telegram/wallet/solflare/${id}/${mint}`), { provider: "solflare", relayId: id, back: mint });
  assert.deepEqual(parseReturnPath(`/telegram/wallet/phantom/${id}`), { provider: "phantom", relayId: id, back: null });
  for (const bad of ["/telegram/wallet", `/telegram/wallet/metamask/${id}`, "/telegram/wallet/phantom/short", `/telegram/wallet/phantom/${id}/not a coin`, `/admin/${id}`]) assert.equal(parseReturnPath(bad), null, bad);

  const want = { phantom_encryption_public_key: "PK", nonce: "N", data: "D" };
  assert.deepEqual(parseReturnAnswer("?phantom_encryption_public_key=PK&nonce=N&data=D"), want, "a normal query");
  assert.deepEqual(parseReturnAnswer("?w=phantom&r=xyz?phantom_encryption_public_key=PK&nonce=N&data=D"), want, "glued after an existing query with a second '?'");
  assert.deepEqual(parseReturnAnswer("", "#phantom_encryption_public_key=PK&nonce=N&data=D"), want, "in the fragment");
  assert.deepEqual(parseReturnAnswer("?errorCode=4001&errorMessage=User%20rejected%20the%20request.&other=dropped"), { errorCode: "4001", errorMessage: "User rejected the request." });
  assert.deepEqual(parseReturnAnswer(""), {});
});
