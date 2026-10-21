import BaseFarmer from "../lib/BaseFarmer.js";

/**
 * LootVault
 *
 * A TON mining mini-app served from lootvault.lol with its API on the same
 * origin. Every call is authenticated by a single header — `X-TG-Init`,
 * carrying the raw Telegram init data — and every response is the envelope
 * `{ ok, d }`, where `d` is the payload and `ok: false` carries an `e` code.
 *
 * The endpoints are obfuscated on the wire. The app's own bundle names them:
 *   GET  /vx/a0          account state      (registered / isAdmin / maintenance)
 *   GET  /vx/tk1         tasks + daily streak
 *   POST /vx/tk2/streak  claim the daily streak
 *   POST /vx/wc3         is this wallet address available
 *   POST /vx/w6          bind the wallet to the account
 *   POST /vx/w7          unbind the wallet
 *   GET  /vx/b7          balances + the account's bound wallets
 *   GET  /vx/d2          mining dashboard   (balance / rate / last collection)
 *   GET  /vx/m4/preview  what a collection would pay
 *   POST /vx/m4          collect it, handed a captcha token
 *   POST /vx/cp1         start the slider captcha, answering `{ id, type }`
 *   POST /vx/cp2         finish it, answering `{ token }`
 *
 * A run verifies the account, then claims the daily streak when one is owed,
 * collects the mining balance and picks up the task rewards. The wallet is
 * bound by hand from the Wallet tool — the app takes the address from a
 * connected TonConnect wallet, which the farmer has no way to read.
 */

const API_URL = "https://lootvault.lol";

/** LOOT has nine decimals on the wire; every amount arrives in nano-LOOT. */
const NANO_PER_LOOT = 1_000_000_000;

/**
 * The app refuses to open a collection below one LOOT, so the farmer waits
 * for the same floor instead of asking the server for a pointless round trip.
 */
export const MIN_COLLECT_NANO = NANO_PER_LOOT;

/** The app spends a captcha token 300ms after it is issued. */
const CAPTCHA_SETTLE_MS = 300;

/** The bot whose mini-app this is. */
const BOT = "LootVaultDexBot";

/** A millisecond span as hours, e.g. 83_878_815 -> "23.3h". */
function formatHours(ms) {
  return `${(ms / 3_600_000).toFixed(1)}h`;
}

/**
 * The slider gesture, as the app performs it.
 *
 * The captcha is a drag across a track: the app reports how long the drag took
 * and how many pointer moves it made, and the server checks that the gesture
 * looks human. The gestures the HAR captured ran 801-1646ms over 71-113 moves
 * — roughly one move every 11-15ms — and a drag the server reads as too fast
 * is refused with `too_fast`.
 */
const DRAG_MIN_MS = 800;
const DRAG_MAX_MS = 1650;
const MS_PER_MOVE_MIN = 11;
const MS_PER_MOVE_MAX = 15;

/**
 * The task checks the farmer can satisfy on its own.
 *
 * A Telegram task is checked by whether the account is in a channel or a chat,
 * and the farmer can join those. The rest ask for referrals, a hold level or
 * a staking deposit — the server checks those against the account, and it
 * refuses the claim until the account really has them.
 */
const TELEGRAM_TASKS = new Set(["tg_channel", "tg_chat"]);

/**
 * How long the server is given to see a new membership.
 *
 * The app asks the user to come back and press the check button; there is no
 * fixed wait on its side. A task the farmer starts itself needs a short
 * settle so the membership has landed before the claim arrives.
 */
const TASK_SETTLE_SECONDS = 15;

/** A nano-LOOT amount as LOOT, e.g. 1928951388 -> "1.9290". */
export function nanoToLoot(nano, digits = 4) {
  const value = Number(nano);
  if (!Number.isFinite(value)) return (0).toFixed(digits);
  return (value / NANO_PER_LOOT).toFixed(digits);
}

/**
 * The LOOT accrued since the last collection.
 *
 * The dashboard reports the hourly rate (`r`, nano per hour), the moment the
 * last collection landed (`lm`) and the server's clock when it answered
 * (`ts`) — all three, so the estimate needs no local clock and cannot drift
 * with the machine's timezone. A payload without them accrues nothing.
 *
 * @param {object} dashboard - the `/vx/d2` payload
 * @returns {number} nano-LOOT accrued
 */
