/**
 * NileWallet client
 *
 * Thin promise wrapper over `chrome.runtime.sendMessage` for the per-account
 * TON wallet living in the service worker. The SW answers every `nile-wallet.*`
 * action with `{ ok: true, ... }` or `{ ok: false, error }`; this unwraps that
 * into a resolved value or a thrown Error.
 *
 * In Electron desktop apps (THE NILE), MV3 service workers go dormant after
 * ~30s. We use a long-lived port connection to keep the SW alive so that
 * chrome.runtime.sendMessage always has a receiving end.
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

/**
 * Long-lived port to keep the MV3 service worker alive.
 * Without this, the SW goes dormant after ~30s and
 * chrome.runtime.sendMessage fails with "Receiving end does not exist".
 */
let keepAlivePort = null;
let keepAliveInterval = null;

function ensureServiceWorkerAlive() {
  if (keepAlivePort) return;

  try {
    keepAlivePort = chrome.runtime.connect({ name: "nile-wallet-keepalive" });
    keepAlivePort.onDisconnect.addListener(() => {
      keepAlivePort = null;
      if (keepAliveInterval) clearInterval(keepAliveInterval);
      keepAliveInterval = null;
      // Try to reconnect after a short delay
      setTimeout(ensureServiceWorkerAlive, 1000);
    });

    // Send periodic pings to keep the port alive
    keepAliveInterval = setInterval(() => {
      try {
        if (keepAlivePort) {
          keepAlivePort.postMessage({ type: "ping" });
        }
      } catch {
        keepAlivePort = null;
        clearInterval(keepAliveInterval);
        keepAliveInterval = null;
      }
    }, 15000); // every 15 seconds
  } catch {
    // Extension context might be invalidated
  }
}

function sendMessage(action, payload) {
  // Ensure the service worker is alive before sending
  ensureServiceWorkerAlive();

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

function sendWithRetry(action, payload, retries = 2) {
  return sendMessage(action, payload).catch((err) => {
    if (
      retries > 0 &&
      (err.message?.includes("Could not establish connection") ||
        err.message?.includes("Receiving end does not exist"))
    ) {
      // Force reconnect the keepalive port
      keepAlivePort = null;
      if (keepAliveInterval) clearInterval(keepAliveInterval);
      keepAliveInterval = null;

      return new Promise((resolve) => setTimeout(resolve, 500)).then(() => {
        ensureServiceWorkerAlive();
        return sendWithRetry(action, payload, retries - 1);
      });
    }
    throw err;
  });
}

// Start keeping the service worker alive immediately
ensureServiceWorkerAlive();

const nileWalletClient = {
  /* ---- vault ---- */
  vaultStatus: () => sendWithRetry("nile-wallet.vault-status"),
  /** Set (first time) or unlock the vault with the single passphrase. */
  unlock: (password) => sendWithRetry("nile-wallet.unlock", { password }),
  lock: () => sendWithRetry("nile-wallet.lock"),

  /* ---- wallet ---- */
  get: (accountId) => sendWithRetry("nile-wallet.get", { accountId }),
  generate: (accountId) => sendWithRetry("nile-wallet.generate", { accountId }),
  /** Import an existing wallet from a 24-word recovery phrase (validated in SW). */
  importWallet: (accountId, phrase) =>
    sendWithRetry("nile-wallet.import", { accountId, phrase }),
  revealSeed: (accountId) =>
    sendWithRetry("nile-wallet.reveal-seed", { accountId }),
  clear: (accountId) => sendWithRetry("nile-wallet.clear", { accountId }),
  balance: (accountId) => sendWithRetry("nile-wallet.balance", { accountId }),

  /* ---- custom tokens (Jettons) ---- */
  listTokens: (accountId) =>
    sendWithRetry("nile-wallet.tokens.list", { accountId }),
  addToken: (accountId, address) =>
    sendWithRetry("nile-wallet.token.add", { accountId, address }),
  removeToken: (accountId, address) =>
    sendWithRetry("nile-wallet.token.remove", { accountId, address }),
  tokenBalance: (accountId, token) =>
    sendWithRetry("nile-wallet.token.balance", { accountId, token }),

  /* ---- transfers ---- */
  estimateTransfer: (accountId, params) =>
    sendWithRetry("nile-wallet.transfer.estimate", { accountId, ...params }),
  sendTransfer: (accountId, params) =>
    sendWithRetry("nile-wallet.transfer.send", { accountId, ...params }),

  /* ---- backup / restore ---- */
  backup: (password) => sendWithRetry("nile-wallet.backup", { password }),
  restorePreview: (password, json) =>
    sendWithRetry("nile-wallet.restore.preview", { password, json }),
  restoreApply: (password, json, overwrite) =>
    sendWithRetry("nile-wallet.restore.apply", { password, json, overwrite }),

  /* ---- TON Connect ---- */
  parseLink: (accountId, link) =>
    sendWithRetry("nile-wallet.connect.parse-link", { accountId, link }),
  approve: (accountId, prepared) =>
    sendWithRetry("nile-wallet.connect.approve", { accountId, prepared }),
  reject: (accountId, prepared) =>
    sendWithRetry("nile-wallet.connect.reject", { accountId, prepared }),
  disconnect: (accountId, dAppPubKey) =>
    sendWithRetry("nile-wallet.connect.disconnect", {
      accountId,
      dAppPubKey,
    }),
  subscribe: (accountId) =>
    sendWithRetry("nile-wallet.connect.subscribe", { accountId }),
  restore: (accountId) =>
    sendWithRetry("nile-wallet.connect.restore", { accountId }),
  sessions: (accountId) =>
    sendWithRetry("nile-wallet.connect.sessions", { accountId }),
};

export default nileWalletClient;
