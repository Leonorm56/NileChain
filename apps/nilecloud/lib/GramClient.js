import { Api, Logger } from "telegram";
import { computeCheck } from "telegram/Password.js";

import BaseTelegramWebClient from "@nile/shared/lib/BaseTelegramWebClient.js";
import toSocksProxy, {
  DEFAULT_SOCKS_TIMEOUT_SECONDS,
} from "./socksProxy.js";
import fsp from "node:fs/promises";
import { getCurrentPath } from "./path.js";
import generateFingerprint from "./fingerprint.js";
import { globby } from "globby";
import path from "node:path";

const { __dirname } = getCurrentPath(import.meta.url);

/** Telegram API credentials. Must match BaseTelegramWebClient. */
const API_ID = 2496;
const API_HASH = "8da85b0d5bfe62527e5b244c209159c3";

/** Seconds a SOCKS dial gets (mtproto over the account's own proxy) */
const SOCKS_TIMEOUT_SECONDS = Number(
  process.env.TELEGRAM_SOCKS_TIMEOUT_SECONDS,
) || DEFAULT_SOCKS_TIMEOUT_SECONDS;

class GramClient extends BaseTelegramWebClient {
  /**
   * @type {Map<string, GramClient>}
   */
  static instances = new Map();

  /** Constructor */
  constructor({ name, session, device, proxy, sessionFilePath, sessionFileExists }) {
    super(session, {
      ...device,
      proxy,
      ...(process.env.NODE_ENV === "production" && {
        baseLogger: new Logger("error"),
      }),
    });

    /** Store Name */
    this._name = name;

    /** Store Device Fingerprint */
    this._device = device;

    /** Store File Path */
    this._sessionFilePath = sessionFilePath;

    /** Store Session File State */
    this._sessionFileExists = sessionFileExists;

    /** Destroy Timeout */
    this._destroyTimeout = null;

    /** Start Timeout */
    this._startTimeout = null;

    /** Initial Start Stage */
    this._resetStartStage();
  }

  /**
   * Parse Proxy
   *
   * `MTProxy` deliberately absent — see `socksProxy.js`. gramjs skips its SOCKS
   * branch when the object carries that key at all, so the old `MTProxy: false`
   * meant the proxy was never used for Telegram and every account dialled from
   * this box's IP.
   */
  static parseProxy(proxy) {
    return toSocksProxy(proxy, SOCKS_TIMEOUT_SECONDS);
  }

  /** Start Handler */
  _createStartHandler(stage) {
    return () =>
      new Promise((resolve) => {
        /** Resolve Stage Promise */
        this._startStagePromise?.resolve?.({
          stage,
        });

        /** Remove Previous Handler */
        if (this._startStage) {
          delete this._startHandlers[this._startStage];
        }

        /** Set Stage */
        this._startStage = stage;

        /** Set Handler */
        this._startHandlers[stage] = (data) => {
          resolve(data);

          /** Return new promise for the next stage */
          return new Promise((_resolve, _reject) => {
            this._startStagePromise = {
              resolve: _resolve,
              reject: _reject,
            };
          });
        };
      });
  }

  _resetStartStage() {
    /** Reset Start Stage */
    this._startStage = null;

    /** Reset Start Stage Promise */
    this._startStagePromise = null;

    /** Reset Start Handlers */
    this._startHandlers = {
      phone: null,
      code: null,
      password: null,
    };
  }

  /** Reset Destroy Timeout */
  _resetDestroyTimeout() {
    clearTimeout(this._destroyTimeout);
    this._destroyTimeout = setTimeout(() => this.destroy(), 15 * 60 * 1000);
  }

  /** Execute on Client */
  async execute(callback) {
    /** Reset Destroy Timeout */
    this._resetDestroyTimeout();

    return super.execute(callback);
  }

  /** Destroy */
  destroy() {
    clearTimeout(this._startTimeout);
    clearTimeout(this._destroyTimeout);
    return super.destroy();
  }