export function pendingMinedNano(dashboard = {}) {
  const rate = Number(dashboard?.r) || 0;
  const lastMinedAt = Number(dashboard?.lm) || 0;
  const serverNow = Number(dashboard?.ts) || 0;

  if (rate <= 0 || lastMinedAt <= 0 || serverNow <= lastMinedAt) return 0;

  return Math.floor((rate * (serverNow - lastMinedAt)) / 3_600_000);
}

/** Whether the accrual has reached the app's one-LOOT collection floor. */
export function isCollectable(dashboard) {
  return pendingMinedNano(dashboard) >= MIN_COLLECT_NANO;
}

/**
 * Whether the account has finished registering.
 *
 * The app accepts either flag: `registered` once the account is complete, or
 * `w` when a wallet is bound — an account registered before the flag existed
 * still answers `registered: false` with a wallet attached. Reading only
 * `registered` sends those accounts back through registration, which the
 * server refuses because the wallet is already bound.
 */
export function isRegistered(account) {
  return account?.registered === true || account?.w === true;
}

export default class LootVaultFarmer extends BaseFarmer {
  static id = "lootvault";
  static title = "LootVault";
  static emoji = "🏦";
  static host = "lootvault.lol";
  static domains = ["lootvault.lol", "t.me"];
  static telegramLink = `https://t.me/${BOT}/app`;
  static path = "/";
  static referrerMode = "random";
  static singleton = true;
  static rating = 5;
  /* The init data is a live timestamp the server will not accept twice. */
  static cacheAuth = false;
  static apiDelay = 300;
  static interval = "*/10 * * * *";

  /* --------------------------------------------------------------------- */
  /* Auth                                                                  */
  /* --------------------------------------------------------------------- */

  /** The init data is the whole auth — it rides in a header, not a body. */
  fetchAuth() {
    return this.getInitData();
  }

  getAuthHeaders() {
    return { "X-TG-Init": this.getInitData() };
  }

  /* --------------------------------------------------------------------- */
  /* Transport                                                             */
  /* --------------------------------------------------------------------- */

  /**
   * Call the API and unwrap the `{ ok, d }` envelope.
   *
   * @param {string} path - the path under the API origin
   * @param {{method?: string, body?: object}} [options]
   * @returns {Promise<object>} the `d` payload
   */
  async call(path, { method = "GET", body } = {}) {
    const url = `${API_URL}${path}`;

    const res =
      method === "GET"
        ? await this.api.get(url, { signal: this.signal })
        : await this.api.post(url, body, { signal: this.signal });

    const payload = res?.data;

    if (!payload || payload.ok !== true) {
      throw new Error(
        payload?.e || payload?.msg || `LootVault ${method} ${path} failed`,
      );
    }

    return payload.d;
  }

  readError(error) {
    return (
      error?.response?.data?.e ||
      error?.response?.data?.msg ||
      error?.message ||
      "Unknown error"
    );
  }

  /**
   * Was the request cancelled?
   *
   * A cancelled request is the run being stopped, not the server refusing —
   * it must not be reported as a failure of whatever the farmer was doing.
   */
  isCanceled(error) {
    return (
      error?.code === "ERR_CANCELED" ||
      error?.name === "CanceledError" ||
      error?.name === "AbortError" ||
      /canceled/i.test(error?.message || "")
    );
  }

  /* --------------------------------------------------------------------- */
  /* API wrappers                                                          */
  /* --------------------------------------------------------------------- */

  /**
   * Verify the account.
   *
   * The server answers `{ registered, isAdmin, maintenance }`. A missing or
   * stale init data comes back as `e: "no_auth"`, which the envelope turns
   * into a thrown error.
   */
  async verifyAccount() {
    return this.call("/vx/a0");
  }

  /** The tasks list and the daily streak state. */
  getTasksData() {
    return this.call("/vx/tk1");
  }

  /** Begin a task, so the server starts watching its condition. */
  startTask(taskId) {
    return this.call("/vx/tk2/start", { method: "POST", body: { taskId } });
  }

  /** Claim a task's reward. */
  claimTaskReward(taskId) {
    return this.call("/vx/tk2/claim", { method: "POST", body: { taskId } });
  }

  /** Claim the daily streak. */
  claimStreak() {
    return this.call("/vx/tk2/streak", { method: "POST" });
  }

  /** The mining dashboard: balance, hourly rate and the last collection. */
  getDashboard() {
    return this.call("/vx/d2");
  }

