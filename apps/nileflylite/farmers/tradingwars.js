import { postJson } from "../lib/http.js";
import { logger } from "../lib/logger.js";
import { refreshInitData } from "../lib/gram-client.js";


const API_BASE = "https://tradingwars.site";
const BOT = "TradingWars_bot";
const START_PARAM = "referral6627962056";

const VENUE_ORDER = ["venue_home", "venue_garage", "venue_hotel", "venue_datacenter"];
const TOTAL_SLOTS = { venue_home: 21, venue_garage: 24, venue_hotel: 27, venue_datacenter: 36 };
const UNLOCK_COST = { venue_garage: 1000, venue_hotel: 10000, venue_datacenter: 100000 };
const LABELS = { venue_home: "Home", venue_garage: "Garage", venue_hotel: "Mining Hotel", venue_datacenter: "Data Center" };

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function getAuthHeaders(initData) {
  return {
    "x-auth": initData,
    "x-av": "4",
    "User-Agent": "Mozilla/5.0 (Linux; Android 14; SM-S928B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Mobile Safari/537.36 Telegram-Android/9.5",
    "x-requested-with": "org.telegram.messenger",
  };
}

async function apiPost(initData, endpoint, body = {}) {
  const headers = getAuthHeaders(initData);
  headers["Content-Type"] = "application/json";
  const res = await postJson(`${API_BASE}/${endpoint}`, body, headers);
  if (!res.ok) throw new Error(`${endpoint}: ${res.error}`);
  try { return JSON.parse(res.data); } catch { return res.data; }
}

async function apiGet(initData, endpoint) {
  const headers = getAuthHeaders(initData);
  const url = `${API_BASE}/${endpoint}`;
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const res = await fetch(url, { headers });
      const text = await res.text();
      if (!res.ok) throw new Error(`HTTP ${res.status}: ${text.slice(0, 100)}`);
      return text;
    } catch (err) {
      if (attempt < 3) {
        logger.warn(`GET attempt ${attempt} failed: ${err.message}, retrying...`);
        await sleep(5000);
      } else {
        throw err;
      }
    }
  }
}

function decodeKlines(data) {
  const buf = Buffer.from(data, "base64");
  const u32 = new Uint32Array(buf.buffer, buf.byteOffset, buf.byteLength / 4);
  const K = 2779096485;
  const decoded = [];
  for (const v of u32) {
    decoded.push((v >>> 0) ^ K);
  }
  if (decoded.length < 5) return [];
  const bars = [];
  const n = (decoded.length - 1) / 4;
  let price = decoded[0] / 1000;
  let idx = 1;
  for (let i = 0; i < n; i++) {
    const close = decoded[idx++] / 1000;
    const high = decoded[idx++] / 1000;
    const low = decoded[idx++] / 1000;
    const volume = decoded[idx++] / 1000;
    bars.push({ open: price, close, high, low, volume });
    price = close;
  }
  return bars;
}

async function tryAuth(initData) {
  if (!initData) return null;
  try {
    const user = await apiPost(initData, "api/updateUser");
    if (user && user.nickname) return { user, initData };
  } catch (e) {
    const age = initData.match(/auth_date=(\d+)/);
    const ageMin = age ? ((Date.now() - parseInt(age[1])*1000)/60000).toFixed(1) : "?";
    logger.warn(`tryAuth failed: ${e.message}, initData age: ${ageMin} min`);
  }
  return null;
}

