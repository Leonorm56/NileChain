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
const MAX_BATTERY_LEVEL = 48;

/** PPH gate: accounts above this must reach FIRST_BATTERY_LEVEL before Phase 2. */
const BATTERY_GATE_PPH = 200000;
const FIRST_BATTERY_LEVEL = 17;

/** Mid-tier battery gate: at this PPH the battery target rises to MID_BATTERY_LEVEL. */
const MID_BATTERY_GATE_PPH = 300000;
const MID_BATTERY_LEVEL = 25;

/** Second-tier battery gate: at this PPH the battery target rises to LATE_BATTERY_LEVEL. */
const LATE_BATTERY_GATE_PPH = 450000;
const LATE_BATTERY_LEVEL = 30;

/** High-tier battery gate: at this PPH the battery target rises to HIGH_BATTERY_LEVEL. */
const HIGH_BATTERY_GATE_PPH = 500000;
const HIGH_BATTERY_LEVEL = 35;

/** Third-tier battery gate: at this PPH the battery target rises to THIRD_BATTERY_LEVEL. */
const THIRD_BATTERY_GATE_PPH = 600000;
const THIRD_BATTERY_LEVEL = 44;

/** Fourth-tier battery gate: at this PPH the battery target rises to FOURTH_BATTERY_LEVEL. */
const FOURTH_BATTERY_GATE_PPH = 800000;
const FOURTH_BATTERY_LEVEL = 48;

/** Maximum live PPH before the account stops farming (hard ceiling). */
const MAX_PPH_CEILING = 870000;

/** Energy limit target once PPH reaches the 650K ceiling. */
const CEILING_ENERGY_TARGET = 6500;

/** Energy gate: below this PPH the farmer does not buy energy_limit boosts. */
const ENERGY_GATE_PPH = 200000;

/** Rolling-hour ad budget shared by the Energy/Battery boost-ad tasks. */
const MAX_ADS_PER_HOUR = 2;
const AD_BUDGET_WINDOW_MS = 60 * 60 * 1000;

/**
 * Battery credit per tap collapses as the bar fills — the mini-app applies
 * `Ht(charge)`: full credit below 60%, then 0.5, then 0.3, and nothing at all
 * once the battery reads 100%. A tap is worth `energyPerTap * 50 * multiplier`
 * battery, which is why the last stretch of a charge costs far more energy per
 * point than the first.
 */
function batteryGainMultiplier(charge) {
  return charge < 0.6 ? 1 : charge < 0.85 ? 0.5 : charge < 1 ? 0.3 : 0;
}

/** Largest `count` one /tap request may credit (the mini-app caps at 100 too). */
const MAX_TAPS_PER_REQUEST = 500;

/**
 * /tap requests in flight at once. One round trip costs ~1.5–2 s, so a serial
 * loop only manages ~300 taps inside a run; lanes multiply the throughput.
 * Longer windows credit more: 20 s lands ~685 taps where 5 s lands ~230.
 */
const TAP_LANES = 20;

/** Tap passes per farmer run — each one gets the full TAP_BUDGET_MS. */
const TAP_PASSES = 6;

/** Longest we wait out a server tap lock before handing the rest to the next run. */
const MAX_TAP_LOCK_WAIT_MS = 5 * 60 * 1000;

/**
 * Fast burst: the whole run taps for TAP_BUDGET_MS and the server sets the
 * credit rate — refused taps are resent rather than paced away.
 */
const TAP_PACE_MS = 1;

/** Back off this long after a batch the server refused before retrying it. */
const TAP_REFUSAL_BACKOFF_MS = 25;

/** Cap on the refusal backoff — however long the server keeps refusing, keep tapping. */
const TAP_MAX_REFUSAL_BACKOFF_MS = 200;

/**
 * Back off this long when a whole tap burst is refused at the request level
 * (the API's generic `{error:"Error"}`, a 502, a timeout) rather than the taps
 * being declined. Louder than a tap refusal because the API itself is unwell.
 */
const TAP_BURST_FAILURE_BACKOFF_MS = 500;

