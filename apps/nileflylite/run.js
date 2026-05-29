import { readAccounts, writeAccounts, getConfig, findAccount } from "./lib/storage.js";
import { logger } from "./lib/logger.js";
import { createBot } from "./lib/telegram-bot.js";
import { farmHeadCoin } from "./farmers/headcoin.js";

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

const config = getConfig();
const bot = createBot(config.telegram.botToken, config.telegram.chatId, config.telegram.threadId);

const FARMERS = [
  { id: "head-coin", title: "HeadCoin", farm: farmHeadCoin },
];

async function run() {
  logger.newline();
  logger.info("=== Starting farming cycle ===");

  const accounts = readAccounts();
  if (accounts.length === 0) {
    logger.warn("No accounts found. Add accounts via server.js or edit accounts.json");
    return;
  }

  logger.info(`Farming ${accounts.length} accounts...`);
  logger.newline();

  const allResults = [];
  const cycleStart = Date.now();

  for (const account of accounts) {
    if (account.headcoin?.enabled === false) {
      logger.info(`Skipping ${account.id} (disabled)`);
      continue;
    }

    logger.newline();
    logger.log(`── Account ${account.id} ──`);

    for (const farmer of FARMERS) {
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
          elapsed,
          ok: result.ok,
        };

        allResults.push({
          accountId: account.id,
          profit: result.profit,
          ok: result.ok,
          error: result.error,
        });
      } catch (err) {
        logger.error(`Error farming ${farmer.title} for ${account.id}:`, err.message);
        allResults.push({
          accountId: account.id,
          profit: 0,
          ok: false,
          error: err.message,
        });
      }
    }

    await sleep(5000);
  }

  const cycleElapsed = Math.round((Date.now() - cycleStart) / 1000);
  await bot.sendCycleSummary(allResults, { elapsed: cycleElapsed });

  await writeAccounts(readAccounts());
  logger.newline();
  logger.success("=== Farming cycle complete ===");
}

run().catch((err) => {
  logger.error("Fatal error:", err.message);
  process.exit(1);
});
