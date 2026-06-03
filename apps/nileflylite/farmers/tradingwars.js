import { postJson } from "../lib/http.js";
import { logger } from "../lib/logger.js";
import { refreshInitData } from "../lib/gram-client.js";
import { readAccounts, writeAccounts } from "../lib/storage.js";


const API_BASE = "https://tradingwars.site";
const BOT = "TradingWars_bot";
const SHORT_NAME = "TradingWars";
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
    if (user && user.id) return { user, initData };
  } catch (e) {
    const age = initData.match(/auth_date=(\d+)/);
    const ageMin = age ? ((Date.now() - parseInt(age[1])*1000)/60000).toFixed(1) : "?";
    logger.warn(`tryAuth failed: ${e.message}, initData age: ${ageMin} min`);
  }
  return null;
}

async function refreshAuth(account) {
  if (!account.session) throw new Error("No session to refresh");
  const fresh = await refreshInitData(account.session, BOT, START_PARAM, SHORT_NAME);
  account.initData = fresh;
  const all = readAccounts();
  const match = all.find((a) => a.id === account.id);
  if (match) {
    match.tradingwarsInitData = fresh;
    match.initData = fresh;
  }
  await writeAccounts(all);
  logger.success("TradingWars initData refreshed via MTProto and saved");
  return fresh;
}

