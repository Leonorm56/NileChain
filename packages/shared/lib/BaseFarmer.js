import * as changeKeys from "change-case/keys";

import seedrandom from "seedrandom";
import utils from "../utils/bundle.js";

/**
 * Promo tags some users graft onto their Telegram display name for airdrop
 * referrals. They must not ride along into the name the farmer hands to a drop
 * (account registration, profile sync, ...), so the display-name accessors
 * strip them. Each pattern is anchored tightly enough to leave an ordinary
 * name alone - e.g. "Pirateson" keeps its "pirate".
 */
const PROMO_NAME_PATTERNS = [
  // "@moneytree_game_bot" referral handle, in any casing.
  /@moneytree_game_bot/giu,
  // "PIRATE🏴‍☠💰 💰": the word PIRATE plus its trailing flag/skull/money-bag
  // emoji cluster (ZWJ / VS16 / space-joined). At least one emoji is required,
  // so a plain "pirate" inside a real name is not touched.
  /pirate(?:[\s‍️]*[\u{1F3F4}\u{2620}\u{1F4B0}])+[\s‍️\u{1F3F4}\u{2620}\u{1F4B0}]*/giu,
];

export default class BaseFarmer {
  static id = "base-farmer";
  static platform = "telegram";
  static type = "webapp";
  static title = "Base Farmer";
  static emoji = "🐾";
  static enabled = true;
  static apiDelay = 200;
  static cacheAuth = true;
  static cacheTelegramWebApp = true;
  static syncToCloud = true;
  static cookies = false;
  static interval = "*/10 * * * *";
  static path = "/";
  static link = "";
  static telegramLink = "";
  static host = "";
  static domains = [];
  static withXSRFToken = false;
  static rating = 1;
  static startupDelay = 30;
  static deactivateOnError = true;
  static published = true;
  static singleton = false;
  static autoStart = true;
  static skipExecutionOfNewAccount = false;

  constructor() {
    /* Register utilities */
    this.utils = utils;

    /* Parse Telegram Link */
    if (this.constructor.platform === "telegram") {
      const { entity, shortName, startParam } = this.utils.parseTelegramLink(
        this.constructor.telegramLink,
      );
      this.entity = entity;
      this.shortName = shortName;
      this.startParam = startParam;
    }

    /* Debugger */
    this.debug = true;
    this.debugger = new Proxy(globalThis.console, {
      get: (target, prop) => {
        if (typeof target[prop] === "function") {
          return (...args) => {
            if (this.debug) {
              target[prop](...args);
            }
          };
        }
        return target[prop];
      },
    });

    /* Initialize Tools */
    this.tools = this.createTools?.() || [];

    this.startedAt = new Date();
    this.currentTaskStartedAt = null;
    this.currentTask = null;

    this.controller = new AbortController();
    this.signal = this.controller.signal;
    this._cloudMode = false;

    /* Mirror the statics so subclasses can read them off `this` too */
    this.platform = this.constructor.platform;
    this.type = this.constructor.type;
    this.telegramLink = this.constructor.telegramLink;
    this.link = this.constructor.link;
    this.apiDelay = this.constructor.apiDelay;
  }

  /** Set Cloud Mode */
  setCloudMode(cloudMode = false) {
    this._cloudMode = cloudMode;
  }

  /** Set Prompt Functions */
  setPromptFunctions(functions) {
    this.promptInput = functions.promptInput;
    this.promptAnswer = functions.promptAnswer;
    this.promptCancel = functions.promptCancel;
  }

  /** Configure Auth Headers */
  configureAuthHeaders(data) {
    this.setAuthHeaders(this.getAuthHeaders(data));
  }

  /** Set Auth Headers */
  setAuthHeaders(headers) {
    this.api.defaults.headers.common = Object.assign(
      this.api.defaults.headers.common,
      headers,
    );
  }

  /**
   * Set the API instance for making requests.
   * @param {import("axios").AxiosInstance} api - Axios instance for API requests
   */
  setApi(api) {
    /** @type {import("axios").AxiosInstance} */
    this.api = api;
  }

  /** Set the Telegram Web App  */
  setTelegramWebApp(telegramWebApp) {
    this.telegramWebApp = telegramWebApp;
  }

