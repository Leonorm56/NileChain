import Encrypter from "./Encrypter.js";
import {
  Address,
  beginCell,
  Cell,
  external,
  internal,
  storeMessage,
  SendMode,
} from "@ton/core";
import { WalletContractV4 } from "@ton/ton";
import {
  mnemonicNew,
  mnemonicToPrivateKey,
  mnemonicValidate,
} from "@ton/crypto";

const WALLET_VERSION = "v4r2";
const TONCENTER_RPC = "https://toncenter.com/api/v2/jsonRPC";

/** TON attached to the Jetton wallet so it can process the transfer + notify. */
const JETTON_TRANSFER_ATTACHED_TON = 50000000n;
/** TON forwarded to the recipient's Jetton wallet to notify it of the transfer. */
const JETTON_FORWARD_TON = 10000000n;

/**
 * NileWallet
 *
 * A fully local TON wallet scoped per account. Generation, encryption and
 * TON Connect sessions live in the MV3 service worker only — no crypto logic
 * ever runs inside the mini-app DOM.
 *
 * The mnemonic is encrypted with a raw AES-GCM key derived once from the
 * single vault passphrase (see the service-worker vault). Each account keeps
 * its own separate mnemonic — only the KDF passphrase is shared.
 */
export default class NileWallet {
  constructor({ storage, accountId }) {
    this.storage = storage;
    this.accountId = accountId;
    this.storageKey = `account-${accountId}:nile-wallet`;
    this.sessionsKey = `account-${accountId}:nile-wallet:sessions`;
    this.tokensKey = `account-${accountId}:nile-wallet:tokens`;
  }

  /** Generate a fresh mnemonic + WalletV4R2 */
  async generate() {
    const mnemonic = await mnemonicNew();
    const phrase = mnemonic.join(" ");
    const wallet = await this.fromPhrase(phrase);
    return { phrase, ...wallet };
  }

  /** Derive wallet from a mnemonic phrase */
  async fromPhrase(phrase) {
    const keyPair = await mnemonicToPrivateKey(phrase.split(" "));
    const wallet = WalletContractV4.create({
      workchain: 0,
      publicKey: keyPair.publicKey,
    });

    return {
      address: wallet.address.toString({ bounceable: false }),
      rawAddress: wallet.address.toRawString(),
      publicKey: keyPair.publicKey.toString("hex"),
    };
  }

  /**
   * Validate + import an existing wallet from a user-pasted recovery phrase.
   *
   * Mirrors {@link generate}: the phrase is validated with @ton/crypto's
   * `mnemonicValidate` before any key material is derived, then the wallet is
   * derived the exact same way — WalletContractV4 (v4r2), workchain 0.
   *
   * NOTE(correctness): the contract version must match the wallet the phrase
   * was exported from. Both v3r2 and v4r2 exist in the wild; deriving with the
   * wrong version produces a *different* address despite a valid mnemonic.
   * This imports as v4r2 (matching every wallet NileWallet has ever created),
   * but if a phrase came from a V3R2 wallet the imported address won't match.
   *
   * @param {string} phrase space-separated 24 words
   * @returns {Promise<{phrase: string, address: string, rawAddress: string, publicKey: string}>}
   * @throws {Error} "Invalid recovery phrase" on poor word count or checksum
   */
  async importFromPhrase(phrase) {
    const words = String(phrase).trim().split(/\s+/).filter(Boolean);
    if (words.length !== 24) {
      throw new Error("Recovery phrase must contain exactly 24 words");
    }
    const valid = await mnemonicValidate(words);
    if (!valid) throw new Error("Invalid recovery phrase");

    return await this.fromPhrase(words.join(" "));
  }

  /**
   * Encrypt the mnemonic before persisting.
   * @param {string} phrase - the 24-word mnemonic
   * @param {Uint8Array} key - the raw vault key (derived once from the passphrase)
   * @returns {Promise<string>} base64 ciphertext bundle
   */
  async encryptSeed(phrase, key) {
    return await Encrypter.encryptWithKey({ data: phrase, key });
  }

