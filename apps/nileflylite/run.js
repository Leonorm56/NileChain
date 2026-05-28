import { readAccounts, writeAccounts, getConfig, findAccount } from "./lib/storage.js";
import { logger } from "./lib/logger.js";
import { createBot } from "./lib/telegram-bot.js";
import { farmHeadCoin } from "./farmers/headcoin.js";

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

        if (result.ok) {
          bot.sendStatus(account.id, farmer.title, result);
        } else {
          bot.sendError(account.id, farmer.title, result.error || "Unknown error");
        }
      } catch (err) {
        logger.error(`Error farming ${farmer.title} for ${account.id}:`, err.message);
        bot.sendError(account.id, farmer.title, err.message);
      }
    }
  }

  await writeAccounts(readAccounts());
  logger.newline();
  logger.success("=== Farming cycle complete ===");
}

run().catch((err) => {
  logger.error("Fatal error:", err.message);
  process.exit(1);
});
