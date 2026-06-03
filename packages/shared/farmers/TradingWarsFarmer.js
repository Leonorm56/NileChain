import BaseFarmer from "../lib/BaseFarmer.js";
import { getDeviceForSession, getTelegramVersion, generateAndroidUserAgent } from "../utils/core.js";

const API_BASE = "https://tradingwars.site";

export default class TradingWarsFarmer extends BaseFarmer {
  static id = "trading-wars";
  static title = "TradingWars";
  static emoji = "⚔";
  static host = "tradingwars.site";
  static domains = ["tradingwars.site"];
  static telegramLink = "https://t.me/TradingWars_bot/TradingWars?startapp=referral6627962056";
  static path = "/";
  static singleton = true;
  static cacheAuth = false;
  static interval = "*/30 * * * *";
  static rating = 3;
  static startupDelay = 30;
  static published = true;

  getReferralLink() {
    return `https://t.me/TradingWars_bot/TradingWars?startapp=referral6627962056`;
  }

  fetchAuth() {
    return Promise.resolve(true);
  }

  getAuthHeaders() {
    return {
      "x-auth": this.getInitData(),
      "x-av": "4",
    };
  }

  configureApi() {
    const device = getDeviceForSession(this.getUserId());
    const tgVersion = getTelegramVersion(this.getUserId());
    const userAgent = generateAndroidUserAgent(device, tgVersion);

    this.logger.log(`Device: ${device.name} (Android ${device.android}, Telegram ${tgVersion})`);

    const interceptor = this.api.interceptors.request.use((config) => {
      config.headers["User-Agent"] = userAgent;
      return config;
    });
    return () => this.api.interceptors.request.eject(interceptor);
  }

  // ---- API methods ----

