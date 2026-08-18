import BaseFarmer from "../lib/BaseFarmer.js";
import AdsGramClient from "../lib/AdsGramClient.js";

/**
 * Soulfarm (SOULFARMBOT)
 *
 * A dark-RPG idle autobattler served from soulfarm.cc with its API at
 * api-soulfarm.saturn.ac. Auth is the raw init data echoed in the
 * `x-telegram-init-data` header on every request.
 *
 * A run claims the passive farm accrual, the free daily chests, the check-in
 * reward, opens every pending chest and equips upgrades, claims whatever
 * tasks are done, and watches AdsGram banners (block 37966) for bonus chests.
 */
const API_URL = "https://api-soulfarm.saturn.ac";

/** AdsGram block id inlaid on the page (seen in the capture's /adv calls). */
const ADSGRAM_BLOCK_ID = 37966;

/** Recycle everything worse than this rarity (matches the autopilot default). */
const KEEP_MIN_RARITY = "LEGENDARY";

/** The +xp recycle table — recycle anything below the keep line for hero xp. */
const RARITY_XP = {
  COMMON: 1000,
  UNCOMMON: 1300,
  RARE: 2000,
  EPIC: 3500,
  LEGENDARY: 6000,
  MYTHIC: 2000,
};

export default class SoulfarmFarmer extends BaseFarmer {
  static id = "soulfarm";
  static title = "Soulfarm";
  static emoji = "⚔️";
  static host = "soulfarm.cc";
  static domains = [
    "soulfarm.cc",
    "api-soulfarm.saturn.ac",
    "api.adsgram.ai",
    "t.me",
  ];
  static telegramLink = "https://t.me/SOULFARMBOT";
  static path = "/";
  static referrerMode = "random";
  static singleton = true;
  static rating = 1;
  static cacheAuth = false;
  static interval = "*/10 * * * *";

  /** Auth is the raw init data echoed in `x-telegram-init-data`. */
  fetchAuth() {
    return this.getInitData();
  }

  /** Headers the API wants on every call. */
  getAuthHeaders(data) {
    return data
      ? {
          "x-telegram-init-data": data,
          "x-device-id": this.getDeviceId(),
          "x-device-fp": this.getDeviceFp(),
          "x-sf-caps": "leagues-v2",
        }
      : {};
  }

  /** A stable per-account device id, matching the page's random uuids. */
  getDeviceId() {
    if (!this.deviceId) {
      const rng = this.getUserRandomGenerator();
      let id = "";
      const hex = "0123456789abcdef";
      for (let i = 0; i < 32; i++) id += hex[Math.floor(rng() * 16)];
      this.deviceId = [
        id.slice(0, 8),
        id.slice(8, 12),
        id.slice(12, 16),
        id.slice(16, 20),
        id.slice(20),
      ].join("-");
    }
    return this.deviceId;
  }

  /** The short device fingerprint the app sends (constant per account). */
  getDeviceFp() {
    if (!this.deviceFp) {
      const rng = this.getUserRandomGenerator();
      this.deviceFp = Array.from(
        { length: 6 },
        () => "abcdefghijklmnopqrstuvwxyz0123456789"[Math.floor(rng() * 36)],
      ).join("");
    }
    return this.deviceFp;
  }

  /* --------------------------------------------------------------------- */
  /* Transport                                                             */
  /* --------------------------------------------------------------------- */

  get(path, params) {
    return this.api
      .get(`${API_URL}${path}`, {
        params,
        signal: this.signal,
        validateStatus: () => true,
        ignoreUnauthorizedError: true,
      })
      .then((res) => res.data);
  }

  post(path, payload = {}) {
    return this.api
      .post(`${API_URL}${path}`, payload, {
        signal: this.signal,
        validateStatus: () => true,
        ignoreUnauthorizedError: true,
      })
      .then((res) => res.data);
  }

  /** Fire-and-forget events tracker (mirrors the page's silent track call). */
  track(events = []) {
    if (!events.length) return;
    return this.post("/api/events", { events }).catch(() => {});
  }

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

  /** Full account state. */
  getState() {
    return this.get("/api/state");
  }

