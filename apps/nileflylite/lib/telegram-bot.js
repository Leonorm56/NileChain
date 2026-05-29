import fs from "node:fs";
import path from "node:path";
import { postJson } from "./http.js";
import { logger } from "./logger.js";

const BASE = "https://api.telegram.org/bot";
const LAST_MSG_PATH = path.resolve("last_message.json");

function readLastMessageId() {
  try {
    return JSON.parse(fs.readFileSync(LAST_MSG_PATH, "utf-8")).message_id;
  } catch {
    return null;
  }
}

function writeLastMessageId(id) {
  const tmp = LAST_MSG_PATH + ".tmp";
  fs.writeFileSync(tmp, JSON.stringify({ message_id: id }));
  fs.renameSync(tmp, LAST_MSG_PATH);
}

export function createBot(token, chatId, threadId) {
  if (!token || !chatId) {
    return { sendCycleSummary: () => {} };
  }

  async function sendMessage(text) {
    const url = `${BASE}${token}/sendMessage`;
    return postJson(url, {
      chat_id: chatId,
      text,
      parse_mode: "HTML",
      link_preview_options: { is_disabled: true },
      ...(threadId ? { message_thread_id: threadId } : {}),
    });
  }

  return {
    async sendCycleSummary(results, meta) {
      try {
        const prevId = readLastMessageId();
        if (prevId) {
          try {
            await postJson(`${BASE}${token}/deleteMessage`, {
              chat_id: chatId,
              message_id: prevId,
            });
          } catch {}
        }

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

        const res = await sendMessage(lines.join("\n"));
        const newId = res?.result?.message_id;
        if (newId) writeLastMessageId(newId);
      } catch (err) {
        logger.error("Failed to send cycle summary:", err.message);
      }
    },
  };
}