  /** Set the Captcha Solver
   * @param {import("./CaptchaSolver.js").default} captcha - Captcha solver instance
   */
  setCaptcha(captcha) {
    this.captcha = captcha;
  }

  /** Set the Telegram Client
   * @param {import("./BaseTelegramWebClient.js").default} client - Telegram client instance
   */
  setTelegramClient(client) {
    return this.setClient(client);
  }

  /** Set the User Agent */
  setUserAgent(userAgent) {
    this.userAgent = userAgent;
  }

  /** Set the Quick Run */
  setQuickRun(quickRun = false) {
    this.quickRun = quickRun;
  }

  /** Set the Logger
   * @param {import("./BaseLogger.js").default} logger - Logger instance
   */
  setLogger(logger) {
    this.logger = logger;
  }

  /** Set the Telegram Client
   * @param {import("./BaseTelegramWebClient.js").default} client - Telegram client instance
   */
  setClient(client) {
    this.client = client;
  }

  /** Can Solve Turnstile */
  canSolveTurnstile() {
    return this.captcha?.isConfigured();
  }

  /** Solve Turnstile */
  solveTurnstile({ siteKey, pageUrl }) {
    return this.captcha?.solveTurnstile({ siteKey, pageUrl });
  }

  /** Can Join Telegram Link */
  canJoinTelegramLink(link) {
    return Boolean(this.client);
  }

  /** Join Telegram Link */
  joinTelegramLink(link) {
    return this.client.joinTelegramLink(link);
  }

  /** Can Update Profile */
  canUpdateProfile(options) {
    return Boolean(this.client);
  }

  /** Update Profile */
  updateProfile(options) {
    return this.client.updateProfile(options);
  }

  /** Get Init Data */
  getInitData() {
    return this.telegramWebApp?.initData;
  }

  /** Get Init Data Unsafe */
  getInitDataUnsafe(camelCase = false) {
    return camelCase
      ? changeKeys.camelCase(this.telegramWebApp?.initDataUnsafe, Infinity)
      : this.telegramWebApp?.initDataUnsafe;
  }

  /** Get Init Data Hash */
  getInitDataHash() {
    return this.getInitDataUnsafe()?.hash;
  }

  /** Get Telegram User */
  getTelegramUser() {
    return this.getInitDataUnsafe()?.user;
  }

  /** Get Fixed Random Number */
  getFixedRandomNumber() {
    return this.getUserRandomGenerator()();
  }

  /** Get User Random Generator */
  getUserRandomGenerator() {
    return seedrandom(this.getUserId());
  }

  /** Get User ID */
  getUserId() {
    return this.getTelegramUser()?.id;
  }

  /** Get Username */
  getUsername() {
    return this.getTelegramUser()?.username;
  }

  /** Get User First Name */
  getUserFirstName() {
    return this.sanitizeDisplayName(
      this.getTelegramUser()?.["first_name"] || "",
    );
  }

  /** Get User Last Name */
  getUserLastName() {
    return this.sanitizeDisplayName(
      this.getTelegramUser()?.["last_name"] || "",
    );
  }

  /**
   * Strip referral promo tags (see PROMO_NAME_PATTERNS) out of a Telegram
   * display name and tidy the leftover whitespace.
   */
  sanitizeDisplayName(value) {
    if (!value) return value ?? "";
    let out = String(value);
    for (const pattern of PROMO_NAME_PATTERNS) out = out.replace(pattern, " ");
    return out.replace(/\s+/g, " ").trim();
  }

  /** Get User Full Name */
  getUserFullName() {
    const firstName = this.getUserFirstName();
    const lastName = this.getUserLastName();

    return `${firstName} ${lastName}`.trim();
  }

  /** Get Profile Photo URL */
  getProfilePhotoUrl() {
    const user = this.getTelegramUser();
    if (user && user["photo_url"]) {
      return user["photo_url"];
    }
    return null;
  }

  /** Get Is Premium User */
  getIsPremiumUser() {
    return this.getInitDataUnsafe()?.["is_premium"] || false;
  }

  /** Get Start Parameter */
  getStartParam() {
    return this.getInitDataUnsafe()?.["start_param"];
  }