/** Cap on the burst-failure backoff, so a dead API is not hammered. */
const TAP_MAX_BURST_BACKOFF_MS = 2_000;

/**
 * How long without a refusal before the tap burst is restored to full width.
 * A burst the API refuses (429/502/timeout) halves the next burst's lane width,
 * which then grows back one lane per clean burst. Without this the pass kept
 * firing 20 parallel taps into a 429 limiter and spending its whole budget on
 * requests the API had already said no to.
 */
const TAP_LANE_RECOVER_MS = 2_000;

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

  /**
   * A short label for a failed call that says *why*: the HTTP status when there
   * was a response, the network code when there was not, and the API's own
   * error string. The fleet logged 13k identical "Tap failed: Error" lines that
   * named neither the status nor the endpoint, which made the cause unknowable.
   */
  describeError(error) {
    const status = error?.response?.status;
    const reason = this.readError(error);
    const label = [status ?? error?.code ?? "no-response", reason]
      .filter(Boolean)
      .join(" ");

    return label;
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
    // Battery gate: five tiers —
    //   200K+ PPH → battery must reach L17 before Phase 2 deepening
    //   300K+ PPH → battery must reach L25 before Phase 2 deepening
    //   450K+ PPH → battery must reach L30 before Phase 2 deepening
    //   500K+ PPH → battery must reach L35 before Phase 2 deepening
    //   600K+ PPH → battery must reach L44 before Phase 2 deepening
    // Accounts at 200K or below skip straight to deepening.
    this.logger.newline();
    const pph = Number(user?.profitPerHour) || 0;
    const curBatteryLevel = Number(user?.batteryLevel) || 0;
    const gateMet = pph > BATTERY_GATE_PPH;
    const midGateMet = pph > MID_BATTERY_GATE_PPH;
    const lateGateMet = pph > LATE_BATTERY_GATE_PPH;
    const highGateMet = pph > HIGH_BATTERY_GATE_PPH;
    const thirdGateMet = pph > THIRD_BATTERY_GATE_PPH;
    const fourthGateMet = pph > FOURTH_BATTERY_GATE_PPH;
    const batteryTarget = fourthGateMet
      ? FOURTH_BATTERY_LEVEL
      : thirdGateMet
        ? THIRD_BATTERY_LEVEL
        : highGateMet
          ? HIGH_BATTERY_LEVEL
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
      pphNow > FOURTH_BATTERY_GATE_PPH
        ? FOURTH_BATTERY_LEVEL
        : pphNow > THIRD_BATTERY_GATE_PPH
          ? THIRD_BATTERY_LEVEL
          : pphNow > HIGH_BATTERY_GATE_PPH
            ? HIGH_BATTERY_LEVEL
            : pphNow > LATE_BATTERY_GATE_PPH
              ? LATE_BATTERY_LEVEL
              : pphNow > MID_BATTERY_GATE_PPH
                ? MID_BATTERY_LEVEL
                : FIRST_BATTERY_LEVEL;

    // ================= FARMING PHASE 2 — DEEPEN ========================
    // Runs once the full farm (MAX_FARM_SIZE) is owned. While above the
    // battery gate the account pauses deepening until the battery reaches
    // the tier-appropriate target (L17 at 200K+, L25 at 300K+, L30 at 450K+, L35 at 500K+, L44 at 600K+).
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
   * PPH: below 200K no energy_limit upgrades, 200K+ up to 3.5k, and 6.5k once
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
  /** Burst tap: run at full speed for TAP_BUDGET_MS (20 s), resending whatever
   *  the server refuses (the mini-app requeues refused taps too), and stop only
   *  when the battery is full, energy is spent, or the time budget is out.
   *  Measured: 20 s credits ~685 taps vs ~230 in 5 s — the charge per cycle is
   *  what keeps an account off 0% battery, where PPH collapses to ~6% of raw. */
  async tapUntilBatteryFull() {
    const TAP_BUDGET_MS = 5_000;
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
    // Bounded so a slow chain can't eat the whole tap budget.
    await Promise.race([
      this.buyTapBoosts(),
      this.utils.delay(2_000, { precised: true }),
    ]).catch(() => {});
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
    // Taps the server already charged energy for but did not credit. Resent —
    // the mini-app requeues these instead of spending a fresh batch on them.
    let pending = 0;
    // Epoch-ms until which the server's own tap lock refuses taps.
    let lockUntil = 0;

    this.logger.log(`Tapping to 100% — battery ${Math.round((battery / cap) * 100)}% of ${cap.toLocaleString()}.`);
    this.debugger.log(
      `~${batteryGainMultiplier(battery / cap) * multitap * 50} battery per tap at this charge.`,
    );
    const tapStartedAt = Date.now();
    // Grows while the server is refusing, resets on the next credit.
    let paceMs = TAP_PACE_MS;
    // Lanes in the next burst: halved when the API refuses a burst outright,
    // grown a lane per clean burst, and restored in full once the limiter has
    // been quiet for TAP_LANE_RECOVER_MS. Carried on the instance because a
    // cycle runs six passes back to back — without that, every pass would pay
    // for the lesson again by firing a full-width burst into a limiter that had
    // already said no.
    let laneWidth = this.tapLaneWidth ?? TAP_LANES;
    let lastRefusedAt = this.tapRefusedAt ?? 0;

    const patchFrom = (res) => {
      this.user_data = { ...this.user_data, ...this.activeMerge(res) };
      const merged = this.user_data;
      battery = Number(merged.batteryEnergy ?? battery);
      energy = Number(merged.energy ?? energy);
      coins = Number(merged.coins ?? coins);
      fullEnergyLeft = Number(merged.fullEnergyLeft ?? fullEnergyLeft);
    };

    while (!this.signal?.aborted && guard++ < 5_000) {
      if (battery >= cap) break;
      if (Date.now() - tapStartedAt >= TAP_BUDGET_MS) {
        this.logger.info(`Tap budget hit (${TAP_BUDGET_MS / 1000}s) at ${battery}/${cap}.`);
        break;
      }

      // The server locks tapping outright on some responses (`locked` +
      // `unlockAt`). Wait the lock out — the old loop saw `accepted: 0`, called
      // it a dead end and left the battery short with energy still in the tank.
      if (lockUntil > Date.now()) {
        const wait = Math.min(lockUntil - Date.now(), MAX_TAP_LOCK_WAIT_MS);
        if (Date.now() - tapStartedAt + wait >= TAP_BUDGET_MS) break;
        this.logger.info(
          `Tap locked by the server — waiting ${Math.ceil(wait / 1000)}s (until ${new Date(lockUntil).toISOString()}).`,
        );
        await this.utils.delay(wait, { signal: this.signal }).catch(() => {});
        continue;
      }

      // Out of energy — use a free full-energy refill so we can keep tapping.
      const energyTaps = Math.floor((energy || 0) / multitap);
      if (energyTaps < 1 && pending < 1) {
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

      // One /tap round trip costs ~1.5–2 s, so serial batches cap a 5 s run at
      // ~300 taps. Fire the lanes at once instead, up to `laneWidth`. Lanes are
      // bounded by the request cap, the taps the server already charged for, and
      // the energy actually on hand — never more.
      // Quiet since the last refusal means the limiter has let go, so go
      // straight back to full width instead of crawling up a lane at a time.
      if (lastRefusedAt && Date.now() - lastRefusedAt >= TAP_LANE_RECOVER_MS) {
        laneWidth = TAP_LANES;
        lastRefusedAt = 0;
      }

      const laneCounts = [];
      let leftPending = pending;
      let leftEnergy = energyTaps;
      while (laneCounts.length < laneWidth) {
        const fromPending = Math.min(leftPending, MAX_TAPS_PER_REQUEST);
        const fromEnergy = Math.min(
          MAX_TAPS_PER_REQUEST - fromPending,
          Math.max(0, leftEnergy),
        );
        const laneCount = fromPending + fromEnergy;
        if (laneCount < 1) break;
        leftPending -= fromPending;
        leftEnergy -= fromEnergy;
        laneCounts.push(laneCount);
      }
      const sent = laneCounts.reduce((a, b) => a + b, 0);
      const prevCoins = coins;
      /** Distinct reasons a lane failed, collected so one burst is one log line. */
      const laneErrors = new Set();
      const results = await Promise.all(
        laneCounts.map((count) =>
          this.tap(count).catch((e) => {
            laneErrors.add(this.describeError(e));
            return null;
          }),
        ),
      );
      const failedLanes = results.filter((result) => !result).length;

      if (failedLanes) {
        // The API refused part or all of the burst: ask for less next time.
        laneWidth = Math.max(1, Math.floor(laneWidth / 2));
        lastRefusedAt = Date.now();
        this.logger.warn(
          `Tap burst: ${failedLanes}/${laneCounts.length} lane(s) failed — ${[...laneErrors].join("; ")}. Narrowing to ${laneWidth} lane(s).`,
        );
      } else {
        laneWidth = Math.min(TAP_LANES, laneWidth + 1);
      }

      if (failedLanes === laneCounts.length) {
        // Every lane was refused at the request level, so the API itself is
        // unwell rather than declining taps. Nothing was charged, so the held
        // taps are still owed to us — back off and send them again. The old loop
        // called this a dead end and ended the pass with taps left to spend,
        // which is how a transient 502 cost an account the rest of its burst.
        paceMs = Math.min(
          Math.max(paceMs * 2, TAP_BURST_FAILURE_BACKOFF_MS),
          TAP_MAX_BURST_BACKOFF_MS,
        );
        if (Date.now() - tapStartedAt + paceMs >= TAP_BUDGET_MS) break;
        await this.utils.delay(paceMs, { signal: this.signal }).catch(() => {});
        continue;
      }

      let accepted = 0;
      let refused = 0;
      let lockedUntil = 0;
      laneCounts.forEach((count, i) => {
        const result = results[i];
        if (!result) {
          // The request never landed, so those taps were never charged — hold
          // them for a resend like any other refusal.
          refused += count;
          return;
        }
        const got = Number(result.accepted ?? count) || 0;
        accepted += got;
        refused += Math.max(0, count - got);
        if (result.locked) {
          lockedUntil = Math.max(lockedUntil, Number(result.unlockAt) || 0);
        }
        patchFrom(result);
      });
      taps += accepted;
      gained += Math.max(0, coins - prevCoins);

      // A lock can arrive on an ordinary tap response: hold the batch and wait.
      if (lockedUntil) {
        lockUntil = lockedUntil;
        pending = refused;
        this.debugger.log(
          `Tap lanes locked: ${refused} tap(s) held until ${new Date(lockUntil).toISOString()}.`,
        );
        continue;
      }

      pending = refused;
      this.debugger.log(
        `Tap batch (${accepted}/${sent} over ${laneCounts.length} lanes): +${Math.max(0, coins - prevCoins)} coins, energy ${energy}/${user.maxEnergy}, battery ${Math.round((battery / cap) * 100)}%, ${refused} refused.`,
      );

      // Refusals are not a dead end: the server credits part of a batch and
      // expects the rest resent (the mini-app requeues them). Keep tapping while
      // energy lasts — back off while the server is refusing so we are not
      // hammering it, and speed back up on the next credit. Only the energy pool
      // and the time guard end the run.
      if (failedLanes > 0) {
        // A lane failed at the request level while others credited, so the API
        // is struggling — do not snap back to the fast pace a clean credit
        // earns, which is exactly what provoked the failure.
        paceMs = Math.min(
          Math.max(paceMs * 2, TAP_REFUSAL_BACKOFF_MS),
          TAP_MAX_REFUSAL_BACKOFF_MS,
        );
      } else if (accepted > 0) {
        // Per-lane cost, not per tap: the lanes already ran in parallel.
        paceMs = Math.min(Math.ceil(accepted / TAP_LANES) * TAP_PACE_MS, 5_000);
      } else if (refused > 0) {
        paceMs = Math.min(Math.max(paceMs * 2, TAP_REFUSAL_BACKOFF_MS), TAP_MAX_REFUSAL_BACKOFF_MS);
      }
      if (Date.now() - tapStartedAt + paceMs < TAP_BUDGET_MS) {
        await this.utils.delay(paceMs, { signal: this.signal }).catch(() => {});
      }
    }

    this.tapLaneWidth = laneWidth;
    this.tapRefusedAt = lastRefusedAt;

    const pct = Math.round((battery / cap) * 100);
    if (battery >= cap) {
      this.logger.success(`Battery charged to 100% (${taps} taps, +${gained} coins, ${boosts} refill${boosts === 1 ? "" : "s"}).`);
    } else if (taps) {
      const held = pending > 0 ? `, ${pending} held` : "";
      this.logger.info(
        `Tapped ${taps}× (+${gained} coins) — battery ${pct}%, energy ${energy}/${user.maxEnergy}${held}.`,
      );
    } else {
      // Reached only with taps === 0 and the battery short of full: no energy
      // left to spend, so say that rather than claiming nothing was needed.
      this.logger.info(`No taps possible — battery ${pct}%, energy ${energy}/${user.maxEnergy}.`);
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
    // Order matters: fill the energy bar, spend it on taps (tapping is what
    // charges the battery), then take the battery ad so its direct top-up
    // lands last instead of being spent into curve-discounted taps.
    await this.executeTask("Energy Ad", () => this.watchFullEnergyAd());
    // Two tap passes, each with its own TAP_BUDGET_MS: the server credits only
    // ~240 taps per 5 s window, so one pass leaves taps on the table.
    for (let pass = 0; pass < TAP_PASSES; pass++) {
      await this.executeTask("Tap", () => this.tapUntilBatteryFull());
    }
    await this.executeTask("Battery Ad", () => this.watchBatteryAd());
    await this.executeTask("Daily Streak", async () => {
      // This read is the only call in the cycle with no handling of its own, and
      // Rignite rate-limits it (429) when every account asks from the same IP in
      // the same pass. An escaping 429 aborted `process()` and cost the account
      // its Collect and Upgrades — the streak is worth a few coins, the rest of
      // the cycle is worth a lot more, so a failed read just skips the task.
      let daily;
      try {
        daily = await this.getDaily();
      } catch (e) {
        if (e?.response?.status === 429) {
          this.logger.info(
            "Daily streak rate-limited (429) — skipped this cycle.",
          );
        } else {
          this.logger.warn("Daily streak unavailable:", this.readError(e));
        }
        return;
      }
      const streakBefore = daily?.streak;
      let claimed = null;
      let claimedState = null;
      let claimError = null;
      if (daily?.canClaim) {
        try {
          claimed = await this.claimDaily();
          claimedState = claimed?.state;
        } catch (e) {
          claimError = e;
        }
      }
      // Some Rignite API responses leave canClaim false even when claimable —
      // attempt the claim anyway so the streak actually increments.
      if (!claimed && daily !== null && !claimError) {
        try {
          claimed = await this.claimDaily();
          claimedState = claimed?.state;
        } catch (e) {
          claimError = e;
        }
      }
      // 400 from the game server = already claimed today (or invalid) — treat as
      // "already claimed" instead of crashing the whole cycle.
      if (claimError && claimError.response?.status === 400) {
        this.logger.info(`Daily streak already claimed today (400).`);
        return;
      }
      if (claimedState) {
        this.user_data = { ...this.user_data, ...claimedState };
      }
      const streakAfter = (claimedState && claimedState.streak) || streakBefore || "?";
      if (claimed) {
        this.logger.success(`Daily streak claimed — streak ${streakAfter}, +${claimed?.coins ?? daily?.coins ?? 0} coins.`);
      } else {
        this.logger.info(`Daily streak already claimed — streak ${streakAfter}.`);
      }
    });
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