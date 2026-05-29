import { post } from "../lib/http.js";
import { logger } from "../lib/logger.js";
import { refreshInitData } from "../lib/gram-client.js";
import { readAccounts, writeAccounts } from "../lib/storage.js";

const API_BASE = "https://headgun.org/headcoin";
const SPLIT = "|;1f~";

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function pad2(n) {
  return String(n).padStart(2, "0");
}

function buildPayload(initData) {
  const now = Date.now();
  const d = new Date(now);
  return {
    textqueryid: initData || "",
    time2200encodein: `${pad2(d.getHours())}:${pad2(d.getMinutes())}:${pad2(d.getSeconds())}`,
    versbuild: "1.73",
    timestamp: String(now),
  };
}

function parseState(raw) {
  if (!raw) return [];
  try {
    const decoded = decodeURIComponent(raw);
    return decoded.split(SPLIT);
  } catch {
    return raw.split(SPLIT);
  }
}

async function fetchGameState(initData) {
  const payload = buildPayload(initData);
  const res = await post(`${API_BASE}/headcoin.php`, payload);
  if (!res.ok) throw new Error(`headcoin.php: ${res.error}`);
  return parseState(res.data);
}

async function claimDailyBonus(initData) {
  const payload = buildPayload(initData);
  const res = await post(`${API_BASE}/claimdailybonus.php`, payload);
  return res.ok && String(res.data ?? "").trim() === "1";
}

function getCardUpgradeCount(state, cat, el) {
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

async function upgradeElement(initData, categIndex, elementIndex) {
  const now = Date.now();
  const payload = {
    textqueryid: initData || "",
    numbcateg: String(categIndex),
    numbelement: String(elementIndex),
    timestamp: String(now),
  };
  const res = await post(`${API_BASE}/levelupelement.php`, payload);
  return res.ok ? String(res.data ?? "").trim() : "";
}

const BOT = "head_coin_bot";

async function refreshAuth(account) {
  const startParam = `bonusId${account.id}`;
  const fresh = await refreshInitData(account.session, BOT, startParam);
  account.initData = fresh;
  await writeAccounts(readAccounts());
  logger.success("initData refreshed and saved");
  return fresh;
}

export async function farmHeadCoin(account) {
  if (!account.initData && !account.session) {
    return { ok: false, error: "No initData or session", coins: 0, profit: 0, mined: 0, dailyBonusClaimed: false, upgrades: 0 };
  }

  let initData = account.initData;

  // If no cached initData but has session, try refresh
  if (!initData && account.session) {
    logger.log("No cached initData, refreshing via MTProto...");
    try {
      initData = await refreshAuth(account);
    } catch (err) {
      return { ok: false, error: `initData refresh failed: ${err.message}`, coins: 0, profit: 0, mined: 0, dailyBonusClaimed: false, upgrades: 0 };
    }
  }

  logger.info(`Farming HeadCoin for ${account.id}...`);

  let state;

  // Helper: try fetching game state with given auth, returns state or null
  const tryFetch = async (auth) => {
    if (!auth) return null;
    try {
      const s = await fetchGameState(auth);
      return s && s.length >= 20 ? s : null;
    } catch { return null; }
  };

  // First attempt with current initData
  state = await tryFetch(initData);

  // If failed and has session, try refresh + retry
  if (!state && account.session) {
    logger.log("Farming failed, refreshing initData via MTProto...");
    try {
      const fresh = await refreshAuth(account);
      state = await tryFetch(fresh);
      if (state) initData = fresh;
    } catch (err) {
      logger.warn(`Refresh failed (${err.message}), trying original initData`);
    }
    // If refresh didn't work, try original initData (might still be valid)
    if (!state) state = await tryFetch(account.initData);
  }

  // No valid state after all retries
  if (!state) {
    return { ok: false, error: "Unexpected game state", coins: 0, profit: 0, mined: 0, dailyBonusClaimed: false, upgrades: 0 };
  }

  const coins = parseInt(state[3], 10) || 0;
  const profit = parseInt(state[15], 10) || 0;
  const mined = parseInt(state[6], 10) || 0;
  const dailyStreak = parseInt(state[8], 10) || 0;

  logger.keyValue("Coins", coins);
  logger.keyValue("Profit/h", profit);
  logger.keyValue("Mined", mined);
  logger.keyValue("Daily Bonus", dailyStreak > 0 ? "Claimed" : "Available");

  let dailyBonusClaimed = dailyStreak > 0;

  if (!dailyBonusClaimed) {
    logger.log("Claiming daily bonus...");
    const claimed = await claimDailyBonus(initData);
    if (claimed) {
      logger.success("Daily bonus claimed");
      dailyBonusClaimed = true;
    } else {
      logger.warn("Daily bonus claim returned unexpected result");
    }
  }

  let upgrades = 0;
  let currentCoins = coins;
  let currentProfit = profit;

  const cardOrder = [
    { cat: 2, count: 9 },
    { cat: 3, count: 11 },
    { cat: 1, count: 9 },
    { cat: 4, count: 2 },
  ];

  if (profit < 55000) {
    for (const { cat, count } of cardOrder) {
      if (currentCoins <= 0) break;

      for (let el = 0; el < count; el++) {
        if (currentCoins <= 0) break;

        const lvl = getCardUpgradeCount(state, cat, el);
        if (lvl >= 14) continue;

        const result = await upgradeElement(initData, cat, el);
        if (result === "1") {
          upgrades++;
          await sleep(2000);
          const postState = await fetchGameState(initData);
          if (postState && postState.length >= 20) {
            currentCoins = parseInt(postState[3], 10) || 0;
            currentProfit = parseInt(postState[15], 10) || 0;
          }

          if (currentProfit >= 55000) {
            logger.success(`Cat ${cat}/${el} upgraded — coins: ${currentCoins}, profit: ${currentProfit}`);
            logger.info("Max profit reached");
            return { ok: true, coins: currentCoins, profit: currentProfit, mined, dailyBonusClaimed, upgrades };
          }
          logger.success(`Cat ${cat}/${el} upgraded — coins: ${currentCoins}, profit: ${currentProfit}`);
        } else if (result === "2") {
          logger.log(`Cat ${cat}/${el}: locked`);
        }
      }
    }
  }

  logger.success(`Farming complete — coins: ${currentCoins}, profit: ${currentProfit}, upgrades: ${upgrades}`);

  return {
    ok: true,
    coins: currentCoins,
    profit: currentProfit,
    mined,
    dailyBonusClaimed,
    upgrades,
  };
}