  /** What a collection would pay right now, and whether one is allowed. */
  previewCollect() {
    return this.call("/vx/m4/preview");
  }

  /** Collect the accrued mining balance. */
  collectMining(captchaToken) {
    return this.call("/vx/m4", { method: "POST", body: { captchaToken } });
  }

  /** Is this wallet address free to bind? */
  checkWallet(address) {
    return this.call("/vx/wc3", { method: "POST", body: { addr: address } });
  }

  /* --------------------------------------------------------------------- */
  /* Captcha                                                               */
  /* --------------------------------------------------------------------- */

  /**
   * Solve the slider captcha.
   *
   * The app drags a slider across the track and reports the gesture — how long
   * it took and how many pointer moves it made. The server only sees those two
   * numbers, and it refuses a gesture that looks synthetic (`too_fast`).
   *
   * The drag is replayed with the shape the HAR captured and the time is
   * actually spent, so the reported duration is the time the gesture took.
   *
   * @returns {Promise<string>} the captcha token
   */
  async solveSliderCaptcha() {
    const challenge = await this.call("/vx/cp1", { method: "POST" });
    const { id, type } = challenge || {};

    if (!id) {
      throw new Error("LootVault returned no captcha challenge");
    }

    if (type && type !== "slider") {
      throw new Error(`Unsupported LootVault captcha type: ${type}`);
    }

    const duration =
      DRAG_MIN_MS +
      Math.floor(Math.random() * (DRAG_MAX_MS - DRAG_MIN_MS + 1));
    const perMove =
      MS_PER_MOVE_MIN + Math.random() * (MS_PER_MOVE_MAX - MS_PER_MOVE_MIN);
    const moves = Math.max(1, Math.round(duration / perMove));

    /* Spend the gesture's time for real, so the report matches the drag. */
    await this.utils.delay(duration, { precised: true, signal: this.signal });

    const result = await this.call("/vx/cp2", {
      method: "POST",
      body: { id, duration, moves, slide: true },
    });

    if (!result?.token) {
      throw new Error("LootVault captcha returned no token");
    }

    return result.token;
  }

  /* --------------------------------------------------------------------- */
  /* Registration                                                          */
  /* --------------------------------------------------------------------- */

  /**
   * Register the account.
   *
   * Registration binds a TON wallet and is guarded by the slider captcha. The
   * app reads the address from a connected TonConnect wallet, which the farmer
   * cannot see — so it is asked for here and then remembered, and the account
   * registers in the same run.
   *
   * The calls run in the app's own order: the captcha first, then the wallet
   * availability check, then the registration itself.
   */
  async register() {
    let address = await this.getWalletAddress();

    if (!address) {
      const input = await this.promptInput?.(
        "Enter your TON wallet address to register LootVault:",
      );
      address = (input || "").trim();

      if (!address) {
        throw new Error(
          "No wallet address — registration needs the TON wallet that receives the payouts.",
        );
      }

      /* Remember it, so the next run registers without asking again. */
      await this.storeWalletAddress(address);
    }

    const captchaToken = await this.solveSliderCaptcha();

    const check = await this.checkWallet(address);
    if (!check?.available) {
      throw new Error(
        check?.own
          ? "That wallet is already bound to this account."
          : "That wallet is already bound to another account.",
      );
    }

    const result = await this.call("/vx/a1", {
      method: "POST",
      body: { captchaToken, addr: address, termsAccepted: true },
    });

    this.logger.success(`Registered on LootVault with wallet ${address}.`);

    return result;
  }

  /** Bind a wallet to the account. */
  bindWallet(address) {
    return this.call("/vx/w6", { method: "POST", body: { addr: address } });
  }

  /** Unbind the account's wallet. */
  unbindWallet() {
    return this.call("/vx/w7", { method: "POST" });
  }

  /** Balances and the wallets bound to the account. */
  getBalances() {
    return this.call("/vx/b7");
  }

  /* --------------------------------------------------------------------- */
  /* Referral                                                              */
  /* --------------------------------------------------------------------- */

