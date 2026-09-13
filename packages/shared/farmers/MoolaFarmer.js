import BaseFarmer from "../lib/BaseFarmer.js";

/**
 * Moola
 *
 * A Telegram crypto-mining mini-app served from moola-peach.vercel.app.
 * Auth is the raw Telegram init data echoed in the `x-init-data` header on
 * every request (Origin/Referer = https://moola-peach.vercel.app).
 *
 * A run starts/keeps the 24h mining session, claims the daily check-in,
 * watches the daily ad quotas (watch / verify / watch2), and attempts the
 * social tasks that are not already done.
 */

const API_URL = "https://moola-peach.vercel.app";

/**
 * Endpoint used to claim accrued mining yield once a mining session completes.
 * This was NOT captured in the HARs provided, so the value below is a best
 * guess — confirm it against a capture of the app's claim action before
 * shipping.
 */
const MINING_CLAIM_URL = "/api/mine/claim";

/**
 * Onboarding tasks require the account to actually join the target first.
 * TaskId → Telegram link. `join_channel` is Moola's own channel; `join_partner`
 * is the ATF partner bot (started via the MTProto client).
 */
const ONBOARDING_LINKS = {
  join_channel: "https://t.me/moolaTg",
  join_partner: "https://t.me/ATF_AIRDROP_bot",
};

/**
 * Social task ids observed in the capture. Each is a POST to
 * `/api/tasks/social` with `{ taskId }`. Tasks already present in the
 * account's `socialDone` list are skipped. Some of these (e.g. real X/YT
 * engagement) require actions the server only credits when actually done, so
 * they may simply not credit — that is handled gracefully.
 */
const SOCIAL_TASKS = [
  "join_channel",
  "join_partner",
  "join_moola_solana",
  "join_dollarbumper",
  "follow_whatsapp",
  "follow_x",
  "subscribe_youtube",
  "retweet",
  "react_post",
  "boost_channel",
  "channel_join",
  "yt_comment",
  "yt_like",
  "yt_share",
  "yt2_comment",
  "x_engage_all",
  "x_comment",
  "x_vote",
  "x_like",
  "x_retweet2",
  "tt_comment1",
  "tt_like2",
  "tt_follow",
  "tt_share",
  "fb_follow",
  "fb_engage",
];

export default class MoolaFarmer extends BaseFarmer {
  static id = "moola";
  static title = "Moola";
  static emoji = "🐄";
  static host = "moola-peach.vercel.app";
  static domains = ["moola-peach.vercel.app"];
  static telegramLink = "https://t.me/MoolasBot";
  static path = "/";
  static referrerMode = "random";
  static singleton = true;
  static rating = 5;
  static cacheAuth = false;
  static apiDelay = 500;
  static interval = "*/10 * * * *";

  /** Auth is the raw init data echoed in `x-init-data`. */
  fetchAuth() {
    return this.getInitData();
  }

  /** Headers the API wants on every call. */
  getAuthHeaders(data) {
    return data ? { "x-init-data": data } : {};
  }

  /* --------------------------------------------------------------------- */
  /* Transport                                                             */
  /* --------------------------------------------------------------------- */

  post(path, payload = {}) {
    return this.api
      .post(`${API_URL}${path}`, payload, { signal: this.signal })
      .then((res) => res.data);
  }

  readError(error) {
    return error?.response?.data?.error || error?.message || "Unknown error";
  }

  /* --------------------------------------------------------------------- */
  /* Login                                                                 */
  /* --------------------------------------------------------------------- */

