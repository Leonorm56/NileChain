import BaseFarmer from "../lib/BaseFarmer.js";

/**
 * ART (ATF) Telegram Mining Web App
 *
 * Served from art.tamimdev.dev with a same-origin REST API under `/api`. Every
 * call carries the raw Telegram init data in an `X-Telegram-Init-Data` header
 * and the Telegram user id in the JSON body (`{ userId }`) — the server reads
 * the header for identity and the body for the target account. There is no
 * signature, no token and no ad-proof: `/api/ads/claim` takes only a userId.
 *
 * A run connects the payout wallet, closes the mining cycle (claim then start),
 * collects the daily ad rewards and works the task list.
 *
 * Verified against two real captures (`test/art.har`, `test/artwallet.har`):
 *
 *   GET  /api/user/:id               user + settings + miningState
 *   GET  /api/tasks/:id              task list (isActive / isCompleted)
 *   GET  /api/ads/status/:id         { watched, limit, remaining, rewardAtf }
 *   GET  /api/miners                 miner upgrade table
 *   GET  /api/referrals/:id          invite link + referral earnings
 *   POST /api/user/start-mining      { userId }
 *   POST /api/user/claim-mining      { userId }
 *   POST /api/ads/claim              { userId }
 *   POST /api/tasks/claim            { userId, taskId }
 *   POST /api/user/connect-wallet    { userId, tonAddress }
 *   POST /api/user/disconnect-wallet { userId }
 *
 * Notes that shaped this implementation:
 *
 * - There is no `/api/ads/start`. The ad itself is played client-side by the
 *   GigaPub SDK (the page loads `ad.gigapub.tech/script?id=8198`) plus a
 *   Monetag fallback, and the reward is granted by `/api/ads/claim` alone.
 *   The daily limit (`adsDailyLimit`, 5) resets 24h after the first ad of the
 *   period, so a run simply drains whatever `remaining` reports.
 * - The mining cycle is 8h (`settings.miningCycleHours`, 28800s). Claiming
 *   clears `miningStartedAt` and the app immediately starts the next cycle, so
 *   mining is resumed on every run instead of only when it happens to be idle.
 * - Task rewards are credited on claim with no completion proof either, but the
 *   client still joins Telegram targets and dwells before claiming, so this
 *   does the same.
 */

const API_URL = "https://art.tamimdev.dev/api";

/** Bot that fronts the mini app — also the referral target (`?start=<id>`). */
const BOT_USERNAME = "ART_AIRDROP_BOT";

/** Claim unlocks above this pending balance, in ATF. */
const MINING_MINIMUM = 1e-4;

/** Client dwell between opening a task target and claiming it. */
const TASK_WAIT_SECONDS = 5;

/** Spacing between ad claims, roughly the length of an ad slot. */
const ADS_WATCH_SECONDS = 10;

export default class ArtFarmer extends BaseFarmer {
  static id = "art";
  static title = "ART";
  static emoji = "🎨";
  static host = "art.tamimdev.dev";
  static domains = ["art.tamimdev.dev", "t.me", "ad.gigapub.tech"];
  static telegramLink = `https://t.me/${BOT_USERNAME}?start=7466223274`;
  static path = "/";
  static referrerMode = "random";
  static singleton = true;
  static rating = 5;
  static cacheAuth = false;
  static interval = "*/10 * * * *";
  static apiDelay = 300;

  /** Get Referral Link (this account's own invite link). */
  getReferralLink() {
    return `https://t.me/${BOT_USERNAME}?start=${this.getUserId()}`;
  }

  /**
   * Auth is the raw Telegram init data. It rides in a header rather than the
   * body, so it is returned from `fetchAuth()` for the framework to cache and
   * also applied per request below.
   */
  fetchAuth() {
    return this.getInitData();
  }

  /** Get Auth Headers */
  getAuthHeaders(data) {
    return this.buildHeaders(data);
  }

  /* --------------------------------------------------------------------- */
  /* Transport                                                             */
  /* --------------------------------------------------------------------- */

  /**
   * Headers the app sends on every call: the init data plus, when present, the
   * JSON content type. `data` lets a caller pass a specific init data string
   * (the framework hands the cached one to `getAuthHeaders`).
   */
  buildHeaders(data, extra = {}) {
    const headers = { ...extra };
    const initData = data || this.getInitData();
    if (initData) headers["X-Telegram-Init-Data"] = initData;
    return headers;
  }