  /** Claim the accrued passive farm souls. */
  claimFarm() {
    return this.post("/api/farm/claim", {});
  }

  /** Claim the hero's free daily chests. */
  claimDailyChests() {
    return this.post("/api/chest/claim-daily", {});
  }

  /** Claim today's check-in reward. `boosted` doubles it via ads. */
  claimCheckin(boosted = false) {
    return this.post("/api/checkin/claim", { boosted });
  }

  /** Open one chest. The `openKey` is a client-side uuid. */
  openChest() {
    return this.post("/api/chest/open", {
      openKey:
        globalThis.crypto?.randomUUID?.() ||
        `ok-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`,
    });
  }

  /** Equip an item by id. */
  equipItem(itemId) {
    return this.post("/api/item/equip", { itemId });
  }

  /** Preview an item before deciding to equip / recycle it. */
  previewItem(itemId) {
    return this.post("/api/item/preview", { itemId });
  }

  /** Recycle an item for hero xp. */
  recycleItem(itemId) {
    return this.post("/api/item/recycle", { itemId });
  }

  /** Mark an item as kept (never recycled by auto-open). */
  keepItem(itemId) {
    return this.post("/api/item/keep", { itemId });
  }

  /** List tasks. */
  getTasks() {
    return this.get("/api/tasks");
  }

  /** Claim a finished task by task id. */
  claimTask(taskId) {
    return this.post("/api/tasks/claim", { taskId });
  }

  /** Fire the social verification check for a task id. */
  claimSharePrepare(caption, cta) {
    return this.post("/api/tasks/share/prepare", { caption, cta });
  }

  /** Open a social (subscribe/follow) task link — validates membership. */
  openSocialTask(taskId) {
    return this.post("/api/tasks/social/open", { taskId });
  }

  /** Claim the returning story reward. */
  claimStory() {
    return this.post("/api/tasks/story/claim", {});
  }

  /** Referral status. */
  getReferral() {
    return this.get("/api/referral");
  }

  /** Claim referral commissions. */
  claimReferral() {
    return this.post("/api/referral/claim", {});
  }

  /** Toggle auto-battle on/off. */
  toggleAutoBattle() {
    return this.post("/api/hero/auto-battle", {});
  }

  /** Report an ad-watch attempt for a surface (adsgram/adexium). */
  reportAdAttempt(surface, attempts) {
    return this.post("/api/ad/attempt", { surface, attempts });
  }

  /* --------------------------------------------------------------------- */
  /* Run flow                                                              */
  /* --------------------------------------------------------------------- */

  /**
   * Load state once and reuse it across the run. Also claims the farm accrual
   * right away since that is what keeps the hero fighting.
   */
  async login() {
    this.state = await this.getState();
    return this.state;
  }

  async process() {
    await this.executeTask("State", () => this.login());

    await this.logUserInfo();
    await this.executeTask("Farm", () => this.claimFarmAndLog());
    await this.executeTask("Auto-battle", () => this.ensureAutoBattle());
    await this.executeTask("Check-in", () => this.claimCheckInReward());
    await this.executeTask("Daily chests", () => this.claimDailyChestsAndLog());
    await this.executeTask("Chests", () => this.openChestsAndUpgrade());
    await this.executeTask("Tasks", () => this.completeTasks());
    await this.executeTask("Referrals", () => this.claimReferrals());
    await this.executeTask("Ads", () => this.watchAds());
  }

  /** Log the current account state. */
  async logUserInfo() {
    const state = this.state || this.state_data || {};

    this.logger.newline();
    if (state.user) this.logCurrentUser();

    this.logger.keyValue("Souls", this.formatAmount(state.wallet?.souls));
    this.logger.keyValue("Per Hour", this.formatAmount(state.soulsPerHour));
    this.logger.keyValue("Level", state.hero?.level ?? "?");
    this.logger.keyValue(
      "Combat Power",
      typeof state.hero?.combatPower === "number"
        ? state.hero.combatPower.toFixed(2)
        : "?",
    );
    this.logger.keyValue("Pending Chests", state.pendingChests ?? 0);

    this.logger.newline();
  }