  /**
   * Register/login. The app only accepts `/api/onboard` once the onboarding
   * join tasks are completed (join_channel, join_partner), so we post those
   * first, then submit. Repeating an already-done task is harmless — the
   * server treats it as already-done (seen in the capture), so we always
   * attempt them.
   */
  async login() {
    for (const [taskId, link] of Object.entries(ONBOARDING_LINKS)) {
      if (this.signal?.aborted) break;
      // Join the target through Telegram first — the task only credits once
      // the account is actually subscribed/started.
      await this.joinOnboardingLink(link);
      try {
        const result = await this.post("/api/tasks/social", { taskId });
        this.user_data = result.user || this.user_data;
        const done = new Set(this.user_data?.socialDone || []);
        if (done.has(taskId)) {
          this.logger.success(`Onboarding task done: ${taskId}`);
        } else {
          this.logger.info(`Onboarding task not credited yet: ${taskId}`);
        }
      } catch (error) {
        this.logger.warn(
          `Onboarding task "${taskId}" failed:`, this.readError(error),
        );
      }
    }

    const result = await this.post("/api/onboard", {});
    if (!result?.user) {
      throw new Error("Onboard failed: " + (result?.error || "no user"));
    }
    this.user_data = result.user;
    return this.user_data;
  }

  /**
   * Join a Telegram channel or start a partner bot via the MTProto client.
   * Channel links (t.me/moolaTg) use JoinChannel; bot links start the bot so
   * the partner registers the account.
   */
  async joinOnboardingLink(link) {
    if (!link || !this.canJoinTelegramLink(link)) return false;
    try {
      if (this.utils.isTelegramChatLink(link)) {
        return await this.tryToJoinTelegramLink(link);
      }
      await this.client.startBotFromLink({ link });
      return true;
    } catch (error) {
      this.logger.warn("Telegram join failed:", error.message);
      return false;
    }
  }

  /** Re-read the account state. `/api/me` returned an empty body in the
   *  capture, so we reuse the idempotent `/api/onboard` to refresh. */
  async refreshUserData() {
    const result = await this.post("/api/onboard", {});
    this.user_data = result?.user || this.user_data;
    return this.user_data;
  }

  /* --------------------------------------------------------------------- */
  /* Logging                                                               */
  /* --------------------------------------------------------------------- */

  async logUserInfo() {
    const user = this.user_data || {};
    this.logger.newline();
    this.logCurrentUser();

    this.logger.keyValue("Balance", user.balance ?? "0");
    this.logger.keyValue("Lifetime", user.lifetime ?? "0");
    this.logger.keyValue("Level", user.level ?? "1");
    this.logger.keyValue("Hashrate", user.hashrate ?? "0");
    this.logger.keyValue("Daily Yield", user.dailyYield ?? "0");

    const mining = user.mining || {};
    this.logger.keyValue(
      "Mining Active",
      mining.active ? "Yes" : "No",
      { valueStyle: mining.active ? this.logger.c.greenBright : this.logger.c.redBright },
    );
    if (mining.active && mining.endsAt) {
      this.logger.keyValue(
        "Mining Ends In",
        this.utils.dateFns.formatDistanceToNowStrict(new Date(mining.endsAt)),
      );
    }
    this.logger.keyValue("Pending Yield", mining.pending ?? "0");

    const checkin = user.checkin || {};
    this.logger.keyValue(
      "Check-in",
      checkin.canClaim ? "Available" : `Day ${checkin.day ?? 0}`,
      { valueStyle: checkin.canClaim ? this.logger.c.greenBright : undefined },
    );

    const ads = user.ads || {};
    this.logger.keyValue(
      "Ads Watched",
      `${ads.watched ?? 0}/${ads.watchTotal ?? 0}`,
    );
    this.logger.keyValue(
      "Ads Verified",
      `${ads.verified ?? 0}/${ads.verifyTotal ?? 0}`,
    );
    this.logger.newline();
  }

  /* --------------------------------------------------------------------- */
  /* Mining                                                                */
  /* --------------------------------------------------------------------- */

  /** Start (or keep) the 24h mining session. */
  async startMining() {
    const mining = this.user_data?.mining || {};
    if (mining.active) {
      this.logger.info("Mining already active.");
      return;
    }

    const result = await this.post("/api/mine/start", {});
    this.user_data = result.user;
    this.logger.success("Mining session started.");
  }

