import { Address } from "@ton/core";
import { WalletContractV4, beginCell, storeStateInit } from "@ton/ton";
import { mnemonicToPrivateKey } from "@ton/crypto";

import Encrypter from "@nile/shared/lib/Encrypter";
import NileWallet from "@nile/shared/lib/NileWallet";
import NileWalletConnect from "@nile/shared/lib/NileWalletConnect";

/**
 * NileWallet Background
 *
 * Wires the shared NileWallet + NileWalletConnect clients into the MV3
 * service worker. Handles account-scoped wallet ops requested from the
 * NileChain window via chrome.runtime messages.
 *
 * Vault model: a single passphrase is set once. Its scrypt-derived key is
 * cached in service-worker memory ONLY (never persisted) and reused to encrypt
 * every account's separate mnemonic. When the SW suspends the cache is lost and
 * the UI must re-unlock. Nothing key-related is ever written to disk.
 */

/** Shared vault record (non-secret salt + a check token to verify the pass). */
const VAULT_STORAGE_KEY = "shared:nile-wallet:vault";
const VAULT_CHECK_PLAINTEXT = "nile-vault-ok";

/** Account list written by the NileChain core (`shared:accounts`). */
const ACCOUNTS_STORAGE_KEY = "shared:accounts";

/** Backup file schema version — bump on breaking format changes. */
const BACKUP_VERSION = 1;

/**
 * Base64-encode a UTF-8 string without URL.createObjectURL (unavailable in
 * some worker contexts) or btoa's latin1-only input limitation.
 */
function utf8ToBase64(str) {
  const bytes = new TextEncoder().encode(str);
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary);
}

/** TON network these wallets operate on. */
const BACKUP_CHAIN = "mainnet";

/** Derived vault key — SW memory only, never stored. */
let vaultKey = null;

const walletCache = new Map();
const connectCache = new Map();

/**
 * StorageAdapter-shaped wrapper over chrome.storage.local. Keys passed in are
 * already fully-qualified (`account-<id>:…` / `shared:…`), so this adds no
 * prefix — it only bridges the {get(key,default), set, remove} shape the shared
 * clients are written against onto the raw chrome.storage.local API.
 */
const storage = {
  async get(key, defaultValue = null) {
    const result = await chrome.storage.local.get(key);
    return key in result ? result[key] : defaultValue;
  },
  async set(key, value) {
    await chrome.storage.local.set({ [key]: value });
  },
  async remove(key) {
    await chrome.storage.local.remove(key);
  },
};

function getWallet(accountId) {
  if (!walletCache.has(accountId)) {
    walletCache.set(accountId, new NileWallet({ storage, accountId }));
  }
  return walletCache.get(accountId);
}

/* -------------------------------------------------------------------------- */
/* Vault (single passphrase → cached key)                                      */
/* -------------------------------------------------------------------------- */

async function getVaultConfig() {
  return await storage.get(VAULT_STORAGE_KEY, null);
}

/** The cached key, or a `needs-unlock` error the UI can catch. */
function requireKey() {
  if (!vaultKey) throw new Error("needs-unlock");
  return vaultKey;
}

/**
 * Unlock the vault. First call (no config) sets it up: generate a stable salt,
 * derive the key, store a check token. Later calls verify the passphrase
 * against that token. On success the derived key is cached in memory.
 */
async function unlockVault(password) {
  if (!password) throw new Error("Passphrase required");

  let config = await getVaultConfig();

  if (!config) {
    const salt = Encrypter.generateSalt();
    const key = await Encrypter.scryptPass(password, salt);
    const check = await Encrypter.encryptWithKey({
      data: VAULT_CHECK_PLAINTEXT,
      key,
    });
    await storage.set(VAULT_STORAGE_KEY, { salt, check });
    vaultKey = key;
    return { configured: true, unlocked: true, created: true };
  }

  const key = await Encrypter.scryptPass(password, config.salt);
  try {
    const decrypted = await Encrypter.decryptWithKey({
      encrypted: config.check,
      key,
    });
    if (decrypted !== VAULT_CHECK_PLAINTEXT) throw new Error("mismatch");
  } catch (e) {
    throw new Error("bad-passphrase");
  }

  vaultKey = key;
  return { configured: true, unlocked: true, created: false };
}

/* -------------------------------------------------------------------------- */
/* Key material                                                                */
/* -------------------------------------------------------------------------- */

