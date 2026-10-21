/**
 * TonAPI, the block explorer the drop reads on-chain holdings from.
 *
 * The shared auto client already knows how to talk to it, and it queues the
 * calls one at a time so a farmer does not flood the explorer.
 */
export { fetchTonApi } from "../auto/wallet.js";
