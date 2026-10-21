import { keyPairFromSecretKey, mnemonicToPrivateKey } from "@ton/crypto";

import { createWallet } from "../auto/wallet.js";

export { createWallet };

/**
 * A key pair from a 24-word phrase, or from a raw secret key.
 *
 * The drop's wallet can be bound two ways: the phrase the user typed in, or
 * a secret key already in the account's storage. Both land here.
 *
 * @param {string} input - a mnemonic phrase, or a 64-character hex secret key
 * @returns {Promise<import("@ton/crypto").KeyPair>}
 */
export async function keyPairFromPhraseOrSecretKey(input) {
  const value = String(input || "").trim();

  if (!value) {
    throw new Error("No phrase or secret key given.");
  }

  /* A secret key is 32 bytes, hex-encoded. */
  if (/^[0-9a-fA-F]{64}$/.test(value)) {
    return keyPairFromSecretKey(Buffer.from(value, "hex"));
  }

  return mnemonicToPrivateKey(value.split(/\s+/).filter(Boolean));
}