async function farmTradingWars(account) {
  let initData = account.tradingwarsInitData || account.initData;
  logger.info(`farmTradingWars called for ${account.id}, has twInitData: ${!!account.tradingwarsInitData}, has session: ${!!account.session}, account keys: ${Object.keys(account).join(",")}`);

  if (!initData && !account.session) {
    logger.warn("No initData or session for TradingWars — sync TradingWars from extension first");
    return { ok: false, error: "No initData — open TradingWars in extension to sync", coins: 0, profit: 0, mined: 0, tokens: 0, hashRate: 0, upgrades: 0, trades: 0 };
  }

  let auth = await tryAuth(initData);
  }

  if (!auth) {
    logger.error("TradingWars authentication failed — open TradingWars in extension to sync");
    return { ok: false, error: "Authentication failed", coins: 0, profit: 0, mined: 0, tokens: 0, hashRate: 0, upgrades: 0, trades: 0 };
  }

  const { user } = auth;
  logger.info(`Farming TradingWars for ${account.id} (${user.nickname || "?"})...`);

  let wallet, equipment, totalHashRate;
  try {
    [wallet, equipment, totalHashRate] = await Promise.all([
      apiPost(initData, "api/getWallet").catch(() => null),
      apiPost(initData, "api/mining/getEquipment").catch(() => null),
      apiPost(initData, "api/mining/getTotalHashRate").catch(() => null),
    ]);
  } catch (err) {
    return { ok: false, error: `Initial fetch failed: ${err.message}`, coins: 0, profit: 0, mined: 0, tokens: 0, hashRate: 0, upgrades: 0, trades: 0 };
  }

  const coins = wallet?.miningBalance ?? user?.balance ?? 0;
  const tokens = wallet?.tokens ?? 0;
  const hashRate = totalHashRate ?? 0;

  logger.newline();
  logger.keyValue("Nickname", user.nickname || "(unknown)");
  logger.keyValue("Balance", `${typeof coins === "number" ? coins.toFixed(2) : coins} coins`);
  logger.keyValue("Tokens", `${tokens} TWARS`);
  if (Array.isArray(equipment)) {
    const gpus = equipment.filter((i) => i.key?.startsWith("gpu_"));
    logger.keyValue("GPUs", `${gpus.length} total`);
  }
  logger.keyValue("Hash Rate", `${hashRate}`);
  logger.newline();

  let upgradesCount = 0;
  let tradesCount = 0;

  // ---- Mining management ----
  if (Array.isArray(equipment)) {
    try {
      const gpus = equipment.filter((i) => i.key?.startsWith("gpu_"));
      const miningBalance = wallet?.miningBalance ?? 0;
      let anyBought = false;
      let allFull = true;

      for (let vi = 0; vi < VENUE_ORDER.length; vi++) {
        const vk = VENUE_ORDER[vi];
        const venue = equipment.find((i) => i.key === vk);
        if (!venue) {
          logger.log(`--- ${LABELS[vk]} ---`);
          logger.info("Not unlocked yet");
          allFull = false;
          break;
        }
        const venueGpus = gpus.filter((g) => g.parentId === venue.id);
        const maxSlots = TOTAL_SLOTS[vk];
        const filled = venueGpus.length;
        logger.log(`--- ${LABELS[vk]} (${filled}/${maxSlots}) ---`);

        if (filled >= maxSlots) {
          logger.info("Full!");
          const nextVk = VENUE_ORDER[vi + 1];
          if (nextVk && !equipment.find((i) => i.key === nextVk)) {
            const cost = UNLOCK_COST[nextVk];
            if (miningBalance >= cost) {
              logger.info(`Unlocking ${LABELS[nextVk]} (${cost.toLocaleString()} coins)...`);
              try {
                await apiPost(initData, "api/mining/buyItem", { key: nextVk, parentId: null });
                logger.success(`Unlocked ${LABELS[nextVk]}!`);
              } catch (e) {
                logger.warn(`Failed to unlock: ${e.message}`);
              }
            } else {
              logger.info(`${LABELS[nextVk]} needs ${cost.toLocaleString()} coins (${(cost - miningBalance).toFixed(0)} more to earn)`);
              allFull = false;
            }
          }
          continue;
        }

        allFull = false;
        for (let i = 0; i < maxSlots; i++) {
          const g = venueGpus[i];
          if (g) continue;
          logger.info(`  [${i}] (empty) → buy gpu_1050ti`);
          try {
            await apiPost(initData, "api/mining/buyItem", { key: "gpu_1050ti", parentId: venue.id });
            logger.success("    Bought!");
            anyBought = true;
          } catch (e) {
            logger.warn(`    Failed: ${e.message}`);
            break;
          }
        }
      }

      if (anyBought) {
        logger.info("New GPUs bought, will upgrade once all slots are filled");
      }

      // Upgrade all if all venues full
      if (allFull) {
        logger.info("All venue slots filled, upgrading equipment...");
        try {
          const result = await apiPost(initData, "api/mining/upgradeAll");
          if (result != null) {
            logger.success("Equipment upgraded!");
            upgradesCount++;
          }
        } catch (e) {
          logger.warn(`Upgrade failed: ${e.message}`);
        }
      }
    } catch (err) {
      logger.warn(`Mining management failed: ${err.message}`);
    }
  }

  // ---- Trading ----
  try {
    const tryCount = user?.tryCount ?? 0;
    if (tryCount > 0) {
      const stakeAmount = tokens >= 5 ? 5 : 0;
      if (stakeAmount > 0) logger.info(`Staking ${stakeAmount} TWARS`);
      logger.info(`Starting try (${tryCount} left)...`);
      const startResult = await apiPost(initData, "api/startTry", { tokensAmount: stakeAmount });
      if (startResult?.klineId) {
        logger.info(`Kline: ${startResult.klineId}`);
        const encrypted = await apiGet(initData, `klines/${startResult.klineId}.json`);
        if (encrypted) {
          const bars = decodeKlines(encrypted);
          if (bars.length >= 2) {
            const firstPrice = bars[0].open;
            const lastPrice = bars[bars.length - 1].close;
            const long = lastPrice > firstPrice;

            const entryPct = (p) => (p - firstPrice) / firstPrice;
            const maxRally = Math.max(...bars.map((b) => entryPct(b.high)));
            const maxDip = Math.min(...bars.map((b) => entryPct(b.low)));

            if (long && maxDip < -0.003) {
              logger.warn(`Skip LONG — price dips ${(maxDip * 100).toFixed(1)}% (exceeds ~0.3% SL bound)`);
            } else if (!long && maxRally > 0.003) {
              logger.warn(`Skip SHORT — price rallies ${(maxRally * 100).toFixed(1)}% (exceeds ~0.3% SL bound)`);
            } else {
              logger.info(`Price ${firstPrice.toFixed(3)} → ${lastPrice.toFixed(3)} → ${long ? "LONG" : "SHORT"}`);
              const result = await apiPost(initData, "api/openPosition", { long, stopLoss: 0.003, takeProfit: 0.003, limitOffset: 0 });
              logger.success(`Position opened: ${JSON.stringify(result)}`);
              tradesCount++;
            }
          } else {
            logger.warn("Not enough bars to decide");
          }
        } else {
          logger.warn("No kline data received");
        }
      } else {
        logger.warn("startTry returned no klineId");
      }
    } else {
      logger.info("No try tokens remaining");
    }
  } catch (err) {
    logger.warn(`Trading failed: ${err.message}`);
  }

  logger.success(`Farming complete — balance: ${typeof coins === "number" ? coins.toFixed(2) : coins}, tokens: ${tokens}, hash: ${hashRate}, upgrades: ${upgradesCount}, trades: ${tradesCount}`);

  return {
    ok: true,
    coins: typeof coins === "number" ? coins : 0,
    profit: 0,
    mined: 0,
    tokens,
    hashRate,
    upgrades: upgradesCount,
    trades: tradesCount,
  };
}

export { farmTradingWars };
