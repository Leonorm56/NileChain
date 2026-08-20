import { Cookie, CookieJar } from "tough-cookie";
import {
  HttpCookieAgent,
  HttpsCookieAgent,
  createCookieAgent,
} from "http-cookie-agent/http";
import { HttpProxyAgent, HttpsProxyAgent } from "hpagent";
import userAgents, {
  regularMobileUserAgents,
} from "@nile/shared/resources/userAgents.js";

import ConsoleLogger from "@nile/shared/lib/ConsoleLogger.js";
import { delay } from "@nile/shared/utils/delay.js";
import GramClient from "../lib/GramClient.js";
import axios from "axios";
import bot from "../lib/bot.js";
import cache from "../lib/cache.js";
import captcha from "../lib/captcha.js";
import db from "../db/models/index.js";
import logger from "../lib/logger.js";
import utils from "../lib/utils.js";

/** Ban trigger count */
const HttpProxyAgentWithCookies = createCookieAgent(HttpProxyAgent);
const HttpsProxyAgentWithCookies = createCookieAgent(HttpsProxyAgent);

/**
 * @param {import("@nile/shared/lib/BaseFarmer.js").default} FarmerClass
 */
export default function createRunner(FarmerClass) {
  /** Environment Variables key */
  const envKey = "FARMER_" + FarmerClass.id.replace(/-/g, "_").toUpperCase();

  /** Is Farmer Enabled */
  const enabled = env(envKey + "_ENABLED", true);

  /** Telegram message thread */
  const threadId =
    env(envKey + "_THREAD_ID", "") || env("TELEGRAM_FARMING_THREAD_ID", "");

  /** Telegram bot link */
  const telegramLink = env(envKey + "_LINK", FarmerClass.telegramLink);

  /** Default primary account ID */
  const defaultPrimaryAccountId = env("PRIMARY_ACCOUNT_ID");

  /** Farmer primary account ID */
  const farmerPrimaryAccountId = env(
    envKey + "_PRIMARY_ACCOUNT_ID",
    defaultPrimaryAccountId,
  );

  /** Primary account ID */
  const primaryAccountId = Number(farmerPrimaryAccountId) || 0;

  /**
   * Withdrawals this farmer may place per rolling hour, fleet-wide. The
   * default of 2 leaves other farmers unthrottled unless they opt in via
   * their own FARMER_<ID>_WITHDRAW_PER_HOUR (and add the reserve gate).
   */
  const withdrawPerHour = env(envKey + "_WITHDRAW_PER_HOUR", 2);

  /**
   * Minimum spacing between two withdrawals. Defaults to an even spread
   * across the hour (30 min for 2/hour) so they never go out together.
   */
  const withdrawMinGapMinutes = env(
    envKey + "_WITHDRAW_MIN_GAP_MINUTES",
    withdrawPerHour >= 1 ? Math.floor(60 / withdrawPerHour) : 0,
  );

  /** Minimum spacing in milliseconds */
  const withdrawMinGapMs = Math.max(0, withdrawMinGapMinutes) * 60 * 1000;

  /**
   * Skip farming a newly added account on the cycle it is first seen. The
   * account is still prepared (its farmer row is created), so it farms normally
   * from the next window on - it just doesn't run the moment it is added.
   * Revert per farmer with FARMER_<ID>_SKIP_NEW_ACCOUNT=false.
   */
  const skipNewAccountExecution = env(envKey + "_SKIP_NEW_ACCOUNT", true);

  /** Log */
  logger.success(`${FarmerClass.title} Farmer`);
  logger.keyValue("Enabled", enabled);
  logger.keyValue("Primary account ID", primaryAccountId, {
    format: false,
  });
  logger.keyValue("Withdraw / hour", withdrawPerHour, { format: false });
  logger.keyValue("Withdraw min gap (min)", withdrawMinGapMinutes, {
    format: false,
  });
  logger.keyValue("Skip new account on add", skipNewAccountExecution, {
    format: false,
  });
  logger.newline();

  return class Runner extends FarmerClass {
    static utils = utils;
    static enabled = enabled;
    static threadId = threadId;
    static telegramLink = telegramLink;
    static primaryAccountId = primaryAccountId;
    static primaryFarmerLink = null;

    /** Newly added accounts sync on add but don't farm until the next window */
    static skipExecutionOfNewAccount = skipNewAccountExecution;
    static runners = new Map();
    static referralLinks = new Map();
    static logger = new ConsoleLogger(true);
    static queue = [];
    static isProcessingQueue = false;
    static feedDone = false;
    static lastResults = new Map();

    /** Fleet-wide withdrawal budget (see reserveWithdrawalSlot) */
    static withdrawPerHour = withdrawPerHour;
    static withdrawMinGapMs = withdrawMinGapMs;
    static withdrawalLedgerKey = `withdrawals:${FarmerClass.id}`;

    /** Staggering window (seconds) and jitter (seconds) */
    static staggerWindowSeconds = 600;
    static staggerJitterSeconds = 15;

    /** Stable (per-account) stagger offset in seconds, derived from account.id */
    static getStaggerOffsetMs(accountId) {
      const windowMs = this.staggerWindowSeconds * 1000;
      const jitterMs = (
        (Math.random() * 2 - 1) * this.staggerJitterSeconds * 1000
      );
      const offsetMs =
        (this.hashAccountId(accountId) % this.staggerWindowSeconds) * 1000;
      return Math.max(0, Math.min(windowMs, offsetMs + jitterMs));
    }

    /** Deterministic hash of account id -> stable 0..window base */
    static hashAccountId(accountId) {
      const str = String(accountId);
      let hash = 2166136261;
      for (let i = 0; i < str.length; i++) {
        hash ^= str.charCodeAt(i);
        hash = Math.imul(hash, 16777619);
      }
      return (hash >>> 0) % this.staggerWindowSeconds;
    }

    /**
     * Pure decision for the withdrawal budget. Prune timestamps older than a
     * rolling hour, then deny if the hour is already full or the last
     * withdrawal is too recent. Side-effect free so it can be unit-tested
     * without the cache. Returns the pruned list so the caller persists it.
     */
    static evaluateWithdrawalSlot(recent, now, perHour, minGapMs) {
      const pruned = (recent || []).filter((ts) => now - ts < 3_600_000);
      if (pruned.length >= perHour) return { allowed: false, pruned };
      const last = pruned.length ? Math.max(...pruned) : 0;
      if (last && now - last < minGapMs) return { allowed: false, pruned };
      return { allowed: true, pruned };
    }

    constructor(account) {
      super();
      this.debug = process.env.NODE_ENV !== "production";
      this.account = account;
      this.farmer = account.farmer;

      this.logger = this.constructor.logger; // Use static logger
      this.utils = this.constructor.utils; // Use static utils
      this.random = this.account.random(); // Seeded RNG

      /** Select User-Agent */
      this.setUserAgent(
        this.constructor.platform === "telegram"
          ? userAgents[Math.floor(this.random() * userAgents.length)]
          : regularMobileUserAgents[
              Math.floor(this.random() * regularMobileUserAgents.length)
            ],
      );

      /** Cookie Jar */
      this.jar = this.constructor.cookies ? new CookieJar() : null;

      /** Proxy URL */
      this.proxy = this.account.proxy ? `http://${this.account.proxy}` : null;

      /** Agent */
      this.httpAgent = this.createAgent(this.proxy, false);
      this.httpsAgent = this.createAgent(this.proxy, true);

      /** Create API */
      this.api = this.createApi();

      /** Apply Delay */
      this.registerDelayInterceptor();

      /** Set XSRF */
      this.registerXSRFInterceptor();

      /** Log API Response */
      if (process.env.NODE_ENV !== "production") {
        this.logApiRequests();
      }

      /** Register extra interceptors */
      if (this.configureApi) {
        this.configureApi();
      }

      /** Set Captcha Solver */
      this.setCaptcha(captcha);

      /** Configure Telegram Web app */
      this.configureTelegramWebApp();
    }

    /* --------------------------------------------------------------------- */
    /* Withdrawal throttle (fleet-wide, persisted)                           */
    /*                                                                       */
    /* Overrides the BaseFarmer no-ops. The queue drains one account at a    */
    /* time and a farmer never overlaps itself, so this read-modify-write on */
    /* the shared per-farmer ledger cannot interleave.                       */
    /* --------------------------------------------------------------------- */

    /** Reserve one of this farmer's hourly withdrawal slots. */
    async reserveWithdrawalSlot() {
      const { withdrawPerHour, withdrawMinGapMs, withdrawalLedgerKey } =
        this.constructor;

      const recent = (await cache.get(withdrawalLedgerKey)) || [];
      const now = Date.now();
      const { allowed, pruned } = this.constructor.evaluateWithdrawalSlot(
        recent,
        now,
        withdrawPerHour,
        withdrawMinGapMs,
      );

      if (!allowed) {
        /* Persist the pruned list so stale timestamps don't accumulate. */
        if (pruned.length !== recent.length) {
          await cache.set(withdrawalLedgerKey, pruned);
        }
        return false;
      }

      pruned.push(now);
      await cache.set(withdrawalLedgerKey, pruned);
      this._withdrawalSlotTs = now;
      return true;
    }

    /** Hand back a slot reserved this run when the send ultimately failed. */
    async releaseWithdrawalSlot() {
      const ts = this._withdrawalSlotTs;
      if (!ts) return;
      this._withdrawalSlotTs = null;

      const { withdrawalLedgerKey } = this.constructor;
      const recent = (await cache.get(withdrawalLedgerKey)) || [];
      const index = recent.indexOf(ts);
      if (index !== -1) {
        recent.splice(index, 1);
        await cache.set(withdrawalLedgerKey, recent);
      }
    }

    /** Create Axios Instance */
    createApi() {
      return axios.create({
        timeout: 60_000,
        httpAgent: this.httpAgent,
        httpsAgent: this.httpsAgent,
        headers: {
          common: {
            ["sec-ch-ua"]:
              '"Android WebView";v="131", "Chromium";v="131", "Not_A Brand";v="24"',
            ["sec-ch-ua-arch"]: '""',
            ["sec-ch-ua-arch-full-version"]: '""',
            ["sec-ch-ua-bitness"]: '""',
            ["sec-ch-ua-full-version-list"]: "",
            ["sec-ch-ua-mobile"]: "?0",
            ["sec-ch-ua-model"]: '""',
            ["sec-ch-ua-platform"]: '"Android"',
            ["sec-ch-ua-platform-version"]: '""',
            ["sec-fetch-dest"]: "empty",
            ["sec-fetch-mode"]: "cors",
            ["sec-fetch-site"]: "same-origin",
            ["x-requested-with"]: "org.telegram.messenger",
            ["User-Agent"]: this.userAgent,
            ["Origin"]: `https://${this.constructor.host}`,
            ["Referer"]: `https://${this.constructor.host}/`,
            ["Referrer-Policy"]: "strict-origin-when-cross-origin",
            ["Cache-Control"]: "no-cache",
          },
        },
      });
    }

    /** Register XSRF Interceptor */
    registerXSRFInterceptor() {
      if (this.constructor.withXSRFToken) {
        this.api.interceptors.request.use(async (config) => {
          const xsrfToken = (
            await this.getCookies({ url: `https://${this.constructor.host}` })
          ).find((cookie) => cookie.name === "XSRF-TOKEN")?.value;

          if (xsrfToken) {
            config.headers["X-XSRF-TOKEN"] = xsrfToken;
          }
          return config;
        });
      }
    }

    /** Log API Requests */
    logApiRequests() {
      this.api.interceptors.response.use(
        (response) => {
          const url = response.config.url;
          const title = this.utils.truncateAndPad(this.account.id, 10);
          const status = this.utils.truncateAndPad(response.status, 3);
          const method = this.utils.truncateAndPad(
            response.config.method.toUpperCase(),
            4,
          );

          /** Log to Console */
          this.logger.output(
            `${this.logger.chalk.bold.blue(
              `${title}`,
            )} ${this.logger.chalk.bold.cyan(
              `${method}`,
            )} ${this.logger.chalk.bold.green(`${status} ${url}`)}`,
          );
          return response;
        },
        (error) => {
          const url = error.config.url;
          const title = this.utils.truncateAndPad(this.account.id, 10);
          const status = this.utils.truncateAndPad(
            error.response?.status || "ERR",
            3,
          );

          const method = this.utils.truncateAndPad(
            error.config.method.toUpperCase(),
            4,
          );

          /** Log to Console */
          this.logger.log(
            `${this.logger.chalk.bold.blue(
              `${title}`,
            )} ${this.logger.chalk.bold.cyan(
              `${method}`,
            )} ${this.logger.chalk.bold.red(`${status} ${url}`)}`,
          );
          return Promise.reject(error);
        },
      );
    }

    /** Create HTTP Agent */
    createAgent(proxy, isHttps) {
      const ProxyAgentType = isHttps ? HttpsProxyAgent : HttpProxyAgent;
      const ProxyAgentWithCookiesType = isHttps
        ? HttpsProxyAgentWithCookies
        : HttpProxyAgentWithCookies;
      const CookiesAgentType = isHttps ? HttpsCookieAgent : HttpCookieAgent;

      if (proxy) {
        return this.constructor.cookies
          ? new ProxyAgentWithCookiesType({
              timeout: 30_000,
              cookies: { jar: this.jar },
              proxy,
            })
          : new ProxyAgentType({ proxy, timeout: 30_000 });
      } else {
        return this.constructor.cookies
          ? new CookiesAgentType({ cookies: { jar: this.jar } })
          : null;
      }
    }

    /** Get Cookies */
    async getCookies({ url }) {
      const cookies = await this.jar.getCookies(url);
      return cookies.map((cookie) => ({
        name: cookie.key,
        value: cookie.value,
      }));
    }

    /** Restore Cookies */
    async restoreCookies() {
      const list = this.farmer.cookies || [];

      for (const item of list) {
        for (const cookie of item.cookies) {
          await this.jar.setCookie(
            new Cookie({
              ...cookie,
              key: cookie.key || cookie.name,
              expiryTime: cookie.expiryTime || cookie.expirationDate,
            }),
            item.url,
          );
        }
      }
    }

    /** Prepare Instance */
    async prepare() {
      const needsAuth = !this.constructor.cacheAuth || !this.farmer;

      /** Create Farmer */
      if (!this.farmer) {
        this.farmer = await this.account.createFarmer({
          errorCount: 0,
          isBanned: false,
          active: true,
          farmer: this.constructor.id,
          headers: {},
          cookies: [],
          initData: "",
        });
      }

      /** Update WebAppData */
      if (this.constructor.platform === "telegram" && this.account.session) {
        try {
          /** Create Telegram Client */
          this.client = await GramClient.create(this.account.session);

          /** Connect */
          await this.client.connect();

          /** Update the web app data */
          if (this.constructor.type === "webapp") {
            await this.updateWebAppData();
          }
        } catch (e) {
          this.logger.error("Failed to update WebAppData", e.message);
        }
      }

      /** Set Telegram Web App */
      this.configureTelegramWebApp();

      /** Restore Cookies */
      if (this.constructor.cookies) {
        await this.restoreCookies();
      }

      /** Prepare Auth Headers */
      if (needsAuth) {
        await this.prepareAuth();
      }

      /** Set Auth Headers */
      if (this.farmer.headers) {
        this.setAuthHeaders(this.farmer.headers);
      }

      /** Fetch Meta */
      await this.fetchMeta();

      /** Save Farmer */
      if (this.farmer.changed()) {
        await this.farmer.save();
      }

      return this;
    }

    /** Configure Telegram Web App */
    configureTelegramWebApp() {
      /** Set Telegram Web App */
      if (
        this.constructor.platform === "telegram" &&
        this.constructor.type === "webapp" &&
        this.farmer
      ) {
        this.setTelegramWebApp(this.farmer.telegramWebApp);
      }
    }

    /** Prepare Auth */
    async prepareAuth() {
      const auth = await this.fetchAuth();
      const headers = await this.getAuthHeaders(auth);
      this.farmer.setHeaders(headers);
    }

    /**
     * Get and update the initData using the telegram link for this farmer
     */
    async updateWebAppData() {
      /** Log link for init data */
      this.logger.info(
        `[${this.account.id}] Updating init data:`,
        this.constructor.telegramLink,
      );

      const { url } = await this.client.getWebview(
        this.constructor.telegramLink,
      );
      const { initData } = this.utils.extractTgWebAppData(url);

      this.farmer.initData = initData;

      this.logger.success("Successfully updated init data!");
    }

    /** Disconnect Farmer */
    async disconnect() {
      try {
        if (this.farmer) {
          this.farmer.active = false;
          await this.farmer.save();
        }
      } catch (error) {
        this.logger.error("Error disconnecting farmer:", error);
      }
    }

    /** Reset error count */
    async resetErrorCount() {
      try {
        if (this.farmer && this.farmer.errorCount > 0) {
          /** Set as active */
          this.farmer.active = true;

          /** Unban the farmer */
          this.farmer.isBanned = false;

          /** Reset error count */
          this.farmer.errorCount = 0;

          /** Save */
          await this.farmer.save();
        }
      } catch (error) {
        this.logger.error("Error resetting error count:", error);
      }
    }

    /** Terminate instance */
    static terminate(id) {
      const instance = this.runners.get(id);
      if (instance) {
        instance.controller.abort();
      }
    }

    /** Execute farming for an instance
     * @param {Runner} instance
     */
    static async execute(instance, skipExecution = false) {
      try {
        /** Prepare instance */
        await instance.prepare();

        /** Update the primary farmer link */
        await this.updatePrimaryFarmerLink(instance);

        /** Start instance */
        if (!skipExecution) {
          await instance.start();
        }

        /** Reset error count */
        await instance.resetErrorCount();

        /** Log success */
        this.logger.success(`[${instance.account.id}] Farming completed`);
      } catch (error) {
        /*
         * A SkipRun (see @nile/shared/lib/SkipRun.js) is a deliberate,
         * non-error stop - e.g. the drop is in maintenance. Leave the account
         * untouched (no error notification, no deactivation, no error-count
         * change) and let the next scheduled run try again. Checked via the
         * brand rather than instanceof so it holds across module copies.
         */
        if (error?.isSkipRun) {
          this.logger.info(
            `[${instance.account.id}] Run skipped: ${error.message}`,
          );
          return;
        }

        if (this.deactivateOnError) {
          await instance.disconnect();
        }

        /** Log error */
        this.logger.error("Error farming account:", instance.account.id, error);

        /** Send error message */
        await bot?.sendFarmerErrorMessage(
          this.id,
          this.title,
          instance.account.id,
          instance.currentTask,
          error.message || "Unknown error!",
        );
      }
    }

    /** Update the primary farmer link
     * @param {Runner} instance
     */
    static async updatePrimaryFarmerLink(instance) {
      try {
        let referralLink = this.referralLinks.get(instance.account.id);

        if (!referralLink) {
          referralLink = await instance.getReferralLink();
          this.referralLinks.set(instance.account.id, referralLink);
        }

        if (
          this.primaryFarmerLink ||
          instance.account.id !== this.primaryAccountId
        ) {
          return;
        }

        /** Update the primary farmer link */
        this.primaryFarmerLink = referralLink;

        /** Configure the primary farmer link */
        this.configurePrimaryLink(this.primaryFarmerLink);

        /** Log */
        this.logger.force(() =>
          this.logger.success(
            `${this.title} Farmer - updated primary farmer link:`,
            this.primaryFarmerLink,
          ),
        );
      } catch (e) {
        /** Log */
        this.logger.force(() => {
          /** Log error */
          this.logger.error(
            `${this.title} Farmer - failed to update primary farmer link:`,
            e,
          );
        });

        /** Reset the primary farmer link */
        this.resetPrimaryFarmerLink(instance);
      }
    }

    /** Process queue */
    static async processQueue() {
      if (this.isProcessingQueue) return;
      this.isProcessingQueue = true;

      try {
        while (this.queue.length > 0 || !this.feedDone) {
          /** Wait for the next staggered account to be fed */
          if (this.queue.length === 0) {
            await delay(250, { precised: true });
            continue;
          }

          let skipExecution = false;
          let instance;

          /** Prioritize primary account is the primary link is not set */
          const primaryIndex = !this.primaryFarmerLink
            ? this.queue.findIndex(
                (item) => item.account.id === this.primaryAccountId,
              )
            : -1;

          /** Prioritize new accounts */
          const newAccountIndex =
            primaryIndex === -1
              ? this.queue.findIndex((item) => !item.account.farmer)
              : -1;

          if (primaryIndex !== -1) {
            instance = this.queue.splice(primaryIndex, 1)[0];

            /** Log */
            this.logger.info(
              "Prioritizing primary account:",
              this.primaryAccountId,
            );
          } else if (newAccountIndex !== -1) {
            instance = this.queue.splice(newAccountIndex, 1)[0];

            /** Configure skipping execution */
            skipExecution = this.skipExecutionOfNewAccount;

            /** Log */
            this.logger.info("Prioritizing new account:", instance.account.id);
          } else {
            instance = this.queue.shift();
          }

          try {
            await this.execute(instance, skipExecution);

            /** Capture the final result while the instance is still alive */
            this.lastResults.set(
              instance.account.id,
              this.getResult(instance.account),
            );
          } catch (err) {
            /** Log error */
            this.logger.error("Queue processing error:", err);

            /** Unblock queue */
            if (instance.account.id === this.primaryAccountId) {
              this.resetPrimaryFarmerLink(instance);
            }
          }
        }
      } finally {
        this.runners.clear();
        this.isProcessingQueue = false;
        this.feedDone = false;
      }
    }

    /** Reset primary farmer link */
    static resetPrimaryFarmerLink(instance) {
      if (
        this.primaryFarmerLink ||
        instance.account.id !== this.primaryAccountId
      )
        return;

      /** Update link */
      this.primaryFarmerLink =
        this.platform === "telegram" ? this.telegramLink : this.link;

      /** Log */
      this.logger.force(() =>
        this.logger.warn(
          `${this.title} Farmer - configuring default farmer link:`,
          this.primaryFarmerLink,
        ),
      );
    }

    /** Prepare an account */
    static prepare(account) {
      if (!this.runners.has(account.id)) {
        const instance = new this(account);
        this.runners.set(account.id, instance);
        this.queue.push(instance);
      }
    }

    /** Get Result */
    static getResult(account) {
      const instance = this.runners.get(account.id);
      if (!instance) {
        return { status: "skipped" };
      }

      return {
        status: instance.currentTask ? "running" : "started",
        startedAt: instance.startedAt,
        currentTaskStartedAt: instance.currentTaskStartedAt,
        currentTask: instance.currentTask,
        elapsed: instance.getElapsedTime(),
      };
    }

    /** Run the farmer for all subscribed accounts */
    static async run({ user } = {}) {
      try {
        /** Determine if farmer is required based on platform */
        const farmerIsRequired = this.platform !== "telegram";

        /** Fetch accounts with farmer and active subscription */
        const accountsWithFarmer = await db.Account.findSubscribedWithFarmer(
          this.id,
        );

        /** Fetch Subscribed Accounts */
        let subscribedList = accountsWithFarmer;

        if (farmerIsRequired) {
          /** Filter accounts without farmer */
          subscribedList = subscribedList.filter((item) => item.farmer);
        }

        /** Filter by user if specified */
        if (user) {
          subscribedList = subscribedList.filter(
            (item) => Number(item.id) === Number(user),
          );
        }

        /** Filter unbanned accounts */
        const accounts = subscribedList.filter((item) => {
          return !item.farmer?.isBanned;
        });

        /** Get accounts to be executed  */
        const executableList = accounts;

        if (executableList.length === 0) {
          return this.logger.success(`> ${this.title} Farmer: no accounts`);
        }

        /** Window start timestamp */
        const windowStart = Date.now();

        /** Sort by permanent stagger offset so the same account stays in
         *  the same time band every window */
        const scheduled = executableList
          .map((account) => ({
            account,
            offsetMs: this.getStaggerOffsetMs(account.id),
          }))
          .sort((a, b) => a.offsetMs - b.offsetMs);

        /** Reset feeding flag */
        this.feedDone = false;
        this.lastResults.clear();

        /**
         * Start the sequence processor (stays alive until feeding is done).
         *
         * The rejection handler is attached *here*, at creation. The feeding
         * loop below parks on `await delay(...)` for up to the whole stagger
         * window before `await processing` is ever reached, so a rejection in
         * that gap would be an *unhandled* rejection — fatal under
         * `fastify start` (close-with-grace calls `process.exit(1)`), which is
         * why the run died mid-window and the summary message never sent.
         */
        const processing = this.processQueue().catch((error) => {
          this.logger.error("Farming queue processing failed:", error);
        });

        /** Feed accounts to the queue at their staggered times */
        for (const { account, offsetMs } of scheduled) {
          const remaining = offsetMs - (Date.now() - windowStart);
          if (remaining > 0) {
            await delay(remaining, { precised: true });
          }
          this.prepare(account);
        }

        /** Signal that all accounts were fed; wait for the queue to finish */
        this.feedDone = true;
        await processing;

        /** Get results */
        const results = executableList.map((account) => {
          return {
            account,
            result: this.lastResults.get(account.id) || {
              status: "skipped",
            },
          };
        });

        /** Send Farming Summary Message */
        try {
          await bot?.sendFarmingInitiatedMessage({
            id: this.id,
            title: `${this.emoji} ${this.title}`,
            link: this.link,
            telegramLink: this.telegramLink,
            threadId: this.threadId,
            totalCount: accountsWithFarmer.length,
            executedCount: executableList.length,
            results,
          });
        } catch (error) {
          this.logger.error("Failed to send farming notification:", error);
        }
      } catch (error) {
        this.logger.error("Error during run:", error);
      } finally {
        this.logger.success(`> ${this.title} Farmer Initiated`);
      }
    }
  };
}