  /** This account's Telegram user id, as the API expects it (a string). */
  getAccountId() {
    const id = this.getUserId();
    if (id === undefined || id === null) {
      throw new Error("No Telegram user id — this account has no mini-app session");
    }
    return String(id);
  }

  /** GET a JSON endpoint. */
  async get(path, params) {
    const query = params
      ? `?${new URLSearchParams(
          Object.entries(params).filter(([, value]) => value != null),
        ).toString()}`
      : "";
    const res = await this.api.get(`${API_URL}${path}${query}`, {
      headers: this.buildHeaders(),
      signal: this.signal,
    });
    return res.data;
  }

  /** POST a JSON body. */
  async post(path, payload = {}) {
    const res = await this.api.post(`${API_URL}${path}`, payload, {
      headers: this.buildHeaders(null, { "Content-Type": "application/json" }),
      signal: this.signal,
    });
    return res.data;
  }

  /** Referral start param, when the account was launched with one. */
  getStartParamPayload() {
    const startParam = this.getStartParam();
    return startParam ? { referredBy: String(startParam) } : {};
  }

  /** Read a message out of whatever error shape came back. */
  readError(error) {
    return (
      error?.response?.data?.error ||
      error?.response?.data?.message ||
      error?.message ||
      "Unknown error"
    );
  }

  /* --------------------------------------------------------------------- */
  /* API wrappers                                                          */
  /* --------------------------------------------------------------------- */

  /** Account state: user, settings and the live mining state. */
  getUser() {
    const params = {
      username: this.getUsername(),
      firstName: this.getUserFirstName(),
      ...this.getStartParamPayload(),
    };
    return this.get(`/user/${this.getAccountId()}`, params);
  }

  /** Full task list for the account. */
  getTasks() {
    return this.get(`/tasks/${this.getAccountId()}`);
  }

  /** Ad reward budget for the current 24h period. */
  getAdsStatus() {
    return this.get(`/ads/status/${this.getAccountId()}`);
  }

  /** Miner upgrade table. */
  getMiners() {
    return this.get("/miners");
  }

  /** Referral summary (invite link, bonus, team earnings). */
  getReferrals() {
    return this.get(`/referrals/${this.getAccountId()}`);
  }

  /** Open the next 8h mining cycle. */
  startMining() {
    return this.post("/user/start-mining", { userId: this.getAccountId() });
  }

  /** Collect everything mined in the closed cycle. */
  claimMining() {
    return this.post("/user/claim-mining", { userId: this.getAccountId() });
  }

  /** Collect one ad reward. */
  claimAd() {
    return this.post("/ads/claim", { userId: this.getAccountId() });
  }

  /** Collect one task reward. */
  claimTask(taskId) {
    return this.post("/tasks/claim", {
      userId: this.getAccountId(),
      taskId,
    });
  }

  /** Attach a payout wallet (address only — no signature is required). */
  connectWallet(tonAddress) {
    return this.post("/user/connect-wallet", {
      userId: this.getAccountId(),
      tonAddress,
    });
  }

  /** Detach the payout wallet. */
  disconnectWallet() {
    return this.post("/user/disconnect-wallet", {
      userId: this.getAccountId(),
    });
  }

  /* --------------------------------------------------------------------- */
  /* Login                                                                 */
  /* --------------------------------------------------------------------- */

  async login() {
    const data = await this.getUser().catch((e) => {
      this.logger.warn("Account fetch failed:", this.readError(e));
      return null;
    });
    if (!data?.user) throw new Error("Failed to load ART account");

    this.user_data = data.user;
    this.settings_data = data.settings || {};
    this.mining_state = data.miningState || {};
    return this.user_data;
  }

  /* --------------------------------------------------------------------- */
  /* Logging                                                               */
  /* --------------------------------------------------------------------- */

  logUserInfo() {
    const user = this.user_data || {};
    const state = this.mining_state || {};
    this.logger.newline();
    this.logCurrentUser();
    this.logger.keyValue("Pool Wallet", `${user.poolWallet ?? 0} ART`);
    this.logger.keyValue("Holding", `${user.holdingWallet ?? 0} ART`);
    this.logger.keyValue("Today PnL", `${user.todayPnl ?? 0} ART`);
    this.logger.keyValue("Total Mined", `${user.allTimeMined ?? 0} ART`);
    this.logger.keyValue("Level", `${user.level ?? 1}`);
    this.logger.keyValue("Mining", this.describeMining(state));
    this.logger.keyValue(
      "Payout Wallet",
      user.tonWalletAddress || "not connected",
    );
    if (this.settings_data?.tokenSymbol) {
      this.logger.keyValue(
        "Min Withdrawal",
        `${this.settings_data.minWithdrawAtf ?? 0} ${this.settings_data.tokenSymbol}`,
      );
    }
  }

