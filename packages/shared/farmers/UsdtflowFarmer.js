import BaseFarmer from "../lib/BaseFarmer.js";

/**
 * USDT Flow
 *
 * A USDT-earning tap-ads app served from usdtflow.ru. Auth is the Telegram
 * init data echoed in the `x-telegram-init-data` header on every request.
 * A run claims quests, watches ads until the daily caps, and collects the
 * daily bonus.
 */

const API_URL = "https://usdtflow.ru/api";

/** Ad providers in the order the app uses them. */
const AD_PROVIDERS = [
  "gigapub",
  "towerads",
  "adsgram",
  "monetix",
  "tads_fullscreen",
  "adexium",
];

/** Providers the app falls back to a link-based flow for. */
const LINK_FLOW_PROVIDERS = new Set(["gigapub", "adexium"]);

const COOLDOWN_SECONDS = 4;

export default class UsdtflowFarmer extends BaseFarmer {
  static id = "usdt-flow";
  static title = "USDT Flow";
  static emoji = "🌊";
  static host = "usdtflow.ru";
  static domains = ["usdtflow.ru", "t.me"];
  static telegramLink = "https://t.me/UsdtTonFlow_bot?startapp=U31M4894";
  static path = "/";
  static referrerMode = "random";
  static singleton = true;
  static rating = 5;
  static cacheAuth = false;
  static interval = "*/10 * * * *";

  /** Auth is the raw init data echoed in `x-telegram-init-data`. */
  fetchAuth() {
    return this.getInitData();
  }

  /** Headers the API wants on every call. */
  getAuthHeaders(data) {
    return data ? { "x-telegram-init-data": data } : {};
  }

  /* --------------------------------------------------------------------- */
  /* Transport                                                             */
  /* --------------------------------------------------------------------- */

  get(path, params) {
    return this.api
      .get(`${API_URL}${path}`, { params, signal: this.signal })
      .then((res) => res.data);
  }

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

  /** Register/login with the init data. */
  async login() {
    const initData = this.getInitData();
    const result = await this.post("/auth/telegram", { initData });
    if (!result?.user) throw new Error("Login failed: " + (result?.msg || "no user"));
    this.user_data = result.user;
    return this.user_data;
  }

  /** Profile state (fresh numbers incl. balance). */
  getState() {
    return this.get("/user");
  }

  /* --------------------------------------------------------------------- */
  /* Logging                                                               */
  /* --------------------------------------------------------------------- */

  async logUserInfo() {
    const user = this.user_data;
    this.logger.newline();
    this.logCurrentUser();
    this.logger.keyValue("Balance USDT", user?.balance_usdt ?? "0");
    this.logger.keyValue("Balance TON", user?.balance_ton ?? "0");
    this.logger.keyValue("Total Earned", user?.total_earned ?? "0");
    this.logger.keyValue("Referral Code", user?.referral_code ?? "-");
    this.logger.keyValue("Referral %", user?.ref_percent ?? 0);
    this.logger.keyValue("Completed Tasks", user?.completed_tasks ?? user?.tasks_count ?? 0);
    this.logger.newline();
  }

  /* --------------------------------------------------------------------- */
  /* Tasks                                                                 */
  /* --------------------------------------------------------------------- */

  /** Claim every claimable task across the own/partner/ads tabs. */
  async completeTasks() {
    let claimed = 0;
    for (const type of ["own", "partner", "ads"]) {
      if (this.signal?.aborted) break;
      const list = await this.get(`/tasks`, { type }).catch((e) => {
        this.logger.warn(`Tasks (${type}) failed:`, this.readError(e));
        return [];
      });
      const tasks = Array.isArray(list) ? list : [];
      const pending = tasks.filter((t) => !t.completed);
      this.logger.info(`${type} tasks: ${pending.length}/${tasks.length} left.`);
      for (const task of pending) {
        if (this.signal?.aborted) break;
        claimed += Number(await this.claimTask(task)) || 0;
      }
    }
    if (claimed) this.logger.success(`Completed ${claimed} task(s).`);
    else this.logger.info("No tasks to complete.");
  }

  /** Claim a single task, joining/opening its link first when needed. */
  async claimTask(task) {
    const label = task.title || task.name || `task ${task.id}`;

    // Manual tasks require a proof submission — not automatable.
    if (task.type === "manual" || task.manual_submission_status === "pending") {
      this.logger.info(`Skipped manual task: ${label}`);
      return 0;
    }

    // Join/open the target link when the task needs it.
    const link = task.action_url || task.url || task.href || "";
    if (link && this.validateTelegramTask(link)) {
      await this.tryToJoinTelegramLink(link);
    }

    // Provider tasks carry the full object; others just the id.
    const payload = task.provider ? { task } : { task_id: task.id };
    try {
      const result = await this.post("/tasks/complete", payload);
      if (result?.success) {
        const reward = this.formatReward(result.reward_usdt, result.reward_ton);
        this.logger.success(`Completed task: ${label}${reward ? " (" + reward + ")" : ""}`);
        return 1;
      }
      this.logger.info(`Task not credited: ${label} - ${result?.error || "no success"}`);
      return 0;
    } catch (e) {
      this.logger.warn(`Task "${label}" failed:`, this.readError(e));
      return 0;
    }
  }

  formatReward(usdt, ton) {
    const usdtAmount = Number(usdt);
    if (Number.isFinite(usdtAmount) && usdtAmount > 0) {
      return usdtAmount.toFixed(4) + " USDT";
    }
    const tonAmount = Number(ton);
    if (Number.isFinite(tonAmount) && tonAmount > 0) {
      return tonAmount.toFixed(4) + " TON";
    }
    return "";
  }

