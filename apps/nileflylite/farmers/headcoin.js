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

// ---- NFT / Diamond helpers ----

function postClean(endpoint, initData, extra = {}) {
  const now = Date.now();
  const payload = {
    textqueryid: initData || "",
    ...extra,
    timestamp: String(now),
  };
  return post(`${API_BASE}/${endpoint}`, payload);
}

async function claimKey(initData) {
  const res = await postClean("claim8hourskey2.php", initData);
  return res.ok ? parseInt(String(res.data ?? "0").trim(), 10) || 0 : 0;
}

async function openNftBox(initData, numbKeys = 1) {
  const payload = {
    ...buildPayload(initData),
    numbkeys: String(numbKeys),
  };
  const res = await post(`${API_BASE}/openboxnft9.php`, payload);
  if (!res.ok) return null;
  const parts = String(res.data ?? "").trim().split("-");
  if (parts.length >= 3) return { keyId: parts[0], nftId: parseInt(parts[2], 10) };
  return null;
}

async function myNfts(initData) {
  const res = await postClean("mynfts.php", initData);
  if (!res.ok) return null;
  const trimmed = String(res.data ?? "").trim();
  const sep = trimmed.split("-");
  if (sep.length < 4) return null;
  return {
    balance: parseFloat(sep[0]) || 0,
    flags: sep[1].split("_").map(Number),
    rate: parseFloat(sep[2]) || 0,
    total: parseFloat(sep[3]) || 0,
  };
}

async function addNftToMining(initData, elementId, slot) {
  const now = Date.now();
  const payload = {
    textqueryid: initData || "",
    numbelement: String(elementId),
    numbslot: String(slot),
    timestamp: String(now),
  };
  const res = await post(`${API_BASE}/addnft.php`, payload);
  return res.ok && String(res.data ?? "").trim() === "1";
}

async function removeNftFromSlot(initData, slot) {
  const payload = {
    ...buildPayload(initData),
    numbelement: String(slot),
  };
  const res = await post(`${API_BASE}/removenftteam.php`, payload);
  return res.ok && String(res.data ?? "").trim() === "1";
}

async function collectNftDiamonds(initData) {
  const payload = buildPayload(initData);
  const res = await post(`${API_BASE}/collectnftteam.php`, payload);
  return res.ok && String(res.data ?? "").trim() === "1";
}

