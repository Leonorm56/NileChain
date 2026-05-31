import { post } from "../lib/http.js";
import { logger } from "../lib/logger.js";

const API_BASE = "https://headgun.org/headcoin";
const SPLIT = "|;1f~";
const MAX_CARD_COST = 150000;

const OFFSET = { PROFIT_PER_HOUR: 15, COINS: 3, MINED: 6, DAILY_BONUS_STREAK: 8, KEYS: 24, DIAMOND_BALANCE: 28 };
const CARD_ORDER = [{ cat: 2, count: 9 }, { cat: 3, count: 11 }, { cat: 1, count: 9 }, { cat: 4, count: 2 }];

const _cardCostCache = {};

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function pad2(n) {
  return String(n).padStart(2, "0");
}

function buildPayload(initData, extra = {}) {
  const now = Date.now();
  const d = new Date(now);
  return {
    textqueryid: initData || "",
    time2200encodein: `${pad2(d.getHours())}:${pad2(d.getMinutes())}:${pad2(d.getSeconds())}`,
    versbuild: "1.73",
    timestamp: String(now),
    ...extra,
  };
}

function parseState(raw) {
  if (!raw) return [];
  try {
    return decodeURIComponent(raw).split(SPLIT);
  } catch {
    return raw.split(SPLIT);
  }
}

