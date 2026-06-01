import { readAccounts, writeAccounts, getConfig, findAccount } from "./lib/storage.js";
import { logger } from "./lib/logger.js";
import { createBot } from "./lib/telegram-bot.js";
import { farmHeadCoin } from "./farmers/headcoin.js";
import { farmTradingWars } from "./farmers/tradingwars.js";

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

const config = getConfig();
const bot = createBot(config.telegram.botToken, config.telegram.chatId, config.telegram.threadId);

const FARMERS = [
  { id: "head-coin", title: "HeadCoin", farm: farmHeadCoin, interval: 0 },
  { id: "trading-wars", title: "TradingWars", farm: farmTradingWars, interval: 60 * 60 * 1000 },
];

async function runCycle() {
  const accounts = readAccounts();
  if (accounts.length === 0) {
    logger.warn("No accounts found");
    return;
  }

  logger.info(`Farming ${accounts.length} accounts...`);

  const allResults = [];
  const cycleStart = Date.now();

  for (const account of accounts) {
    logger.newline();
    logger.log(`── Account ${account.id} ──`);

    const farmerPromises = FARMERS.map(async (farmer) => {
      if (farmer.interval > 0) {
        const lastRun = account.farmers?.[farmer.id]?.lastRun;
        if (lastRun) {
          const elapsed = Date.now() - new Date(lastRun).getTime();
          if (elapsed < farmer.interval) {
            const remaining = Math.round((farmer.interval - elapsed) / 60000);
            logger.info(`${farmer.title}: ${remaining}m until next run, skipping`);
            return;
          }
        }
      }

      try {
        const start = Date.now();
        const result = await farmer.farm(account);
        const elapsed = Math.round((Date.now() - start) / 1000);

        if (!account.farmers) account.farmers = {};
        account.farmers[farmer.id] = {
          lastRun: new Date().toISOString(),
          coins: result.coins,
          profit: result.profit,
          mined: result.mined,
          dailyBonusClaimed: result.dailyBonusClaimed,
          upgrades: result.upgrades || 0,
          diamonds: result.diamonds || 0,
          elapsed,
          ok: result.ok,
        };

        if (!result.ok && result.error) {
          logger.warn(`${farmer.title} result: ${result.error}`);
        }

        allResults.push({
          farmerId: farmer.id,
          farmerTitle: farmer.title,
          accountId: account.id,
          profit: result.profit,
          tokens: result.tokens,
          upgrades: result.upgrades,
          trades: result.trades,
          ok: result.ok,
          error: result.error,
        });
      } catch (err) {
        logger.error(`Error farming ${farmer.title} for ${account.id}:`, err.message);
        allResults.push({
          farmerId: farmer.id,
          farmerTitle: farmer.title,
          accountId: account.id,
          profit: 0,
          ok: false,
          error: err.message,
        });
      }
    });

    await Promise.all(farmerPromises);

    await sleep(2000);
  }

  const cycleElapsed = Math.round((Date.now() - cycleStart) / 1000);

  const farmerGroups = {};
  for (const r of allResults) {
    const key = r.farmerId || "unknown";
    if (!farmerGroups[key]) farmerGroups[key] = { farmerId: key, farmerTitle: r.farmerTitle || key, results: [] };
    farmerGroups[key].results.push(r);
  }

  for (const group of Object.values(farmerGroups)) {
    await bot.sendFarmerSummary(group.farmerId, group.farmerTitle, group.results, { elapsed: cycleElapsed });
  }

  // Re-read fresh state and merge farmer results (don't overwrite sync data)
  const freshAccounts = readAccounts();
  for (const farmed of accounts) {
    const match = freshAccounts.find((a) => a.id === farmed.id);
    if (match && farmed.farmers) {
      match.farmers = farmed.farmers;
    }
  }
  await writeAccounts(freshAccounts);
  logger.newline();
  logger.success("=== Farming cycle complete ===");
}

async function run() {
  logger.info("=== Run loop started ===");

  while (true) {
    try {
      await runCycle();
    } catch (err) {
      logger.error("Cycle error:", err.message);
    }


  }
}

run().catch((err) => {
  logger.error("Fatal error:", err.message);
  process.exit(1);
});
