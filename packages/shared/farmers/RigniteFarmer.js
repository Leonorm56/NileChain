import BaseFarmer from "../lib/BaseFarmer.js";

/**
 * Rignite
 *
 * A x-init-data authenticated tap-mining app served from app.rignite.app with
 * its API at api.rignite.app. Every call is a JSON POST; auth is delegated by
 * the `x-init-data` header, optionally boosted by an `x-session` id returned
 * from `/auth`.
 */

const API_URL = "https://api.rignite.app";

/** Ad provider mode served by GET /client-version.json (fallback if fetch fails). */
const AD_MODE_DEFAULT = "adexium_house";

/** Building/upgrade categories in unlock order (each has 8 tiers). */
const CATEGORIES = ["tools", "energy", "workers", "land", "special", "cosmic"];

/** Item tiers per category (tools_1 .. tools_8, etc). */
const ITEM_IDS = CATEGORIES.flatMap((category) =>
  Array.from({ length: 8 }, (_, i) => `${category}_${i + 1}`),
);

/** An item must reach this level before the next tier in the section unlocks. */
const UNLOCK_LEVEL = 3;

/** The server caps how many levels an item can be upgraded to. */
const MAX_ITEM_LEVEL = 20;

/** How many buildings to buy before stopping; beyond this, only upgrades. */
const MAX_FARM_SIZE = 20;

/** Seconds to wait between simulated ad watches. */
const AD_COOLDOWN_SECONDS = 2;

/** Phase-1 tap prep targets: taps per click and max energy to reach before tapping. */
const BOOST_TARGET_MULTITAP = 5;
const BOOST_TARGET_MAX_ENERGY = 3500;

/** Maximum battery level before we stop upgrading it. */
const MAX_BATTERY_LEVEL = 44;

/** PPH gate: accounts above this must reach FIRST_BATTERY_LEVEL before Phase 2. */
const BATTERY_GATE_PPH = 200000;
const FIRST_BATTERY_LEVEL = 17;

/** Mid-tier battery gate: at this PPH the battery target rises to MID_BATTERY_LEVEL. */
const MID_BATTERY_GATE_PPH = 300000;
const MID_BATTERY_LEVEL = 25;

/** Second-tier battery gate: at this PPH the battery target rises to LATE_BATTERY_LEVEL. */
const LATE_BATTERY_GATE_PPH = 450000;
const LATE_BATTERY_LEVEL = 30;

/** Third-tier battery gate: at this PPH the battery target rises to L30→L40. */
const THIRD_BATTERY_GATE_PPH = 600000;
const THIRD_BATTERY_LEVEL = 44;

/** Maximum live PPH before the account stops farming (hard ceiling). */
const MAX_PPH_CEILING = 650000;

/** Energy limit target once PPH reaches the 650K ceiling. */
const CEILING_ENERGY_TARGET = 6500;

/** Energy gate: below this PPH the farmer does not buy energy_limit boosts. */
const ENERGY_GATE_PPH = 200000;

/** Rolling-hour ad budget shared by the Energy/Battery boost-ad tasks. */
const MAX_ADS_PER_HOUR = 2;
const AD_BUDGET_WINDOW_MS = 60 * 60 * 1000;

/**
 * In-process mirror of each account's ad-watch log, used when the host gives
 * no persistent `farmer.storage` (long-lived node runner) and as a write-back
 * cache when it does. Values are arrays of epoch-ms watch timestamps.
 */
const AD_WATCH_MEMORY = new Map();

export default class RigniteFarmer extends BaseFarmer {
  static id = "rignite";
  static title = "Rignite";
  static emoji = "⛏️";
  static host = "app.rignite.app";
  static domains = ["app.rignite.app", "api.rignite.app", "t.me"];
  static telegramLink = "https://t.me/RigniteBot?startapp=ref_6627962056";
  static path = "/";
  static referrerMode = "random";
  static singleton = true;
  static rating = 5;
  static cacheAuth = false;
  static interval = "*/10 * * * *";
  static maxConcurrency = 10;

  /** Get Referral Link (this account's own invite link). */
  getReferralLink() {
    return `https://t.me/RigniteBot?startapp=ref_${this.getUserId()}`;
  }

  /** Auth is the raw Telegram init data echoed in `x-init-data`. */
  fetchAuth() {
    return this.getInitData();
  }

  /** Headers the API wants on every call. */
  getAuthHeaders(data) {
    return data
      ? {
          "X-Init-Data": data,
        }
      : {};
  }

  /* --------------------------------------------------------------------- */
  /* Transport                                                             */
  /* --------------------------------------------------------------------- */

  /** Today's date (UTC, matching the server) in the `yyyy-mm-dd` policy format. */
  getAdPolicyDate() {
    const d = new Date();
    const p = (n) => String(n).padStart(2, "0");
    return `${d.getUTCFullYear()}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())}`;
  }