  /**
   * Decrypt the stored mnemonic.
   * @param {string} encrypted - base64 ciphertext bundle
   * @param {Uint8Array} key - the raw vault key
   * @returns {Promise<string>} the plaintext mnemonic
   */
  async decryptSeed(encrypted, key) {
    return await Encrypter.decryptWithKey({ encrypted, key });
  }

  /** Persist wallet metadata (never the plaintext seed) */
  async save(wallet) {
    await this.storage.set(this.storageKey, {
      platform: WALLET_VERSION,
      ...wallet,
    });
    return wallet;
  }

  /** Load wallet metadata (address, encrypted seed) */
  async load() {
    return await this.storage.get(this.storageKey, null);
  }

  /** Remove wallet (metadata + any TON Connect sessions) */
  async clear() {
    await this.storage.remove(this.storageKey);
    await this.storage.remove(this.sessionsKey);
  }

  /**
   * Live balance in TON. Tries tonapi.io first, falls back to toncenter.
   * @param {string} address
   * @returns {Promise<string>} balance as a decimal string
   */
  async getBalance(address) {
    try {
      return await this.getBalanceFromTonapi(address);
    } catch (error) {
      return await this.getBalanceFromToncenter(address);
    }
  }

  /** Balance via tonapi.io */
  async getBalanceFromTonapi(address) {
    const res = await fetch(`https://tonapi.io/v2/accounts/${address}`);
    if (!res.ok) throw new Error(`tonapi balance failed ${res.status}`);
    const data = await res.json();
    return this.nanoToTon(data.balance || 0);
  }

  /** Balance via toncenter (fallback) */
  async getBalanceFromToncenter(address) {
    const res = await fetch(
      `https://toncenter.com/api/v2/getAddressBalance?address=${encodeURIComponent(
        address,
      )}`,
    );
    if (!res.ok) throw new Error(`toncenter balance failed ${res.status}`);
    const data = await res.json();
    if (!data.ok) throw new Error("toncenter balance error");
    return this.nanoToTon(data.result || 0);
  }

  /** Convert nanotons → TON with 9 decimal places, trimmed */
  nanoToTon(nano) {
    const value = BigInt(nano);
    const whole = value / 1000000000n;
    const fraction = (value % 1000000000n).toString().padStart(9, "0");
    const trimmed = fraction.replace(/0+$/, "");
    return trimmed ? `${whole}.${trimmed}` : whole.toString();
  }

  /* ------------------------------------------------------------------ */
  /* Custom tokens (Jettons)                                             */
  /* ------------------------------------------------------------------ */

  /** Load the list of tracked Jettons for this account. */
  async listTokens() {
    return (await this.storage.get(this.tokensKey, [])) || [];
  }

  /**
   * Validate a pasted Jetton master address and fetch its metadata
   * (name, symbol, decimals, icon) from tonapi.io.
   * @param {string} address
   * @returns {Promise<{address:string,name:string,symbol:string,decimals:number,icon_url:string|null}>}
   */
  async getJettonInfo(address) {
    let parsed;
    try {
      parsed = Address.parse(address);
    } catch {
      throw new Error("Invalid address format");
    }
    const res = await fetch(`https://tonapi.io/v2/jettons/${parsed.toString()}`);
    if (res.status === 404) throw new Error("Not a valid Jetton");
    if (!res.ok) throw new Error(`Jetton lookup failed ${res.status}`);
    const data = await res.json();
    const meta = data.metadata || {};

    return {
      address: parsed.toString({ bounceable: false }),
      name: meta.name || "Unknown Token",
      symbol: meta.symbol || "TOKEN",
      decimals: Number(meta.decimals ?? 9) || 9,
      icon_url: meta.image || null,
    };
  }