  /** Human-readable mining state for the log. */
  describeMining(state) {
    if (!state?.isMining) return "idle";
    const seconds = Number(state.remainingSeconds) || 0;
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.round((seconds % 3600) / 60);
    return `running — ${hours}h ${minutes}m left (${state.accumulatedAtf ?? 0} ART pending)`;
  }

  /* --------------------------------------------------------------------- */
  /* Wallet                                                                */
  /* --------------------------------------------------------------------- */

  /**
   * The account pays out only to a linked TON wallet. Collect the address
   * already on file, or link one when the account has none yet.
   */
  async ensureWallet() {
    const onFile = this.user_data?.tonWalletAddress;
    if (onFile) {
      this.logger.info(`Wallet already connected: ${onFile}.`);
      await this.storeWalletAddress(onFile);
      return true;
    }

    const saved = await this.getWalletAddress();
    if (saved) return this.linkWallet(saved);

    this.logger.warn(
      "No payout wallet linked — use the Connect Wallet tool once, then earnings are withdrawable.",
    );
    return false;
  }

  /**
   * Collect Wallet tool: read the wallet the account has on file (or this
   * profile's saved one) and persist it under this account's storage key, so
   * the address is harvestable per account without touching the API.
   */
  async collectWallet() {
    const onFile = this.user_data?.tonWalletAddress;

    if (!onFile) {
      const remote = await this.getUser().catch(() => null);
      if (remote?.user) {
        this.user_data = { ...this.user_data, ...remote.user };
        this.mining_state = remote.miningState || this.mining_state;
      }
    }

    const address = this.user_data?.tonWalletAddress;
    if (!address) {
      this.logger.warn("This account has no wallet on file yet.");
      return null;
    }

    await this.storeWalletAddress(address);
    this.logger.success(`Wallet collected: ${address}`);
    return address;
  }

  /** Link an address through the app's endpoint and remember it. */
  async linkWallet(address) {
    const result = await this.connectWallet(address).catch((e) => {
      this.logger.warn("Wallet connect failed:", this.readError(e));
      return null;
    });
    if (!result || result.success === false) {
      this.logger.info(
        "Wallet not connected: " + (result?.error || "unknown"),
      );
      return false;
    }

    const onFile =
      result.user?.tonWalletAddress || result.tonWalletAddress || address;
    this.user_data = { ...this.user_data, tonWalletAddress: onFile };
    await this.storeWalletAddress(onFile);
    this.logger.success(`Wallet connected: ${onFile}.`);
    return true;
  }

  /** Link a TON wallet address, prompting for it (Tools button). */
  async connectWalletInteractive() {
    const input = await this.promptInput("Enter your TON wallet address:");
    const address = (input || "").trim();
    if (!address) {
      this.logger.warn("No address provided.");
      return;
    }
    await this.linkWallet(address);
  }

  /** Detach the wallet from this account (Tools button). */
  async disconnectWalletInteractive() {
    const result = await this.disconnectWallet().catch((e) => {
      this.logger.warn("Wallet disconnect failed:", this.readError(e));
      return null;
    });
    if (!result || result.success === false) {
      this.logger.info(
        "Wallet not disconnected: " + (result?.error || "unknown"),
      );
      return;
    }
    this.user_data = { ...this.user_data, tonWalletAddress: null };
    this.walletAddress = null;
    try {
      await this.storage?.remove?.("wallet");
    } catch (error) {
      this.debugger.log("Failed to clear stored wallet:", error.message);
    }
    this.logger.success("Wallet disconnected.");
  }

  /** Persist the linked address against this account, when storage exists. */
  async storeWalletAddress(address) {
    this.walletAddress = address;
    try {
      await this.storage?.set("wallet", {
        address,
        userId: this.getUserId() ?? null,
        collectedAt: new Date().toISOString(),
      });
    } catch (error) {
      this.debugger.log("Failed to store wallet:", error.message);
    }
  }