  /**
   * Get Referral Link
   *
   * The mini-app's short name has to stay in the link. `t.me/LootVaultDexBot`
   * opens the bot's chat, not the app — the app would never load, and with it
   * the referral never lands. The app reads the referral from the mini-app's
   * `start_param`, so the code travels as `startapp`, the same way the other
   * farmers that own a short name pass theirs.
   */
  getReferralLink() {
    const userId = this.getUserId();
    if (!userId) return this.telegramLink;
    return `https://t.me/${BOT}/app?startapp=ref_${userId}`;
  }

  /* --------------------------------------------------------------------- */
  /* Login                                                                 */
  /* --------------------------------------------------------------------- */

  async login() {
    const account = await this.verifyAccount();
    this.account = account;

    if (account.maintenance) {
      throw new Error("LootVault is in maintenance — nothing to farm");
    }

    return account;
  }

  /* --------------------------------------------------------------------- */
  /* Logging                                                               */
  /* --------------------------------------------------------------------- */

  async logUserInfo() {
    const account = this.account || {};

    this.logger.newline();
    this.logCurrentUser();
    this.logger.keyValue("Registered", account.registered ? "yes" : "no");
    this.logger.keyValue("Maintenance", account.maintenance ? "yes" : "no");
    this.logger.newline();
  }

  /* --------------------------------------------------------------------- */
  /* Daily streak                                                          */
  /* --------------------------------------------------------------------- */

  /**
   * Claim the daily streak when one is owed.
   *
   * The account is verified first: an account that was never registered cannot
   * claim, and the server would refuse the claim anyway. A streak that is not
   * ready is left alone — the server tracks the cooldown itself.
   *
   * @returns {Promise<boolean>} whether a streak was claimed
   */
  async claimDailyStreak() {
    const account = await this.verifyAccount();
    this.account = account;

    if (!account.registered) {
      this.logger.warn(
        "Account is not registered on LootVault — the streak cannot be claimed.",
      );
      return false;
    }

    const data = await this.getTasksData();
    const streak = data?.streak || {};

    if (!streak.canClaim) {
      this.logStreakCooldown(streak);
      return false;
    }

    const result = await this.claimStreak();
    const claimed = result?.claimedDay ?? streak.nextDay;

    this.logger.success(
      `Daily streak claimed: day ${claimed} (+${result?.reward ?? 0} LOOT).`,
    );

    if (result?.droppedItems?.length) {
      this.logger.info(`Dropped: ${result.droppedItems.join(", ")}`);
    }

    this.streak = result?.streakStatus || streak;

    return true;
  }

  /**
   * Say when the streak unlocks, and warn when it lapses before then.
   *
   * The server keeps two clocks: `cooldownMs` until the next claim is allowed
   * and `expiresInMs` until the streak is gone. Normally the second is the
   * larger — a missed claim still leaves a window. When it is the smaller, the
   * streak lapses before the claim unlocks, and the run is worth a warning.
   *
   * @param {object} streak
   */
  logStreakCooldown(streak) {
    const cooldown = Number(streak.cooldownMs) || 0;
    const expires = Number(streak.expiresInMs) || 0;

    this.logger.info(
      `Streak not ready — day ${streak.currentDay ?? 0}, next reward ${streak.nextReward ?? 0}` +
        (cooldown ? `, unlocks in ${formatHours(cooldown)}.` : "."),
    );

    if (expires && cooldown && expires < cooldown) {
      this.logger.warn(
        `The streak lapses in ${formatHours(expires)}, before it unlocks — claim it to keep the streak.`,
      );
    }
  }

  /* --------------------------------------------------------------------- */
  /* Task rewards                                                          */
  /* --------------------------------------------------------------------- */

  /**
   * Claim the task rewards.
   *
   * The app opens a task's link, starts it, and claims it — the server checks
   * the condition when the claim lands. A Telegram task is joined from here, so
   * it is started and then claimed; a task that is already ready is claimed
   * straight away. The rest ask for referrals, a hold level or a staking
   * deposit, and the server would refuse those, so they are left alone.
   *
   * @returns {Promise<number>} how many rewards were credited
   */
  async claimTasks() {
    const data = await this.getTasksData();
    const tasks = data?.tasks || [];

    let claimed = 0;

    for (const task of tasks) {
      if (this.signal?.aborted) break;

      if (task.status === "claimed") continue;

      /* Already satisfied — the reward is waiting to be picked up. */
      if (task.status === "ready") {
        if (await this.claimTaskRewardFor(task)) claimed += 1;
        continue;
      }

      if (!TELEGRAM_TASKS.has(task.checkType)) continue;

      /* A task still to be started: join, start, let it settle, then claim. */
      if (task.status === "new") {
        if (task.link) {
          await this.tryToJoinTelegramLink(task.link);
        }

        const started = await this.beginTask(task).catch((e) => {
          this.logger.warn(
            `Task "${task.title}" could not be started:`,
            this.readError(e),
          );
          return false;
        });

        if (!started) continue;

        await this.utils.delayForSeconds(TASK_SETTLE_SECONDS, {
          signal: this.signal,
        });
      }

      if (await this.claimTaskRewardFor(task)) claimed += 1;
    }

    if (claimed) {
      this.logger.success(`Claimed ${claimed} task reward(s).`);
    } else {
      this.logger.info("No task rewards to claim.");
    }

    return claimed;
  }