  /**
   * Derive this account's Jetton wallet address for a Jetton master.
   * Runs the master's `get_wallet_address` get-method via toncenter —
   * the Jetton wallet is the contract that actually holds the balance.
   * @param {string} masterAddress
   * @param {string} ownerAddress the NileWallet account address
   * @returns {Promise<string>} bounceable Jetton wallet address
   */
  async deriveJettonWalletAddress(masterAddress, ownerAddress) {
    const argCell = beginCell()
      .storeAddress(Address.parse(ownerAddress))
      .endCell();
    const sliceB64 = argCell.toBoc().toString("base64");

    const res = await fetch("https://toncenter.com/api/v3/runGetMethod", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        address: masterAddress,
        method: "get_wallet_address",
        stack: [{ type: "slice", value: sliceB64 }],
      }),
    });
    if (!res.ok) throw new Error(`Jetton wallet lookup failed ${res.status}`);
    const data = await res.json();
    if (data.exit_code !== 0 || !data.stack?.length) {
      throw new Error("Not a valid Jetton master");
    }

    const resultCell = Cell.fromBoc(
      Buffer.from(data.stack[0].value, "base64"),
    )[0];
    const jettonWallet = resultCell.beginParse().loadAddress();
    return jettonWallet.toString({ bounceable: true });
  }

  /**
   * Track a Jetton for this account. Persists metadata + the derived
   * per-account Jetton wallet address in chrome.storage.local.
   * @param {string} masterAddress
   * @returns {Promise<object>} the stored token record
   */
  async addToken(masterAddress) {
    const wallet = await this.load();
    if (!wallet?.address) throw new Error("Create a wallet first");

    const info = await this.getJettonInfo(masterAddress);
    const jettonWalletAddress = await this.deriveJettonWalletAddress(
      info.address,
      wallet.address,
    );

    const record = {
      jetton_master_address: info.address,
      jetton_wallet_address: jettonWalletAddress,
      symbol: info.symbol,
      name: info.name,
      decimals: info.decimals,
      icon_url: info.icon_url,
      added_at: Date.now(),
    };

    const tokens = await this.listTokens();
    const existing = tokens.findIndex(
      (t) =>
        t.jetton_master_address === info.address ||
        (() => {
          try {
            return (
              Address.parse(t.jetton_master_address).equals(
                Address.parse(info.address),
              )
            );
          } catch {
            return false;
          }
        })(),
    );
    if (existing >= 0) tokens[existing] = record;
    else tokens.push(record);

    await this.storage.set(this.tokensKey, tokens);
    return record;
  }

  /** Stop tracking a Jetton (does not touch on-chain balance). */
  async removeToken(masterAddress) {
    let target;
    try {
      target = Address.parse(masterAddress);
    } catch {
      target = null;
    }

    const tokens = await this.listTokens();
    const next = tokens.filter((t) => {
      try {
        const existing = Address.parse(t.jetton_master_address);
        if (target) return !existing.equals(target);
        return t.jetton_master_address !== masterAddress;
      } catch {
        return t.jetton_master_address !== masterAddress;
      }
    });
    await this.storage.set(this.tokensKey, next);
    return { status: true };
  }

  /**
   * Live balance (in raw token units) for a Jetton wallet address.
   * Uses tonapi.io's jetton balances endpoint keyed by the owner address,
   * which returns the real token balance (not the contract's TON balance).
   * @param {string} jettonWalletAddress
   * @param {string} [ownerAddress] the wallet owner — if omitted, derived from storage
   * @returns {Promise<string>} raw balance as decimal string
   */
  async getJettonBalance(jettonWalletAddress, ownerAddress, masterAddress) {
    if (!ownerAddress) {
      const wallet = await this.load();
      ownerAddress = wallet?.address;
    }
    if (!ownerAddress) throw new Error("Owner address required for jetton balance");

    const parsed = Address.parse(ownerAddress);
    const res = await fetch(
      `https://tonapi.io/v2/accounts/${parsed.toString()}/jettons`,
    );
    if (!res.ok) throw new Error(`Jetton balance failed ${res.status}`);
    const data = await res.json();
    const jettons = data?.balances || data?.jettons || [];

    let targetHash;
    try {
      targetHash = Address.parse(jettonWalletAddress).hash.toString("hex");
    } catch {
      targetHash = null;
    }
    let masterHash;
    if (masterAddress) {
      try {
        masterHash = Address.parse(masterAddress).hash.toString("hex");
      } catch {
        masterHash = null;
      }
    }

    for (const j of jettons) {
      if (masterHash) {
        const jMaster = j.jetton?.address || j.jetton_address || j.master_address;
        if (jMaster) {
          try {
            if (Address.parse(jMaster).hash.toString("hex") === masterHash) {
              return String(j.balance ?? j.amount ?? 0);
            }
          } catch { /* skip */ }
        }
      }
      if (targetHash) {
        const jWallet = j.wallet_address;
        if (jWallet) {
          try {
            if (Address.parse(jWallet).hash.toString("hex") === targetHash) {
              return String(j.balance ?? j.amount ?? 0);
            }
          } catch { /* skip */ }
        }
      }
    }

    if (targetHash) {
      try {
        const res2 = await fetch("https://toncenter.com/api/v3/runGetMethod", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            address: jettonWalletAddress,
            method: "get_wallet_data",
            stack: [],
          }),
        });
        if (res2.ok) {
          const d2 = await res2.json();
          if (d2.exit_code === 0 && d2.stack) {
            for (const item of d2.stack) {
              if (item.type === "int" && item.value != null) {
                return String(item.value);
              }
            }
          }
        }
      } catch { /* fall through */ }
    }

    throw new Error("Jetton not found in account balances");
  }

  /** Format a raw token amount using the token's decimals. */
  formatTokenBalance(raw, decimals) {
    const value = BigInt(raw);
    const divisor = 10n ** BigInt(decimals);
    const whole = value / divisor;
    const fraction = (value % divisor).toString().padStart(decimals, "0");
    const trimmed = fraction.replace(/0+$/, "");
    return trimmed ? `${whole}.${trimmed}` : whole.toString();
  }

  /* ------------------------------------------------------------------ */
  /* Transfers (build, estimate fee, broadcast)                          */
  /* ------------------------------------------------------------------ */

  /**
   * toncenter v2 JSON-RPC call with a small retry on rate limiting.
   * @param {string} method
   * @param {object} params
   * @returns {Promise<object>} the `result` envelope
   */
  async rpcCall(method, params) {
    let lastError;
    for (let attempt = 0; attempt < 3; attempt++) {
      const res = await fetch(TONCENTER_RPC, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: 1, jsonrpc: "2.0", method, params }),
      });
      const data = await res.json();
      if (res.ok && !data.error && data.ok !== false) return data.result;
      lastError = data.error || data.result || `HTTP ${res.status}`;
      if (/ratelimit/i.test(String(lastError))) {
        await new Promise((r) => setTimeout(r, 1500 * (attempt + 1)));
        continue;
      }
      break;
    }
    throw new Error(`${method} failed: ${lastError}`);
  }

  /**
   * Current wallet seqno (0 when the account is not deployed yet).
   * @param {string} address
   * @returns {Promise<number>}
   */
  async getSeqno(address) {
    try {
      const res = await this.rpcCall("runGetMethod", {
        address,
        method: "seqno",
        stack: [],
      });
      if (res.exit_code !== 0) return 0;
      return Number(res.stack?.[0]?.value) || 0;
    } catch {
      return 0;
    }
  }

  /**
   * `getWalletInformation` account state — used to decide whether the
   * external message needs state-init (first deployment).
   * @param {string} address
   * @returns {Promise<string>} active | uninitialized | frozen | nonexist
   */
  async getAccountState(address) {
    const res = await this.rpcCall("getWalletInformation", { address });
    return res.account_state || "uninitialized";
  }

  /**
   * Raw TON balance (nanotons) for an address.
   * @param {string} address
   * @returns {Promise<string>} balance as decimal string
   */
  async getTonBalanceRaw(address) {
    const res = await this.rpcCall("getAddressBalance", { address });
    return String(res.balance ?? 0);
  }

  /**
   * Parse a user-typed decimal amount into raw integer units.
   * @param {string} amount e.g. "1.25"
   * @param {number} decimals e.g. 9 (TON) or the token's decimals
   * @returns {bigint}
   */
  parseAmountToRaw(amount, decimals) {
    const s = String(amount).trim();
    if (!/^\d+(\.\d+)?$/.test(s)) throw new Error("Invalid amount");
    const [whole, fraction = ""] = s.split(".");
    if (fraction.length > decimals) {
      throw new Error(`Too many decimals (max ${decimals})`);
    }
    const padded = (fraction + "0".repeat(decimals)).slice(0, decimals);
    return BigInt(whole) * 10n ** BigInt(decimals) + BigInt(padded || "0");
  }

  /**
   * Build + sign a transfer message from the account's v4r2 wallet.
   *
   * `jetton` is the stored token record when sending a Jetton (message goes to
   * this account's own Jetton wallet with a TEP-74 transfer body); otherwise a
   * plain TON transfer is built. Returns the wrapped external message cell ready
   * for `estimateFee` / `sendBoc`, plus the seqno it was signed with.
   *
   * @param {object} args
   * @param {import("@ton/ton").WalletContractV4} args.contract
   * @param {import("@ton/crypto").KeyPair} args.keyPair
   * @param {string} args.to recipient owner address
   * @param {bigint} args.amountRaw amount in raw units
   * @param {object|null} [args.jetton] stored token record
   * @returns {Promise<{cell: Cell, seqno: number, valueNano: bigint}>}
   */
  async buildSignedTransfer({ contract, keyPair, to, amountRaw, jetton = null }) {
    let destination = Address.parse(to);
    let valueNano = amountRaw;
    let body = beginCell().storeUint(0, 32).endCell();

    if (jetton) {
      const owner = contract.address.toString();
      destination = Address.parse(jetton.jetton_wallet_address);
      valueNano = JETTON_TRANSFER_ATTACHED_TON;
      body = beginCell()
        .storeUint(0xf8a7ea5, 32) // transfer op
        .storeUint(0, 64) // query id
        .storeCoins(amountRaw) // jetton amount
        .storeAddress(Address.parse(to)) // destination owner
        .storeAddress(Address.parse(owner)) // response destination (sender)
        .storeBit(0) // no custom payload
        .storeCoins(JETTON_FORWARD_TON) // forward ton amount (recipient gas)
        .storeBit(0) // no forward payload
        .endCell();
    }

    const seqno = await this.getSeqno(contract.address.toString());
    const transfer = contract.createTransfer({
      seqno,
      sendMode: SendMode.PAY_GAS_SEPARATELY + SendMode.IGNORE_ERRORS,
      secretKey: keyPair.secretKey,
      messages: [
        internal({ to: destination, value: valueNano, bounce: true, body }),
      ],
    });

    const state = await this.getAccountState(contract.address.toString());
    const needsInit = state !== "active";
    const ext = external({
      to: contract.address,
      init: needsInit ? contract.init : null,
      body: transfer,
    });
    const cell = beginCell().store(storeMessage(ext)).endCell();

    return { cell, seqno, valueNano };
  }

  /**
   * Estimate the network fee for a signed transfer (the sender's share).
   * @param {string} address the wallet address
   * @param {Cell} cell the signed external message
   * @returns {Promise<bigint>} fee in nanotons
   */
  async estimateTransferFee(address, cell) {
    const res = await this.rpcCall("estimateFee", {
      address,
      body: cell.toBoc().toString("base64"),
      ignore_chksig: true,
    });
    const f = res.source_fees || {};
    return (
      BigInt(f.in_fwd_fee || 0) +
      BigInt(f.storage_fee || 0) +
      BigInt(f.gas_fee || 0) +
      BigInt(f.fwd_fee || 0)
    );
  }

  /**
   * Broadcast a signed transfer to the network.
   * @param {Cell} cell the signed external message
   * @returns {Promise<{hash: string}>} hex hash of the sent message
   */
  async broadcastTransfer(cell) {
    await this.rpcCall("sendBoc", { boc: cell.toBoc().toString("base64") });
    return { hash: cell.hash().toString("hex") };
  }

  /**
   * Verify the account can afford a transfer: TON balance covers amount + fee
   * (or the attached gas for Jettons) and the Jetton balance covers the amount.
   * @param {object} args
   * @param {import("@ton/ton").WalletContractV4} args.contract
   * @param {bigint} args.amountRaw amount in raw units
   * @param {object|null} [args.jetton] stored token record
   * @param {bigint} [args.feeNano] estimated network fee (nanotons)
   * @returns {Promise<{sufficient: boolean, reason: string|null, tonBalanceRaw: string, jettonBalanceRaw: string|null}>}
   */
  async checkTransferFunds({ contract, amountRaw, jetton = null, feeNano = 0n }) {
    const owner = contract.address.toString();
    const tonBalanceRaw = await this.getTonBalanceRaw(owner);
    const tonBalance = BigInt(tonBalanceRaw);

    if (jetton) {
      const jettonBalanceRaw = await this.getJettonBalance(
        jetton.jetton_wallet_address,
        owner,
        jetton.jetton_master_address,
      );
      const jettonBalance = BigInt(jettonBalanceRaw);
      if (jettonBalance < amountRaw) {
        return {
          sufficient: false,
          reason: "Insufficient token balance",
          tonBalanceRaw,
          jettonBalanceRaw,
        };
      }
      if (tonBalance < JETTON_TRANSFER_ATTACHED_TON + feeNano) {
        return {
          sufficient: false,
          reason: "Insufficient TON balance for network costs",
          tonBalanceRaw,
          jettonBalanceRaw,
        };
      }
      return { sufficient: true, reason: null, tonBalanceRaw, jettonBalanceRaw };
    }

    if (tonBalance < amountRaw + feeNano) {
      return {
        sufficient: false,
        reason: "Insufficient TON balance",
        tonBalanceRaw,
        jettonBalanceRaw: null,
      };
    }
    return { sufficient: true, reason: null, tonBalanceRaw, jettonBalanceRaw: null };
  }

  /**
   * Encrypt a mnemonic for a portable backup file using a key derived from the
   * user's passphrase + the backup's own salt. The resulting ciphertext is only
   * decryptable with that passphrase, so the file is self-contained.
   * @param {string} phrase
   * @param {string} password the vault passphrase
   * @param {string} salt base64 salt for this backup (see Encrypter.generateSalt)
   * @returns {Promise<string>} base64 ciphertext bundle
   */
  async encryptForBackup(phrase, password, salt) {
    const key = await Encrypter.scryptPass(password, salt);
    return await Encrypter.encryptWithKey({ data: phrase, key });
  }

  /**
   * Decrypt a backup entry's mnemonic using the passphrase + backup salt.
   * @param {string} encrypted base64 ciphertext bundle
   * @param {string} password the vault passphrase
   * @param {string} salt base64 salt stored in the backup file
   * @returns {Promise<string>} the plaintext mnemonic
   * @throws {Error} on wrong passphrase or corrupted data
   */
  async decryptFromBackup(encrypted, password, salt) {
    const key = await Encrypter.scryptPass(password, salt);
    return await Encrypter.decryptWithKey({ encrypted, key });
  }

  /**
   * Poll the wallet seqno until it advances past `fromSeqno` (the tx landed).
   * @param {string} address
   * @param {number} fromSeqno seqno the transfer was signed with
   * @param {number} [timeoutMs]
   * @returns {Promise<number>} the new seqno
   */
  async waitForSeqnoChange(address, fromSeqno, timeoutMs = 60_000) {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      const seqno = await this.getSeqno(address);
      if (seqno > fromSeqno) return seqno;
      await new Promise((r) => setTimeout(r, 3000));
    }
    throw new Error("Timed out waiting for confirmation");
  }
}
