import BaseFarmer from "../lib/BaseFarmer.js";

/**
 * MRG Miner
 *
 * MRG crypto mining mini-app served from app.mrgtoken.xyz with its API at
 * mrg.up.railway.app. Auth is the raw Telegram init data sent in the JSON
 * body (`{ initData }`) on every call — no auth header. A run connects the
 * payout wallet (address only, no signature), claims accrued mining, then
 * works the task list: visit the task URL, wait 15s, claim.
 */

const API_URL = "https://mrg.up.railway.app/api";

/** Claim button unlocks above this unclaimed balance. */
const MINING_MINIMUM = 1e-4;

/** Client enforces a 15s dwell between opening a task and claiming it. */
const TASK_WAIT_SECONDS = 15;

export default class MrgFarmer extends BaseFarmer {
  static id = "mrg";
  static title = "MRG";
  static emoji = "🪙";
  static host = "app.mrgtoken.xyz";
  static domains = ["app.mrgtoken.xyz", "mrg.up.railway.app", "t.me"];
  static telegramLink = "https://t.me/mrgminerbot/app";
  static path = "/";
  static referrerMode = "random";
  static singleton = true;
  static rating = 5;
  static cacheAuth = false;
  static interval = "*/10 * * * *";
  static apiDelay = 300;

  /** Get Referral Link (this account's own invite link). */
  getReferralLink() {
    return `https://t.me/mrgminerbot/app?startapp=ref_${this.getUserId()}`;
  }

  /** Auth is the raw Telegram init data sent in the request body. */
  fetchAuth() {
    return this.getInitData();
  }

  /** No auth header — initData rides in the JSON body. */
  getAuthHeaders() {
    return {};
  }

  /* --------------------------------------------------------------------- */
  /* Transport                                                             */
  /* --------------------------------------------------------------------- */

  /** Post with initData baked into the body, like the app does. */
  async post(path, payload = {}) {
    const res = await this.api.post(
      `${API_URL}${path}`,
      { initData: this.getInitData(), ...payload },
      { signal: this.signal },
    );
    return res.data;
  }

  /** Referral start param when the account carries one. */
  getStartParamPayload() {
    return this.getStartParam() ? { startParam: String(this.getStartParam()) } : {};
  }

  readError(error) {
    return error?.response?.data?.error || error?.response?.data?.message || error?.message || "Unknown error";
  }

  /* --------------------------------------------------------------------- */
  /* API wrappers                                                          */
  /* --------------------------------------------------------------------- */

  /** Verify session — returns user, task list and completed ids. */
  async verify() {
    return this.post("/auth/verify", this.getStartParamPayload());
  }

  /** Fresh account state (balances). */
  getMe() {
    return this.post("/user/me", {});
  }

  /** Connect the payout wallet (address only, no signature required). */
  connectWallet(address, balance = 0) {
    return this.post("/user/connect-wallet", { address, balance });
  }

  /** Claim accrued mining rewards. */
  claimMining() {
    return this.post("/user/claim-mining", {});
  }

  /** Claim a single task by id. */
  claimTask(taskId) {
    return this.post("/user/claim-task", { taskId });
  }

  /* --------------------------------------------------------------------- */
  /* Login                                                                 */
  /* --------------------------------------------------------------------- */

  async login() {
    const auth = await this.verify().catch((e) => {
      this.logger.warn("Auth call failed:", this.readError(e));
      return null;
    });
    if (!auth || auth.success === false) throw new Error("Failed to authenticate");
    this.user_data = auth.user || {};
    this.task_list = Array.isArray(auth.tasks) ? auth.tasks : [];
    this.completed_ids = new Set(auth.completedTaskIds || []);
    return this.user_data;
  }

  /* --------------------------------------------------------------------- */
  /* Logging                                                               */
  /* --------------------------------------------------------------------- */

  async logUserInfo() {
    const user = this.user_data;
    this.logger.newline();
    this.logCurrentUser();
    this.logger.keyValue("In-App Balance", user?.inAppBalance ?? "0");
    this.logger.keyValue("Unclaimed Mining", user?.unclaimedMiningBalance ?? "0");
    this.logger.keyValue("Total Mined", user?.totalMinedLifetime ?? "0");
    this.logger.keyValue("Wallet", user?.walletAddress || "not connected");
    this.logger.newline();
  }