  /** Start a task, reporting a refusal instead of throwing. */
  async beginTask(task) {
    await this.startTask(task.id);
    return true;
  }

  /**
   * Claim one task's reward.
   *
   * The server refuses a claim whose condition is not met yet, and the app
   * shows that as a message rather than an error — so it is reported, not
   * thrown.
   */
  async claimTaskRewardFor(task) {
    const result = await this.claimTaskReward(task.id).catch((e) => {
      this.logger.info(
        `Task not credited: ${task.title} — ${this.readError(e)}`,
      );
      return null;
    });

    if (!result) return false;

    this.logger.success(
      `Task claimed: ${task.title} (+${result?.reward ?? 0} LOOT).`,
    );
    return true;
  }

  /* --------------------------------------------------------------------- */
  /* Mining                                                                */
  /* --------------------------------------------------------------------- */

  /**
   * Collect the accrued mining balance.
   *
   * The app prices the accrual from the dashboard — the hourly rate times the
   * hours since the last collection — and stays closed below one LOOT. Past
   * that it asks the preview endpoint whether a collection is allowed, solves
   * the slider captcha and posts the token to the collect endpoint.
   *
   * Every step can refuse without failing: a collection that is not ready, a
   * captcha the server reads as synthetic, or a server-side audit that is
   * unavailable are all reported and the run moves on.
   *
   * @returns {Promise<boolean>} whether LOOT was collected
   */
  async collectMined() {
    const dashboard = await this.getDashboard().catch((e) => {
      this.logger.warn("Mining dashboard failed:", this.readError(e));
      return null;
    });

    /* Mining is claimed first, so a dashboard hiccup must not end the run. */
    if (!dashboard) return false;

    this.dashboard = dashboard;

    this.logDashboard(dashboard);

    const pending = pendingMinedNano(dashboard);

    if (!isCollectable(dashboard)) {
      this.logger.info(
        `Mining: ${nanoToLoot(pending)} LOOT accrued, ` +
          `${nanoToLoot(MIN_COLLECT_NANO - pending)} short of a collection.`,
      );
      return false;
    }

    const preview = await this.previewCollect().catch((e) => {
      this.logger.warn("Mining preview failed:", this.readError(e));
      return null;
    });

    if (!preview) return false;

    /* The server's verdict wins over the local estimate. */
    if (preview.canCollect === false) {
      this.logger.info(
        `Mining: ${nanoToLoot(preview.totalMined ?? pending)} LOOT ready, ` +
          "collection not allowed yet.",
      );
      return false;
    }

    const token = await this.solveSliderCaptcha().catch((e) => {
      this.logger.warn("Mining captcha failed:", this.readError(e));
      return null;
    });

    if (!token) return false;

    /* The app holds the token this long before it spends it. */
    await this.utils.delay(CAPTCHA_SETTLE_MS, {
      precised: true,
      signal: this.signal,
    });

    const result = await this.collectMining(token).catch((e) => {
      this.logger.warn("Mining collection failed:", this.readError(e));
      return null;
    });

    if (!result) return false;

    this.logger.success(
      `Collected ${nanoToLoot(result.mined ?? preview.totalMined)} LOOT` +
        (result.newBalance
          ? ` — balance ${nanoToLoot(result.newBalance)} LOOT.`
          : "."),
    );

    if (result.txHash) {
      this.logger.info(`Ledger entry: ${result.txHash}`);
    }

    return true;
  }