async function farmTradingWars(account) {
  let initData = account.tradingwarsInitData || account.initData;

  if (!initData && !account.session) {
    return { ok: false, error: "No initData or session — sync from extension", coins: 0, profit: 0, mined: 0, tokens: 0, hashRate: 0, upgrades: 0, trades: 0 };
  }

  if (!initData && account.session) {
    logger.log("No cached initData, refreshing via MTProto...");
    try {
      initData = await refreshAuth(account);
    } catch (err) {
      return { ok: false, error: `initData refresh failed: ${err.message}`, coins: 0, profit: 0, mined: 0, tokens: 0, hashRate: 0, upgrades: 0, trades: 0 };
    }
  }

  logger.info(`Farming TradingWars for ${account.id}...`);

  const tryFetch = async (auth) => {
    if (!auth) return null;
    try {
      const res = await tryAuth(auth);
      return res && res.user ? res : null;
    } catch { return null; }
  };

  let auth = await tryFetch(initData);

  if (!auth && account.session) {
    logger.log("Farming failed, refreshing initData via MTProto...");
    try {
      const fresh = await refreshAuth(account);
      auth = await tryFetch(fresh);
      if (auth) initData = fresh;
    } catch (err) {
      logger.warn(`Refresh failed (${err.message}), trying original initData`);
    }
    if (!auth) auth = await tryFetch(account.initData);
  }

  if (!auth) {
    return { ok: false, error: "Authentication failed", coins: 0, profit: 0, mined: 0, tokens: 0, hashRate: 0, upgrades: 0, trades: 0 };
  }

  const { user } = auth;
  logger.info(`Farming TradingWars for ${account.id} (${user.username || user.first_name || "?"})...`);

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
  logger.keyValue("Username", user.username || user.first_name || "(unknown)");
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
      let miningBalance = wallet?.miningBalance ?? 0;
      let anyBought = false;

      const gpu1050tiSlots = { venue_home: 12, venue_garage: 12, venue_hotel: 12, venue_datacenter: 6 };
      const machineCost = { gpu_1050ti: 50, asic_s9: 9300 };

      // ---- Phase 1: fill gpu_1050ti in each venue, then unlock next ----
      let lastUnlockedIdx = -1;
      for (let vi = 0; vi < VENUE_ORDER.length; vi++) {
        const vk = VENUE_ORDER[vi];
        const venue = equipment.find((i) => i.key === vk);
        if (!venue) break;
        lastUnlockedIdx = vi;

        const venueGpus = gpus.filter((g) => g.parentId === venue.id);
        const maxSlots = TOTAL_SLOTS[vk];
        const gpuCount = gpu1050tiSlots[vk];

        logger.log(`--- ${LABELS[vk]} (${venueGpus.length}/${maxSlots}) ---`);
        for (let i = 0; i < gpuCount; i++) {
          if (venueGpus[i]) continue;
          const cost = machineCost.gpu_1050ti;
          if (cost > miningBalance) {
            logger.info(`  [${i}] needs gpu_1050ti (${cost.toLocaleString()} coins) — need ${(cost - miningBalance).toFixed(0)} more`);
            continue;
          }
          try {
            logger.info(`  [${i}] (empty) → buy gpu_1050ti (${cost.toLocaleString()} coins)`);
            await apiPost(initData, "api/mining/buyItem", { key: "gpu_1050ti", parentId: venue.id });
            logger.success("    Bought!");
            anyBought = true;
            miningBalance -= cost;
          } catch (e) {
            logger.warn(`  [${i}] gpu_1050ti failed: ${e.message}`);
          }
        }
      }

      // unlock next venue if all gpu_1050ti slots filled in current last venue
      const nextIdx = lastUnlockedIdx + 1;
      if (nextIdx < VENUE_ORDER.length) {
        const vk = VENUE_ORDER[lastUnlockedIdx];
        const venue = equipment.find((i) => i.key === vk);
        if (venue) {
          const venueGpus = gpus.filter((g) => g.parentId === venue.id);
          const gpuCount = gpu1050tiSlots[vk];
          const allGpuFilled = gpuCount === 0 || venueGpus.slice(0, gpuCount).every(Boolean);
          if (allGpuFilled) {
            const nextVk = VENUE_ORDER[nextIdx];
            if (!equipment.find((i) => i.key === nextVk)) {
              const cost = UNLOCK_COST[nextVk];
              if (cost <= miningBalance) {
                logger.info(`Unlocking ${LABELS[nextVk]} (${cost.toLocaleString()} coins)...`);
                try {
                  await apiPost(initData, "api/mining/buyItem", { key: nextVk, parentId: null });
                  logger.success(`Unlocked ${LABELS[nextVk]}!`);
                  anyBought = true;
                  miningBalance -= cost;
                } catch (e) {
                  logger.warn(`Failed to unlock: ${e.message}`);
                }
              } else {
                logger.info(`${LABELS[nextVk]} needs ${cost.toLocaleString()} coins (${(cost - miningBalance).toFixed(0)} more)`);
              }
            }
          }
        }
      }

      // ---- Phase 2: fill asic_s9 only after all 4 venues unlocked ----
      const allUnlocked = VENUE_ORDER.every((vk) => equipment.find((i) => i.key === vk));
      if (allUnlocked) {
        const allGpuDone = VENUE_ORDER.every((vk) => {
          const venue = equipment.find((i) => i.key === vk);
          if (!venue) return false;
          const venueGpus = gpus.filter((g) => g.parentId === venue.id);
          const gpuCount = gpu1050tiSlots[vk];
          return gpuCount === 0 || venueGpus.slice(0, gpuCount).every(Boolean);
        });
        if (allGpuDone) {
          logger.info("All venues unlocked and 1050ti slots filled — buying asic_s9");
          for (const vk of VENUE_ORDER) {
            const venue = equipment.find((i) => i.key === vk);
            if (!venue) continue;
            const venueGpus = gpus.filter((g) => g.parentId === venue.id);
            const gpuCount = gpu1050tiSlots[vk];
            const maxSlots = TOTAL_SLOTS[vk];
            for (let i = gpuCount; i < maxSlots; i++) {
              if (venueGpus[i]) continue;
              const cost = machineCost.asic_s9;
              if (cost > miningBalance) {
                logger.info(`  [${i}] needs asic_s9 (${cost.toLocaleString()} coins) — need ${(cost - miningBalance).toFixed(0)} more`);
                continue;
              }
              try {
                logger.info(`  [${i}] (empty) → buy asic_s9 (${cost.toLocaleString()} coins)`);
                await apiPost(initData, "api/mining/buyItem", { key: "asic_s9", parentId: venue.id });
                logger.success("    Bought!");
                anyBought = true;
                miningBalance -= cost;
              } catch (e) {
                logger.warn(`  [${i}] asic_s9 failed: ${e.message}`);
              }
            }
          }
        } else {
          logger.info("Still filling gpu_1050ti slots before switching to asic_s9");
        }
      }

      if (anyBought) {
        logger.info("New machines bought, will check upgrades next cycle");
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