/** Decrypt the account's mnemonic (requires unlock) and derive its keypair. */
async function getKeyPair(accountId) {
  const key = requireKey();
  const wallet = getWallet(accountId);
  const stored = await wallet.load();

  if (!stored?.encrypted) throw new Error("No wallet for this account");

  const phrase = await wallet.decryptSeed(stored.encrypted, key);
  const keyPair = await mnemonicToPrivateKey(phrase.split(" "));
  const contract = WalletContractV4.create({
    workchain: 0,
    publicKey: keyPair.publicKey,
  });

  return { keyPair, phrase, contract };
}

/* -------------------------------------------------------------------------- */
/* TON Connect                                                                 */
/* -------------------------------------------------------------------------- */

/** Forward an inbound bridge request to the NileChain window(s). */
function forwardRequest(accountId, request) {
  chrome.runtime
    .sendMessage({ action: "nile-wallet.connect.request", accountId, request })
    .catch(() => {
      /* no receiver (window closed) — safe to ignore */
    });
}

/**
 * One long-lived NileWalletConnect per account so its bridge EventSource stays
 * alive across messages. Built bare (no keypair) — subscribe/restore/reject
 * don't need the account key; approve attaches it lazily via {@link ensureKeys}.
 */
function getConnect(accountId) {
  if (!connectCache.has(accountId)) {
    connectCache.set(
      accountId,
      new NileWalletConnect({
        storage,
        accountId,
        onRequest: (request) => forwardRequest(accountId, request),
      }),
    );
  }
  return connectCache.get(accountId);
}

/** Attach the account's signing keypair to a connect instance (requires unlock). */
async function ensureKeys(connect, accountId) {
  if (!connect.keyPair) {
    const { keyPair, contract } = await getKeyPair(accountId);
    connect.keyPair = keyPair;
    connect.wallet = contract;
  }
  return connect;
}

/**
 * Re-subscribe every account that has persisted TON Connect sessions. Runs at
 * SW startup — needs no vault key (each session already stores its own x25519
 * secret), so connections survive reloads without re-approving.
 */
async function restoreAllSessions() {
  const all = await chrome.storage.local.get(null);
  const suffix = ":nile-wallet:sessions";

  for (const key of Object.keys(all)) {
    if (!key.startsWith("account-") || !key.endsWith(suffix)) continue;
    const sessions = all[key];
    if (!sessions || !Object.keys(sessions).length) continue;

    const accountId = key.slice("account-".length, key.length - suffix.length);
    try {
      await getConnect(accountId).subscribe();
    } catch (e) {
      console.error("NileWallet restore failed for", accountId, e);
    }
  }
}

/* -------------------------------------------------------------------------- */
/* Transfers                                                                   */
/* -------------------------------------------------------------------------- */

/**
 * Validate a transfer request and normalize it. `kind` is "ton" or "jetton";
 * `amount` is a user-typed decimal string; `token` is the stored token record
 * for Jetton sends. Returns the parsed raw amount + the token record.
 */
function resolveSendParams(wallet, message) {
  const { kind, token, to, amount } = message;

  try {
    Address.parse(to);
  } catch {
    throw new Error("Invalid recipient address");
  }
  if (!amount) throw new Error("Enter an amount");

  let raw;
  let jetton = null;
  if (kind === "jetton") {
    if (!token?.jetton_wallet_address) throw new Error("Token not tracked");
    raw = wallet.parseAmountToRaw(amount, Number(token.decimals) || 9);
    jetton = token;
  } else {
    raw = wallet.parseAmountToRaw(amount, 9);
  }
  if (raw <= 0n) throw new Error("Amount must be greater than zero");

  return { to, raw, jetton };
}

async function handleTransferEstimate(accountId, message) {
  const wallet = getWallet(accountId);
  const { contract, keyPair } = await getKeyPair(accountId);
  const params = resolveSendParams(wallet, message);

  const { cell } = await wallet.buildSignedTransfer({
    contract,
    keyPair,
    to: params.to,
    amountRaw: params.raw,
    jetton: params.jetton,
  });
  const feeNano = await wallet.estimateTransferFee(
    contract.address.toString(),
    cell,
  );
  const funds = await wallet.checkTransferFunds({
    contract,
    amountRaw: params.raw,
    jetton: params.jetton,
    feeNano,
  });

  return {
    status: true,
    to: params.to,
    amountRaw: params.raw.toString(),
    feeNano: feeNano.toString(),
    insufficient: funds.sufficient ? null : funds.reason,
    tonBalanceRaw: funds.tonBalanceRaw,
    jettonBalanceRaw: funds.jettonBalanceRaw,
  };
}