  async apiPost(endpoint, body = {}, signal) {
    const maxRetries = 2;
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        const r = await this.api.post(`${API_BASE}/${endpoint}`, body, { signal });
        return r.data;
      } catch (e) {
        if (attempt < maxRetries && e.response?.status >= 500) {
          this.logger.warn(`  ${endpoint} attempt ${attempt}/${maxRetries} (${e.response.status}), retrying...`);
          await new Promise((r) => setTimeout(r, 3000 * attempt));
          continue;
        }
        const status = e.response?.status ? `status ${e.response.status}` : "no response";
        const body = e.response?.data ? ` — ${JSON.stringify(e.response.data).slice(0, 200)}` : "";
        e.message = `${endpoint}: ${status}${body}`;
        throw e;
      }
    }
  }

  updateUser(signal) {
    return this.apiPost("api/updateUser", {}, signal);
  }

  getWallet(signal) {
    return this.apiPost("api/getWallet", {}, signal);
  }

  getEquipment(signal) {
    return this.apiPost("api/mining/getEquipment", {}, signal);
  }

  getTotalHashRate(signal) {
    return this.apiPost("api/mining/getTotalHashRate", {}, signal);
  }

  upgradeAll(signal) {
    return this.apiPost("api/mining/upgradeAll", {}, signal);
  }

  buyItem(key, parentId, signal) {
    return this.apiPost("api/mining/buyItem", { key, parentId }, signal);
  }

  sellItem(id, signal) {
    return this.apiPost("api/mining/sellItem", { id }, signal);
  }

  startTry(tokensAmount = 0, signal) {
    return this.apiPost("api/startTry", { tokensAmount }, signal);
  }

  openPosition({ long, stopLoss, takeProfit, limitOffset }, signal) {
    return this.apiPost("api/openPosition", { long, stopLoss, takeProfit, limitOffset }, signal);
  }

  getKlines(klineId, signal) {
    return this.api.get(`${API_BASE}/klines/${klineId}.json`, {
      headers: this.getAuthHeaders(),
      signal,
    }).then((r) => r.data);
  }

  _decodeKlines(data) {
    const raw = atob(data);
    const u32 = [];
    for (let i = 0; i < raw.length; i += 4) {
      const v = raw.charCodeAt(i) | (raw.charCodeAt(i + 1) << 8) | (raw.charCodeAt(i + 2) << 16) | (raw.charCodeAt(i + 3) << 24);
      u32.push((v >>> 0) ^ 2779096485);
    }
    if (u32.length < 5) return [];
    const bars = [];
    const n = (u32.length - 1) / 4;
    const k = (x) => x / 1000;
    let price = k(u32[0]);
    let idx = 1;
    for (let i = 0; i < n; i++) {
      const close = k(u32[idx++]);
      const high = k(u32[idx++]);
      const low = k(u32[idx++]);
      const volume = k(u32[idx++]);
      bars.push({ open: price, close, high, low, volume });
      price = close;
    }
    return bars;
  }

  getWalletOperations(limit = 50, skip = 0, signal) {
    return this.apiPost("api/getWalletOperations", { limit, skip }, signal);
  }

  getAchievements(signal) {
    return this.apiPost("api/getAchievements", {}, signal);
  }

  // ---- Process ----

  async process() {
    const [user, wallet, equipment, totalHashRate] = await Promise.all([
      this.updateUser().catch(() => null),
      this.getWallet().catch(() => null),
      this.getEquipment().catch(() => null),
      this.getTotalHashRate().catch(() => null),
    ]);

    if (!user) {
      this.logger.warn("Failed to fetch user data, skipping cycle");
      return;
    }

    this._logInfo(user, wallet, equipment, totalHashRate);

    await this.executeTask("Upgrade Equipment", () => this._upgradeEquipment());
    await this.executeTask("Venue Debug", () => this._logVenues());
    await this.executeTask("Manage Mining", () => this._manageMining());
    await this.executeTask("Trade", () => this._trade(user));
  }

  _logInfo(user, wallet, equipment, totalHashRate) {
    this.logger.newline();
    this.logCurrentUser();
    if (user) {
      this.logger.keyValue("Nickname", user.nickname || "(unknown)");
    }
    const coins = wallet?.miningBalance ?? user?.balance ?? 0;
    this.logger.keyValue("Balance", `${coins.toFixed?.(2) ?? coins} coins`);
    if (wallet) {
      this.logger.keyValue("Tokens", `${wallet.tokens || 0} TWARS`);
    }
    if (Array.isArray(equipment)) {
      const gpus = equipment.filter((i) => i.key?.startsWith("gpu_"));
      this.logger.keyValue("GPUs", `${gpus.length} total`);
    }
    if (totalHashRate != null) {
      this.logger.keyValue("Hash Rate", `${totalHashRate}`);
    }
    this.logger.newline();
  }

  async _upgradeEquipment() {
    const equipment = await this.getEquipment().catch(() => null);
    if (!Array.isArray(equipment)) return;
    const gpus = equipment.filter((i) => i.key?.startsWith("gpu_"));
    const venueOrder = ["venue_home", "venue_garage", "venue_hotel", "venue_datacenter"];
    const totalSlots = { venue_home: 21, venue_garage: 24, venue_hotel: 27, venue_datacenter: 36 };
    const allFull = venueOrder.every((vk) => {
      const venue = equipment.find((i) => i.key === vk);
      if (!venue) return false;
      const venueGpus = gpus.filter((g) => g.parentId === venue.id);
      return venueGpus.length >= (totalSlots[vk] || 0);
    });
    if (!allFull) {
      this.logger.info("Skipping upgrades — not all venue slots are filled yet");
      return;
    }
    const result = await this.upgradeAll();
    if (result) {
      this.logger.success("Equipment upgraded");
    }
  }

  async _logVenues() {
    const data = await this.getEquipment();
    if (!Array.isArray(data)) {
      this.logger.warn("Unexpected response: " + typeof data);
      return;
    }

    const gpuTiers = ["gpu_1050ti", "gpu_1060", "gpu_1070", "gpu_1080ti"];
    const totalSlots = { venue_home: 21, venue_garage: 24, venue_hotel: 27, venue_datacenter: 36, venue_atlantic: 0, venue_lunar: 0 };

    const gpus = data.filter((i) => i.key?.startsWith("gpu_"));

    const targetVenues = ["venue_home", "venue_garage", "venue_hotel", "venue_datacenter", "venue_atlantic", "venue_lunar"];
    const labels = { venue_home: "Home", venue_garage: "Garage", venue_hotel: "Mining Hotel", venue_datacenter: "Data Center", venue_atlantic: "Atlantic", venue_lunar: "Lunar" };

    for (const vk of targetVenues) {
      if (this.signal.aborted) break;
      const venue = data.find((i) => i.key === vk);
      this.logger.log(`--- ${labels[vk] || vk} ---`);
      if (!venue) {
        this.logger.info("(not unlocked)");
        continue;
      }
      const venueGpus = gpus.filter((g) => g.parentId === venue.id);
      const maxSlots = totalSlots[vk] || venueGpus.length;
      this.logger.info(`Slots: ${venueGpus.length}/${maxSlots} filled`);

      for (let i = 0; i < maxSlots; i++) {
        if (this.signal.aborted) break;
        const g = venueGpus[i];
        if (!g) {
          this.logger.info(`  [${i}] (empty)`);
          continue;
        }
        const tierIdx = gpuTiers.indexOf(g.key);
        const nextTier = tierIdx >= 0 && tierIdx < gpuTiers.length - 1 ? gpuTiers[tierIdx + 1] : null;
        this.logger.info(`  [${i}] ${g.key} (id: ${g.id})${nextTier ? ` → ${nextTier}` : " (max)"}`);
      }
    }
  }

  async _manageMining() {
    const [equipment, wallet] = await Promise.all([
      this.getEquipment(),
      this.getWallet().catch(() => null),
    ]);
    if (!Array.isArray(equipment)) return;

    this.logger.newline();
    this.logger.log("=== Mining Management ===");
    let miningBalance = wallet?.miningBalance ?? 0;
    this.logger.info(`Mining Balance: ${miningBalance.toFixed(2)} coins`);

    const gpus = equipment.filter((i) => i.key?.startsWith("gpu_"));
    const venueOrder = ["venue_home", "venue_garage", "venue_hotel", "venue_datacenter"];
    const totalSlots = { venue_home: 21, venue_garage: 24, venue_hotel: 27, venue_datacenter: 36 };
    const unlockCost = { venue_garage: 1000, venue_hotel: 10000, venue_datacenter: 100000 };
    const labels = { venue_home: "Home", venue_garage: "Garage", venue_hotel: "Mining Hotel", venue_datacenter: "Data Center" };
    const gpu1050tiSlots = { venue_home: 12, venue_garage: 12, venue_hotel: 12, venue_datacenter: 6 };
    const machineCost = { gpu_1050ti: 50, asic_s9: 9300 };
    let anyBought = false;

    // ---- Phase 1: fill gpu_1050ti in each venue, then unlock next ----
    let lastUnlockedIdx = -1;
    for (let vi = 0; vi < venueOrder.length; vi++) {
      if (this.signal.aborted) return;
      const vk = venueOrder[vi];
      const venue = equipment.find((i) => i.key === vk);
      if (!venue) break;
      lastUnlockedIdx = vi;

      const venueGpus = gpus.filter((g) => g.parentId === venue.id);
      const maxSlots = totalSlots[vk];
      const gpuCount = gpu1050tiSlots[vk];

      this.logger.log(`--- ${labels[vk]} (${venueGpus.length}/${maxSlots}) ---`);
      for (let i = 0; i < gpuCount; i++) {
        if (this.signal.aborted) return;
        if (venueGpus[i]) continue;
        const cost = machineCost.gpu_1050ti;
        if (cost > miningBalance) {
          this.logger.info(`  [${i}] needs gpu_1050ti (${cost.toLocaleString()} coins) — need ${(cost - miningBalance).toFixed(0)} more`);
          continue;
        }
        try {
          this.logger.info(`  [${i}] (empty) → buy gpu_1050ti (${cost.toLocaleString()} coins)`);
          await this.buyItem("gpu_1050ti", venue.id);
          this.logger.success("    Bought!");
          anyBought = true;
          miningBalance -= cost;
        } catch (e) {
          this.logger.warn(`  [${i}] gpu_1050ti failed: ${e.message}`);
        }
      }
    }

    // unlock next venue if all gpu_1050ti slots filled in current last venue
    const nextIdx = lastUnlockedIdx + 1;
    if (nextIdx < venueOrder.length) {
      const vk = venueOrder[lastUnlockedIdx];
      const venue = equipment.find((i) => i.key === vk);
      if (venue) {
        const venueGpus = gpus.filter((g) => g.parentId === venue.id);
        const gpuCount = gpu1050tiSlots[vk];
        const allGpuFilled = gpuCount === 0 || venueGpus.slice(0, gpuCount).every(Boolean);
        if (allGpuFilled) {
          const nextVk = venueOrder[nextIdx];
          if (!equipment.find((i) => i.key === nextVk)) {
            const cost = unlockCost[nextVk];
            if (cost <= miningBalance) {
              this.logger.info(`Attempting to unlock ${labels[nextVk]} (${cost.toLocaleString()} coins)...`);
              try {
                await this.buyItem(nextVk, null);
                this.logger.success(`Unlocked ${labels[nextVk]}!`);
                anyBought = true;
                miningBalance -= cost;
              } catch (e) {
                this.logger.warn(`Failed to unlock: ${e.message}`);
              }
            } else {
              this.logger.info(`${labels[nextVk]} needs ${cost.toLocaleString()} coins (${(cost - miningBalance).toFixed(0)} more)`);
            }
          }
        }
      }
    }

    // ---- Phase 2: fill asic_s9 only after all 4 venues unlocked ----
    const allUnlocked = venueOrder.every((vk) => equipment.find((i) => i.key === vk));
    if (allUnlocked) {
      const allGpuDone = venueOrder.every((vk) => {
        const venue = equipment.find((i) => i.key === vk);
        if (!venue) return false;
        const venueGpus = gpus.filter((g) => g.parentId === venue.id);
        const gpuCount = gpu1050tiSlots[vk];
        return gpuCount === 0 || venueGpus.slice(0, gpuCount).every(Boolean);
      });
      if (allGpuDone) {
        this.logger.info("All venues unlocked and 1050ti slots filled — buying asic_s9");
        for (const vk of venueOrder) {
          if (this.signal.aborted) return;
          const venue = equipment.find((i) => i.key === vk);
          if (!venue) continue;
          const venueGpus = gpus.filter((g) => g.parentId === venue.id);
          const gpuCount = gpu1050tiSlots[vk];
          const maxSlots = totalSlots[vk];
          for (let i = gpuCount; i < maxSlots; i++) {
            if (this.signal.aborted) return;
            if (venueGpus[i]) continue;
            const cost = machineCost.asic_s9;
            if (cost > miningBalance) {
              this.logger.info(`  [${i}] needs asic_s9 (${cost.toLocaleString()} coins) — need ${(cost - miningBalance).toFixed(0)} more`);
              continue;
            }
            try {
              this.logger.info(`  [${i}] (empty) → buy asic_s9 (${cost.toLocaleString()} coins)`);
              await this.buyItem("asic_s9", venue.id);
              this.logger.success("    Bought!");
              anyBought = true;
              miningBalance -= cost;
            } catch (e) {
              this.logger.warn(`  [${i}] asic_s9 failed: ${e.message}`);
            }
          }
        }
      } else {
        this.logger.info("Still filling gpu_1050ti slots before switching to asic_s9");
      }
    }

    if (anyBought) {
      this.logger.info(`New machines bought, will check upgrades next cycle`);
    }
  }

  async _trade(user) {
    const tryCount = user?.tryCount ?? 0;
    if (tryCount <= 0) {
      this.logger.info("No try tokens remaining");
      return;
    }
    const wallet = await this.getWallet().catch(() => null);
    const twars = wallet?.tokens ?? 0;
    const stakeAmount = twars >= 5 ? 5 : 0;
    if (stakeAmount > 0) {
      this.logger.info(`Staking ${stakeAmount} TWARS`);
    }
    this.logger.info(`Starting try (${tryCount} left)...`);
    const startResult = await this.startTry(stakeAmount);
    if (!startResult?.klineId) {
      this.logger.warn("startTry returned no klineId");
      return;
    }
    this.logger.info(`Kline: ${startResult.klineId}`);
    const encrypted = await this.getKlines(startResult.klineId);
    if (!encrypted) {
      this.logger.warn("No kline data received");
      return;
    }
    const bars = this._decodeKlines(encrypted);
    if (bars.length < 2) {
      this.logger.warn("Not enough bars to decide");
      return;
    }
    const firstPrice = bars[0].open;
    const lastPrice = bars[bars.length - 1].close;
    const long = lastPrice > firstPrice;

    const entryPct = (p) => (p - firstPrice) / firstPrice;
    const maxRally = Math.max(...bars.map((b) => entryPct(b.high)));
    const maxDip = Math.min(...bars.map((b) => entryPct(b.low)));

    if (long && maxDip < -0.003) {
      this.logger.warn(`Skip LONG — price dips ${(maxDip * 100).toFixed(1)}% (exceeds ~0.3% SL bound)`);
      return;
    }
    if (!long && maxRally > 0.003) {
      this.logger.warn(`Skip SHORT — price rallies ${(maxRally * 100).toFixed(1)}% (exceeds ~0.3% SL bound)`);
      return;
    }

    this.logger.info(`Price ${firstPrice.toFixed(3)} → ${lastPrice.toFixed(3)} → ${long ? "LONG" : "SHORT"}`);
    const result = await this.openPosition({ long, stopLoss: 0.003, takeProfit: 0.003, limitOffset: 0 });
    this.logger.success(`Position opened: ${JSON.stringify(result)}`);
  }

  // ---- Tools ----

  createTools() {
    return [
      {
        name: "Actions",
        list: [
          {
            id: "process",
            icon: "refresh",
            title: "Run Cycle",
            action: this.process.bind(this),
            dispatch: false,
          },
        ],
      },
    ];
  }
}