function parseTasks(raw) {
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

async function apiPost(initData, endpoint, extra = {}) {
  const payload = buildPayload(initData, extra);
  const res = await post(`${API_BASE}/${endpoint}`, payload);
  if (!res.ok) throw new Error(`${endpoint}: ${res.error}`);
  return res.data;
}

async function fetchGameState(initData) {
  return parseState(await apiPost(initData, "headcoin.php"));
}

async function fetchTasks(initData) {
  return parseTasks(await apiPost(initData, "gettasks.php"));
}

async function completeTask(initData, taskId) {
  return apiPost(initData, "checktask.php", { numbtask: taskId });
}

async function clickSponsorTask(initData, taskId) {
  return apiPost(initData, "clicktasksponsor.php", { numbtask: taskId });
}

async function checkSponsorTask(initData, taskId) {
  return apiPost(initData, "checktasksponsor.php", { numbtask: taskId });
}

async function claimDailyBonus(initData) {
  const data = await apiPost(initData, "claimdailybonus.php");
  return String(data ?? "").trim() === "1";
}

async function upgradeElement(initData, categIndex, elementIndex) {
  const now = Date.now();
  const payload = {
    textqueryid: initData || "",
    numbcateg: String(categIndex),
    numbelement: String(elementIndex),
    timestamp: String(now),
  };
  const res = await post(`${API_BASE}/levelupelement.php`, payload, {
    "Origin": "https://headgun.org",
    "Referer": "https://headgun.org/",
  });
  return res.ok ? String(res.data ?? "").trim() : "";
}

function postClean(endpoint, initData, extra = {}) {
  const now = Date.now();
  return post(`${API_BASE}/${endpoint}`, {
    textqueryid: initData || "",
    ...extra,
    timestamp: String(now),
  });
}

async function claimKey(initData) {
  const res = await postClean("claim8hourskey2.php", initData);
  return res.ok ? parseInt(String(res.data ?? "0").trim(), 10) || 0 : 0;
}

async function openNftBox(initData, numbKeys = 1) {
  const d = new Date(Date.now());
  const pad2 = (n) => String(n).padStart(2, "0");
  const payload = {
    textqueryid: initData || "",
    time2200encodein: `${pad2(d.getHours())}:${pad2(d.getMinutes())}:${pad2(d.getSeconds())}`,
    versbuild: "1.73",
    numbkeys: String(numbKeys),
    timestamp: String(Date.now()),
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
  const res = await post(`${API_BASE}/addnft.php`, {
    textqueryid: initData || "",
    numbelement: String(elementId),
    numbslot: String(slot),
    timestamp: String(now),
  });
  return res.ok && String(res.data ?? "").trim() === "1";
}

async function removeNftFromSlot(initData, slot) {
  const d = new Date(Date.now());
  const pad2 = (n) => String(n).padStart(2, "0");
  const res = await post(`${API_BASE}/removenftteam.php`, {
    textqueryid: initData || "",
    time2200encodein: `${pad2(d.getHours())}:${pad2(d.getMinutes())}:${pad2(d.getSeconds())}`,
    numbelement: String(slot),
    timestamp: String(Date.now()),
  });
  return res.ok && String(res.data ?? "").trim() === "1";
}

async function collectNftDiamonds(initData) {
  const res = await postClean("collectnftteam.php", initData);
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

async function runNftFlow(initData, state) {
  let diamondBalance = parseFloat(state[OFFSET.DIAMOND_BALANCE]) || 0;
  logger.keyValue("Diamonds", diamondBalance);

  const claimedCount = await claimKey(initData);
  if (claimedCount > 0) {
    logger.success(`Claimed ${claimedCount} keys`);
    await sleep(1000);
  }

  const freshState = await fetchGameState(initData).catch(() => state);
  const keyCount = parseInt((freshState || state)[OFFSET.KEYS], 10) || 0;
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
    logger.warn("NFT data unexpected");
  }

  const collected = await collectNftDiamonds(initData);
  if (collected) {
    logger.success("Diamond rewards collected");
    const finalState = await fetchGameState(initData).catch(() => null);
    if (finalState) {
      diamondBalance = parseFloat(finalState[OFFSET.DIAMOND_BALANCE]) || 0;
    }
  }

  logger.keyValue("Diamonds final", diamondBalance);
  return diamondBalance;
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

function getCardCost(state, cat, el) {
  const cacheKey = `${cat}-${el}`;
  const cached = _cardCostCache[cacheKey];
  if (cached !== undefined && cached >= MAX_CARD_COST) return cached;

  const lvl = getCardUpgradeCount(state, cat, el);
  if (lvl >= 14) return MAX_CARD_COST;

  return 0;
}

function parseCEOState(state) {
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

function logInfo(state) {
  logger.newline();
  logger.keyValue("Coins", parseInt(state[OFFSET.COINS], 10) || 0);
  logger.keyValue("Profit/h", parseInt(state[OFFSET.PROFIT_PER_HOUR], 10) || 0);
  logger.keyValue("Mined", parseInt(state[OFFSET.MINED], 10) || 0);
  logger.keyValue("Diamonds", parseFloat(state[OFFSET.DIAMOND_BALANCE]) || 0);
  logger.keyValue("Keys", parseInt(state[OFFSET.KEYS], 10) || 0);
  logger.keyValue("Daily Bonus", parseInt(state[OFFSET.DAILY_BONUS_STREAK], 10) > 0 ? "Claimed" : "Available");
  logger.newline();
}

async function handleDailyBonus(initData, state) {
  const claimed = parseInt(state[OFFSET.DAILY_BONUS_STREAK], 10) || 0;
  if (claimed > 0) {
    logger.info("Daily bonus already claimed");
    return true;
  }
  logger.log("Claiming daily bonus...");
  const result = await claimDailyBonus(initData);
  if (result) {
    logger.success("Daily bonus claimed");
    return true;
  }
  logger.warn("Daily bonus claim returned unexpected result");
  return false;
}

async function handleTasks(initData) {
  const tasks = await fetchTasks(initData);
  if (!tasks?.length) {
    logger.info("No tasks available");
    return;
  }

  logger.info(`${tasks.length} tasks available`);
  for (const task of tasks) {
    if (/match money/i.test(task.title)) continue;

    const status = await completeTask(initData, task.id);
    if (String(status).trim() === "1") {
      logger.success(`Already done: ${task.title}`);
      continue;
    }

    logger.log(`Play: ${task.title}`);
    await clickSponsorTask(initData, task.id);

    const check = await checkSponsorTask(initData, task.id);
    if (String(check).trim() === "1") logger.success(`Done: ${task.title}`);
    else logger.warn(`Pending: ${task.title}`);
  }
}

async function selectCEO(initData, state) {
  const { selectCEO: ceoCat } = parseCEOState(state);
  if (ceoCat < 0) return;
  const result = await upgradeElement(initData, ceoCat, 0);
  if (result === "1") logger.success(`CEO game set to category ${ceoCat}`);
}

async function upgradeCards(initData, state) {
  let coins = parseInt(state[OFFSET.COINS], 10) || 0;
  let profit = parseInt(state[OFFSET.PROFIT_PER_HOUR], 10) || 0;
  let upgrades = 0;

  for (const { cat, count } of CARD_ORDER) {
    logger.newline();
    logger.info(`=== Upgrading cat ${cat} (${count} elements) ===`);

    const catState = await fetchGameState(initData);
    coins = parseInt(catState[OFFSET.COINS], 10) || 0;
    profit = parseInt(catState[OFFSET.PROFIT_PER_HOUR], 10) || 0;
    logInfo(catState);

    if (coins <= 0) {
      logger.info("No coins left");
      continue;
    }

    for (let el = 0; el < count; el++) {
      if (coins <= 0) break;

      const cost = getCardCost(catState, cat, el);
      if (cost >= MAX_CARD_COST) {
        logger.warn(`Cat ${cat}/${el} cost ${cost} — max ${MAX_CARD_COST}, skipping`);
        continue;
      }

      const result = await upgradeElement(initData, cat, el);

      if (result === "1") {
        upgrades++;
        const prevProfit = profit;
        await sleep(2000);
        const postState = await fetchGameState(initData);
        coins = parseInt(postState[OFFSET.COINS], 10) || 0;
        profit = parseInt(postState[OFFSET.PROFIT_PER_HOUR], 10) || 0;
        const spent = prevProfit > 0 ? undefined : (coins - parseInt(catState[OFFSET.COINS], 10));
        _cardCostCache[`${cat}-${el}`] = Math.abs(spent) || cost;
        const gain = profit - prevProfit;
        logger.success(`Cat ${cat}/${el} upgraded`);
        if (gain > 0) logger.keyValue("+Profit/h", gain);
        logger.keyValue("Coins left", coins);
        logger.keyValue("Profit/h", profit);

      } else if (result === "2") {
        logger.log(`Cat ${cat}/${el}: locked`);
      } else if (result === "0" || result === "") {
        logger.warn(`Cat ${cat}/${el} error (${result || "empty"})`);
      } else {
        logger.warn(`Cat ${cat}/${el} unexpected: ${result}`);
      }
    }
    await sleep(10000);
  }

  return { coins, profit, upgrades };
}

export async function farmHeadCoin(account) {
  if (!account.initData) {
    return { ok: false, error: "No initData — sync account from extension", coins: 0, profit: 0, mined: 0, dailyBonusClaimed: false, upgrades: 0, diamonds: 0 };
  }

  const initData = account.initData;
  logger.info(`Farming HeadCoin for ${account.id}...`);

  const state = await fetchGameState(initData).catch(() => null);
  if (!state || state.length < 20) {
    return { ok: false, error: "Unexpected game state", coins: 0, profit: 0, mined: 0, dailyBonusClaimed: false, upgrades: 0, diamonds: 0 };
  }

  const mined = parseInt(state[OFFSET.MINED], 10) || 0;
  logInfo(state);

  const dailyBonusClaimed = await handleDailyBonus(initData, state);

  await selectCEO(initData, state).catch((e) => logger.warn(`CEO failed: ${e?.message || e}`));

  await handleTasks(initData).catch((e) => logger.warn(`Tasks failed: ${e?.message || e}`));

  const { coins, profit, upgrades } = await upgradeCards(initData, state);

  let diamonds = 0;
  await sleep(2000);
  const postUpgradeState = await fetchGameState(initData).catch(() => state);
  diamonds = await runNftFlow(initData, postUpgradeState).catch((e) => {
    logger.warn(`NFT flow failed: ${e?.message || e}`);
    return 0;
  });

  logger.success(`Farming complete — coins: ${coins}, profit: ${profit}, upgrades: ${upgrades}, diamonds: ${diamonds}`);

  return { ok: true, coins, profit, mined, dailyBonusClaimed, upgrades, diamonds };
}