function getNftTeamElements(state) {
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

// ---- NFT flow inside farmHeadCoin ----

async function runNftFlow(initData, state) {
  const O = { KEYS: 24, DIAMOND_BALANCE: 28 };
  let diamondBalance = parseFloat(state[O.DIAMOND_BALANCE]) || 0;
  logger.keyValue("Diamonds", diamondBalance);

  const claimedCount = await claimKey(initData);
  if (claimedCount > 0) {
    logger.success(`Claimed ${claimedCount} keys`);
    await sleep(1000);
  }

  const freshState = await fetchGameState(initData).catch(() => state);
  const keyCount = parseInt((freshState || state)[O.KEYS], 10) || 0;
  logger.keyValue("Keys", keyCount);

  if (keyCount >= 10) {
    const result = await openNftBox(initData, 10);
    if (result && result.nftId) {
      logger.success(`Opened 10 boxes, got NFT #${result.nftId}`);
    } else {
      logger.warn("Bulk box open returned unexpected result");
    }
    await sleep(1000);
  } else if (keyCount > 0) {
    for (let i = 0; i < Math.min(keyCount, 5); i++) {
      const result = await openNftBox(initData, 1);
      if (result && result.nftId) {
        logger.success(`Opened NFT #${result.nftId}`);
        await sleep(1000);
      } else {
        break;
      }
    }
  }

  const nftData = await myNfts(initData);
  const teamElements = getNftTeamElements(state);
  const filledSlots = teamElements.filter(v => v > 0).length;

  if (nftData && nftData.flags) {
    if (filledSlots >= 3) {
      logger.info(`All 3 slots filled (${teamElements.slice(0, 3).join(",")}), skipping swap`);
    } else {
      const owned = [];
      for (let id = 0; id < nftData.flags.length; id++) {
        if (nftData.flags[id] === 1) owned.push(id);
      }
      const inTeam = new Set(teamElements.filter(v => v > 0));
      const available = owned.filter(id => !inTeam.has(id));
      logger.info(`NFTs: owned ${owned.length}, in team ${inTeam.size}, available ${available.length}`);
      available.sort((a, b) => b - a);

      for (let slot = 1; slot <= 3; slot++) {
        await removeNftFromSlot(initData, slot);
        await sleep(1000);
      }

      let slotIdx = 1;
      for (const elementId of available) {
        if (slotIdx > 3) break;
        const added = await addNftToMining(initData, elementId, slotIdx);
        if (added) {
          logger.success(`NFT #${elementId} added to slot ${slotIdx}`);
          teamElements[slotIdx - 1] = elementId;
          await sleep(1000);
        } else {
          logger.warn(`Failed to add NFT #${elementId}`);
        }
        slotIdx++;
      }
    }
  } else {
    logger.warn(`NFT data unexpected`);
  }

  const collected = await collectNftDiamonds(initData);
  if (collected) {
    logger.success("Diamond rewards collected");
    const finalState = await fetchGameState(initData).catch(() => null);
    if (finalState) {
      diamondBalance = parseFloat(finalState[O.DIAMOND_BALANCE]) || 0;
    }
  }

  logger.keyValue("Diamonds final", diamondBalance);
  return diamondBalance;
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
    return { ok: false, error: "No initData or session", coins: 0, profit: 0, mined: 0, dailyBonusClaimed: false, upgrades: 0, diamonds: 0 };
  }

  let initData = account.initData;

  // If no cached initData but has session, try refresh
  if (!initData && account.session) {
    logger.log("No cached initData, refreshing via MTProto...");
    try {
      initData = await refreshAuth(account);
    } catch (err) {
      return { ok: false, error: `initData refresh failed: ${err.message}`, coins: 0, profit: 0, mined: 0, dailyBonusClaimed: false, upgrades: 0, diamonds: 0 };
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
    logger.log("No cached initData, refreshing via MTProto...");
    try {
      const fresh = await refreshAuth(account);
      state = await tryFetch(fresh);
      if (state) initData = fresh;
    } catch (err) {
      logger.warn(`Refresh failed: ${err.message}`);
      logger.warn(`Session length: ${(account.session || "").length}`);
    }
    // If refresh didn't work, try original initData (might still be valid)
    if (!state) {
      logger.warn("MTProto refresh returned no initData, trying stale initData");
      state = await tryFetch(account.initData);
    }
  }
    // If refresh didn't work, try original initData (might still be valid)
    if (!state) state = await tryFetch(account.initData);
  }

  // No valid state after all retries
  if (!state) {
    return { ok: false, error: "Unexpected game state", coins: 0, profit: 0, mined: 0, dailyBonusClaimed: false, upgrades: 0, diamonds: 0 };
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

  if (profit < 55000) {
    for (let el = 0; el <= 9; el++) {
      if (currentCoins <= 0) break;

      const lvl = getCardUpgradeCount(state, 3, el);
      if (lvl >= 14) continue;

      const result = await upgradeElement(initData, 3, el);
      if (result === "1") {
        upgrades++;
        await sleep(2000);
        const postState = await fetchGameState(initData);
        if (postState && postState.length >= 20) {
          currentCoins = parseInt(postState[3], 10) || 0;
          currentProfit = parseInt(postState[15], 10) || 0;
        }

        if (currentProfit >= 55000) {
          logger.success(`Cat 3/${el} upgraded — coins: ${currentCoins}, profit: ${currentProfit}`);
          logger.info("Max profit reached");
          break;
        }
        logger.success(`Cat 3/${el} upgraded — coins: ${currentCoins}, profit: ${currentProfit}`);
      } else if (result === "2") {
        logger.log(`Cat 3/${el}: locked`);
      }
    }
  }

  logger.success(`Farming complete — coins: ${currentCoins}, profit: ${currentProfit}, upgrades: ${upgrades}`);

  const diamonds = await runNftFlow(initData, state);

  return {
    ok: true,
    coins: currentCoins,
    profit: currentProfit,
    mined,
    dailyBonusClaimed,
    upgrades,
    diamonds,
  };
}
