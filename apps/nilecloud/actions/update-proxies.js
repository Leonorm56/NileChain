import app from "../config/app.js";
import chalk from "chalk";
import db from "../db/models/index.js";
import proxy from "../lib/proxy.js";

/** Update Proxies */
async function updateProxies() {
  if (app.proxy.enabled) {
    try {
      /** Update List */
      console.log(chalk.bold.blue("Updating proxy list..."));
      await proxy.updateList();

      /** Get Working Proxies */
      console.log(chalk.bold.blue("Testing working proxies..."));
      const workingProxies = await proxy.getWorkingProxies();

      /** Sort by duration ascending, extract proxies list */
      const sortedProxies = workingProxies
        .slice()
        .sort((a, b) => a.duration - b.duration)
        .map((item) => item.proxy);

      /** Log dead proxies (monitoring only, no reassignment) */
      const deadProxies = workingProxies.filter((item) => !item.status);
      if (deadProxies.length > 0) {
        console.log(
          chalk.bold.yellow(
            `${deadProxies.length} dead proxies detected (not reassigned):`,
          ),
        );
        console.table(deadProxies.map((item) => ({ proxy: item.proxy, ip: item.ip })));
      }

      /** Optionally clear proxies from unsubscribed accounts */
      if (app.proxy.clearUnsubscribed) {
        const unsubscribedAccounts = await db.Account.findAll({
          where: {
            proxy: { [db.Sequelize.Op.ne]: null },
            "$subscriptions.id$": { [db.Sequelize.Op.eq]: null },
          },
          include: [
            {
              required: false,
              association: "subscriptions",
              where: { active: true },
            },
          ],
        });

        /** Clear proxies for unsubscribed accounts that currently have proxies */
        if (unsubscribedAccounts.length > 0) {
          await db.Account.update(
            { proxy: "" },
            {
              where: {
                id: {
                  [db.Sequelize.Op.in]: unsubscribedAccounts.map(
                    (account) => account.id,
                  ),
                },
              },
            },
          );
        }
      }

      /* Get subscribed accounts */
      const accounts = await db.Account.findAllWithActiveSubscription();

      /** Proxies currently used by subscribed accounts (non-null) */
      const usedProxies = accounts
        .map((account) => account.proxy)
        .filter(Boolean);

      /** Accounts with no proxy yet (blank) */
      const blankAccounts = accounts.filter((account) => !account.proxy);

      if (blankAccounts.length > 0) {
        /** Available proxies = working proxies not currently used by subscribed accounts */
        const availableProxies = sortedProxies.filter(
          (p) => !usedProxies.includes(p),
        );

        /** Assign proxies only to accounts without a proxy */
        blankAccounts.forEach((account) => {
          const newProxy = availableProxies.shift();
          if (newProxy) {
            account.proxy = newProxy;
          }
        });

        /** Save Accounts */
        await Promise.allSettled(
          blankAccounts
            .filter((account) => account.changed())
            .map((account) => account.save()),
        );
      }

      console.log(chalk.bold.green("Proxies updated successfully."));
    } catch (error) {
      console.log(chalk.bold.red("Failed to update proxies"));
      if (process.env.NODE_ENV === "development") {
        console.error("Error updating proxies:", error);
      }
    }
  }
}

export default updateProxies;
