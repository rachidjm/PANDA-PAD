import { Connection, Keypair, PublicKey, Transaction } from "@solana/web3.js";
import {
  TOKEN_2022_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
  createAssociatedTokenAccountIdempotentInstruction,
  createTransferCheckedInstruction,
  getAssociatedTokenAddressSync,
  getMint,
} from "@solana/spl-token";
import bs58 from "bs58";
import { serverRpcUrl } from "@/lib/solana/rpc";
import type { ChainStatus } from "./claim-machine";
import type { ClaimChain, PreparedTransfer } from "./engine";

/**
 * The real Solana side of airdrop claims: pays PANDA (an SPL token) from the
 * dedicated AIRDROP pool wallet — a different wallet from the Rewards Pool and
 * the Treasury, by design, so the accounting of each never mixes. The signing
 * key lives only in the server-only env var PANDA_AIRDROP_POOL_SECRET_KEY.
 *
 * Only thin glue around web3.js/spl-token: every decision that matters (who
 * gets paid, how much, whether a retry is safe) is made and tested in
 * engine.ts / claim-machine.ts against a simulated chain.
 */

export function getAirdropPoolSigner(): Keypair | null {
  const raw = process.env.PANDA_AIRDROP_POOL_SECRET_KEY?.trim();
  if (!raw) return null;
  try {
    return Keypair.fromSecretKey(raw.startsWith("[") ? Uint8Array.from(JSON.parse(raw)) : bs58.decode(raw));
  } catch {
    throw new Error("PANDA_AIRDROP_POOL_SECRET_KEY is set but isn't valid (expected base58 or a JSON byte array).");
  }
}

export function pandaMint(): PublicKey | null {
  const m = process.env.NEXT_PUBLIC_PANDA_TOKEN_MINT;
  if (!m) return null;
  try {
    return new PublicKey(m);
  } catch {
    return null;
  }
}

export type AirdropChainConfig = { connection: Connection; signer: Keypair; mint: PublicKey };

/** null unless everything needed is configured — callers must then refuse (fail closed). */
export function airdropChainConfig(): AirdropChainConfig | null {
  const signer = getAirdropPoolSigner();
  const mint = pandaMint();
  if (!signer || !mint) return null;
  return { connection: new Connection(serverRpcUrl(), "confirmed"), signer, mint };
}

async function tokenProgramFor(connection: Connection, mint: PublicKey): Promise<PublicKey> {
  const info = await connection.getAccountInfo(mint);
  if (!info) throw new Error("PANDA mint not found on this network.");
  if (info.owner.equals(TOKEN_PROGRAM_ID) || info.owner.equals(TOKEN_2022_PROGRAM_ID)) return info.owner;
  throw new Error("PANDA mint isn't owned by a token program.");
}

/** The airdrop pool's PANDA balance in base units. */
export async function poolTokenBalance(cfg: AirdropChainConfig): Promise<bigint> {
  const program = await tokenProgramFor(cfg.connection, cfg.mint);
  const ata = getAssociatedTokenAddressSync(cfg.mint, cfg.signer.publicKey, false, program);
  try {
    const bal = await cfg.connection.getTokenAccountBalance(ata, "confirmed");
    return BigInt(bal.value.amount);
  } catch {
    return BigInt(0); // no token account yet = nothing funded
  }
}

/** Extra blocks past lastValidBlockHeight before "never seen" counts as "can never land" — absorbs RPC lag (~1 min). */
const EXPIRY_MARGIN_BLOCKS = 150;

export function solanaClaimChain(cfg: AirdropChainConfig): ClaimChain {
  const { connection, signer, mint } = cfg;
  return {
    async prepare(wallet: string, amount: bigint): Promise<PreparedTransfer> {
      const program = await tokenProgramFor(connection, mint);
      const decimals = (await getMint(connection, mint, "confirmed", program)).decimals;
      const recipient = new PublicKey(wallet);
      const source = getAssociatedTokenAddressSync(mint, signer.publicKey, false, program);
      const dest = getAssociatedTokenAddressSync(mint, recipient, true, program);

      const balance = await poolTokenBalance(cfg);
      if (balance < amount) throw new Error("Airdrop pool holds less than the claim amount.");

      const tx = new Transaction();
      tx.add(createAssociatedTokenAccountIdempotentInstruction(signer.publicKey, dest, recipient, mint, program));
      tx.add(createTransferCheckedInstruction(source, mint, dest, signer.publicKey, amount, decimals, [], program));
      const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash("confirmed");
      tx.feePayer = signer.publicKey;
      tx.recentBlockhash = blockhash;
      tx.sign(signer);
      if (!tx.signature) throw new Error("Failed to sign the airdrop transfer.");
      const raw = tx.serialize();

      return {
        signature: bs58.encode(tx.signature),
        lastValidBlockHeight,
        send: async () => {
          await connection.sendRawTransaction(raw, { skipPreflight: false, maxRetries: 3, preflightCommitment: "confirmed" });
        },
      };
    },

    async status(signature: string, lastValidBlockHeight: number): Promise<ChainStatus> {
      const { value } = await connection.getSignatureStatuses([signature], { searchTransactionHistory: true });
      const s = value[0];
      if (s) {
        if (s.err) return "failed";
        return s.confirmationStatus === "finalized" ? "confirmed" : "pending";
      }
      // Never seen: only provably dead once the blockhash has expired.
      const height = await connection.getBlockHeight("confirmed");
      return height > lastValidBlockHeight + EXPIRY_MARGIN_BLOCKS ? "expired" : "pending";
    },
  };
}