  /* --------------------------------------------------------------------- */
  /* Wallet                                                                */
  /* --------------------------------------------------------------------- */

  /** Mining pays only to a connected wallet — connect ours when missing. */
  async ensureWallet() {
    if (this.user_data?.walletAddress || this.user_data?.tonWalletAddress) {
      this.logger.info(`Wallet already connected: ${this.user_data.walletAddress || this.user_data.tonWalletAddress}.`);
      return true;
    }
    const saved = await this.getWalletAddress();
    if (saved) return this.linkWallet(saved);
    this.logger.warn("No payout wallet linked — use the Connect Wallet tool once, then mining unlocks.");
    return false;
  }

  /** Link an address through the app's endpoint and remember it. */
  async linkWallet(address) {
    const result = await this.connectWallet(address, 0).catch((e) => {
      this.logger.warn("Wallet connect failed:", this.readError(e));
      return null;
    });
    if (!result || result.success === false) {
      this.logger.info("Wallet not connected: " + (result?.error || "unknown"));
      return false;
    }
    const onFile = result.user?.tonWalletAddress || address;
    this.user_data = { ...this.user_data, walletAddress: onFile };
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

  /** Persist the linked address, in the environments that offer storage. */
  async storeWalletAddress(address) {
    this.walletAddress = address;
    try {
      await this.storage?.set("wallet", { address });
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

  /** Claim accrued mining when above the app's minimum. */
  async claimMiningRewards() {
    const pending = Number(this.user_data?.unclaimedMiningBalance) || 0;
    if (pending <= MINING_MINIMUM) {
      this.logger.info(`Nothing to claim yet (${pending} MRG).`);
      return;
    }
    const result = await this.claimMining().catch((e) => {
      if (e?.response?.status === 400) {
        this.logger.info("Mining claim refused (too soon) — next run.");
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
    this.logger.success(`Claimed mining (+${pending} MRG).`);
  }

  /* --------------------------------------------------------------------- */
  /* Tasks                                                                 */
  /* --------------------------------------------------------------------- */

  /** Work every task: visit link, wait 15s, claim. */
  async completeTasks() {
    const done = this.completed_ids || new Set();
    const tasks = (this.task_list || []).filter((t) => {
      const id = t.taskId || t.id;
      return id && !done.has(id) && !t.isPaused;
    });
    if (!tasks.length) {
      this.logger.info("No tasks to complete.");
      return;
    }
    this.logger.info(`${tasks.length} task(s) to complete.`);
    let claimed = 0;
    for (const task of tasks) {
      if (this.signal?.aborted) break;
      claimed += Number(await this.completeTask(task)) || 0;
    }
    if (claimed) this.logger.success(`Completed ${claimed} task(s).`);
    else this.logger.info("No tasks credited.");
  }

  /** Complete a single task with the app's 15s visit dwell. */
  async completeTask(task) {
    const id = task.taskId || task.id;
    const label = task.title || id;

    // Headless Adsgram-task clicks are not automatable — skip loudly.
    const url = task.url || "";
    if (task.verificationType === "adsgram_ad" || url.includes("adsgram")) {
      this.logger.info(`Skipped adsgram task: ${label}`);
      return 0;
    }

    // Open/join the target link first when it is a Telegram link.
    if (url && this.validateTelegramTask(url)) {
      await this.tryToJoinTelegramLink(url);
    }

    // The client enforces a 15s dwell between opening and claiming.
    await this.utils.delayForSeconds(TASK_WAIT_SECONDS, { signal: this.signal }).catch(() => {});
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
    this.logger.success(`Completed task: ${label}${task.reward ? ` (+${task.reward} MRG)` : ""}`);
    return 1;
  }

  /* --------------------------------------------------------------------- */
  /* Process                                                               */
  /* --------------------------------------------------------------------- */

  async process() {
    await this.login();
    await this.logUserInfo();
    const walletOk = await this.executeTask("Wallet", () => this.ensureWallet());
    if (walletOk) {
      await this.executeTask("Mining", () => this.claimMiningRewards());
    }
    await this.executeTask("Tasks", () => this.completeTasks());

    const fresh = await this.getMe().catch(() => null);
    if (fresh?.user) this.user_data = { ...this.user_data, ...fresh.user };
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
        ],
      },
      {
        name: "Mining",
        list: [
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
