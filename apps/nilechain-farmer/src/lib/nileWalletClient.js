/**
 * NileWallet client
 *
 * Thin promise wrapper over `chrome.runtime.sendMessage` for the per-account
 * TON wallet living in the service worker. The SW answers every `nile-wallet.*`
 * action with `{ ok: true, ... }` or `{ ok: false, error }`; this unwraps that
 * into a resolved value or a thrown Error.
 *
 * In the PWA/bridge build `window.chrome` is proxied (see lib/bridge-client),
 * so the same call works there too.
 */

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

function sendMessage(action, payload) {
  return new Promise((resolve, reject) => {
    try {
      chrome.runtime.sendMessage({ action, ...payload }, (response) => {
        const runtimeError = chrome.runtime?.lastError;
        if (runtimeError) {
          reject(new Error(runtimeError.message));
          return;
        }
        if (!response) {
          reject(new Error("No response from NileWallet background"));
          return;
        }
        if (response.ok === false) {
          if (response.error === "needs-unlock") {
            reject(new NileWalletLockedError());
          } else if (response.error === "bad-passphrase") {
            reject(new NileWalletBadPassphraseError());
          } else {
            reject(new Error(response.error || "NileWallet request failed"));
          }
          return;
        }
        resolve(response);
      });
    } catch (e) {
      reject(e);
    }
  });
}

function send(action, payload = {}) {
  return sendMessage(action, payload).catch((err) => {
    /* MV3 service workers go dormant after ~30s. Chrome should auto-wake
     * on the first sendMessage, but there can be a race where the port
     * isn't ready yet. Retry once after a short delay. */
    if (
      err.message?.includes("Could not establish connection") ||
      err.message?.includes("Receiving end does not exist")
    ) {
      return new Promise((resolve) => setTimeout(resolve, 300)).then(() =>
        sendMessage(action, payload),
      );
    }
    throw err;
  });
}

const nileWalletClient = {
  /* ---- vault ---- */
  vaultStatus: () => send("nile-wallet.vault-status"),
  /** Set (first time) or unlock the vault with the single passphrase. */
  unlock: (password) => send("nile-wallet.unlock", { password }),
  lock: () => send("nile-wallet.lock"),

  /* ---- wallet ---- */
  get: (accountId) => send("nile-wallet.get", { accountId }),
  generate: (accountId) => send("nile-wallet.generate", { accountId }),
  /** Import an existing wallet from a 24-word recovery phrase (validated in SW). */
  importWallet: (accountId, phrase) =>
    send("nile-wallet.import", { accountId, phrase }),
  revealSeed: (accountId) => send("nile-wallet.reveal-seed", { accountId }),
  clear: (accountId) => send("nile-wallet.clear", { accountId }),
  balance: (accountId) => send("nile-wallet.balance", { accountId }),

  /* ---- custom tokens (Jettons) ---- */
  listTokens: (accountId) => send("nile-wallet.tokens.list", { accountId }),
  addToken: (accountId, address) =>
    send("nile-wallet.token.add", { accountId, address }),
  removeToken: (accountId, address) =>
    send("nile-wallet.token.remove", { accountId, address }),
  tokenBalance: (accountId, token) =>
    send("nile-wallet.token.balance", { accountId, token }),

  /* ---- transfers ---- */
  /** Build + sign + estimate network fee. Returns { feeNano, insufficient, ... }. */
  estimateTransfer: (accountId, params) =>
    send("nile-wallet.transfer.estimate", { accountId, ...params }),
  /** Broadcast a signed transfer. Returns { hash, txStatus }. */
  sendTransfer: (accountId, params) =>
    send("nile-wallet.transfer.send", { accountId, ...params }),

  /* ---- backup / restore ---- */
  /** Export ALL wallets (every account) as an encrypted JSON download. */
  backup: (password) => send("nile-wallet.backup", { password }),
  /** Decrypt + validate a backup without writing. Returns preview entries. */
  restorePreview: (password, json) =>
    send("nile-wallet.restore.preview", { password, json }),
  /** Write a validated backup, honoring per-account overwrite consent. */
  restoreApply: (password, json, overwrite) =>
    send("nile-wallet.restore.apply", { password, json, overwrite }),

  /* ---- TON Connect ---- */
  parseLink: (accountId, link) =>
    send("nile-wallet.connect.parse-link", { accountId, link }),
  approve: (accountId, prepared) =>
    send("nile-wallet.connect.approve", { accountId, prepared }),
  reject: (accountId, prepared) =>
    send("nile-wallet.connect.reject", { accountId, prepared }),
  disconnect: (accountId, dAppPubKey) =>
    send("nile-wallet.connect.disconnect", { accountId, dAppPubKey }),
  subscribe: (accountId) =>
    send("nile-wallet.connect.subscribe", { accountId }),
  restore: (accountId) => send("nile-wallet.connect.restore", { accountId }),
  sessions: (accountId) =>
    send("nile-wallet.connect.sessions", { accountId }),
};

export default nileWalletClient;
