import { Bot } from "grammy";
import app from "../config/app.js";
import cache from "./cache.js";
import logger from "./logger.js";
import utils from "./utils.js";

class GroupBot extends Bot {
  /** Send Group Message
   *
   * This method will send a new message and automatically remove the previous message
   * with the same cache key
   */
  async sendGroupMessage(cacheKey, message, options = {}) {
    try {
      const previous = await cache.get(cacheKey);
      const html = message.join("\n");

      const sent = await this.api.sendMessage(app.chat.id, html, {
        ...options,
        ["parse_mode"]: "HTML",
        ["link_preview_options"]: { ["is_disabled"]: true },
      });

      /** Store Message ID */
      await cache.set(cacheKey, sent["message_id"]);

      /** Remove Previous Message */
      try {
        if (previous) {
          await this.api.deleteMessage(app.chat.id, previous);
        }
      } catch (error) {
        logger.error("Failed to remove previous message:", error);
      }

      return message;
    } catch (error) {
      logger.error("Error sending group message:", error);
    }
  }

  /** Send Farming Initiated Message */
  async sendFarmingInitiatedMessage({
    id,
    title,
    link,
    telegramLink,
    threadId,
    results,
    totalCount,
    executedCount,
  }) {
    try {
      const formattedResults = results.map(({ account, result }) => {
        return {
          id: account.id,
          status:
            result.status === "started"
              ? "✅"
              : result.status === "running"
                ? "☑️"
                : "❌",
          session: telegramLink ? (account.session ? "🟨" : "🟪") : "",
          count: account?.farmer?.errorCount || 0,
          username: account.user?.username || "",
          title: account.title,
          info:
            result.status === "running"
              ? [
                  `<b>TSK:</b> <code>${result.currentTask}</code>`,
                  `<b>ELP:</b> <code>${result.elapsed}</code>`,
                ].join("\n")
              : null,
        };
      });

      /* Telegram limit is 4096 chars. Build full message first, then truncate. */
      const MAX_MSG_LEN = 4000;
      const header = `<b>${title}</b>`;
      const statusLine = `<i>✅ Status: Initiated (${executedCount}/${totalCount})</i>\n`;
      const linkBlock = `<blockquote><a href="${link || telegramLink}">Open ${link ? "Link" : "Telegram Bot"}</a></blockquote>`;
      const dateLine = `<b>🗓️ Date</b>: ${utils.dateFns.format(new Date(), "yyyy-MM-dd HH:mm:ss")}`;
      const fixedParts = [header, statusLine, linkBlock, dateLine].join("\n");
      const userBudget = MAX_MSG_LEN - fixedParts.length - 10;

      let users = utils.formatUsers(formattedResults);
      if (users.length > userBudget) {
        const trimmed = formattedResults.filter(
          (r) => r.status !== "❌"
        );
        users = utils.formatUsers(trimmed);
      }
      if (users.length > userBudget) {
        /* Keep only running + started */
        const running = formattedResults.filter(
          (r) => r.status === "☑️" || r.status === "✅"
        );
        users = utils.formatUsers(running);
      }
      if (users.length > userBudget) {
        /* Truncate at last newline before budget to avoid splitting HTML tags */
        users = users.slice(0, userBudget);
        const lastNewline = users.lastIndexOf("\n");
        if (lastNewline > 0) users = users.slice(0, lastNewline);
        users += "\n…</blockquote>";
      }

      return await this.sendGroupMessage(
        `messages.farming-initiated.${id}`,
        [
          header,
          statusLine,
          `${linkBlock}${users}`,
          dateLine,
        ],
        { ["message_thread_id"]: threadId },
      );
    } catch (error) {
      logger.error("Error sending farming initiated message:", error);
    }
  }

  /** Send User Update Complete Message */
  async sendUserUpdateCompleteMessage(result) {
    try {
      const users = utils.formatUsers(
        result.accounts.map((account) => {
          return {
            id: account.id,
            status: "✅",
            session: account.session ? "🟨" : "🟪",
            username: account.user?.username || "",
            title: account.title,
          };
        }),
      );

      const startDate = utils.dateFns.format(
        result.startDate,
        "yyyy-MM-dd HH:mm:ss",
      );

      const endDate = utils.dateFns.format(
        result.endDate,
        "yyyy-MM-dd HH:mm:ss",
      );

      return await this.sendGroupMessage(
        "messages.user-update.completed",
        [
          `<b>🌐 Accounts Update</b>`,
          "<i>✅ Status: Completed</i>",
          `\n<blockquote><i>Telegram Account updated!</i></blockquote>${users}`,
          `<b>🗓️ Start Date</b>: ${startDate}`,
          `<b>🗓️ End Date</b>: ${endDate}`,
        ],
        { ["message_thread_id"]: app.chat.threads.announcement },
      );
    } catch (error) {
      logger.error(error);
    }
  }

  /** Send Server Address */
  async sendServerAddress(address) {
    try {
      const date = utils.dateFns.format(new Date(), "yyyy-MM-dd HH:mm:ss");

      return await this.sendGroupMessage(
        "messages.startup.server-address",
        [
          `<b>☁️ Latest Fly Server</b>`,
          `<b>🚀 Address</b>: ${address}`,
          `<b>🗓️ Updated</b>: ${date}`,
        ],
        { ["message_thread_id"]: app.chat.threads.announcement },
      );
    } catch (error) {
      logger.error(error);
    }
  }

  /** Send Farmer Error Message */
  async sendFarmerErrorMessage(
    id,
    title,
    accountId,
    currentTask,
    errorMessage,
  ) {
    try {
      return await this.sendGroupMessage(
        `messages.error.${id}.${accountId}`,
        [
          `❌ Error when executing ${title} Farmer for (<b>${accountId}</b>)`,
          `<i>Current Task: ${currentTask || "(none)"}</i>`,
          `<i>${errorMessage}</i>`,
        ],
        { ["message_thread_id"]: app.chat.threads.error },
      );
    } catch (error) {
      logger.error(error);
    }
  }

  /** Send Private Message */
  async sendPrivateMessage(id, messages, options = {}) {
    try {
      /* Must be awaited: an un-awaited reject escapes this try and becomes an
       * unhandled rejection (fatal under close-with-grace). */
      return await this.api.sendMessage(id, messages.join("\n"), {
        ["parse_mode"]: "HTML",
        ...options,
      });
    } catch (error) {
      logger.error(error);
    }
  }
}

const token = env("TELEGRAM_BOT_TOKEN");
const bot = token ? new GroupBot(token) : null;

export default bot;
