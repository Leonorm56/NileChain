import { sha256, sign } from "@ton/crypto";

/**
 * Build the TON ownership proof the drop asks for when a wallet is bound.
 *
 * The page hands the wallet a payload from the backend and the wallet signs
 * it, together with the domain it is signing for and its own state init. The
 * drop checks the signature against the address it is binding, which is what
 * proves the account really owns the wallet.
 *
 * @param {object} options
 * @param {object} options.wallet - the TON wallet contract, for its state init
 * @param {Uint8Array} options.secretKey - the key pair's secret key
 * @param {string} options.domain - the host the proof is signed for
 * @param {string} options.payload - the payload the backend handed out
 * @returns {Promise<object>} the proof, signed
 */
export async function buildTonProof({
  wallet,
  secretKey,
  domain,
  payload,
} = {}) {
  if (!wallet) throw new Error("No wallet to prove ownership of.");
  if (!secretKey) throw new Error("No secret key to sign the proof with.");
  if (!payload) throw new Error("No payload to sign.");

  const proof = {
    timestamp: Date.now(),
    domain,
    payload,
    state_init: stateInitToBase64(wallet.stateInit),
  };

  const hash = sha256(Buffer.from(JSON.stringify(proof), "utf8"));
  const signature = sign(hash, Buffer.from(secretKey)).toString("base64");

  return { ...proof, signature };
}

/**
 * The wallet's state init as base64.
 *
 * A contract carries it as a cell; TonConnect hands it over as a string.
 */
function stateInitToBase64(stateInit) {
  if (typeof stateInit === "string") return stateInit;
  if (stateInit?.toBounce) return stateInit.toBounce().toString("base64");
  if (stateInit?.cell?.toBounce) {
    return stateInit.cell.toBounce().toString("base64");
  }

  throw new Error("The wallet has no state init to sign.");
}
