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
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          "Origin": "https://headgun.org",
          "Referer": "https://headgun.org/",
          "x-requested-with": "org.telegram.messenger",
        },
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
    DIAMOND_BALANCE: 28,
    KEYS: 24,
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

  // ---- NFT / Diamond helpers ----

  async _postClean(endpoint, extra, signal) {
    const now = Date.now();
    const params = new URLSearchParams({
      textqueryid: this.telegramWebApp?.initData || "",
      ...extra,
      timestamp: String(now),
    });
    return this.api
      .post(`${API_BASE}/${endpoint}`, params.toString(), {
        signal,
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          "Origin": "https://headgun.org",
          "Referer": "https://headgun.org/",
          "x-requested-with": "org.telegram.messenger",
        },
      })
      .then((r) => r.data);
  }

  async claimKey(signal) {
    return this._postClean("claim8hourskey2.php", {}, signal);
  }

  async openNftBox(numbKeys = 1, signal) {
    const text = await this.post("openboxnft9.php", { numbkeys: String(numbKeys) }, signal);
    const trimmed = String(text ?? "").trim();
    this.logger.log(`openNftBox(${numbKeys}) raw: "${trimmed}"`);
    const parts = trimmed.split("-");
    if (parts.length >= 3) {
      return { keyId: parts[0], nftId: parseInt(parts[2], 10) };
    }
    return null;
  }

  async myNfts(signal) {
    const text = await this._postClean("mynfts.php", {}, signal);
    const trimmed = String(text ?? "").trim();
    const sep = trimmed.split("-");
    if (sep.length < 4) {
      this.logger.warn(`myNfts unexpected format: ${sep.length} parts`);
      return null;
    }
    const flags = sep[1].split("_").map(Number);
    return {
      balance: parseFloat(sep[0]) || 0,
      flags,
      rate: parseFloat(sep[2]) || 0,
      total: parseFloat(sep[3]) || 0,
    };
  }

  async addNftToMining(elementId, slot, signal) {
    const now = Date.now();
    const params = new URLSearchParams({
      textqueryid: this.telegramWebApp?.initData || "",
      numbelement: String(elementId),
      numbslot: String(slot),
      timestamp: String(now),
    });
    const raw = await this.api
      .post(`${API_BASE}/addnft.php`, params.toString(), {
        signal,
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          "Origin": "https://headgun.org",
          "Referer": "https://headgun.org/",
        },
      })
      .then((r) => r.data);
    return String(raw ?? "").trim() === "1";
  }

  async removeNftFromSlot(slot, signal) {
    const raw = await this.post("removenftteam.php", { numbelement: String(slot) }, signal);
    const trimmed = String(raw ?? "").trim();
    this.logger.log(`removeNft(slot=${slot}) raw: "${trimmed}"`);
    return trimmed === "1";
  }

  async collectNftDiamonds(signal) {
    const raw = await this.post("collectnftteam.php", {}, signal);
    const trimmed = String(raw ?? "").trim();
    this.logger.log(`collectDiamonds raw: "${trimmed}"`);
    return trimmed === "1";
  }

  _getNftTeamElements(state) {
    const raw = (state[105] || "").trim();
    if (raw && raw !== "0_0_0_0_0") {
      const vals = raw.split("_").map(Number);
      if (vals.length >= 3 && vals.some(v => v > 0)) return vals.slice(0, 5);
    }
    const ids = [];
    for (let i = 96; i <= 100; i++) {
      const v = parseInt(state[i], 10);
      ids.push(isNaN(v) ? 0 : v);
    }
    return ids;
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

    const startTime = Date.now();
    await this._preUpgradeTasks(state, O, signal);

    await this._upgradeCards(O, signal);

    await this._nftDiamondFlow(state, O, signal);
    this.logger.info(`Cycle completed in ${((Date.now() - startTime) / 1000).toFixed(1)}s`);
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
    this.logger.keyValue("Diamonds", parseFloat(state[O.DIAMOND_BALANCE]) || 0);
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
    const catCounts = { 2: 9, 3: 13, 1: 9, 4: 2 };
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

    for (let el = 0; el <= 9; el++) {
      if (signal.aborted) return;
      if (currentCoins <= 0) break;

      const lvl = this._getCardUpgradeCount(state, 3, el);
      if (lvl >= 14) continue;

      const result = await this.executeTask(
        `Upgrade cat 3 el ${el}`,
        () => this.upgradeElement(3, el, signal),
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
          this.logger.success(`Cat 3/${el} upgraded — coins: ${currentCoins}, profit: ${currentProfit}`);
          this.logger.info("Max profit reached");
          return;
        }
        this.logger.success(`Cat 3/${el} upgraded — coins: ${currentCoins}, profit: ${currentProfit}`);
      } else if (trimmed === "2") {
        this.logger.warn(`Cat 3/${el}: locked`);
      }
    }

    this.logger.success(`Farming complete — coins: ${currentCoins}, profit: ${currentProfit}, upgrades: ${upgrades}`);
  }

  async _nftDiamondFlow(state, O, signal) {
    const freshState = await this.fetchGameState(signal).catch(() => state);
    const liveState = (freshState && freshState.length >= 20) ? freshState : state;

    let diamondBalance = parseFloat(liveState[O.DIAMOND_BALANCE]) || 0;
    this.logger.keyValue("Diamonds", diamondBalance);

    const claimed = await this.executeTask("Claim 8-hour key", () => this.claimKey(signal));
    const claimedCount = parseInt(String(claimed ?? "0").trim(), 10) || 0;
    if (claimedCount > 0) {
      this.logger.success(`Claimed ${claimedCount} keys`);
      await this.utils.delayForSeconds(1, { signal });
    }

    const freshState2 = await this.fetchGameState(signal).catch(() => liveState);
    const keyCount = parseInt((freshState2 || liveState)[O.KEYS], 10) || 0;
    this.logger.keyValue("Keys", keyCount);

    if (keyCount >= 10) {
      const result = await this.executeTask("Open 10 boxes", () => this.openNftBox(10, signal));
      if (result && result.nftId) {
        this.logger.success(`Opened 10 boxes, got NFT #${result.nftId}`);
      } else {
        this.logger.warn("Bulk box open returned unexpected result");
      }
      await this.utils.delayForSeconds(1, { signal });
    } else if (keyCount > 0) {
      for (let i = 0; i < Math.min(keyCount, 5); i++) {
        if (signal.aborted) return;
        const result = await this.executeTask(`Open box ${i+1}`, () => this.openNftBox(1, signal));
        if (result && result.nftId) {
          this.logger.success(`Opened NFT #${result.nftId}`);
          await this.utils.delayForSeconds(1, { signal });
        } else {
          break;
        }
      }
    }

    const nftData = await this.executeTask("Fetch NFT list", () => this.myNfts(signal));
    const teamElements = this._getNftTeamElements(liveState);
    const filledSlots = teamElements.filter(v => v > 0).length;

    if (nftData && nftData.flags) {
      if (filledSlots >= 3) {
        this.logger.info(`All 3 slots filled (${teamElements.slice(0,3).join(",")}), skipping swap`);
      } else {
        const owned = [];
        for (let id = 0; id < nftData.flags.length; id++) {
          if (nftData.flags[id] === 1) owned.push(id);
        }
        const inTeam = new Set(teamElements.filter(v => v > 0));
        const available = owned.filter(id => !inTeam.has(id));
        this.logger.info(`NFTs: owned ${owned.length}, in team ${inTeam.size}, available ${available.length}`);
        available.sort((a, b) => b - a);

        for (let slot = 1; slot <= 3; slot++) {
          if (signal.aborted) return;
          await this.executeTask(
            `Remove NFT from slot ${slot}`,
            () => this.removeNftFromSlot(slot, signal),
          );
          await this.utils.delayForSeconds(1, { signal });
        }

        let slotIdx = 1;
        for (const elementId of available) {
          if (signal.aborted) return;
          if (slotIdx > 3) break;
          const added = await this.executeTask(
            `Add NFT #${elementId} to slot ${slotIdx}`,
            () => this.addNftToMining(elementId, slotIdx, signal),
          );
          if (added) {
            this.logger.success(`NFT #${elementId} added to slot ${slotIdx}`);
            teamElements[slotIdx - 1] = elementId;
            await this.utils.delayForSeconds(1, { signal });
          } else {
            this.logger.warn(`Failed to add NFT #${elementId}`);
          }
          slotIdx++;
        }
      }
    } else {
      this.logger.warn(`NFT data: ${JSON.stringify(nftData)}`);
    }

    const collected = await this.executeTask("Collect diamond rewards", () => this.collectNftDiamonds(signal));
    if (collected) {
      this.logger.success("Diamond rewards collected");
      const finalState = await this.fetchGameState(signal).catch(() => null);
      if (finalState) {
        diamondBalance = parseFloat(finalState[O.DIAMOND_BALANCE]) || 0;
      }
    }

    this.logger.keyValue("Diamonds final", diamondBalance);
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