  /**
   * The app reads GET /client-version.json for its `adMode`, then sends
   * `x-rignite-ad-policy: <adMode>:<date>.1` on every request. Since
   * 2026-09-05 the server answers ad endpoints with CLIENT_UPDATE_REQUIRED
   * when that header is missing, so fetch the mode once per run (fall back to
   * the known mode if the fetch fails — never block farming on it).
   */
  async ensureAdMode() {
    if (this.adMode) return this.adMode;
    try {
      const res = await fetch(
        `https://app.rignite.app/client-version.json?_=${Date.now()}`,
        { signal: this.signal },
      );
      const data = res.ok ? await res.json() : null;
      if (data?.adMode) this.adMode = data.adMode;
    } catch {
      // offline / blocked — fall through to the default
    }
    this.adMode = this.adMode || AD_MODE_DEFAULT;
    return this.adMode;
  }

  /** Headers the real client sends on every api call (ad-policy gate + tg). */
  getClientHeaders() {
    const headers = {
      "x-requested-with": "org.telegram.messenger",
    };
    const mode = this.adMode || AD_MODE_DEFAULT;
    const policy = this.adPolicy || `${mode}:${this.getAdPolicyDate()}.1`;
    headers["x-rignite-ad-policy"] = policy;
    return headers;
  }

  /** Post to an endpoint with the init data header baked in. */
  async post(path, payload = {}) {
    const attempt = () =>
      this.api.post(`${API_URL}/${path}`, payload, {
        headers: this.getClientHeaders(),
        signal: this.signal,
      });
    let res;
    try {
      res = await attempt();
    } catch (error) {
      const body = error?.response?.data;
      const sent = this.getClientHeaders()["x-rignite-ad-policy"];
      // The server answers ad endpoints with 426 CLIENT_UPDATE_REQUIRED and
      // names the exact policy it expects — adopt it and replay once rather
      // than failing the whole run.
      if (error?.response?.status === 426 && body?.expectedPolicy && body.expectedPolicy !== sent) {
        this.adMode = String(body.expectedPolicy).split(":")[0] || this.adMode;
        this.adPolicy = body.expectedPolicy;
        this.logger?.info?.(`Ad policy updated to ${body.expectedPolicy}.`);
        res = await attempt();
      } else {
        throw error;
      }
    }
    return res.data;
  }

  /** The referral id the app wants (digits of the primary user id). */
  getRef() {
    return String(this.getUserId() || "");
  }