  getLaunchURL() {
    if (this.getInitData()) {
      return this.constructor.getUrlFromInitData(this.getInitData());
    } else {
      return this.constructor.telegramLink || this.constructor.link;
    }
  }

  /** Configure primary link */
  static configurePrimaryLink(link) {
    if (link) {
      if (this.platform === "telegram") {
        this.telegramLink = link;
      } else {
        this.link = link;
      }
    }
  }

  /** Get URL from Init Data */
  static getUrlFromInitData(initData) {
    const url = new URL(this.path, `https://${this.host}`);
    const params = new URLSearchParams();

    params.set("tgWebAppData", initData);

    url.hash = `#${params.toString()}`;

    return url.toString();
  }

  /** Start the farmer */
  async start(signal) {
    if (signal) {
      this.signal = signal;
    }

    /** Delay for 3s */
    await this.utils.delayForSeconds(3, { signal: this.signal });

    return this.process();
  }

  /** Get elapsed time */
  getElapsedTime() {
    return this.utils.dateFns.formatDistanceToNowStrict(
      this.currentTaskStartedAt || new Date(),
    );
  }

  /** Execute a task with logging */
  async executeTask(task, callback, allowInQuickRun = true) {
    /** Update Task */
    this.currentTaskStartedAt = new Date();
    this.currentTask = task;

    /* Add newline */
    this.logger.newline();

    /* Check Aborted */
    if (this.signal?.aborted) {
      this.logger.warn(`✖ Task aborted: ${this.logger.c.magenta(task)}`);
      return;
    }

    /* Check Quick Run */
    const skipInQuickRun = this.quickRun && !allowInQuickRun;

    if (skipInQuickRun) {
      /* Log Skipped Task */
      this.logger.log(
        `${this.logger.c.yellow(
          "⚡ Skipping in quick run:",
        )} ${this.logger.c.magenta(task)}`,
      );
      return;
    }

    try {
      /* Log Task Start */
      this.logger.log(
        `${this.logger.c.gray("⚙ Executing task:")} ${this.logger.c.magenta(
          task,
        )}`,
      );

      /** Delay before processing task */
      await this.utils.delayForSeconds(5, { signal: this.signal });

      /* Execute Callback */
      const result = await callback();

      /* Log Task Completion */
      this.logger.log(
        `${this.logger.c.green("✔ Completed task:")} ${this.logger.c.magenta(
          task,
        )}`,
      );
      return result;
    } catch (error) {
      /* Log Task Error */
      this.logger.log(
        `${this.logger.c.red(
          "✖ Error executing task:",
        )} ${this.logger.c.magenta(task)}\n   ${this.logger.c.gray(
          error.message,
        )}`,
      );
      throw error;
    } finally {
      /** Delay before processing next task */
      await this.utils.delayForSeconds(5, { signal: this.signal });
    }
  }

  /** Validate Telegram Task */
  validateTelegramTask(link) {
    return (
      !this.utils.isTelegramChatLink(link) || this.canJoinTelegramLink(link)
    );
  }

  /** Try to join Telegram Link */
  async tryToJoinTelegramLink(link) {
    if (this.utils.isTelegramChatLink(link) && this.canJoinTelegramLink(link)) {
      try {
        await this.joinTelegramLink(link);
        return true;
      } catch (error) {
        this.logger.error("Failed to join Telegram link:", error.message);
        return false;
      }
    }
  }

  /** Try to update profile */
  async tryToUpdateProfile(options) {
    if (this.canUpdateProfile(options)) {
      try {
        await this.updateProfile(options);
        return true;
      } catch (error) {
        this.logger.error("Failed to update profile:", error.message);
        return false;
      }
    }
  }

  /** Update Web App Data */
  async updateWebAppData() {
    if (
      this.constructor.platform === "telegram" &&
      this.constructor.type === "webapp"
    ) {
      const { url } = await this.client.getWebview(
        this.constructor.telegramLink,
      );
      const { initData } = this.utils.extractTgWebAppData(url);

      this.setTelegramWebApp({
        initData,
        initDataUnsafe: this.utils.getInitDataUnsafe(initData),
      });
    }
  }

  /** Set Auth */
  async setAuth() {
    const auth = await this.fetchAuth();
    this.configureAuthHeaders(auth);
    return this;
  }