  /** The linked address, from this run or a previous one. */
  async getWalletAddress() {
    if (this.walletAddress) return this.walletAddress;
    try {
      const saved = await this.storage?.get("wallet");
      if (saved?.address) this.walletAddress = saved.address;
    } catch (error) {
      this.debugger.log("Failed to read stored wallet:", error.message);
    }
    return this.walletAddress || null;
  }

  /* --------------------------------------------------------------------- */
  /* Mining                                                                */
  /* --------------------------------------------------------------------- */

  /**
   * Close a finished cycle and keep one running. Claiming is only accepted
   * while the cycle is closed (or its 8h have elapsed), which is why the claim
   * happens before the restart.
   */
  async syncMining() {
    const state = this.mining_state || {};
    const pending = Number(state.accumulatedAtf) || 0;

    if (state.isMining && (Number(state.remainingSeconds) || 0) > 0) {
      this.logger.info(
        `Cycle in progress — ${Number(state.accumulatedAtf) || 0} ART pending, ${this.describeMining(state)}.`,
      );
      return;
    }

    if (pending > MINING_MINIMUM) {
      await this.claimMiningRewards();
    } else {
      this.logger.info(`Nothing to claim yet (${pending} ART).`);
    }

    await this.startMiningCycle();
  }

  /** Collect the closed cycle's output. */
  async claimMiningRewards() {
    const result = await this.claimMining().catch((e) => {
      if (e?.response?.status === 400) {
        this.logger.info("Mining claim refused (nothing accrued) — next run.");
        return null;
      }
      this.logger.warn("Mining claim failed:", this.readError(e));
      return null;
    });
    if (!result) return;

    if (result.success === false) {
      this.logger.info("Mining not credited: " + (result.error || "unknown"));
      return;
    }

    if (result.user) this.user_data = { ...this.user_data, ...result.user };
    if (result.miningState) this.mining_state = result.miningState;
    this.logger.success(`Claimed mining (+${result.claimedAtf ?? 0} ART).`);
  }

  /** Open the next 8h cycle. */
  async startMiningCycle() {
    const result = await this.startMining().catch((e) => {
      this.logger.warn("Start mining failed:", this.readError(e));
      return null;
    });
    if (!result) return;

    if (result.success === false) {
      this.logger.info("Mining not started: " + (result.error || "unknown"));
      return;
    }

    if (result.user) this.user_data = { ...this.user_data, ...result.user };
    if (result.miningState) this.mining_state = result.miningState;
    this.logger.success("Mining cycle started (8h).");
  }

  /* --------------------------------------------------------------------- */
  /* Ads                                                                   */
  /* --------------------------------------------------------------------- */

  /**
   * Drain the daily ad budget. The reward endpoint takes only the userId — no
   * watch proof is sent by the app either — so each remaining slot is claimed
   * directly, spaced like an ad slot.
   */
  async watchAds() {
    const status = await this.getAdsStatus().catch((e) => {
      this.logger.warn("Ads status failed:", this.readError(e));
      return null;
    });
    if (!status) return;

    if (!status.enabled) {
      this.logger.info("Ad rewards are disabled for this app.");
      return;
    }

    // The budget is the loop bound and must not be reassigned below, or the
    // loop would stop early on the declining `remaining` it reports back.
    const budget = Number(status.remaining) || 0;
    if (budget <= 0) {
      this.logger.info(
        `Daily ad limit reached (${status.watched}/${status.limit}) — resets in ${Math.round(
          (Number(status.resetsInSeconds) || 0) / 3600,
        )}h.`,
      );
      return;
    }

    this.logger.info(
      `${budget} of ${status.limit} ad rewards left in this period.`,
    );

    let claimed = 0;
    let gained = 0;
    for (let index = 0; index < budget; index += 1) {
      if (this.signal?.aborted) break;
      if (index > 0) {
        await this.utils
          .delayForSeconds(ADS_WATCH_SECONDS, { signal: this.signal })
          .catch(() => {});
        if (this.signal?.aborted) break;
      }

      const result = await this.claimAd().catch((e) => {
        this.logger.warn("Ad claim failed:", this.readError(e));
        return null;
      });
      if (!result) break;
      if (result.success === false) {
        this.logger.info("Ad not credited: " + (result.error || "unknown"));
        break;
      }

      claimed += 1;
      gained += Number(result.reward) || 0;
      if (result.user) this.user_data = { ...this.user_data, ...result.user };

      // Stop early only when the server says the budget is spent.
      if (Number(result.remaining) <= 0) break;
    }

    if (claimed) {
      this.logger.success(`Watched ${claimed} ad(s) (+${gained} ART).`);
    } else {
      this.logger.info("No ad rewards credited.");
    }
  }

