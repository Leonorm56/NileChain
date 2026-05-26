import BaseFarmer from "../lib/BaseFarmer.js";

const API_BASE = "https://headgun.org/headcoin";
const SPLIT = "|;1f~";

export default class HeadCoinFarmer extends BaseFarmer {
  static id = "head-coin";
  static title = "HeadCoin";
  static emoji = "🪙";
  static host = "headgun.org";
  static domains = ["headgun.org"];
  static telegramLink = "https://t.me/head_coin_bot?start=bonusId6627962056";
  static path = "/headcoinweb166/index.html";
  static singleton = true;
  static cacheAuth = false;
  static interval = "*/10 * * * * *";
  static rating = 3;
  static startupDelay = 30;
  static published = true;
  static maxCardCost = 150000;

  getReferralLink() {
    return `https://t.me/head_coin_bot/start?startapp=bonusId${this.getUserId()}`;
  }

  buildPayload(extra = {}) {
    const now = Date.now();
    const d = new Date(now);
    const pad2 = (n) => String(n).padStart(2, "0");

    return {
      textqueryid: this.telegramWebApp?.initData || "",
      time2200encodein: `${pad2(d.getHours())}:${pad2(d.getMinutes())}:${pad2(d.getSeconds())}`,
      versbuild: "1.73",
      timestamp: String(now),
      ...extra,
    };
  }

  buildUpgradePayload(categIndex, elementIndex) {
    return {
      textqueryid: this.telegramWebApp?.initData || "",
      numbcateg: String(categIndex),
      numbelement: String(elementIndex),
      timestamp: String(Date.now()),
    };
  }

  async post(endpoint, extra, signal) {
    const params = new URLSearchParams(this.buildPayload(extra));
    return this.api
      .post(`${API_BASE}/${endpoint}`, params.toString(), {
        signal,
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
      })
      .then((r) => r.data);
  }

  parseState(raw) {
    const decoded = decodeURIComponent(raw);
    return decoded.split(SPLIT);
  }

  parseTasks(raw) {
    const decoded = decodeURIComponent(raw);
    if (!decoded || decoded === "0") return [];
    return decoded.split("||").map((block) => {
      const parts = block.split("~_-");
      return {
        id: parts[0],
        title: (parts[1] || "").replace(/\+/g, " "),
        link: (parts[2] || "").replace(/\+/g, " "),
        type: parts[3] || "0",
        sponsor: parts[5] || "",
      };
    });
  }

  static OFFSET = {
    PROFIT_PER_HOUR: 15,
    COINS: 3,
    MINED: 6,
    DAILY_BONUS_STREAK: 8,
  };

  async fetchGameState(signal) {
    return this.parseState(await this.post("headcoin.php", {}, signal));
  }

  async fetchTasks(signal) {
    return this.parseTasks(await this.post("gettasks.php", {}, signal));
  }

  async completeTask(taskId, signal) {
    return this.post("checktask.php", { numbtask: taskId }, signal);
  }

  async clickSponsorTask(taskId, signal) {
    return this.post("clicktasksponsor.php", { numbtask: taskId }, signal);
  }

  async checkSponsorTask(taskId, signal) {
    return this.post("checktasksponsor.php", { numbtask: taskId }, signal);
  }

  async claimDailyBonus(signal) {
    return this.post("claimdailybonus.php", {}, signal);
  }

  async refreshWebAppData() {
    await this.updateWebAppData();
  }