  /** Claim accrued yield once the 24h mining session has completed. */
  async claimMining() {
    const mining = this.user_data?.mining || {};
    if (!mining.complete) {
      if (mining.active) {
        this.logger.info("Mining still running — nothing to claim yet.");
      }
      return;
    }

    try {
      const result = await this.post(MINING_CLAIM_URL, {});
      this.user_data = result.user || this.user_data;
      this.logger.success("Mining yield claimed.");
    } catch (error) {
      this.logger.warn("Could not claim mining:", this.readError(error));
    }
  }

  /* --------------------------------------------------------------------- */
  /* Check-in                                                              */
  /* --------------------------------------------------------------------- */

  /** Claim the daily check-in reward when available. */
  async claimCheckin() {
    const checkin = this.user_data?.checkin || {};
    if (!checkin.canClaim) {
      this.logger.info("Daily check-in already claimed.");
      return;
    }

    const result = await this.post("/api/tasks/checkin", {});
    this.user_data = result.user;
    this.logger.success("Daily check-in claimed.");
  }

  /* --------------------------------------------------------------------- */
  /* Ads                                                                   */
  /* --------------------------------------------------------------------- */

  /** Watch the three daily ad quotas (watch / verify / watch2). */
  async watchAds() {
    let ads = this.user_data?.ads || {};

    const quotas = [
      { key: "watched", total: "watchTotal", type: "watch" },
      { key: "verified", total: "verifyTotal", type: "verify" },
      { key: "watched2", total: "watch2Total", type: "watch2" },
    ];

    for (const quota of quotas) {
      if (this.signal?.aborted) break;
      let done = Number(ads[quota.key]) || 0;
      const total = Number(ads[quota.total]) || 0;

      while (done < total) {
        if (this.signal?.aborted) break;
        try {
          const result = await this.post("/api/tasks/ad", { type: quota.type });
          this.user_data = result.user;
          ads = this.user_data?.ads || {};
          done = Number(ads[quota.key]) || 0;
          this.logger.info(
            `Ad (${quota.type}): ${done}/${total}`,
          );
        } catch (error) {
          this.logger.warn(`Ad (${quota.type}) failed:`, this.readError(error));
          break;
        }
      }

      if (done >= total && total > 0) {
        this.logger.success(`Ad quota done: ${quota.type} (${done}/${total}).`);
      }
    }
  }

  /* --------------------------------------------------------------------- */
  /* Social tasks                                                          */
  /* --------------------------------------------------------------------- */

  /** Attempt every social task that is not already done. */
  async completeSocialTasks() {
    const done = new Set(this.user_data?.socialDone || []);
    const pending = SOCIAL_TASKS.filter((id) => !done.has(id));

    if (pending.length === 0) {
      this.logger.info("All social tasks already done.");
      return;
    }

    this.logger.info(`Social tasks left: ${pending.length}.`);
    for (const taskId of pending) {
      if (this.signal?.aborted) break;
      try {
        const result = await this.post("/api/tasks/social", { taskId });
        this.user_data = result.user;
        const stillDone = new Set(this.user_data?.socialDone || []);
        if (stillDone.has(taskId)) {
          this.logger.success(`Completed social task: ${taskId}`);
        } else {
          this.logger.info(
            `Social task not credited (may need manual action): ${taskId}`,
          );
        }
      } catch (error) {
        this.logger.warn(`Social task "${taskId}" failed:`, this.readError(error));
      }
    }
  }

  /* --------------------------------------------------------------------- */
  /* Process                                                               */
  /* --------------------------------------------------------------------- */

  async process() {
    await this.login();

    await this.logUserInfo();
    await this.executeTask("Claim Mining", () => this.claimMining());
    await this.executeTask("Mining", () => this.startMining());
    await this.executeTask("Check-in", () => this.claimCheckin());
    await this.executeTask("Ads", () => this.watchAds());
    await this.executeTask("Social Tasks", () => this.completeSocialTasks());
  }
}