  getLang() {
    return this.getInitDataUnsafe()?.user?.language_code || "en";
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

  /* --------------------------------------------------------------------- */
  /* API wrappers                                                          */
  /* --------------------------------------------------------------------- */

  /** Start a fresh session and remember the returned session id. */
  async auth() {
    const result = await this.post("auth", {
      lang: this.getLang(),
      dev: this.getDeviceId(),
      ...(this.getStartParam() ? { startParam: String(this.getStartParam()) } : {}),
    });
    if (result?.sessionId) {
      this.setAuthHeaders({ "x-session": result.sessionId });
    }
    return result;
  }

  /** Full account state — including user, items, quests, milestones. */
  getMe() {
    return this.post("me", {});
  }

  /** Credit a batch of taps. `count` mirrors the page's pending taps. */
  tap(count) {
    return this.post("tap", { count });
  }

  /** Free refill that restores energy to max (uses the `fullEnergyLeft` pool). */
  fullEnergy() {
    return this.post("boost/full-energy", {});
  }

  /** Upgrade a boost one level (type: "multitap" | "energy_limit"). */
  upgradeBoost(type) {
    return this.post("boost/upgrade", { type });
  }

  /** Buy one level of an item. */
  buyItem(itemId) {
    return this.post("items/buy", { itemId });
  }

  /** Buy every affordable level of an item. */
  buyItemMax(itemId) {
    return this.post("items/buymax", { itemId });
  }

  /** Upgrade the battery one level. */
  upgradeBattery() {
    return this.post("battery/upgrade", {});
  }

  /** Collect passive mining across all buildings at once. */
  collectShift() {
    return this.post("shift/collect", {});
  }

  /** Collect passive mining for a single building. */
  collectBuilding(itemId) {
    return this.post("shift/collect-building", { itemId });
  }

  /** List quests (claimable + in-progress). */
  getQuests() {
    return this.post("quests", {});
  }

  /** Claim a finished quest. */
  claimQuest(id) {
    return this.post("quests/claim", { id });
  }

  /** Daily rewards info. */
  getDaily() {
    return this.post("daily", {});
  }

  /** Claim today's daily reward. */
  claimDaily() {
    return this.post("daily/claim", {});
  }

  /** Surprise reward status; ready flag gates the claim. */
  getSurprise() {
    return this.post("surprise/claim", {});
  }

  /** Daily combo status. */
  getCombo() {
    return this.post("combo", {});
  }

  /** Claim the daily combo. */
  claimCombo() {
    return this.post("combo/claim", {});
  }

  /** Collect passive task bucket rewards (gorev = tasks). */
  collectTasks() {
    return this.post("gorev/topla", {});
  }

  /** Ad milestone status. */
  getAdMilestones() {
    return this.post("ad/milestone", {});
  }

  /** Claim a ready ad milestone by its 1-based index. */
  claimAdMilestone(index) {
    return this.post("ad/milestone/claim", { index });
  }

  /** Intent to show an ad (type: "coins" | "milestone"). */
  adIntent(type) {
    return this.post("ad/intent", { type });
  }

  /** Report an ad as completed; only then the reward is credited. */
  adComplete(meta) {
    return this.post("ad/complete", meta);
  }

  /** Pending gifts. */
  getGifts() {
    return this.post("gift/pending", {});
  }

  /** Claim a gift. */
  claimGift() {
    return this.post("gift/claim", {});
  }

  /** Claim a social task by id (tonapp, producthunt). */
  claimSocialTask(id) {
    return this.post("social-task/claim", { id });
  }

  /** Season stats (informational). */
  getStats() {
    return this.post("stats", {});
  }

  /** Player rank (informational). */
  getRank() {
    return this.post("rank", {});
  }

  /* --------------------------------------------------------------------- */
  /* Login                                                                 */
  /* --------------------------------------------------------------------- */

  /** Auth, then pull the account state. */
  async login() {
    const auth = await this.auth().catch((e) => {
      this.logger.warn("Auth call failed:", this.readError(e));
      return null;
    });
    if (!auth) throw new Error("Failed to authenticate");

    this.user_data = await this.getMe();
    if (!this.user_data) throw new Error("Failed to load account");

    // `/me` mirrors the auth user object but drops the `items` upgrade map and
    // section bookkeeping — those are only present on `/auth`. Store them so
    // the upgrade logic knows what's owned and at what level.
    if (auth) {
      this.user_data = {
        ...this.user_data,
        items: JSON.parse(JSON.stringify(auth?.items || {})),
        buildingPending: JSON.parse(
          JSON.stringify(auth?.user?.buildingPending || this.user_data.buildingPending || {}),
        ),
      };
    }

    return this.user_data;
  }

  readError(error) {
    return error?.response?.data?.error || error?.message || "Unknown error";
  }

  /* --------------------------------------------------------------------- */
  /* Collect + Upgrade                                                     */
  /* --------------------------------------------------------------------- */

  /**
   * Collect all buildings at once via the batch endpoint, then the shared
   * task bucket. Falls back to per-building collection if the batch call
   * fails (some accounts may not have the endpoint available).
   */
  async collectEverything() {
    let collected = 0;

    // Try the batch collect endpoint first (single API call for all buildings).
    const batch = await this.collectShift().catch((e) => {
      this.debugger.log("Batch collect failed, falling back to per-building:", this.readError(e));
      return null;
    });

    if (batch && (batch.coins !== undefined || batch.collected !== undefined)) {
      collected += Number(batch.collected) || Number(batch.coins) || 0;
      this.debugger.log("Batch collect:", collected);
    } else {
      // Fallback: collect each owned building individually.
      const user = this.user_data;
      const items = user?.items || {};
      const pending = user?.buildingPending || {};
      const ownedIds = new Set([
        ...Object.keys(items || {}),
        ...Object.keys(pending || {}),
      ]);

      for (const itemId of ITEM_IDS) {
        if (this.signal?.aborted) break;
        if (!ownedIds.has(itemId)) continue;
        const result = await this.collectBuilding(itemId).catch((e) => {
          if (e?.response?.data?.error !== "NOTHING_TO_COLLECT") {
            this.logger.warn(`Collect ${itemId} failed:`, this.readError(e));
          }
          return null;
        });
        const gained = Number(result?.collected) || 0;
        collected += gained;
        this.debugger.log(`Collect ${itemId}:`, gained);
      }
    }

    const taskBucket = await this.collectTasks().catch((e) => {
      this.logger.warn("Collect tasks failed:", this.readError(e));
      return null;
    });
    const taskGained = Number(taskBucket?.toplam) || 0;
    collected += taskGained;
    this.debugger.log("Collected tasks:", taskGained);

    if (collected > 0) {
      this.logger.success(`Collected ${collected} coins.`);
    } else {
      this.logger.info("Nothing to collect yet.");
    }
  }

  /**
   * Upgrade logic — split into two clearly separated farming phases:
   *
   *   FARMING PHASE 1 (EXPAND) — unlock new buildings in the app's unlock
   *   order up to MAX_FARM_SIZE (20), taking each new building to level 3
   *   (UNLOCK_LEVEL) so the next tier opens.
   *
   *   FARMING PHASE 2 (DEEPEN) — runs once the farm (MAX_FARM_SIZE) is
   *   owned; one pass per run raising every owned building toward
   *   MAX_ITEM_LEVEL (20).
   *
   * A section (tools, energy, ...) only unlocks once every item of the
   * previous section has been bought, and item `cat_N` only unlocks once
   * `cat_(N-1)` has reached level 3. The server enforces both with
   * FINISH_PREV_SECTION / "Gereken item seviyesi yok" errors, so Phase 1
   * buys deterministically: finish each section left-to-right. While the
   * farm is still expanding (fewer than MAX_FARM_SIZE owned) every coin goes
   * toward unlocking the next building and Phase 2 does not run.
   */
  async upgradeItems() {
    const user = this.user_data;
    let coins = Number(user?.coins) || 0;
    const items = JSON.parse(JSON.stringify(user?.items || {}));

    /** Buildings owned so far (any item level > 0 counts as owned). */
    const ownedCount = () =>
      ITEM_IDS.reduce((n, id) => n + ((items[id] ?? 0) > 0 ? 1 : 0), 0);

    // ================= FARMING PHASE 1 — EXPAND ========================
    this.logger.newline();
    this.logger.log(`Farming Phase 1 — expand (${ownedCount()}/${MAX_FARM_SIZE} buildings owned).`);
    const phase1 = await this.phase1Expand(coins, items, ownedCount);
    coins = phase1.coins;
    if (phase1.upgrades) {
      this.logger.success(`Farming Phase 1 done — bought ${phase1.upgrades} upgrade(s).`);
    } else if (ownedCount() >= MAX_FARM_SIZE) {
      this.logger.info(`Farming Phase 1 done — farm already complete (${MAX_FARM_SIZE}/${MAX_FARM_SIZE}).`);
    } else {
      this.logger.info("Farming Phase 1 done — not enough coins to expand further yet.");
    }

    // ================= BATTERY UPGRADE =====================================
    // Battery gate: four tiers —
    //   200K+ PPH → battery must reach L17 before Phase 2 deepening
    //   300K+ PPH → battery must reach L25 before Phase 2 deepening
    //   450K+ PPH → battery must reach L30 before Phase 2 deepening
    //   600K+ PPH → battery must reach L44 before Phase 2 deepening
    // Accounts at 200K or below skip straight to deepening.
    this.logger.newline();
    const pph = Number(user?.profitPerHour) || 0;
    const curBatteryLevel = Number(user?.batteryLevel) || 0;
    const gateMet = pph > BATTERY_GATE_PPH;
    const midGateMet = pph > MID_BATTERY_GATE_PPH;
    const lateGateMet = pph > LATE_BATTERY_GATE_PPH;
    const thirdGateMet = pph > THIRD_BATTERY_GATE_PPH;
    const batteryTarget = thirdGateMet
      ? THIRD_BATTERY_LEVEL
      : lateGateMet
        ? LATE_BATTERY_LEVEL
        : midGateMet
          ? MID_BATTERY_LEVEL
          : FIRST_BATTERY_LEVEL;
    // Always log the active battery tier so the battery rules are visible every run.
    this.logger.log(
      `Battery rule — PPH ${pph.toLocaleString()}, target L${batteryTarget}, now L${curBatteryLevel}.`,
    );
    if (gateMet && curBatteryLevel < batteryTarget) {
      this.logger.log(`Upgrading Battery — PPH ${pph}, must reach L${batteryTarget} before deepening (L${curBatteryLevel} now).`);
      const battery = await this.upgradeBattery().catch((e) => {
        this.logger.info("Battery upgrade not available:", this.readError(e));
        return null;
      });
      if (battery?.state) {
        this.user_data = { ...battery.state, coins: Number(battery.state.coins ?? coins) };
        this.logger.success("Battery upgraded successfully.");
      } else if (battery?.coins !== undefined || (battery && !battery.state)) {
        const patch = this.activeMerge(battery);
        this.user_data = { ...this.user_data, ...patch };
        if (patch.batteryLevel) this.logger.success("Battery upgraded successfully.");
        else this.logger.info("Battery upgrade not available.");
      } else {
        this.logger.info("Battery upgrade not available.");
      }
    } else if (gateMet) {
      this.logger.log(`Battery upgrade skipped — battery already at target level (L${curBatteryLevel}).`);
    } else {
      this.logger.log(`Battery upgrade skipped — PPH ${pph} at/below the ${BATTERY_GATE_PPH / 1000}K gate.`);
    }

    // Re-read after the attempt above: a successful reply carries fresh state.
    coins = Number(this.user_data?.coins) ?? coins;
    const batteryLevel = Number(this.user_data?.batteryLevel) || curBatteryLevel;
    const pphNow = Number(this.user_data?.profitPerHour) || pph;
    const effectiveTarget =
      pphNow > THIRD_BATTERY_GATE_PPH
        ? THIRD_BATTERY_LEVEL
        : pphNow > LATE_BATTERY_GATE_PPH
          ? LATE_BATTERY_LEVEL
          : pphNow > MID_BATTERY_GATE_PPH
            ? MID_BATTERY_LEVEL
            : FIRST_BATTERY_LEVEL;

    // ================= FARMING PHASE 2 — DEEPEN ========================
    // Runs once the full farm (MAX_FARM_SIZE) is owned. While above the
    // battery gate the account pauses deepening until the battery reaches
    // the tier-appropriate target (L25 at 200K+, L30 at 450K+).
    this.logger.newline();
    if (ownedCount() < MAX_FARM_SIZE) {
      this.logger.info(
        `Farming Phase 2 skipped — ${ownedCount()}/${MAX_FARM_SIZE} buildings owned, still in Farming Phase 1.`,
      );
    } else if (gateMet && batteryLevel < effectiveTarget) {
      this.logger.info(`Farming Phase 2 paused — PPH ${pph}, battery must reach L${effectiveTarget} first (L${batteryLevel}).`);
    } else {
      this.logger.log("Farming Phase 2 — deepen (raise owned buildings toward level 20).");
      const phase2 = await this.phase2Deepen(coins, items);
      coins = phase2.coins;
      if (phase2.upgrades) {
        this.logger.success(`Farming Phase 2 done — applied ${phase2.upgrades} upgrade(s).`);
      } else {
        this.logger.info("Farming Phase 2 done — nothing upgradeable (maxed or out of coins).");
      }
    }

    this.user_data = {
      ...this.user_data,
      coins,
      items,
      ...this.activeMerge(this.user_data),
    };
  }

  /**
   * FARMING PHASE 1 — Expand.
   * Unlock new buildings (in unlock order) up to MAX_FARM_SIZE, taking each
   * new building to level 3 (UNLOCK_LEVEL) so the next tier opens. The tools
   * section is always open; later sections need the whole previous section
   * bought first. Stops early when coins run out / next tier is locked — the
   * next run resumes with more coins. Returns the remaining coin balance and
   * the number of purchases made.
   */
  async phase1Expand(coins, items, ownedCount) {
    let upgrades = 0;

    for (let c = 0; c < CATEGORIES.length; c++) {
      if (this.signal?.aborted || ownedCount() >= MAX_FARM_SIZE) break;
      const category = CATEGORIES[c];

      // The tools section is always open; others need the whole previous
      // section bought first.
      if (c > 0) {
        const prev = CATEGORIES[c - 1];
        const prevDone = ITEM_IDS.filter((id) => id.startsWith(`${prev}_`)).every(
          (id) => (items[id] ?? 0) > 0,
        );
        if (!prevDone) break;
      }

      let affordable = true;
      for (let tier = 0; tier < 8; tier++) {
        if (this.signal?.aborted || !affordable || ownedCount() >= MAX_FARM_SIZE) break;
        const itemId = `${category}_${tier + 1}`;

        // item _N needs item _(N-1) at level 3; item _1 is always open here.
        if (tier > 0) {
          const prevId = `${category}_${tier}`;
          if ((items[prevId] ?? 0) < UNLOCK_LEVEL) break;
        }

        // Buy this item up to level 3 (or as far as we can afford).
        while ((items[itemId] ?? 0) < UNLOCK_LEVEL && ownedCount() < MAX_FARM_SIZE) {
          if (this.signal?.aborted) break;
          const result = await this.buyItem(itemId).catch((e) => {
            this.logger.warn(`Buy ${itemId} failed:`, this.readError(e));
            return null;
          });
          // A successful purchase credits coins and returns the new level.
          // Anything else is a blocker (not enough coins / locked).
          if (!result || result?.coins === undefined || result?.profitPerHour === undefined) {
            affordable = false;
            break;
          }
          coins = Number(result.coins);
          const level = Number(result.level) || (items[itemId] ?? 0) + 1;
          items[itemId] = level;
          upgrades++;
          this.logger.success(`Upgraded ${itemId} to level ${level} (${ownedCount()}/${MAX_FARM_SIZE} buildings).`);
        }
      }
    }

    return { coins, upgrades };
  }

  /**
   * FARMING PHASE 2 — Deepen.
   * PPH ceiling: accounts at or above MAX_PPH_CEILING stop spending coins —
   * they keep tapping/collecting but won't upgrade past the ceiling.
   */
  async phase2Deepen(coins, items) {
    const pph = Number(this.user_data?.profitPerHour) || 0;
    if (pph >= MAX_PPH_CEILING) {
      this.logger.info(`Farming Phase 2 skipped — PPH ${pph} at or above the ${MAX_PPH_CEILING / 1000}K ceiling.`);
      return { coins, upgrades: 0 };
    }

    let upgrades = 0;

    for (let tier = 0; tier < ITEM_IDS.length; tier++) {
      if (this.signal?.aborted) break;
      const itemId = ITEM_IDS[tier];
      const curLevel = items[itemId] ?? 0;
      if (curLevel <= 0) continue; // not owned

      if (curLevel >= MAX_ITEM_LEVEL) {
        this.logger.info(`Upgrade ${itemId} already MAX level (${curLevel}).`);
        continue;
      }

      const result = await this.buyItem(itemId).catch((e) => {
        this.logger.warn(`Upgrade ${itemId} failed:`, this.readError(e));
        return null;
      });
      // A refused purchase (no fresh coins/profitPerHour in the reply) means
      // not enough coins — log and keep going.
      if (!result || result?.coins === undefined || result?.profitPerHour === undefined) {
        this.logger.info(`Upgrade ${itemId} — LESS COINS.`);
        continue;
      }
      coins = Number(result.coins);
      const newLevel = Number(result.level) || curLevel + 1;
      items[itemId] = newLevel;
      upgrades++;
      this.logger.success(`Upgraded ${itemId} to level ${newLevel}.`);
    }

    return { coins, upgrades };
  }

  /**
   * Buy tap boosts until 5 taps/click, then raise the energy limit tiered by
   * PPH: below 200K no energy_limit upgrades, 200K+ up to 3.5k, and 7.5k once
   * PPH reaches the 650K ceiling. Never beyond the active target. Best effort
   * on coins: a refusal means not affordable, so we stop and retry next run.
   */
  async buyTapBoosts() {
    let tapLvl = Number(this.user_data?.multitapLevel) || 1;
    while (tapLvl < BOOST_TARGET_MULTITAP && !this.signal?.aborted) {
      const res = await this.upgradeBoost("multitap").catch(() => null);
      const next = Number(res?.multitapLevel) || 0;
      if (!res || next <= tapLvl) break;
      tapLvl = next;
      this.logger.success(`Tap boost → ${tapLvl} taps/click.`);
    }

    // Energy limit tiered by PPH like the battery gates:
    //   below 200K → no energy_limit upgrades (coins go to buildings)
    //   200K+      → up to 3.5k (BOOST_TARGET_MAX_ENERGY)
    //   650K+      → up to 6.5k (CEILING_ENERGY_TARGET)
    const pphNow = Number(this.user_data?.profitPerHour) || 0;
    const energyTarget =
      pphNow >= MAX_PPH_CEILING
        ? CEILING_ENERGY_TARGET
        : pphNow >= ENERGY_GATE_PPH
        ? BOOST_TARGET_MAX_ENERGY
        : 0;
    let maxE = Number(this.user_data?.maxEnergy) || 0;
    if (energyTarget > 0) {
      // Always log the active tier so the energy rules are visible every run.
      this.logger.log(
        `Energy boost — PPH ${pphNow.toLocaleString()}, target ${energyTarget.toLocaleString()}, now ${maxE.toLocaleString()}.`,
      );
      while (maxE < energyTarget && !this.signal?.aborted) {
        const res = await this.upgradeBoost("energy_limit").catch((e) => {
          this.logger.info(`Energy boost upgrade refused: ${this.readError(e)}`);
          return null;
        });
        const next = Number(res?.maxEnergy) || 0;
        if (!res || next <= maxE || next > energyTarget) break;
        maxE = next;
        this.logger.success(`Energy boost → ${maxE} max.`);
      }
    } else {
      this.logger.info(
        `Energy boost skipped — PPH ${pphNow.toLocaleString()} below the ${ENERGY_GATE_PPH / 1000}K gate (now ${maxE.toLocaleString()}).`,
      );
    }

    // Boost replies carry partial state — refresh so tapping sees new levels.
    const me = await this.getMe().catch(() => null);
    if (me) this.user_data = { ...this.user_data, ...me };
  }

  /* --------------------------------------------------------------------- */
  /* Ad budget — 2 boost-ad watches per rolling hour (energy + battery)      */
  /* --------------------------------------------------------------------- */

  adBudgetKey() {
    return `rignite:ad-watches:${this.getUserId() ?? "anon"}`;
  }

  /** Epoch-ms timestamps of boost-ad watches inside the current hour. */
  async getAdWatchLog() {
    const key = this.adBudgetKey();
    const cutoff = Date.now() - AD_BUDGET_WINDOW_MS;
    let stored = [];
    try {
      const raw = await this.storage?.get?.(key);
      if (Array.isArray(raw)) stored = raw;
    } catch {
      stored = [];
    }
    const merged = [...new Set([...stored, ...(AD_WATCH_MEMORY.get(key) || [])])]
      .map(Number)
      .filter((t) => Number.isFinite(t) && t >= cutoff)
      .sort((a, b) => a - b);
    AD_WATCH_MEMORY.set(key, merged);
    return merged;
  }

  /** Boost-ad watches still available this hour (0..MAX_ADS_PER_HOUR). */
  async adsLeftThisHour() {
    return Math.max(0, MAX_ADS_PER_HOUR - (await this.getAdWatchLog()).length);
  }

  /** Record one completed boost-ad watch (call only after /ad/complete ok). */
  async recordAdWatch() {
    const log = await this.getAdWatchLog();
    log.push(Date.now());
    const key = this.adBudgetKey();
    AD_WATCH_MEMORY.set(key, log);
    try {
      await this.storage?.set?.(key, log);
    } catch {
      // no persistent storage — the in-process mirror is enough
    }
  }

  /**
   * Watch one full-energy ad (type "full_energy"): intent → watch → complete →
   * refresh /me. Refills the tap-energy bar to 100% from the near-unlimited
   * ad pool (`adEnergyLeft`), unlike the free refills that run out.
   */
  async watchFullEnergyAd() {
    if ((await this.adsLeftThisHour()) <= 0) {
      this.logger.log(`Skipping Energy Ad — ad budget reached (${MAX_ADS_PER_HOUR}/hour).`);
      return false;
    }

    const intent = await this.adIntent("full_energy").catch((e) => {
      this.logger.warn("Full-energy ad intent failed:", this.readError(e));
      return null;
    });
    if (!intent?.ok) {
      this.logger.warn("Full-energy ad intent refused:", JSON.stringify(intent).slice(0, 200));
      return false;
    }

    const rng = this.getUserRandomGenerator();
    const ms = 10000 + Math.floor(rng() * 5000);
    await this.utils.delay(ms, { precised: true, signal: this.signal }).catch(() => {});
    if (this.signal?.aborted) return false;

    const done = await this.adComplete({ network: "warhold", ymid: null, ms, tapGap: -1 }).catch(() => null);
    if (!done?.ok) return false;

    // Only a completed watch consumes the hourly ad budget.
    await this.recordAdWatch();

    const me = await this.getMe().catch(() => null);
    if (me) this.user_data = { ...this.user_data, ...me };

    const energy = Number(this.user_data?.energy) ?? 0;
    const max = Number(this.user_data?.maxEnergy) || 0;
    if (energy >= max) this.logger.success(`Energy recharged to 100% via ad (${energy}/${max}).`);
    else this.logger.warn(`Ad done but energy not refilled (${energy}/${max}).`);
    return true;
  }

  /**
   * Watch one battery ad (type "battery"): intent → watch → complete →
   * refresh /me. Charges the battery energy pool directly. The daily quota is
   * tracked by `batteryAdLeft` on the /me response.
   */
  async watchBatteryAd() {
    if ((await this.adsLeftThisHour()) <= 0) {
      this.logger.log(`Skipping Battery Ad — ad budget reached (${MAX_ADS_PER_HOUR}/hour).`);
      return false;
    }

    const adLeft = Number(this.user_data?.batteryAdLeft) || 0;
    if (adLeft <= 0) {
      this.logger.info("No battery ads left today.");
      return false;
    }

    const intent = await this.adIntent("battery").catch((e) => {
      this.logger.warn("Battery ad intent failed:", this.readError(e));
      return null;
    });
    if (!intent?.ok) {
      this.logger.warn("Battery ad intent refused:", JSON.stringify(intent).slice(0, 200));
      return false;
    }

    const rng = this.getUserRandomGenerator();
    const ms = 10000 + Math.floor(rng() * 5000);
    await this.utils.delay(ms, { precised: true, signal: this.signal }).catch(() => {});
    if (this.signal?.aborted) return false;

    const done = await this.adComplete({ network: "warhold", ymid: null, ms, tapGap: -1 }).catch(() => null);
    if (!done?.ok) return false;

    // Only a completed watch consumes the hourly ad budget.
    await this.recordAdWatch();

    const me = await this.getMe().catch(() => null);
    if (me) this.user_data = { ...this.user_data, ...me };

    const batt = Number(this.user_data?.batteryEnergy) ?? 0;
    const cap = Number(this.user_data?.batteryCap) || 0;
    const pct = cap > 0 ? Math.round((batt / cap) * 100) : 0;
    this.logger.success(`Battery ad done — battery ${pct}% (${batt}/${cap}). Left: ${Number(this.user_data?.batteryAdLeft) ?? 0}.`);
    return true;
  }

  /**
   * Tap until the battery is recharged to 100%. Before tapping it buys the
   * tap boosts (5 taps/click, 3.5k max ⚡) and watches one full-energy ad so
   * the session starts at 100% energy. Every tap charges the battery and the
   * `/tap` response reports fresh battery/energy/coins fields. When energy runs
   * dry before the battery is full, `/boost/full-energy` tops it back up until
   * the daily free-refill pool is exhausted.
   */
  async tapUntilBatteryFull() {
    let user = this.user_data;
    if (!user) return 0;

    const cap = Number(user.batteryCap) || 0;
    if (cap <= 0) {
      this.logger.info("No battery to charge yet.");
      return 0;
    }
    if (Number(user.batteryEnergy ?? 0) >= cap) {
      this.logger.info("No battery charge needed (battery 100%).");
      return 0;
    }
    // Phase-1 prep: buy tap boosts (capped at 5 taps / 3.5k max energy) so the
    // session taps with the strongest tap/energy before the battery is drained.
    await this.buyTapBoosts();
    user = this.user_data;

    const multitap = Math.max(1, Number(user.multitapLevel) || 1);
    let battery = Number(user.batteryEnergy) ?? 0;
    let energy = Number(user.energy) ?? 0;
    let coins = Number(user.coins) ?? 0;
    let fullEnergyLeft = Number(user.fullEnergyLeft) ?? 0;
    let boosts = 0;
    let taps = 0;
    let gained = 0;
    let guard = 0;

    const patchFrom = (res) => {
      this.user_data = { ...this.user_data, ...this.activeMerge(res) };
      const merged = this.user_data;
      battery = Number(merged.batteryEnergy ?? battery);
      energy = Number(merged.energy ?? energy);
      coins = Number(merged.coins ?? coins);
      fullEnergyLeft = Number(merged.fullEnergyLeft ?? fullEnergyLeft);
    };

    while (!this.signal?.aborted && guard++ < 200) {
      if (battery >= cap) break;

      // Out of energy — use a free full-energy refill so we can keep tapping.
      const maxTaps = Math.floor((energy || 0) / multitap);
      if (maxTaps < 1) {
        if (fullEnergyLeft > 0) {
          const boost = await this.fullEnergy().catch((e) => {
            this.logger.warn("Full-energy boost failed:", this.readError(e));
            return null;
          });
          if (!boost) break;
          boosts++;
          patchFrom(boost);
          this.logger.success(`Energy refilled (${energy}/${user.maxEnergy}). Left: ${fullEnergyLeft}.`);
          continue;
        }
        break;
      }

      const count = Math.min(100, maxTaps);
      const prevCoins = coins;
      const result = await this.tap(count).catch((e) => {
        this.logger.warn("Tap failed:", this.readError(e));
        return null;
      });
      if (!result) break;

      const accepted = Number(result.accepted ?? count) || 0;
      taps += accepted;
      patchFrom(result);
      gained += Math.max(0, coins - prevCoins);

      this.debugger.log(
        `Tap batch (${accepted}/${count}): +${Math.max(0, coins - prevCoins)} coins, energy ${energy}/${user.maxEnergy}, battery ${Math.round((battery / cap) * 100)}%.`,
      );
      if (accepted < 1) break;
    }

    const pct = Math.round((battery / cap) * 100);
    if (battery >= cap) {
      this.logger.success(`Battery charged to 100% (${taps} taps, +${gained} coins, ${boosts} refill${boosts === 1 ? "" : "s"}).`);
    } else if (taps) {
      this.logger.info(`Tapped ${taps}× (+${gained} coins); battery ${pct}%, energy ${energy}/${user.maxEnergy}.`);
    } else {
      this.logger.info(`No battery charge needed (battery ${pct}%).`);
    }
    return taps;
  }

  /** Merge the small per-request user fields into the stored snapshot. */
  activeMerge(result) {
    const patch = {};
    for (const key of [
      "coins",
      "profitPerHour",
      "maxEnergy",
      "energy",
      "batteryEnergy",
      "batteryCap",
      "batteryDrain",
      "batteryLevel",
      "totalEarned",
      "bucketCoins",
    ]) {
      if (result?.[key] !== undefined) patch[key] = result[key];
    }
    return patch;
  }

  /* --------------------------------------------------------------------- */
  /* Quests + Rewards                                                      */
  /* --------------------------------------------------------------------- */

  /* --------------------------------------------------------------------- */
  /* Process                                                               */
  /* --------------------------------------------------------------------- */

  /** Override executeTask to remove inter-task delays.
   *  Accounts are already staggered via Runner.js, so additional delays
   *  inside a single account's cycle are pure waste. Removing them cuts
   *  per-account time from ~120s to ~60s, preventing the 40-account cycle
   *  from exceeding the 10-minute cron window.
   */
  async executeTask(task, callback, allowInQuickRun = true) {
    this.currentTaskStartedAt = new Date();
    this.currentTask = task;

    this.logger.newline();

    if (this.signal?.aborted) {
      this.logger.warn(`✖ Task aborted: ${task}`);
      return;
    }

    const skipInQuickRun = this.quickRun && !allowInQuickRun;
    if (skipInQuickRun) {
      this.logger.log(`⚡ Skipping in quick run: ${task}`);
      return;
    }

    try {
      this.logger.log(`⚙ Executing task: ${task}`);
      const result = await callback();
      this.logger.log(`✔ Completed task: ${task}`);
      return result;
    } catch (error) {
      this.logger.log(`✖ Error executing task: ${task}\n   ${error.message}`);
      throw error;
    }
  }

  async process() {
    await this.login();
    await this.ensureAdMode();

    await this.logUserInfo();
    await this.executeTask("Energy Ad", () => this.watchFullEnergyAd());
    await this.executeTask("Battery Ad", () => this.watchBatteryAd());
    await this.executeTask("Tap", () => this.tapUntilBatteryFull());
    await this.executeTask("Collect", () => this.collectEverything());
    await this.executeTask("Upgrades", () => this.upgradeItems());
  }

  /** Log the current account state. */
  async logUserInfo() {
    const user = this.user_data;

    this.logger.newline();
    this.logCurrentUser();

    this.logger.keyValue("Balance", user?.coins ?? "0");
    this.logger.keyValue("Per Hour", user?.profitPerHour ?? "0");
    this.logger.keyValue("Total Earned", user?.totalEarned ?? "0");
    this.logger.keyValue(
      "Energy",
      `${user?.energy ?? 0}/${user?.maxEnergy ?? 0}`,
    );
    this.logger.keyValue(
      "Battery",
      `${user?.batteryLevel ?? 0} (${user?.batteryEnergy ?? 0}/${user?.batteryCap ?? 0})`,
    );
    this.logger.keyValue("Bucket", user?.bucketCoins ?? "0");

    this.logger.newline();
  }

  /** Show a tiny stats/rank summary. */
  async showRank() {
    const [stats, rank] = await Promise.all([
      this.getStats().catch(() => null),
      this.getRank().catch(() => null),
    ]);
    if (rank?.rank) this.logger.info(`Rank #${rank.rank} of ${stats?.players || "?"} players.`);
  }

  /* --------------------------------------------------------------------- */
  /* Tools                                                                 */
  /* --------------------------------------------------------------------- */

  createTools() {
    return [
      {
        name: "Collect",
        list: [
          {
            id: "tap-to-full",
            icon: "hand.raised.fill",
            title: "Tap Battery to 100%",
            action: this.tapUntilBatteryFull.bind(this),
            dispatch: false,
          },
          {
            id: "collect-all",
            icon: "refresh",
            title: "Collect All",
            action: this.collectEverything.bind(this),
            dispatch: false,
          },
          {
            id: "upgrade-all",
            icon: "arrow.up",
            title: "Upgrade All",
            action: this.upgradeItems.bind(this),
            dispatch: false,
          },
        ],
      },
    ];
  }
}