  /** Register Delay Interceptor */
  registerDelayInterceptor() {
    if (this.constructor.apiDelay) {
      this.api.interceptors.request.use(async (config) => {
        await this.utils.delay(this.constructor.apiDelay);
        return config;
      });
    }
  }

  /** Get Auth */
  fetchAuth() {
    return Promise.resolve(true);
  }

  /** Get Meta */
  fetchMeta() {
    return Promise.resolve(true);
  }

  /** Get Auth Headers */
  getAuthHeaders(data) {
    return {};
  }

  /** Make Request ID */
  makeRequestId() {
    return this.utils.uuid();
  }

  /** Determine if the request should be retried */
  shouldRetryRequest(error) {
    const retryAfter = error.response?.data?.retry_after;
    if (retryAfter) {
      return true;
    }
    return false;
  }

  /** Restore cached auth data */
  restoreCachedAuthData(data) {}

  /** Load data */
  load() {}

  /** Persist data */
  persist() {}

  /** Set Cache Auth */
  setCacheAuth(status) {
    this.cacheAuth = status;
  }

  /** Set cache telegram web app */
  setCacheTelegramWebApp(status) {
    this.cacheTelegramWebApp = status;
  }

  /** Can Solve ReCaptcha */
  canSolveReCaptcha() {
    return this.captcha?.isConfigured();
  }

  /** Solve ReCaptcha */
  solveReCaptcha({ siteKey, pageUrl }) {
    return this.captcha?.solveReCaptcha({ siteKey, pageUrl });
  }

  /* --------------------------------------------------------------------- */
  /* Auto adapter                                                          */
  /*                                                                       */
  /* Drops opt in by declaring `static auto`. Every drop's API returns a    */
  /* different shape, so the orchestrator never touches raw responses — it  */
  /* only talks to the three methods below plus `withdraw()`, which each    */
  /* farmer normalizes on its own side.                                     */
  /* --------------------------------------------------------------------- */

  /** The drop's declared minimum withdrawal. */
  getMinimumWithdrawal() {
    return Number(this.constructor.auto?.minWithdrawal ?? 0);
  }

  /** Link a TON wallet to the account and refresh the drop's view of it. */
  async connectAutoWallet(wallet) {
    throw new Error("connectAutoWallet method must be implemented in subclass");
  }

  /** Claim whatever is pending so the next summary reflects current balances. */
  async refreshAutoState() {
    throw new Error("refreshAutoState method must be implemented in subclass");
  }

  /** Normalized account snapshot shared by every Auto drop. */
  getAutoSummary() {
    throw new Error("getAutoSummary method must be implemented in subclass");
  }

  /** Request a withdrawal. */
  async withdraw(options) {
    throw new Error("withdraw method must be implemented in subclass");
  }

  /* --------------------------------------------------------------------- */
  /* Fleet-wide withdrawal throttle (cloud only)                           */
  /*                                                                       */
  /* The extension runs one isolated account per profile, so the default   */
  /* is a no-op: any account may withdraw whenever it is otherwise         */
  /* eligible. The cloud Runner overrides these to enforce a shared,       */
  /* persisted per-farmer budget across the whole fleet.                   */
  /* --------------------------------------------------------------------- */

  /** Ask permission to place a withdrawal now. Returns true if granted. */
  async reserveWithdrawalSlot() {
    return true;
  }

  /** Return a reserved slot when the send fails, so it isn't wasted. */
  async releaseWithdrawalSlot() {}

  /** Notify the server admin */
  async notifyAdmin(messages) {
    return false;
  }

  /** Format account link (Telegram HTML) */
  formatAccountLink(id) {
    return `<a href="tg://user?id=${id}">${id}</a>`;
  }

  /** Log Current User */
  logCurrentUser() {
    const user = this.getTelegramUser();
    this.logger.keyValue(
      "User",
      `${user.username || "(no-username)"} (${user.id})`,
    );
  }

  /** Process */
  async process() {
    throw new Error("process method must be implemented in subclass");
  }

  /** Get Referral Link */
  async getReferralLink() {
    throw new Error("getReferralLink method must be implemented in subclass");
  }

  /** Get Cookies */
  async getCookies(options) {
    throw new Error("getCookies method must be implemented in subclass");
  }
}
