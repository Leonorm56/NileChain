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
  static interval = "*/10 * * * *";
  static rating = 3;
  static startupDelay = 30;
  static published = true;

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

  async post(endpoint, extra, signal) {
    return this.api
      .post(`${API_BASE}/${endpoint}`, this.buildPayload(extra), {
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

  async upgradeElement(categIndex, elementIndex, signal) {
    return this.post("levelupelement.php", { numbcateg: categIndex, numbelement: elementIndex }, signal);
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

    await this._claimMined(state, O, signal);
    await this._claimDailyBonus(state, O, signal);
    await this._completeTasks(signal);
    await this._upgradeCards(O, signal);
    await this._selectCEO(state, signal);

    const finalState = await this.executeTask("Refresh state", () => this.fetchGameState(signal));
    if (finalState?.length >= 20) {
      this.logger.newline();
      this.logger.keyValue("Final Coins", parseInt(finalState[O.COINS], 10) || 0);
      this.logger.keyValue("Final Profit/h", parseInt(finalState[O.PROFIT_PER_HOUR], 10) || 0);
      this.logger.newline();
    }

    this.logger.log("HeadCoin cycle complete");
    return true;
  }

  _logInfo(state, O) {
    this.logger.newline();
    this.logCurrentUser();
    this.logger.keyValue("Coins", parseInt(state[O.COINS], 10) || 0);
    this.logger.keyValue("Profit/h", parseInt(state[O.PROFIT_PER_HOUR], 10) || 0);
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

  async _upgradeCards(O, signal) {
    const fresh = await this.fetchGameState(signal);
    let coins = parseInt(fresh[O.COINS], 10) || 0;
    let profit = parseInt(fresh[O.PROFIT_PER_HOUR], 10) || 0;

    this.logger.info("Upgrading cards...");

    if (profit >= 35000) {
      this.logger.info(`Maximum profit per hour reached: ${profit}`);
      return;
    }

    for (let cat = 1; cat <= 5 && !signal.aborted; cat++) {
      const elements = [2, 0, 1];
      for (const el of elements) {
        if (coins <= 0) {
          this.logger.info("Not enough money to upgrade");
          break;
        }

        const result = await this.executeTask(
          `Upgrade cat ${cat} elem ${el}`,
          () => this.upgradeElement(cat, el, signal),
        );

        const trimmed = String(result ?? "").trim();

        if (trimmed === "0" || trimmed === "") {
          this.logger.success(`Cat ${cat}/${el} upgraded`);
          const postState = await this.fetchGameState(signal);
          coins = parseInt(postState[O.COINS], 10) || 0;
          profit = parseInt(postState[O.PROFIT_PER_HOUR], 10) || 0;
          this.logger.keyValue("Coins left", coins);
          this.logger.keyValue("Profit/h", profit);

          if (profit >= 35000) {
            this.logger.info(`Maximum profit per hour reached: ${profit}`);
            return;
          }
        } else {
          this.logger.log(`Cat ${cat}/${el} already maxed`);
          continue;
        }
      }
    }
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