  /** Start Response */
  async startResponse(stage, response) {
    if (this._startStage !== stage) {
      throw new Error("Invalid stage!");
    } else if (!this._startHandlers[stage]) {
      throw new Error("Missing stage handler!");
    } else {
      return await this._startHandlers[stage](response);
    }
  }

  /** Start Pending */
  startPending() {
    return new Promise((_resolve, _reject) => {
      /** Automatically Logout */
      this._startTimeout = setTimeout(() => this.logout(), 10 * 60 * 1000);

      /** Reset Start Stage */
      this._resetStartStage();

      /** Reset Start Stage Promise */
      this._startStagePromise = { resolve: _resolve, reject: _reject };

      /** Start */
      this.start({
        phoneNumber: this._createStartHandler("phone"),
        phoneCode: this._createStartHandler("code"),
        password: this._createStartHandler("password"),
        onError: (error) => {
          if (this._startStagePromise) {
            this._startStagePromise.reject(error);
          } else {
            console.error(
              "Error occurred before handler was initialized:",
              error,
            );
          }
        },
      })
        .then(async () => {
          try {
            /** Get User */
            const user = await this.getMe();

            await this._saveSession();
            await this.destroy();

            this._startStagePromise?.resolve?.({
              stage: "authenticated",
              user,
            });
          } catch (error) {
            /** Log Error */
            console.error("Error during authentication process:", error);

            /** Reject Error */
            this._startStagePromise?.reject?.(error);
          } finally {
            this._resetStartStage();
          }
        })
        .catch((error) => this._startStagePromise?.reject?.(error))
        .finally(() => {
          /** Clear Timeout */
          clearTimeout(this._startTimeout);
        });
    });
  }

  /** Join Telegram Link */
  async joinTelegramLink(link) {
    this._joinQueue = this._joinQueue || Promise.resolve();
    this._joinQueue = this._joinQueue.then(() => super.joinTelegramLink(link));

    return this._joinQueue;
  }

  /** Logout */
  async logout() {
    try {
      /** Try to reconnect */
      if (this.disconnected) {
        await this.connect();
      }

      /** Logout */
      await this.invoke(new Api.auth.LogOut({}));

      /** Destroy */
      await this.destroy();
    } catch (error) {
      /** Logout */
      console.error("Error during logout:", error);
    } finally {
      /** Reject */
      this._startStagePromise?.reject?.(new Error("Logged Out!"));

      /** Delete Session */
      await this._deleteSession();

      /** Remove Instance */
      await this.constructor.delete(this._name);
    }
  }

  /** Save Session */
  async _saveSession() {
    /** Write to File */
    await this.constructor.writeSession(this._name, this.session.save(), this._device);

    /** Mark as Saved */
    this._sessionFileExists = true;
  }

  /** Delete Session */
  async _deleteSession() {
    /** Delete File */
    if (this._sessionFileExists) {
      await fsp.unlink(this._sessionFilePath);
    }

    /** Mark as Removed */
    this._sessionFileExists = false;
  }

  /**
   * Starts a Client
   * @param {string} name
   * @param {string|null} proxy
   * @returns {GramClient}
   */
  static async create(name, proxy = null) {
    if (this.instances.has(name)) return this.instances.get(name);

    const sessionFilePath = await this.getSessionPath(name);
    const sessionFileExists = await this.sessionFileExists(name);

    const file = await this.readSessionFile(name);
    const session = file?.session ?? "";
    const device = file?.device ?? (await this.getDevice(name, sessionFileExists));

    return this.instances
      .set(
        name,
        new this({
          name,
          session,
          device,
          proxy: this.parseProxy(proxy),
          sessionFilePath,
          sessionFileExists,
        }),
      )
      .get(name);
  }

  /** Get Sessions */
  static async getSessions() {
    const entries = await globby([path.join(this.getStoragePath(), "*.json")]);

    const sessions = entries.map(
      (item) => path.basename(item, ".json").split("_")[1],
    );

    return sessions;
  }

