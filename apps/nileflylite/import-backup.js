import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import { readAccounts, writeAccounts } from "./lib/storage.js";
import { logger } from "./lib/logger.js";

const SESSIONS_DIR = path.resolve("sessions");

async function ensureDir(dir) {
  await fsp.mkdir(dir, { recursive: true });
}

async function main() {
  const backupPath = process.argv[2];

  if (!backupPath) {
    logger.error("Usage: node import-backup.js <backup-file.json>");
    logger.info("Get backup from old server: curl -o backup.json http://<old-server>/api/manager/export-backup");
    process.exit(1);
  }

  logger.info(`Reading backup: ${backupPath}`);

  let backup;
  try {
    const raw = await fsp.readFile(backupPath, "utf-8");
    backup = JSON.parse(raw);
  } catch (err) {
    logger.error("Failed to read backup:", err.message);
    process.exit(1);
  }

  const { accounts = [], farmers = [], sessions = [] } = backup;

  logger.info(`Backup contains:`);
  logger.keyValue("Accounts", accounts.length);
  logger.keyValue("Farmers", farmers.length);
  logger.keyValue("Sessions", sessions.length);
  logger.newline();

  const existingAccounts = readAccounts();

  // Match farmers to accounts, preferring head-coin farmer
  const accountMap = new Map();

  for (const acct of accounts) {
    const id = String(acct.id);
    const farmerRecords = farmers.filter((f) => String(f.accountId) === id);

    // Find initData from head-coin farmer, or any farmer
    const headCoinFarmer = farmerRecords.find((f) => f.farmer === "head-coin");
    const anyFarmer = farmerRecords.find((f) => f.initData);
    const farmer = headCoinFarmer || anyFarmer;

    const existing = existingAccounts.find((a) => a.id === id);

    accountMap.set(id, {
      id,
      title: acct.title || existing?.title || id,
      initData: farmer?.initData || existing?.initData || "",
      session: acct.session || existing?.session || "",
      headcoin: existing?.headcoin || {
        enabled: true,
        lastRun: null,
        coins: 0,
        profit: 0,
        dailyBonusClaimed: false,
      },
    });
  }

  // Save session files
  if (sessions.length > 0) {
    await ensureDir(SESSIONS_DIR);
    logger.info(`Restoring ${sessions.length} session files...`);
    for (const s of sessions) {
      const filePath = path.join(SESSIONS_DIR, s.name);
      await fsp.writeFile(filePath, s.content);
      logger.log(`  Restored: ${s.name}`);
    }
    logger.newline();
  }

  // Write accounts
  const result = Array.from(accountMap.values());
  await writeAccounts(result);
  logger.success(`Imported ${result.length} accounts to accounts.json`);
  logger.newline();
  logger.info("Run 'node run.js' to start farming");
}

main().catch((err) => {
  logger.error("Import failed:", err.message);
  process.exit(1);
});