  async upgradeElement(categIndex, elementIndex, signal) {
    const params = new URLSearchParams(this.buildUpgradePayload(categIndex, elementIndex));
    return this.api
      .post(`${API_BASE}/levelupelement.php`, params.toString(), {
        signal,
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          "Origin": "https://headgun.org",
          "Referer": "https://headgun.org/",
        },
      })
      .then((r) => r.data);
  }

  // ---- Process ----

  async process() {
    const signal = this.signal;
    const O = HeadCoinFarmer.OFFSET;
    this.logger.log("Starting HeadCoin farming cycle...");

    const state = await this.executeTask("Fetch game state", () => this.fetchGameState(signal));
    if (!state || state.length < 20) {
      this.logger.error("Unexpected game state response");
      return false;
    }

    this._logInfo(state, O);

    await this._upgradeCards(O, signal);
    return true;
  }

  _logInfo(state, O) {
    this.logger.newline();
    this.logCurrentUser();
    this.logger.keyValue("Coins", parseInt(state[O.COINS], 10) || 0);
    this.logger.keyValue("Profit/h", parseInt(state[O.PROFIT_PER_HOUR], 10) || 0);
    const authDate = this.getInitDataUnsafe()?.auth_date;
    if (authDate) {
      const ageMin = Math.round((Date.now() / 1000 - authDate) / 60);
      this.logger.keyValue("InitData age", `${ageMin} min`);
    }
    this.logger.keyValue("Mined", parseInt(state[O.MINED], 10) || 0);
    this.logger.keyValue("Daily Bonus", parseInt(state[O.DAILY_BONUS_STREAK], 10) > 0 ? "Claimed" : "Available");
    this.logger.newline();
  }

  async _claimMined(state, O, signal) {
    const mined = parseInt(state[O.MINED], 10) || 0;
    if (mined <= 0) return;
    this.logger.info(`Claiming ${mined} mined coins...`);
    const refreshed = await this.fetchGameState(signal);
    if (refreshed.length >= 20) {
      this.logger.success(`Mined claimed – Coins: ${refreshed[O.COINS] || 0}`);
    }
  }

  async _claimDailyBonus(state, O, signal) {
    const claimed = parseInt(state[O.DAILY_BONUS_STREAK], 10) || 0;
    if (claimed > 0) {
      this.logger.info("Daily bonus already claimed");
      return;
    }
    await this.executeTask("Claim daily bonus", () => this.claimDailyBonus(signal));
    this.logger.success("Daily bonus claimed");
  }

  async _completeTasks(signal) {
    const tasks = await this.executeTask("Fetch tasks", () => this.fetchTasks(signal));
    if (!tasks?.length) return;

    this.logger.info(`${tasks.length} tasks available`);
    for (const task of tasks) {
      if (signal.aborted) break;
      if (/match money/i.test(task.title)) continue;

      const status = await this.executeTask(
        `Status: ${task.title}`,
        () => this.completeTask(task.id, signal),
      );
      if (String(status).trim() === "1") {
        this.logger.success(`Already done: ${task.title}`);
        continue;
      }

      if (task.sponsor) {
        const link = `https://t.me/${task.sponsor}`;
        await this.executeTask(`Join: ${task.title}`, () => this.tryToJoinTelegramLink(link));
      }

      this.logger.log(`Play: ${task.title}`);
      await this.executeTask(`Play: ${task.title}`, () => this.clickSponsorTask(task.id, signal));

      const check = await this.executeTask(
        `Check: ${task.title}`,
        () => this.checkSponsorTask(task.id, signal),
      );
      if (String(check).trim() === "1") this.logger.success(`Done: ${task.title}`);
      else this.logger.warn(`Pending: ${task.title}`);
    }
  }

  _getCardUpgradeCount(state, cat, el) {
    const cardOrder = [2, 3, 1, 4];
    const catCounts = { 2: 9, 3: 11, 1: 9, 4: 2 };
    let pos = 0;
    for (const c of cardOrder) {
      if (c === cat) break;
      pos += catCounts[c];
    }
    pos += el;

    let maxLevel = 0;
    for (let i = 15; i < Math.min(state.length, 120); i++) {
      const raw = state[i];
      if (!raw || !/^\d+(_\d+)+$/.test(raw)) continue;
      const parts = raw.split("_").map(Number);
      if (pos < parts.length && parts[pos] > maxLevel) {
        maxLevel = parts[pos];
      }
    }
    return maxLevel;
  }

  _getCardCost(state, cat, el) {
    if (!this._cardCostCache) {
      try {
        this._cardCostCache = JSON.parse(localStorage.getItem("hc_cost_cache") || "{}");
      } catch { this._cardCostCache = {}; }
    }
    const cacheKey = `${cat}-${el}`;
    const cached = this._cardCostCache[cacheKey];
    if (cached !== undefined && cached >= this.constructor.maxCardCost) return cached;

    const lvl = this._getCardUpgradeCount(state, cat, el);
    if (lvl >= 14) return this.constructor.maxCardCost;

    return 0;
  }

  async _upgradeCards(O, signal) {
    const cardOrder = [
      { cat: 2, count: 9 },
      { cat: 3, count: 11 },
      { cat: 1, count: 9 },
      { cat: 4, count: 2 },
    ];

    for (const { cat, count } of cardOrder) {
      if (signal.aborted) return;

      this.logger.newline();
      this.logger.info(`=== Fresh cycle before cat ${cat} ===`);

      let state = await this.fetchGameState(signal);
      if (!state || state.length < 20) {
        this.logger.error(`Cat ${cat}: Unexpected game state`);
        continue;
      }

      this._logInfo(state, O);

      await this._claimMined(state, O, signal);
      await this._claimDailyBonus(state, O, signal);
      await this._completeTasks(signal);

      state = await this.fetchGameState(signal);

      this.logger.info(`Upgrading cards cat ${cat} (${count} elements)...`);

      let coins = parseInt(state[O.COINS], 10) || 0;
      let profit = parseInt(state[O.PROFIT_PER_HOUR], 10) || 0;

      if (profit >= 100000) {
        this.logger.info(`Maximum profit per hour reached: ${profit}`);
        return;
      }

      try {
        await this.refreshWebAppData();
      } catch (e) {
        this.logger.warn(`Cat ${cat}: refreshWebAppData failed: ${e?.message || e}`);
      }

      let upgraded = 0;

      for (let el = 0; el < count; el++) {
        if (signal.aborted) return;
        if (coins <= 0) break;

        const upgradeCost = this._getCardCost(state, cat, el);
        if (upgradeCost >= this.constructor.maxCardCost) {
          this.logger.warn(`Cat ${cat}/${el} costs ${upgradeCost} — max ${this.constructor.maxCardCost}, skipping`);
          continue;
        }

        const result = await this.executeTask(
          `Upgrade cat ${cat} el ${el}`,
          () => this.upgradeElement(cat, el, signal),
        );

        const trimmed = String(result ?? "").trim();

        if (trimmed === "1") {
          upgraded++;
          const prevCoins = coins;
          const prevProfit = profit;
          const postState = await this.fetchGameState(signal);
          coins = parseInt(postState[O.COINS], 10) || 0;
          profit = parseInt(postState[O.PROFIT_PER_HOUR], 10) || 0;
          const cost = prevCoins - coins;
          if (!this._cardCostCache) this._cardCostCache = {};
          this._cardCostCache[`${cat}-${el}`] = cost;
          try { localStorage.setItem("hc_cost_cache", JSON.stringify(this._cardCostCache)); } catch {}
          const gain = profit - prevProfit;
          this.logger.success(`Cat ${cat}/${el} upgraded`);
          if (cost > 0) this.logger.keyValue("Cost", cost);
          if (gain > 0) this.logger.keyValue("+Profit/h", gain);
          this.logger.keyValue("Coins left", coins);
          this.logger.keyValue("Profit/h", profit);

          if (profit >= 100000) {
            this.logger.info(`Maximum profit per hour reached: ${profit}`);
            return;
          }
        } else if (trimmed === "2") {
          this.logger.warn(`Cat ${cat}/${el} locked`);
        } else if (trimmed === "0" || trimmed === "") {
          this.logger.warn(`Cat ${cat}/${el} error (${trimmed || "empty"})`);
        } else {
          this.logger.warn(`Cat ${cat}/${el} unexpected: ${JSON.stringify(result)}`);
        }
      }

      if (upgraded > 0) {
        this.logger.newline();
        this.logger.keyValue("Cat upgraded", upgraded);
        this.logger.keyValue("Coins left", coins);
        this.logger.keyValue("Profit/h", profit);
      } else {
        this.logger.info("No upgrades available");
      }

      await this.utils.delayForSeconds(10, { signal: this.signal });
    }

    this.logger.info("All 4 categories upgraded — HeadCoin farming complete");
  }

  async _selectCEO(state, signal) {
    const { selectCEO } = this.parseCEOState(state);
    if (selectCEO < 0) return;
    await this.executeTask(
      `Select CEO game: category ${selectCEO}`,
      () => this.upgradeElement(selectCEO, 0, signal),
    );
    this.logger.success(`CEO game set to category ${selectCEO}`);
  }

  parseCEOState(state) {
    const knownFields = {};
    for (let i = 15; i < Math.min(state.length, 120); i++) {
      const v = state[i];
      if (v && /^\d+(_\d+)+$/.test(v)) {
        knownFields[i] = v.split("_").map(Number);
      }
    }

    let bestCEO = -1;
    for (const [idx, levels] of Object.entries(knownFields)) {
      if (levels.length >= 2 && levels[0] > 0) {
        bestCEO = Math.max(bestCEO, parseInt(idx, 10));
      }
    }

    return { selectCEO: bestCEO, categoryFields: knownFields };
  }

  createTools() {
    return [
      {
        name: "Actions",
        list: [
          {
            id: "run-cycle",
            icon: "refresh",
            title: "Run Farming Cycle",
            action: this.process.bind(this),
            dispatch: false,
          },
        ],
      },
    ];
  }
}