  /**
   * Store the latest state snapshot returned anywhere in the run. Only real
   * state-shaped payloads are kept — action endpoints answer 201 with a
   * `{wallet, hero, …}` body, while errors answer `{error}` / a bare string,
   * and storing one of those would poison every later `this.state` read.
   */
  applyState(state) {
    if (
      state &&
      typeof state === "object" &&
      (state.wallet || state.hero || state.user || state.checkin)
    ) {
      this.state = state;
    }
    return state;
  }

  /** Claim the passive farm and log the earnings. */
  async claimFarmAndLog() {
    const result = await this.claimFarm().catch((e) => {
      this.logger.warn("Farm claim failed:", this.readError(e));
      return null;
    });
    if (result?.earnedSouls !== undefined) {
      this.logger.success(
        `Claimed farm: +${this.formatAmount(result.earnedSouls)} souls${
          result.capReached ? " (cap reached)" : ""
        }`,
      );
    } else {
      this.logger.info(
        `Farm claim: ${result?.error || "no pending accrual"}`,
      );
    }
    this.applyState(result);
    return result;
  }

  /** Keep auto-battle on so souls accrue passively. */
  async ensureAutoBattle() {
    const hero = this.state?.hero;
    if (hero?.autoBattle === false) {
      const result = await this.toggleAutoBattle().catch((e) => {
        this.logger.warn("Auto-battle toggle failed:", this.readError(e));
        return null;
      });
      if (result?.autoBattle === true) {
        this.logger.success("Auto-battle re-enabled.");
      }
    } else {
      this.logger.info("Auto-battle is already active.");
    }
  }

  /** Claim today's check-in (the daily-login reward) when it's available. */
  async claimCheckInReward() {
    const checkin = this.state?.checkin;
    if (!checkin?.canClaimToday) {
      this.logger.info("Check-in not available yet.");
      return true;
    }

    const result = await this.claimCheckin(false).catch((e) => {
      this.logger.warn("Check-in claim failed:", this.readError(e));
      return null;
    });

    // The API answers 201 with a state-shaped body (wallet/hero/checkin) and
    // no `ok`/`granted` envelope, so treat any non-error response as claimed.
    if (result && !result.error) {
      const reward = this.describeCheckinReward(result, checkin);
      this.logger.success(`Check-in claimed${reward ? `: +${reward}` : "."}`);
      this.applyState(result.state || result);
    } else {
      this.logger.warn(`Check-in not credited: ${result?.error || "unknown"}`);
    }
    return true;
  }

  /** Best-effort label for the check-in reward just claimed. */
  describeCheckinReward(result, checkin) {
    if (result?.granted && typeof result.granted === "object") {
      return this.summarizeReward(result.granted);
    }
    // Fall back to the reward listed on the day we just claimed.
    const div = (checkin?.divisions || []).find(
      (d) => d.day === checkin.position,
    );
    return div?.free ? this.summarizeReward(div.free) : "";
  }

  /** Claim the free hero daily chests. */
  async claimDailyChestsAndLog() {
    const result = await this.claimDailyChests().catch((e) => {
      this.logger.warn("Daily chests failed:", this.readError(e));
      return null;
    });
    const granted = result?.granted;
    if (granted) {
      const chests = granted.chests ?? 0;
      if (chests > 0) {
        this.logger.success(`Daily chests: +${chests} chests.`);
      } else {
        this.logger.info("Daily chests already claimed.");
      }
    }
    this.applyState(result?.state || result);
    return result;
  }

