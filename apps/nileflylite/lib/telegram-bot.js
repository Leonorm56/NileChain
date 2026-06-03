import fs from "node:fs";
import path from "node:path";
import { postJson } from "./http.js";
import { logger } from "./logger.js";

const BASE = "https://api.telegram.org/bot";
const LAST_MSG_PATH = path.resolve("last_message.json");

export function createBot(token, chatId, threadId) {
  if (!token || !chatId) {
    return { sendCycleSummary: () => {} };
  }

  async function sendMessage(text) {
    const MAX = 4000;
    if (text.length > MAX) {
      logger.warn(`Message too long (${text.length} chars), truncating to ${MAX}`);
      text = text.slice(0, MAX - 100) + `\n\n<b>... truncated (${text.length - MAX + 100} chars removed)</b>`;
    }
    const url = `${BASE}${token}/sendMessage`;
    const res = await postJson(url, {
      chat_id: chatId,
      text,
      parse_mode: "HTML",
      link_preview_options: { is_disabled: true },
      ...(threadId ? { message_thread_id: threadId } : {}),
    });
    if (res.ok && res.data) {
      try { return JSON.parse(res.data); } catch {}
    }
    logger.error(`Telegram sendMessage failed: ${res?.error || "unknown"}`);
    return null;
  }

  function lastMsgPath(farmerId) {
    return farmerId ? path.resolve(`last_message_${farmerId}.json`) : LAST_MSG_PATH;
  }

  function readMsgId(farmerId) {
    const p = lastMsgPath(farmerId);
    try {
      return JSON.parse(fs.readFileSync(p, "utf-8")).message_id;
    } catch {
      return null;
    }
  }

  function writeMsgId(farmerId, id) {
    const p = lastMsgPath(farmerId);
    const tmp = p + ".tmp";
    fs.writeFileSync(tmp, JSON.stringify({ message_id: id }));
    fs.renameSync(tmp, p);
  }

  async function deletePrevious(farmerId) {
    const prevId = readMsgId(farmerId);
    if (!prevId) return;
    const delRes = await postJson(`${BASE}${token}/deleteMessage`, {
      chat_id: chatId,
      message_id: prevId,
    });
    if (!delRes.ok && delRes.data) {
      try {
        const parsed = JSON.parse(typeof delRes.data === "string" ? delRes.data : "{}");
        if (!parsed.ok) logger.warn(`Delete old message: ${parsed.description}`);
      } catch {}
    }
  }

  async function sendAndTrack(farmerId, text) {
    const res = await sendMessage(text);
    const newId = res?.result?.message_id;
    if (newId) writeMsgId(farmerId, newId);
  }

  return {
    async sendCycleSummary(results, meta) {
      logger.info(`Sending cycle summary (${results.length} results, ${meta.elapsed}s)...`);
      try {
        await deletePrevious(null);

        const okResults = [];
        const errors = [];
        for (const r of results) {
          if (r.ok) okResults.push(r);
          else errors.push(r);
        }

        const date = new Date().toISOString().slice(0, 19).replace("T", " ");
        const lines = [
          `<b>🔄 Farming Cycle</b> — ${date}`,
          "─────────────────────────────────",
        ];

        for (const r of okResults) {
          lines.push(`${r.accountId} — ${r.profit?.toLocaleString() || "0"}/h`);
        }

        lines.push("─────────────────────────────────");
        lines.push(`✅ ${okResults.length} accounts | ⏱ ${meta.elapsed}s`);

        if (errors.length > 0) {
          lines.push("");
          lines.push("<b>Errors:</b>");
          for (const r of errors) {
            lines.push(`${r.accountId} — ${r.error || "Unknown"}`);
          }
        }

        await sendAndTrack(null, lines.join("\n"));
      } catch (err) {
        logger.error("Failed to send cycle summary:", err.message);
      }
    },

    async sendFarmerSummary(farmerId, farmerTitle, results, meta) {
      logger.info(`Sending ${farmerTitle} summary (${results.length} results)...`);
      try {
        await deletePrevious(farmerId);

        const okResults = [];
        const errors = [];
        for (const r of results) {
          if (r.ok) okResults.push(r);
          else errors.push(r);
        }

        const date = new Date().toISOString().slice(0, 19).replace("T", " ");
        const lines = [
          `<b>🛠 ${farmerTitle}</b> — ${date}`,
          "─────────────────────────────────",
        ];

        for (const r of okResults) {
          const parts = [`${r.accountId}`];
          if (r.profit != null) parts.push(`${r.profit.toLocaleString()}/h`);
          if (r.tokens != null) parts.push(`${r.tokens} TWARS`);
          if (r.upgrades) parts.push(`⬆${r.upgrades}`);
          if (r.trades) parts.push(`📈${r.trades}`);
          lines.push(parts.join(" — "));
        }

        lines.push("─────────────────────────────────");
        lines.push(`✅ ${okResults.length} accounts | ⏱ ${meta.elapsed}s`);

        if (errors.length > 0) {
          lines.push("");
          lines.push("<b>Errors:</b>");
          for (const r of errors) {
            lines.push(`${r.accountId} — ${r.error || "Unknown"}`);
          }
        }

        await sendAndTrack(farmerId, lines.join("\n"));
      } catch (err) {
        logger.error(`Failed to send ${farmerTitle} summary:`, err.message);
      }
    },
  };
}