  /* --------------------------------------------------------------------- */
  /* Ads                                                                   */
  /* --------------------------------------------------------------------- */

  /** Watch ads until the everyday provider caps are hit. */
  async watchAds() {
    const config = await this.get("/ads/config").catch((e) => {
      this.logger.warn("Could not load ad config:", this.readError(e));
      return null;
    });
    if (!config) return 0;

    const limits = config.daily_limits || {};
    const totalLimit = Number(limits.total) || 0;

    let refreshed = 0;
    let earned = 0;
    let attempted = 0;
    while (!this.signal?.aborted) {
      const progress = await this.getAdProgress();
      if (totalLimit && progress >= totalLimit) {
        this.logger.info(`Daily ad limit reached: ${progress}/${totalLimit}.`);
        break;
      }

      let progressed = false;
      for (const provider of AD_PROVIDERS) {
        if (this.signal?.aborted) break;

        const providerLimit = Number(limits[provider]) || 0;
        if (providerLimit) {
          const current = await this.getAdProgress();
          if (current >= providerLimit) continue;
        }

        // The app first tries the SDK flow, falling back to the link flow
        // for providers that offer it. Mirror that preference.
        const flows = ["sdk", ...(LINK_FLOW_PROVIDERS.has(provider) ? ["link"] : [])];
        for (const flow of flows) {
          if (this.signal?.aborted) break;
          const result = await this.post("/ads", { provider, flow }).catch((e) => {
            this.logger.warn(`${provider} (${flow}): ad not credited -`, this.readError(e));
            return null;
          });
          if (!result) continue;
          if (result.success) {
            earned += Number(result.reward_usdt) || 0;
            attempted++;
            this.logger.success(`${provider}: ${this.formatReward(result.reward_usdt, result.reward_ton)}`);
            progressed = true;
            await this.utils.delayForSeconds(COOLDOWN_SECONDS, { signal: this.signal });
            refreshed = progress + 1;
            break;
          }
        }
      }

      if (!progressed) break;
    }

    if (earned) this.logger.success(`Credited ${attempted} ad(s) for ${earned.toFixed(4)} USDT.`);
    else this.logger.info(`No ads credited (${attempted} attempted).`);
    return attempted || refreshed;
  }

  /** Current watched-today counter (refreshed before each provider loop). */
  async getAdProgress() {
    const check = await this.get("/ads").catch(() => null);
    return check?.watched_today != null ? Number(check.watched_today) : 0;
  }

  /* --------------------------------------------------------------------- */
  /* Bonus                                                                 */
  /* --------------------------------------------------------------------- */

  /** Join any outstanding bonus targets, then claim the daily bonus. */
  async claimDailyBonusTask() {
    const bonus = await this.get("/bonus/daily").catch((e) => {
      this.logger.warn("Bonus failed:", this.readError(e));
      return null;
    });
    if (!bonus) return;

    this.debugger.log("Bonus:", bonus);

    if (!bonus.active) {
      this.logger.info("No daily bonus active.");
      return;
    }
    if (bonus.claimed_today) {
      this.logger.info("Daily bonus already claimed.");
      return;
    }

    // Join every not-yet-subscribed target that we can join.
    const targets = Array.isArray(bonus.targets) ? bonus.targets : [];
    for (const target of targets) {
      if (this.signal?.aborted) break;
      if (target.subscribed || !target.href) continue;
      if (this.validateTelegramTask(target.href)) {
        await this.tryToJoinTelegramLink(target.href);
      }
    }

    if (!bonus.all_subscribed) {
      this.logger.warn("Daily bonus targets not all subscribed yet.");
      return;
    }
    if (!bonus.can_claim) {
      this.logger.info("Daily bonus not claimable yet.");
      return;
    }

    const result = await this.post("/bonus/daily", {}).catch((e) => {
      this.logger.warn("Bonus claim failed:", this.readError(e));
      return null;
    });
    if (result?.success) {
      this.logger.success(`Claimed daily bonus (+${this.formatReward(result.reward_usdt, result.reward_ton) || bonus.reward_usdt + " USDT"}).`);
    } else {
      this.logger.info("Daily bonus not credited: " + (result?.error || "unknown"));
    }
  }

  /* --------------------------------------------------------------------- */
  /* Process                                                               */
  /* --------------------------------------------------------------------- */

  async process() {
    await this.login();
    await this.logUserInfo();
    await this.executeTask("Tasks", () => this.completeTasks());
    await this.executeTask("Ads", () => this.watchAds());
    await this.executeTask("Bonus", () => this.claimDailyBonusTask());

    // Refresh the profile so logged numbers reflect the run. Note `/api/user`
    // comes back sanitized (null username/photo), so only merge the numbers
    // into the auth profile instead of replacing it wholesale.
    const fresh = await this.getState().catch(() => null);
    if (fresh) {
      for (const key of [
        "balance_usdt",
        "balance_ton",
        "total_earned",
        "ref_percent",
        "views_count",
        "ads_count",
        "tasks_count",
        "completed_tasks",
      ]) {
        if (fresh[key] != null) this.user_data[key] = fresh[key];
      }
    }
  }

  /* --------------------------------------------------------------------- */
  /* Tools                                                                 */
  /* --------------------------------------------------------------------- */

  createTools() {
    return [
      {
        name: "Ads",
        list: [
          {
            id: "watch-ads",
            icon: "play",
            title: "Watch Ads",
            action: this.watchAds.bind(this),
            dispatch: false,
          },
        ],
      },
      {
        name: "Tasks",
        list: [
          {
            id: "complete-tasks",
            icon: "check",
            title: "Complete Tasks",
            action: this.completeTasks.bind(this),
            dispatch: false,
          },
        ],
      },
    ];
  }
}