  /** Report the balance, the rate and what has accrued since the last run. */
  logDashboard(dashboard) {
    const pending = pendingMinedNano(dashboard);

    this.logger.keyValue("Balance", `${nanoToLoot(dashboard?.b)} LOOT`);
    this.logger.keyValue("Mining rate", `${nanoToLoot(dashboard?.r)} LOOT/h`);
    this.logger.keyValue("Accrued", `${nanoToLoot(pending)} LOOT`);

    if (dashboard?.league?.name) {
      const level = Number(dashboard.lvl) || 1;
      const maxLevel = Number(dashboard.maxLvl) || 0;
      this.logger.keyValue(
        "League",
        `${dashboard.league.name}${maxLevel ? ` — level ${level}/${maxLevel}` : ""}`,
      );
    }
  }

  /* --------------------------------------------------------------------- */
  /* Wallet                                                                */
  /* --------------------------------------------------------------------- */

  /**
   * Bind a wallet to the account.
   *
   * The address is checked first: one wallet per account, and an address
   * already bound elsewhere comes back as `available: false`.
   *
   * @param {string} address
   * @returns {Promise<boolean>} whether the wallet is bound
   */
  async connectWallet(address) {
    const addr = String(address || "").trim();
    if (!addr) {
      this.logger.warn("No wallet address given.");
      return false;
    }

    const check = await this.checkWallet(addr).catch((e) => {
      if (!this.isCanceled(e)) {
        this.logger.warn("Wallet check failed:", this.readError(e));
      }
      return null;
    });

    if (!check) return false;

    if (!check.available) {
      this.logger.warn(
        check.own
          ? "That wallet is already bound to this account."
          : "That wallet is already bound to another account.",
      );
      return false;
    }

    await this.bindWallet(addr).catch((e) => {
      this.logger.warn("Wallet bind failed:", this.readError(e));
      throw e;
    });

    await this.storeWalletAddress(addr);
    this.logger.success(`Wallet bound: ${addr}.`);

    return true;
  }

  /** Unbind the account's wallet. */
  async disconnectWallet() {
    await this.unbindWallet().catch((e) => {
      this.logger.warn("Wallet unbind failed:", this.readError(e));
      return null;
    });

    this.logger.success("Wallet unbound.");
    return true;
  }

  /** Persist the bound address, in the environments that offer storage. */
  async storeWalletAddress(address) {
    this.walletAddress = address;
    try {
      await this.storage?.set("wallet", { address });
    } catch (error) {
      this.debugger.log("Failed to store wallet:", error.message);
    }
  }

  /** The bound address, from this run or a previous one. */
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

  /** Bind a TON wallet address, prompting for it (Wallet tool). */
  async connectWalletInteractive() {
    let address = await this.getWalletAddress();

    if (!address) {
      const input = await this.promptInput?.(
        "Enter your TON wallet address:",
      );
      address = (input || "").trim();
      if (!address) {
        this.logger.warn("No address provided.");
        return;
      }
    }

    /* Keep the address either way: an account that is not registered yet has
       nothing to bind to, and registration is what binds the wallet. */
    await this.storeWalletAddress(address);

    let account = null;
    try {
      account = await this.verifyAccount();
    } catch (e) {
      if (this.isCanceled(e)) {
        this.logger.info("Wallet check cancelled.");
        return;
      }
    }

    if (account && !isRegistered(account)) {
      this.logger.info(
        `Wallet saved: ${address}. The farmer will register the account with it.`,
      );
      return;
    }

    await this.connectWallet(address);
  }

  /** Unbind the wallet, from the Wallet tool. */
  async disconnectWalletInteractive() {
    await this.disconnectWallet();
  }

  /* --------------------------------------------------------------------- */
  /* Process                                                               */
  /* --------------------------------------------------------------------- */

  async process() {
    await this.login();
    await this.logUserInfo();

    /* A new account has to be registered before anything can be claimed. */
    if (!isRegistered(this.account)) {
      await this.executeTask("Register", () => this.register());
      await this.login();
      await this.logUserInfo();
    }

    /* Mining is the payout, so it runs before the optional tasks. */
    await this.executeTask("Mining", () => this.collectMined());
    await this.executeTask("Daily Streak", () => this.claimDailyStreak());
    await this.executeTask("Tasks", () => this.claimTasks());
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
            id: "disconnect-wallet",
            icon: "xmark.circle",
            title: "Disconnect Wallet",
            action: this.disconnectWalletInteractive.bind(this),
            dispatch: false,
          },
        ],
      },
    ];
  }
}