  /** Check if session exists */
  static async sessionExists(name) {
    return this.instances.has(name) || this.sessionFileExists(name);
  }

  /** Check if session file exists */
  static async sessionFileExists(name) {
    return await fsp
      .access(this.getSessionPath(name))
      .then(() => true)
      .catch(() => false);
  }

  /** Read session file content */
  static async readSessionFile(name) {
    const filePath = this.getSessionPath(name);

    if (!(await this.sessionFileExists(name))) return null;

    const parsed = JSON.parse(await fsp.readFile(filePath, "utf8"));

    if (parsed && typeof parsed === "object" && "session" in parsed) {
      return parsed;
    }

    /** Legacy: file content is the raw session string */
    return { session: parsed };
  }

  /** Read a saved device fingerprint (or null) */
  static async readDevice(name) {
    const file = await this.readSessionFile(name);
    return file?.device || null;
  }

  /**
   * Get the permanent device fingerprint for an account.
   * Generates once on first session create and persists it.
   */
  static async getDevice(name, sessionFileExists) {
    const saved = await this.readDevice(name);

    if (saved) return saved;

    const device = generateFingerprint();

    if (sessionFileExists) {
      const file = await this.readSessionFile(name);
      await this.writeSession(name, file?.session ?? "", device);
    }

    return device;
  }

  /** Write session */
  static async writeSession(session, content, device) {
    const resolvedDevice =
      device || (await this.readDevice(session)) || generateFingerprint();

    return fsp.writeFile(
      this.getSessionPath(session),
      JSON.stringify({
        session: content,
        device: resolvedDevice,
      }),
    );
  }

  /** Get session file path */
  static getSessionPath(name) {
    return path.join(this.getStoragePath(), `session_${name}.json`);
  }

  /** Get storage directory for all sessions */
  static getStoragePath() {
    return path.resolve(__dirname, "../sessions");
  }

  /** Delete Instance */
  static delete(name) {
    this.instances.delete(name);
  }

  /**
   * Create an ephemeral client (not tracked, no session file backing) from a
   * raw StringSession. Used for session cloning.
   */
  static createRaw(sessionString = "", proxy = null) {
    return new this({
      name: null,
      session: sessionString,
      proxy: this.parseProxy(proxy),
      sessionFilePath: null,
      sessionFileExists: false,
    });
  }

  /**
   * Mint a brand-new, independent session from an existing authorised session
   * using the Telegram login-token (QR) flow.
   *
   * The authorised session accepts the token, so no phone number and no login
   * code are needed; when the account has 2FA enabled, each candidate password
   * is tried until one succeeds.
   *
   * @param {string} sessionString - StringSession of an authorised account
   * @param {{ passwords?: string[], proxy?: string|null }} [options]
   * @returns {Promise<{ session: string, user: import("telegram").Api.User }>}
   */
  static async cloneSession(sessionString, { passwords = [], proxy = null } = {}) {
    const source = this.createRaw(sessionString, proxy);
    const fresh = this.createRaw("", proxy);

    try {
      /**
       * The DC address embedded in a session string may not be reachable from
       * this box, so repoint it at the address resolved here. Best effort: if
       * the lookup fails, connect with whatever the session already holds.
       */
      try {
        const dcId = source.session.dcId;

        if (dcId) {
          const info = await this.getDcDetails(dcId);

          if (info?.ipAddress) {
            source.session.setDC(info.id, info.ipAddress, info.port);
          }
        }
      } catch {
        /** Fall through to the DC already stored in the session */
      }

      await source.connect();
      await fresh.connect();

      /** The imported session must be authorised to accept the token */
      if (!(await source.isUserAuthorized())) {
        throw new Error("Source session is not authorized");
      }

      /** Export a login token from the fresh (empty) client */
      const exported = await fresh.invoke(
        new Api.auth.ExportLoginToken({
          apiId: API_ID,
          apiHash: API_HASH,
          exceptIds: [],
        }),
      );

      if (!(exported instanceof Api.auth.LoginToken)) {
        throw new Error(`Unexpected export result: ${exported.className}`);
      }

      /** Accept the token with the authorised client (a server-side QR scan) */
      await source.invoke(
        new Api.auth.AcceptLoginToken({ token: exported.token }),
      );

      /** Finalize: obtain authorisation (DC migration and 2FA handled) */
      await this._finalizeLoginToken(fresh, passwords);

      /** Return the new session and the account it belongs to */
      const user = await fresh.getMe();

      return { session: fresh.session.save(), user };
    } finally {
      await source.destroy().catch(() => {});
      await fresh.destroy().catch(() => {});
    }
  }

