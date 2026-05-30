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
  static interval = "*/30 * * * *";
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

  static OFFSET = {
    PROFIT_PER_HOUR: 15,
    COINS: 3,
    MINED: 6,
    DAILY_BONUS_STREAK: 8,
  };

  async fetchGameState(signal) {
    return this.parseState(await this.post("headcoin.php", {}, signal));
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

    await this._preUpgradeTasks(state, O, signal);

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

  async _preUpgradeTasks(state, O, signal) {
    await this._claimDailyBonus(state, O, signal).catch((e) =>
      this.logger.warn(`Daily bonus failed: ${e?.message || e}`),
    );
    await this.refreshWebAppData().catch((e) =>
      this.logger.warn(`Refresh webapp failed: ${e?.message || e}`),
    );
  }

  async _claimDailyBonus(state, O, signal) {
    const claimed = parseInt(state[O.DAILY_BONUS_STREAK], 10) || 0;
    if (claimed > 0) {
      this.logger.info("Daily bonus already claimed");
      return;
    }
    const result = await this.executeTask("Claim daily bonus", () => this.claimDailyBonus(signal));
    if (String(result ?? "").trim() === "1") {
      this.logger.success("Daily bonus claimed");
    } else {
      this.logger.warn(`Daily bonus claim returned: ${JSON.stringify(result)}`);
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

  async _upgradeCards(O, signal) {
    if (signal.aborted) return;

    let upgrades = 0;
    let currentCoins;
    let currentProfit;

    const state = await this.fetchGameState(signal);
    if (!state || state.length < 20) {
      this.logger.error("Unexpected game state");
      return;
    }

    currentCoins = parseInt(state[O.COINS], 10) || 0;
    currentProfit = parseInt(state[O.PROFIT_PER_HOUR], 10) || 0;

    if (currentProfit >= 55000) {
      this.logger.info(`Maximum profit per hour reached: ${currentProfit}`);
      return;
    }

    for (let el = 0; el <= 15; el++) {
      if (signal.aborted) return;
      if (currentCoins <= 0) break;

      const lvl = this._getCardUpgradeCount(state, 1, el);
      if (lvl >= 14) continue;

      const result = await this.executeTask(
        `Upgrade cat 1 el ${el}`,
        () => this.upgradeElement(1, el, signal),
      );

      const trimmed = String(result ?? "").trim();

      if (trimmed === "1") {
        upgrades++;
        await this.utils.delayForSeconds(2, { signal: this.signal });
        const postState = await this.fetchGameState(signal);
        if (postState && postState.length >= 20) {
          currentCoins = parseInt(postState[O.COINS], 10) || 0;
          currentProfit = parseInt(postState[O.PROFIT_PER_HOUR], 10) || 0;
        }

        if (currentProfit >= 55000) {
          this.logger.success(`Cat 1/${el} upgraded — coins: ${currentCoins}, profit: ${currentProfit}`);
          this.logger.info("Max profit reached");
          return;
        }
        this.logger.success(`Cat 1/${el} upgraded — coins: ${currentCoins}, profit: ${currentProfit}`);
      } else if (trimmed === "2") {
        this.logger.warn(`Cat 1/${el}: locked`);
      }
    }

    this.logger.success(`Farming complete — coins: ${currentCoins}, profit: ${currentProfit}, upgrades: ${upgrades}`);
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
