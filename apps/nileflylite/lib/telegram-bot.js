import { postJson } from "./http.js";
import { logger } from "./logger.js";

const BASE = "https://api.telegram.org/bot";

export function createBot(token, chatId, threadId) {
  if (!token || !chatId) {
    return {
      sendStatus: () => {},
      sendError: () => {},
    };
  }

  async function sendMessage(text, options = {}) {
    const url = `${BASE}${token}/sendMessage`;
    await postJson(url, {
      chat_id: chatId,
      text,
      parse_mode: "HTML",
      link_preview_options: { is_disabled: true },
      ...(threadId ? { message_thread_id: threadId } : {}),
      ...options,
    });
  }

  return {
    async sendStatus(accountId, title, result) {
      try {
        const date = new Date().toISOString().slice(0, 19).replace("T", " ");
        const lines = [
          `<b>${title}</b>`,
          `<i>✅ Status: Initiated</i>`,
          ``,
          `<b>Account</b>: ${accountId}`,
          `<b>Coins</b>: ${result.coins?.toLocaleString() || "0"}`,
          `<b>Profit/h</b>: ${result.profit?.toLocaleString() || "0"}`,
          `<b>Daily Bonus</b>: ${result.dailyBonusClaimed ? "✅" : "❌"}`,
          `<b>Upgrades</b>: ${result.upgrades || 0}`,
          ``,
          `<b>Date</b>: ${date}`,
        ];
        await sendMessage(lines.join("\n"));
      } catch (err) {
        logger.error("Failed to send status message:", err.message);
      }
    },

    async sendError(accountId, title, error) {
      try {
        const lines = [
          `<b>❌ ${title} - Error</b>`,
          `<b>Account</b>: ${accountId}`,
          `<i>${error.message || error}</i>`,
        ];
        await sendMessage(lines.join("\n"), {
          message_thread_id: undefined,
        });
      } catch (err) {
        logger.error("Failed to send error message:", err.message);
      }
    },
  };
}
