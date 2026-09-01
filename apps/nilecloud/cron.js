import "./config/env.js";

import CronRunner from "@nile/shared/lib/CronRunner.js";
import app from "./config/app.js";
import expireSubscriptions from "./actions/expire-subscriptions.js";
import farmers from "./farmers/index.js";
import { fileURLToPath } from "node:url";
import path from "node:path";
import updateAccounts from "./actions/update-accounts.js";
import updateProxies from "./actions/update-proxies.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const env = (key, def) => process.env[key] ?? def;

if (app.cron.enabled) {
  const runner = new CronRunner(app.cron.mode);

  /**  Register jobs */
  runner.register("0 0 * * *", expireSubscriptions, "Expire Subscriptions");
  runner.register("*/15 * * * *", updateProxies, "Update Proxies");

  /** Update Accounts — only if enabled */
  if (env("UPDATE_ACCOUNTS_ENABLED", "true") !== "false") {
    runner.register("*/20 * * * *", updateAccounts, "Update Accounts");
  } else {
    console.log("⏭  Update Accounts disabled via UPDATE_ACCOUNTS_ENABLED=false");
  }

  /**  Farmers — respect FARMER_<ID>_ENABLED env vars */
  const minimumRating = env("MINIMUM_FARMER_RATING", 0);

  Object.values(farmers)
    .filter((FarmerClass) => {
      const envKey = `FARMER_${FarmerClass.id.toUpperCase().replace(/-/g, "_")}_ENABLED`;
      const envEnabled = env(envKey, "true");
      const isEnabled = FarmerClass.enabled && envEnabled !== "false";
      if (!isEnabled) {
        console.log(`⏭  ${FarmerClass.title} disabled (${envKey}=${envEnabled})`);
      }
      return (
        isEnabled &&
        FarmerClass.rating >= minimumRating &&
        FarmerClass.interval
      );
    })
    .forEach((FarmerClass) => {
      runner.register(
        FarmerClass.interval,
        () => FarmerClass.run(),
        FarmerClass.title,
      );
    });

  /** Start Runner */
  runner.start();
}
