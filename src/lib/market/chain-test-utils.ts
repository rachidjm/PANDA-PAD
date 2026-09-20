import { SystemInstruction, SystemProgram, Transaction } from "@solana/web3.js";
import bs58 from "bs58";
import type { ParsedTxLike } from "./chain";

/** Test helper: the jsonParsed form an RPC would return for this (base64) transaction. Not used by production code. */
export function toParsed(base64: string, err: unknown = null): ParsedTxLike {
  const tx = Transaction.from(Buffer.from(base64, "base64"));
  const msg = tx.compileMessage();
  return {
    meta: { err },
    transaction: {
      message: {
        accountKeys: msg.accountKeys.map((k, i) => ({ pubkey: k, signer: i < msg.header.numRequiredSignatures })),
        instructions: tx.instructions.map((ix) => {
          if (ix.programId.equals(SystemProgram.programId)) {
            const t = SystemInstruction.decodeTransfer(ix);
            return { programId: ix.programId, program: "system", parsed: { type: "transfer", info: { source: t.fromPubkey.toBase58(), destination: t.toPubkey.toBase58(), lamports: Number(t.lamports) } } };
          }
          return { programId: ix.programId, accounts: ix.keys.map((k) => k.pubkey), data: bs58.encode(ix.data) };
        }),
      },
    },
  };
}