  /** Open pending chests, equipping upgrades and recycling the rest. */
  async openChestsAndUpgrade() {
    // `pendingChests` is the count waiting to be opened; each open response
    // also reports `remaining`, which we use to stop early.
    let pending = Number(this.state?.pendingChests ?? 0);
    if (!Number.isFinite(pending) || pending < 0) pending = 0;

    if (pending <= 0) {
      this.logger.info("No pending chests to open.");
      return 0;
    }

    this.logger.log(`Opening ${pending} chest${pending === 1 ? "" : "s"}…`);
    let opened = 0;
    let equipped = 0;
    let recycled = 0;

    for (let i = 0; i < pending; i++) {
      if (this.signal?.aborted) break;

      const result = await this.openChest().catch((e) => {
        this.logger.warn(`Chest open failed: ${this.readError(e)}`);
        return null;
      });
      if (!result?.item) {
        if (result?.error) {
          this.logger.warn(`Chest open: ${result.error}`);
          break;
        }
        break;
      }

      opened++;
      const item = result.item;

      // Equip-if-upgrade takes priority (matches the app: it wears every
      // early upgrade and only recycles what it can't use). Anything that
      // isn't an upgrade and sits below the keep-line is recycled for xp.
      if (this.isUpgradeForSlot(item)) {
        const equippedOk = await this.equipOpenedItem(item, result);
        if (equippedOk) {
          equipped++;
        } else if (item.rarity && this.shouldRecycle(item)) {
          if (await this.recycleOpenedItem(item, result)) recycled++;
        }
      } else if (item.rarity && this.shouldRecycle(item)) {
        if (await this.recycleOpenedItem(item, result)) recycled++;
      }

      // Stop as soon as the server says the pile is empty.
      if (Number(result.remaining) === 0) break;
    }

    if (opened) {
      this.logger.success(
        `Chests: ${opened} opened, ${equipped} equipped, ${recycled} recycled.`,
      );
      const fresh = await this.getState().catch(() => null);
      this.applyState(fresh || { pendingChests: 0 });
    } else {
      this.logger.info("No chests to open.");
    }
    return opened;
  }

  /** Preview + equip one freshly opened item when it beats the slot. */
  async equipOpenedItem(item, _result) {
    if (this.isUpgradeForSlot(item)) {
      const preview = await this.previewItem(item.id).catch(() => null);
      if (preview?.isUpgrade || (preview?.powerDelta ?? 0) > 0) {
        await this.equipItem(item.id).catch((e) => {
          this.logger.warn(`Equip failed: ${this.readError(e)}`);
          return null;
        });
        this.logger.success(
          `${this.capitalize(item.slot)} +${preview?.powerDelta ?? item.power} power.`,
        );
        return true;
      }
    }
    return false;
  }

  /** Recycle an opened item that is below the keep-line. */
  async recycleOpenedItem(item, _result) {
    const result = await this.recycleItem(item.id).catch((e) => {
      this.logger.warn(`Recycle failed: ${this.readError(e)}`);
      return null;
    });
    if (result?.ok || result?.xpGained) {
      this.logger.log(
        `Recycled ${this.colorizeRarity(item.rarity)} (slot ${this.capitalize(item.slot)}).`,
      );
      return true;
    }
    return false;
  }

  /** Does a freshly-opened item beat whatever is equipped in its slot? */
  isUpgradeForSlot(item) {
    const equipped = (this.state?.inventory || []).find(
      (i) => i.slot === item.slot && i.equipped,
    );
    if (!equipped) return true;
    return (Number(item.power) || 0) > (Number(equipped.power) || 0);
  }

  /** Keep high rarity; recycle the rest (autopilot default line). */
  shouldRecycle(item) {
    if (!item.rarity) return false;
    if (item.kept) return false;
    if (!RARITY_XP[item.rarity]) return false;
    const order = ["COMMON", "UNCOMMON", "RARE", "EPIC", "LEGENDARY", "MYTHIC"];
    return order.indexOf(item.rarity) < order.indexOf(KEEP_MIN_RARITY);
  }

  /** Claim every task that is done but not claimed yet. */
  async completeTasks() {
    const tasksData = await this.getTasks().catch((e) => {
      this.logger.warn("Tasks failed:", this.readError(e));
      return null;
    });
    const tasks = tasksData?.tasks || [];
    let claimed = 0;

    for (const task of tasks) {
      if (this.signal?.aborted) break;
      if (!task || task.done !== true || task.claimed === true) continue;

      try {
        const result = await this.claimTask(task.id);

        if (result?.ok || !result?.error) {
          claimed++;
          this.logger.success(
            `Task: ${task.label || task.id} (+${this.summarizeReward(task.reward)}).`,
          );
        } else {
          this.logger.warn(
            `Task "${task.label || task.id}" not credited: ${result.error}`,
          );
        }
      } catch (e) {
        this.logger.warn(`Task "${task.label || task.id}" failed:`, this.readError(e));
      }
    }

    if (claimed) this.logger.success(`Claimed ${claimed} task(s).`);
    else this.logger.info("No tasks ready to claim.");
    return claimed;
  }