async function handleTransferSend(accountId, message) {
  const wallet = getWallet(accountId);
  const { contract, keyPair } = await getKeyPair(accountId);
  const params = resolveSendParams(wallet, message);

  const { cell, seqno } = await wallet.buildSignedTransfer({
    contract,
    keyPair,
    to: params.to,
    amountRaw: params.raw,
    jetton: params.jetton,
  });
  const feeNano = await wallet.estimateTransferFee(
    contract.address.toString(),
    cell,
  );
  const funds = await wallet.checkTransferFunds({
    contract,
    amountRaw: params.raw,
    jetton: params.jetton,
    feeNano,
  });
  if (!funds.sufficient) throw new Error(funds.reason);

  const { hash } = await wallet.broadcastTransfer(cell);
  let status = "pending";
  try {
    await wallet.waitForSeqnoChange(contract.address.toString(), seqno);
    status = "confirmed";
  } catch {
    /* broadcast accepted; confirmation may lag — report as pending */
  }

  return { status: true, hash, txStatus: status, seqno };
}

/* -------------------------------------------------------------------------- */
/* Backup / Restore                                                            */
/* -------------------------------------------------------------------------- */

/** Every account id currently registered with the NileChain core. */
async function listAccountIds() {
  const accounts = await storage.get(ACCOUNTS_STORAGE_KEY, []);
  if (!Array.isArray(accounts)) return [];
  return accounts
    .filter((a) => a && typeof a.id === "string" && a.id)
    .map((a) => a.id);
}

/**
 * Verify a typed passphrase against the vault check token WITHOUT persisting
 * anything. The scrypt key is derived and discarded — never cached/logged.
 */
async function assertVaultPassword(password) {
  if (!password) throw new Error("Passphrase required");
  const config = await getVaultConfig();
  if (!config) throw new Error("Vault not configured");
  const key = await Encrypter.scryptPass(password, config.salt);
  let decrypted;
  try {
    // AES-GCM throws a raw DOMException on a bad key — normalize it.
    decrypted = await Encrypter.decryptWithKey({
      encrypted: config.check,
      key,
    });
  } catch {
    throw new Error("bad-passphrase");
  }
  if (decrypted !== VAULT_CHECK_PLAINTEXT) throw new Error("bad-passphrase");
}

/**
 * Validate a backup file's structure before touching anything. Rejects
 * malformed files up front so a bad import can never partially write.
 */
function parseBackup(json) {
  let data;
  try {
    data = JSON.parse(json);
  } catch {
    throw new Error("Not a valid backup file");
  }
  if (!data || data.type !== "nilewallet-backup") {
    throw new Error("Not a NileWallet backup file");
  }
  if (data.version !== BACKUP_VERSION) {
    throw new Error(`Unsupported backup version: ${data.version}`);
  }
  if (typeof data.salt !== "string" || !data.salt) {
    throw new Error("Backup is missing its encryption salt");
  }
  if (!Array.isArray(data.entries) || data.entries.length === 0) {
    throw new Error("Backup contains no wallets");
  }

  data.entries.forEach((entry, index) => {
    const label = `Entry ${index + 1}`;
    if (!entry || typeof entry !== "object") throw new Error(`${label}: invalid`);
    if (typeof entry.account_id !== "string" || !entry.account_id) {
      throw new Error(`${label}: missing account_id`);
    }
    if (typeof entry.mnemonic_encrypted !== "string" || !entry.mnemonic_encrypted) {
      throw new Error(`${label}: missing encrypted mnemonic`);
    }
    if (typeof entry.address !== "string" || !entry.address) {
      throw new Error(`${label}: missing address`);
    }
    try {
      Address.parse(entry.address);
    } catch {
      throw new Error(`${label}: invalid address`);
    }
    if (entry.added_tokens !== undefined && !Array.isArray(entry.added_tokens)) {
      throw new Error(`${label}: invalid added_tokens`);
    }
  });

  return data;
}