  /** Re-export the login token to finish authorisation */
  static async _finalizeLoginToken(client, passwords, attempt = 0) {
    let result;

    try {
      result = await client.invoke(
        new Api.auth.ExportLoginToken({
          apiId: API_ID,
          apiHash: API_HASH,
          exceptIds: [],
        }),
      );
    } catch (error) {
      if (error.errorMessage === "SESSION_PASSWORD_NEEDED") {
        return this._checkPassword(client, passwords);
      }

      throw error;
    }

    if (result instanceof Api.auth.LoginTokenSuccess) {
      return result.authorization;
    }

    /** Acceptance not yet propagated — retry a few times */
    if (result instanceof Api.auth.LoginToken) {
      if (attempt >= 5) {
        throw new Error("Login token was not accepted in time");
      }

      await new Promise((resolve) => setTimeout(resolve, 1_000));

      return this._finalizeLoginToken(client, passwords, attempt + 1);
    }

    if (result instanceof Api.auth.LoginTokenMigrateTo) {
      await client._switchDC(result.dcId);

      try {
        const migrated = await client.invoke(
          new Api.auth.ImportLoginToken({ token: result.token }),
        );

        if (migrated instanceof Api.auth.LoginTokenSuccess) {
          return migrated.authorization;
        }

        throw new Error(`Unexpected migrate result: ${migrated.className}`);
      } catch (error) {
        if (error.errorMessage === "SESSION_PASSWORD_NEEDED") {
          return this._checkPassword(client, passwords);
        }

        throw error;
      }
    }

    throw new Error(`Unexpected login token result: ${result.className}`);
  }

  /** Complete 2FA by trying each candidate password */
  static async _checkPassword(client, passwords) {
    if (!passwords.length) {
      throw new Error("2FA password required but none provided");
    }

    let lastError;

    for (const password of passwords) {
      try {
        const passwordSrp = await client.invoke(new Api.account.GetPassword());
        const check = await computeCheck(passwordSrp, password);

        return await client.invoke(
          new Api.auth.CheckPassword({ password: check }),
        );
      } catch (error) {
        lastError = error;

        /** Wrong password — try the next candidate */
        if (error.errorMessage === "PASSWORD_HASH_INVALID") {
          continue;
        }

        throw error;
      }
    }

    throw new Error(
      `2FA failed: no provided password matched${
        lastError ? ` (${lastError.errorMessage || lastError.message})` : ""
      }`,
    );
  }

  /**
   * Resolve a Telegram DC's address through a throwaway client, cached per DC.
   * A session string's embedded DC address can be stale or unreachable.
   */
  static async getDcDetails(dcId) {
    if (!this.dcCache) {
      this.dcCache = new Map();
    }

    if (this.dcCache.has(dcId)) {
      return this.dcCache.get(dcId);
    }

    if (!this.dcHelperPromise) {
      this.dcHelperPromise = (async () => {
        const helper = this.createRaw("");

        await helper.connect();

        return helper;
      })();
    }

    const helper = await this.dcHelperPromise;
    const info = await helper.execute(() => helper.getDC(dcId));

    this.dcCache.set(dcId, info);

    return info;
  }
}

export default GramClient;