  /** Helper that formats a tasks reward for the log. */
  summarizeReward(reward = {}) {
    const parts = [];
    for (const [key, value] of Object.entries(reward)) {
      if (value > 0) parts.push(`${value} ${key}`);
    }
    return parts.join(", ") || "reward";
  }

  /** Claim any claimable referral commissions. */
  async claimReferrals() {
    const data = await this.getReferral().catch((e) => {
      this.logger.warn("Referrals failed:", this.readError(e));
      return null;
    });
    if (data?.available || (data?.claimableUsd ?? data?.availableUsd ?? 0) > 0) {
      try {
        const result = await this.claimReferral();
        this.logger.success(
          `Referral claimed: +${this.formatAmount(result?.souls)} souls (${result?.rate ?? "?"}).`,
        );
      } catch (e) {
        this.logger.warn("Referral claim failed:", this.readError(e));
      }
    } else {
      this.logger.info("No referral commissions waiting.");
    }
  }

  /** Watch AdsGram banners (block 37966) and report each one. */
  async watchAds() {
    const config = this.state?.config || {};
    const capHour = config.adCapHour ?? 5;
    const capDay = config.adCapDay ?? 25;
    const count = Math.min(capHour, capDay);
    if (count <= 0) {
      this.logger.info("Ad watching not available.");
      return 0;
    }

    const adsgram = new AdsGramClient(this, {
      topDomain: "https://soulfarm.cc",
    });
    let watched = 0;

    for (let i = 0; i < count; i++) {
      if (this.signal?.aborted) break;

      try {
        await this.reportAdAttempt("watch", [
          { network: "adsgram", outcome: "started" },
        ]).catch(() => {});

        await adsgram.watch(ADSGRAM_BLOCK_ID);

        await this.reportAdAttempt("watch", [
          { network: "adsgram", outcome: "completed" },
        ]).catch(() => {});

        watched++;
        this.logger.success(`Ad ${watched}/${count} watched.`);
      } catch (e) {
        this.logger.info(`Ad not available${e.message ? `: ${e.message}` : ""}`);
        break;
      }

      await this.utils.delayForSeconds(4, { signal: this.signal });
    }

    if (watched) {
      const fresh = await this.getState().catch(() => null);
      this.applyState(fresh);
    }
    return watched;
  }

  /* --------------------------------------------------------------------- */
  /* Formatting helpers                                                    */
  /* --------------------------------------------------------------------- */

  formatAmount(value) {
    const amount = Number(value);
    if (!Number.isFinite(amount)) return String(value ?? "-");
    return Math.floor(amount).toLocaleString();
  }

  capitalize(word = "") {
    return word ? word.charAt(0).toUpperCase() + word.slice(1).toLowerCase() : "";
  }

  colorizeRarity(rarity = "") {
    const colors = {
      COMMON: this.logger.c.gray,
      UNCOMMON: this.logger.c.green,
      RARE: this.logger.c.cyan,
      EPIC: this.logger.c.magenta,
      LEGENDARY: this.logger.c.yellow,
      MYTHIC: this.logger.c.red,
    };
    return (colors[rarity] || ((x) => x))(rarity);
  }

  /* --------------------------------------------------------------------- */
  /* Tools                                                                 */
  /* --------------------------------------------------------------------- */

  createTools() {
    return [
      {
        name: "Farm",
        list: [
          {
            id: "claim-farm",
            icon: "goforward",
            title: "Claim Farm",
            action: this.claimFarmAndLog.bind(this),
            dispatch: false,
          },
          {
            id: "open-chests",
            icon: "shippingbox.fill",
            title: "Open Chests",
            action: this.openChestsAndUpgrade.bind(this),
            dispatch: false,
          },
        ],
      },
    ];
  }
}