/**
 * Decrypt + integrity-check one backup entry: mnemonic checksum must pass and
 * the derived address must equal the recorded one (tamper detection).
 */
async function decryptBackupEntry(entry, password, salt) {
  let phrase;
  try {
    phrase = await getWallet(entry.account_id).decryptFromBackup(
      entry.mnemonic_encrypted,
      password,
      salt,
    );
  } catch {
    throw new Error("Wrong passphrase or corrupted backup");
  }

  const derived = await getWallet(entry.account_id).importFromPhrase(phrase);
  const recorded = Address.parse(entry.address);
  if (!Address.parse(derived.address).equals(recorded)) {
    throw new Error("Backup entry address does not match its mnemonic");
  }
  return phrase;
}

/** Export every stored wallet as a passphrase-encrypted JSON backup + download. */
async function handleWalletBackup(message) {
  // Vault must be unlocked (need the in-memory key to decrypt stored seeds),
  // and the typed passphrase must match it — the backup is encrypted with a
  // key derived from that passphrase so the file is portable by itself.
  const vaultKey = requireKey();
  await assertVaultPassword(message.password);

  const salt = Encrypter.generateSalt();
  const entries = [];

  for (const id of await listAccountIds()) {
    const wallet = getWallet(id);
    const stored = await wallet.load();
    if (!stored?.encrypted) continue; // account has no NileWallet

    // Decrypt with the cached vault key, re-encrypt with the passphrase key.
    const phrase = await wallet.decryptSeed(stored.encrypted, vaultKey);
    const mnemonic_encrypted = await wallet.encryptForBackup(
      phrase,
      message.password,
      salt,
    );

    entries.push({
      account_id: id,
      farm_id: null, // the fixture currently has no farm grouping
      address: stored.address,
      chain: BACKUP_CHAIN,
      mnemonic_encrypted,
      added_tokens: await wallet.listTokens(),
    });
  }

  if (entries.length === 0) throw new Error("No wallets to back up");

  const backup = {
    version: BACKUP_VERSION,
    type: "nilewallet-backup",
    created_at: Date.now(),
    salt,
    entries,
  };

  const now = new Date();
  const date = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
  const filename = `nilewallet-backup-${date}.json`;

  // Download via the extension's download API using a data: URL — service
  // workers don't reliably support URL.createObjectURL, but data: URLs are
  // self-contained and work everywhere. If the API is unavailable or fails,
  // hand the JSON back to the UI so it can save the file itself.
  if (typeof chrome.downloads?.download === "function") {
    const json = JSON.stringify(backup, null, 2);
    const dataUrl = `data:application/json;base64,${utf8ToBase64(json)}`;
    try {
      await chrome.downloads.download({ url: dataUrl, filename, saveAs: true });
      return { status: true, filename, count: entries.length };
    } catch {
      /* fall through to UI-side download */
    }
  }

  return {
    status: true,
    filename,
    count: entries.length,
    json: JSON.stringify(backup),
  };
}

/** Decrypt + validate a backup without writing anything (preview). */
async function handleRestorePreview(message) {
  const backup = parseBackup(message.json);
  const entries = [];

  for (const entry of backup.entries) {
    await decryptBackupEntry(entry, message.password, backup.salt);
    const existing = await getWallet(entry.account_id).load();
    entries.push({
      account_id: entry.account_id,
      address: entry.address,
      chain: entry.chain || BACKUP_CHAIN,
      token_count: Array.isArray(entry.added_tokens) ? entry.added_tokens.length : 0,
      exists: Boolean(existing?.encrypted),
    });
  }

  return { status: true, created_at: backup.created_at, entries };
}

/** Write a validated backup into chrome.storage.local, honoring overwrite consent. */
async function handleRestoreApply(message) {
  // Storing requires re-encrypting with the vault key, so the vault must be
  // unlocked. The typed passphrase is used only to decrypt the backup.
  const vaultKey = requireKey();
  const backup = parseBackup(message.json);
  const overwrite = message.overwrite || {};

  let restored = 0;
  let skipped = 0;

  for (const entry of backup.entries) {
    const wallet = getWallet(entry.account_id);
    const existing = await wallet.load();

    if (existing?.encrypted && overwrite[entry.account_id] !== true) {
      skipped++; // wallet exists and wasn't confirmed for overwrite
      continue;
    }

    const phrase = await decryptBackupEntry(entry, message.password, backup.salt);
    const derived = await wallet.importFromPhrase(phrase);
    const encrypted = await wallet.encryptSeed(phrase, vaultKey);

    await wallet.save({
      address: derived.address,
      rawAddress: derived.rawAddress,
      publicKey: derived.publicKey,
      encrypted,
    });
    await storage.set(
      `account-${entry.account_id}:nile-wallet:tokens`,
      Array.isArray(entry.added_tokens) ? entry.added_tokens : [],
    );
    restored++;
  }

  return { status: true, restored, skipped };
}

