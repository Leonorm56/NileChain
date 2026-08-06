/**
 * @param {import("commander").Command} program
 * @param {typeof import("inquirer").default} inquirer
 * @param {typeof import("chalk").default} chalk
 */
export default (program, inquirer, chalk) => {
  program
    .command("set-proxy [user] [proxy]")
    .description("Manually set the proxy for an account")
    .usage("12345678 user:pass@ip:port")
    .action(async (userId, proxy) => {
      const db = await import("../db/models/index.js").then((m) => m.default);

      if (!userId) {
        const answers = await inquirer.prompt([
          { name: "userId", message: "Telegram User ID:", required: true },
        ]);

        userId = answers.userId;
      }

      if (!proxy) {
        const answers = await inquirer.prompt([
          { name: "proxy", message: "Proxy (user:pass@ip:port):", required: true },
        ]);

        proxy = answers.proxy;
      }

      /** Find account */
      const account = await db.Account.findByPk(userId);

      if (!account) {
        console.log(chalk.red.bold(`Account ${userId} not found.`));
        return;
      }

      /** Update proxy */
      await account.update({ proxy });

      console.log(
        chalk.green.bold(
          `Proxy updated for account ${userId} -> ${proxy}`,
        ),
      );
    });
};
