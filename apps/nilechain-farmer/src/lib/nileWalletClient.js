/**
 * NileWallet client
 *
 * Most operations run client-side via the NileWallet module — no service worker
 * needed for vault, wallet, token, or transfer ops. TON Connect still requires
 * the service worker for its long-lived EventSource bridge.
 */

import nileWallet from "./nileWallet";

/** Error thrown when the vault key isn't cached — UI should prompt to unlock. */
export class NileWalletLockedError extends Error {
  constructor() {
    super("needs-unlock");
    this.name = "NileWalletLockedError";
    this.code = "needs-unlock";
  }
}

/** Error thrown when an entered passphrase doesn't match the vault. */
export class NileWalletBadPassphraseError extends Error {
  constructor() {
    super("bad-passphrase");
    this.name = "NileWalletBadPassphraseError";
    this.code = "bad-passphrase";
  }
}

function wrapError(err) {
  if (err?.message === "needs-unlock") throw new NileWalletLockedError();
  if (err?.message === "bad-passphrase") throw new NileWalletBadPassphraseError();
  throw err;
}

function call(fn, ...args) {
  return Promise.resolve()
    .then(() => fn(...args))
    .catch(wrapError);
}

/**
 * Forward a TON Connect action to the service worker.
 * The SW hosts NileWalletConnect instances with long-lived EventSource bridges.
 */
function swCall(message) {
  return new Promise((resolve, reject) => {
    if (typeof chrome === "undefined" || !chrome.runtime?.sendMessage) {
      reject(new Error("Service worker unavailable"));
      return;
    }
    chrome.runtime.sendMessage(message, (response) => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message || "Service worker unavailable"));
        return;
      }
      if (response && response.error) {
        reject(new Error(response.error));
        return;
      }
      resolve(response);
    });
  }).catch(wrapError);
}

const nileWalletClient = {
  /* ---- vault ---- */
  vaultStatus: () => call(nileWallet.vaultStatus),
  unlock: (password) => call(nileWallet.unlock, password),
  lock: () => call(nileWallet.lock),

  /* ---- wallet ---- */
  get: (accountId) => call(nileWallet.get, accountId),
  generate: (accountId) => call(nileWallet.generate, accountId),
  importWallet: (accountId, phrase) =>
    call(nileWallet.importWallet, accountId, phrase),
  revealSeed: (accountId) => call(nileWallet.revealSeed, accountId),
  clear: (accountId) => call(nileWallet.clear, accountId),
  balance: (accountId) => call(nileWallet.balance, accountId),

  /* ---- custom tokens (Jettons) ---- */
  listTokens: (accountId) => call(nileWallet.listTokens, accountId),
  addToken: (accountId, address) =>
    call(nileWallet.addToken, accountId, address),
  removeToken: (accountId, address) =>
    call(nileWallet.removeToken, accountId, address),
  tokenBalance: (accountId, token) =>
    call(nileWallet.tokenBalance, accountId, token),

  /* ---- transfers ---- */
  estimateTransfer: (accountId, params) =>
    call(nileWallet.estimateTransfer, accountId, params),
  sendTransfer: (accountId, params) =>
    call(nileWallet.sendTransfer, accountId, params),

  /* ---- backup / restore ---- */
  backup: (password) => call(nileWallet.backup, { password }),
  restorePreview: (password, json) =>
    call(nileWallet.restorePreview, { password, json }),
  restoreApply: (password, json, overwrite) =>
    call(nileWallet.restoreApply, { password, json, overwrite }),

  /* ---- TON Connect (requires SW for EventSource bridge) ---- */
  parseLink: (accountId, link) =>
    swCall({ action: "nile-wallet.connect.parse-link", accountId, link }),
  approve: (accountId, prepared) =>
    swCall({ action: "nile-wallet.connect.approve", accountId, prepared }),
  reject: (accountId, prepared) =>
    swCall({ action: "nile-wallet.connect.reject", accountId, prepared }),
  disconnect: (accountId, dAppPubKey) =>
    swCall({ action: "nile-wallet.connect.disconnect", accountId, dAppPubKey }),
  subscribe: (accountId) =>
    swCall({ action: "nile-wallet.connect.subscribe", accountId }),
  restore: (accountId) =>
    swCall({ action: "nile-wallet.connect.restore", accountId }),
  sessions: (accountId) =>
    swCall({ action: "nile-wallet.connect.sessions", accountId }),

  /* ---- Injected window.tonconnect provider approve/reject ---- */
  injectedApprove: (accountId, requestId) =>
    swCall({ action: "nile-wallet.connect.injected-approve", accountId, requestId, rejected: false }),
  injectedReject: (accountId, requestId) =>
    swCall({ action: "nile-wallet.connect.injected-approve", accountId, requestId, rejected: true }),
};

export default nileWalletClient;