/* -------------------------------------------------------------------------- */
/* Message handling                                                            */
/* -------------------------------------------------------------------------- */

export async function handleWalletMessage(message) {
  const accountId = message.accountId;

  switch (message.action) {
    /* ---- vault ---- */
    case "nile-wallet.vault-status": {
      const config = await getVaultConfig();
      return { configured: Boolean(config), unlocked: Boolean(vaultKey) };
    }

    case "nile-wallet.unlock":
      return await unlockVault(message.password);

    case "nile-wallet.lock": {
      vaultKey = null;
      return { status: true };
    }

    /* ---- wallet ---- */
    case "nile-wallet.get": {
      const wallet = getWallet(accountId);
      const stored = await wallet.load();
      return {
        status: Boolean(stored),
        address: stored?.address || null,
        rawAddress: stored?.rawAddress || null,
        publicKey: stored?.publicKey || null,
        platform: stored?.platform || "v4r2",
      };
    }

    case "nile-wallet.generate": {
      const key = requireKey();
      const wallet = getWallet(accountId);
      const stored = await wallet.load();
      if (stored?.encrypted) throw new Error("Wallet already exists");

      const { phrase, address, rawAddress, publicKey } =
        await wallet.generate();
      const encrypted = await wallet.encryptSeed(phrase, key);

      await wallet.save({ address, rawAddress, publicKey, encrypted });
      return { status: true, address, rawAddress, publicKey };
    }

    case "nile-wallet.import": {
      const key = requireKey();
      const wallet = getWallet(accountId);
      const stored = await wallet.load();
      if (stored?.encrypted) throw new Error("Wallet already exists");

      // Validates (24 words + checksum) before deriving anything. Never logs
      // or persists the plaintext phrase — only the encrypted seed is stored.
      const { phrase, address, rawAddress, publicKey } =
        await wallet.importFromPhrase(message.phrase);
      const encrypted = await wallet.encryptSeed(phrase, key);

      await wallet.save({ address, rawAddress, publicKey, encrypted });
      return { status: true, address, rawAddress, publicKey };
    }

    case "nile-wallet.reveal-seed": {
      const key = requireKey();
      const wallet = getWallet(accountId);
      const stored = await wallet.load();
      if (!stored?.encrypted) throw new Error("No wallet for this account");
      const phrase = await wallet.decryptSeed(stored.encrypted, key);
      return { phrase };
    }

    case "nile-wallet.clear": {
      const wallet = getWallet(accountId);
      await wallet.clear();
      // Drop any live bridge connection for this account.
      const connect = connectCache.get(accountId);
      if (connect) {
        connect.unsubscribe();
        connectCache.delete(accountId);
      }
      return { status: true };
    }

    case "nile-wallet.balance": {
      const wallet = getWallet(accountId);
      const stored = await wallet.load();
      if (!stored?.address) return { balance: "0", error: "no-wallet" };
      const balance = await wallet.getBalance(stored.address);
      return { balance };
    }

    /* ---- custom tokens (Jettons) ---- */
    case "nile-wallet.tokens.list": {
      const wallet = getWallet(accountId);
      return { status: true, tokens: await wallet.listTokens() };
    }

    case "nile-wallet.token.add": {
      const wallet = getWallet(accountId);
      const token = await wallet.addToken(message.address);
      return { status: true, token };
    }

    case "nile-wallet.token.remove": {
      const wallet = getWallet(accountId);
      await wallet.removeToken(message.address);
      return { status: true };
    }

    case "nile-wallet.token.balance": {
      const wallet = getWallet(accountId);
      const token = message.token;
      const balance = await wallet.getJettonBalance(token.jetton_wallet_address);
      return {
        status: true,
        jetton_master_address: token.jetton_master_address,
        balance,
      };
    }

    /* ---- transfers ---- */
    case "nile-wallet.transfer.estimate":
      return await handleTransferEstimate(accountId, message);

    case "nile-wallet.transfer.send":
      return await handleTransferSend(accountId, message);

    /* ---- backup / restore ---- */
    case "nile-wallet.backup":
      return await handleWalletBackup(message);

    case "nile-wallet.restore.preview":
      return await handleRestorePreview(message);

    case "nile-wallet.restore.apply":
      return await handleRestoreApply(message);

    /* ---- TON Connect ---- */
    case "nile-wallet.connect.parse-link": {
      const connect = getConnect(accountId);
      const prepared = await connect.prepareConnectRequest(message.link);
      return { status: true, prepared };
    }

    case "nile-wallet.connect.approve": {
      const connect = getConnect(accountId);
      await ensureKeys(connect, accountId);
      const result = await connect.approve(message.prepared || message.request);
      return { status: true, ...result };
    }

    case "nile-wallet.connect.reject": {
      const connect = getConnect(accountId);
      await connect.reject(message.prepared || message.request);
      return { status: true };
    }

    case "nile-wallet.connect.disconnect": {
      const connect = getConnect(accountId);
      await connect.disconnect(message.dAppPubKey);
      return { status: true };
    }

    case "nile-wallet.connect.subscribe":
    case "nile-wallet.connect.restore": {
      const connect = getConnect(accountId);
      const clientIds = await connect.subscribe();
      return { status: true, clientIds };
    }

    case "nile-wallet.connect.sessions": {
      const connect = getConnect(accountId);
      const sessions = await connect.loadSessions();
      return {
        status: true,
        sessions: Object.values(sessions).map((s) => ({
          dAppPubKey: s.dAppPubKey,
          manifest: s.manifest,
          connectedAt: s.connectedAt,
        })),
      };
    }

    /* ---- Injected window.tonconnect provider (JS bridge) --------------- */

    /**
     * tonconnect.connect → handle connect from the injected provider.
     * Unlike the HTTP bridge flow, no `prepareConnectRequest` is needed — the
     * dApp calls connect() directly.  We build the connect items, return them
     * to the provider, and persist a minimal session so follow-up send calls
     * work.
     */
    case "nile-wallet.connect.injected-connect": {
      const connect = getConnect(accountId);
      await ensureKeys(connect, accountId);

      const protocol = message.protocol || "tonconnect";
      const messageObj = message.message || {};
      const requestedItems = messageObj.items || [{ name: "ton_addr" }];
      const manifest = messageObj.manifest || {};
      const domain = (() => {
        try { return new URL(manifest.url || "").host; } catch { return manifest.name || ""; }
      })();

      const items = await connect.buildConnectItems(requestedItems, domain);
      const device = connect.getDeviceInfo();

      // The address for the connect response
      const addressItem = items.find((i) => i.name === "ton_addr");
      const address = addressItem?.address || connect.wallet.address.toRawString();
      const publicKey = addressItem?.publicKey || connect.keyPair.publicKey.toString("hex");
      const walletStateInit = addressItem?.walletStateInit || connect.getStateInit();

      return {
        status: true,
        address,
        publicKey,
        walletStateInit,
        items,
        device,
      };
    }

    /**
     * tonconnect.send → forward a sendTransaction request from the dApp to the
     * NileChain window for user approval.  Returns a promise that resolves
     * when the user approves/rejects via the UI confirmation dialog.
     */
    case "nile-wallet.connect.injected-send": {
      const dAppRequest = message.message;

      if (!dAppRequest) throw new Error("Missing transaction message");

      const requestId = dAppRequest.id || String(Date.now());

      // Build a request object matching what the bridge flow sends
      const requestPayload = {
        method: "sendTransaction",
        id: requestId,
        params: Array.isArray(dAppRequest.params) ? dAppRequest.params : [dAppRequest],
      };

      // Forward to the NileChain window(s) for approval — this is a long-
      // lived promise that resolves when the user clicks approve/reject.
      const result = await new Promise((resolve, reject) => {
        // Store pending request so the UI can resolve it
        if (!globalThis._pendingInjectedRequests) globalThis._pendingInjectedRequests = new Map();
        globalThis._pendingInjectedRequests.set(requestId, {
          resolve,
          reject,
          accountId,
          requestPayload,
        });

        // Forward to all NileChain windows
        forwardRequest(accountId, {
          transport: "injected",
          request: requestPayload,
        });

        // Timeout after 5 minutes
        setTimeout(() => {
          if (globalThis._pendingInjectedRequests?.has(requestId)) {
            globalThis._pendingInjectedRequests.delete(requestId);
            reject(new Error("User approval timed out"));
          }
        }, 300000);
      });

      return { status: true, ...result };
    }

    /**
     * tonconnect.disconnect → clean up any active session for this account.
     */
    case "nile-wallet.connect.injected-disconnect": {
      // For injected provider, there's no bridge session to tear down.
      // Just acknowledge.
      return { status: true };
    }

    /**
     * tonconnect.restoreConnection → check if we have a wallet and return
     * its address so the dApp can re-establish state.
     */
    case "nile-wallet.connect.injected-restore": {
      const wallet = getWallet(accountId);
      const stored = await wallet.load();
      if (!stored?.address) {
        return { status: false, error: "no-wallet" };
      }

      // Try to get keypair for publicKey
      let publicKey = stored.publicKey || null;
      let walletStateInit = null;
      try {
        const kp = await getKeyPair(accountId);
        const contract = kp.contract;
        walletStateInit = beginCell()
          .store(storeStateInit(contract.init))
          .endCell()
          .toBoc()
          .toString("base64");
        publicKey = kp.keyPair.publicKey.toString("hex");
      } catch {
        // vault locked — return what we have
      }

      return {
        status: true,
        address: stored.rawAddress || stored.address,
        publicKey,
        walletStateInit,
      };
    }

    /**
     * Resolve an injected sendTransaction approval/rejection from the UI.
     * Called by NileWalletConnectModal when the user clicks approve/reject.
     */
    case "nile-wallet.connect.injected-approve": {
      const pending = globalThis._pendingInjectedRequests?.get(message.requestId);
      if (!pending) throw new Error("No pending request for " + message.requestId);

      globalThis._pendingInjectedRequests.delete(message.requestId);

      if (message.rejected) {
        pending.reject(new Error("User rejected the transaction"));
        return { status: true };
      }

      // The user approved — build, sign, and broadcast the transaction.
      try {
        const wallet = getWallet(pending.accountId);
        const { contract, keyPair } = await getKeyPair(pending.accountId);
        const txParams = pending.requestPayload?.params?.[0] || {};
        const messages = txParams.messages || [];

        if (!messages.length) throw new Error("No messages in transaction");

        // Build output messages for WalletContractV4.createTransfer
        const outMessages = [];
        for (const msg of messages) {
          const addr = Address.parse(msg.address);
          const amount = BigInt(msg.amount || "0");

          // Decode the payload cell if provided (hex or base64 BOC)
          let body = beginCell().endCell();
          if (msg.payload) {
            try {
              const { Cell } = await import("@ton/core");
              body = Cell.fromHex(msg.payload);
            } catch {
              try {
                const { Cell } = await import("@ton/core");
                body = Cell.fromBase64(msg.payload);
              } catch { /* empty body */ }
            }
          }

          outMessages.push({
            to: addr,
            value: { coins: amount },
            body,
          });
        }

        const seqno = await wallet.getSeqno(contract.address.toString());
        const transfer = contract.createTransfer({
          seqno,
          messages: outMessages,
          sendMode: 0,
        });

        const signed = transfer.sign(keyPair.secretKey);
        const boc = signed.toBoc().toString("base64");
        const { hash } = await wallet.broadcastTransfer(signed);

        pending.resolve({ status: "ok", result: { boc, hash } });
      } catch (signError) {
        pending.reject(signError);
      }

      return { status: true };
    }

    default:
      throw new Error(`Unknown action: ${message.action}`);
  }
}

export function setupNileWalletBackground() {
  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    // Only handle our own actions; let other listeners own everything else.
    if (!message?.action?.startsWith("nile-wallet.")) return false;

    handleWalletMessage(message)
      .then((result) => sendResponse({ ok: true, ...result }))
      .catch((error) =>
        sendResponse({ ok: false, error: error?.message || String(error) }),
      );

    // Keep the messaging channel open for the async response.
    return true;
  });

  // Restore persisted bridge sessions on every cold start.
  restoreAllSessions().catch((e) =>
    console.error("NileWallet session restore failed:", e),
  );
}