  /* --------------------------------------------------------------------- */
  /* Tasks                                                                 */
  /* --------------------------------------------------------------------- */

  /** Work every active, unclaimed task: open the target, dwell, claim. */
  async completeTasks() {
    const tasks = await this.getTasks().catch((e) => {
      this.logger.warn("Task list failed:", this.readError(e));
      return null;
    });
    if (!tasks) return;

    const list = Array.isArray(tasks.tasks)
      ? tasks.tasks.filter((task) => task.isActive !== false && !task.isCompleted)
      : [];

    if (!list.length) {
      this.logger.info("No tasks to complete.");
      return;
    }

    this.logger.info(`${list.length} task(s) to complete.`);
    let claimed = 0;
    let gained = 0;

    for (const task of list) {
      if (this.signal?.aborted) break;
      const result = await this.completeTask(task);
      if (result) {
        claimed += 1;
        gained += result;
      }
    }

    if (claimed) this.logger.success(`Completed ${claimed} task(s) (+${gained} ART).`);
    else this.logger.info("No tasks credited.");
  }

  /** Complete a single task with the client's open-then-dwell rhythm. */
  async completeTask(task) {
    const id = task.id;
    const label = task.title || id;
    const url = task.actionUrl || "";

    // Join the Telegram target first when the account can.
    if (url && this.validateTelegramTask(url)) {
      await this.tryToJoinTelegramLink(url);
    }

    await this.utils
      .delayForSeconds(TASK_WAIT_SECONDS, { signal: this.signal })
      .catch(() => {});
    if (this.signal?.aborted) return 0;

    const result = await this.claimTask(id).catch((e) => {
      this.logger.warn(`Task "${label}" failed:`, this.readError(e));
      return null;
    });
    if (!result) return 0;

    if (result.success === false) {
      this.logger.info(`Task not credited: ${label} - ${result.error || "no success"}`);
      return 0;
    }

    if (result.user) this.user_data = { ...this.user_data, ...result.user };
    const reward = Number(result.reward) || 0;
    this.logger.success(`Completed task: ${label} (+${reward} ART)`);
    return reward;
  }

  /* --------------------------------------------------------------------- */
  /* Process                                                               */
  /* --------------------------------------------------------------------- */

  async process() {
    await this.login();
    this.logUserInfo();

    await this.executeTask("Wallet", () => this.ensureWallet());
    await this.executeTask("Mining", () => this.syncMining());
    await this.executeTask("Ads", () => this.watchAds());
    await this.executeTask("Tasks", () => this.completeTasks());

    const fresh = await this.getUser().catch(() => null);
    if (fresh?.user) {
      this.user_data = { ...this.user_data, ...fresh.user };
      this.mining_state = fresh.miningState || this.mining_state;
      this.settings_data = fresh.settings || this.settings_data;
    }
    this.logger.newline();
    this.logger.keyValue(
      "Pool Wallet",
      `${this.user_data?.poolWallet ?? 0} ART`,
    );
  }

  /* --------------------------------------------------------------------- */
  /* Tools                                                                 */
  /* --------------------------------------------------------------------- */

  createTools() {
    return [
      {
        name: "Wallet",
        list: [
          {
            id: "connect-wallet",
            icon: "wallet",
            title: "Connect Wallet",
            action: this.connectWalletInteractive.bind(this),
            dispatch: false,
          },
          {
            id: "collect-wallet",
            icon: "arrow.down.circle",
            title: "Collect Wallet",
            action: this.collectWallet.bind(this),
            dispatch: true,
          },
          {
            id: "disconnect-wallet",
            icon: "xmark",
            title: "Disconnect Wallet",
            action: this.disconnectWalletInteractive.bind(this),
            dispatch: false,
          },
        ],
      },
      {
        name: "Mining",
        list: [
          {
            id: "start-mining",
            icon: "play",
            title: "Start Mining",
            action: this.startMiningCycle.bind(this),
            dispatch: false,
          },
          {
            id: "claim-mining",
            icon: "hand.raised.fill",
            title: "Claim Mining",
            action: this.claimMiningRewards.bind(this),
            dispatch: false,
          },
        ],
      },
      {
        name: "Ads",
        list: [
          {
            id: "claim-ads",
            icon: "play.rectangle",
            title: "Claim Ad Rewards",
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
