import dotenv from "dotenv";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config({ path: path.resolve(__dirname, "../.env") });

global.env = function (key, defaultValue) {
  let value = process.env[key];

  if (value === undefined) return defaultValue;

  value = value.trim();

  switch (value.toLowerCase()) {
    case "true":
    case "(true)":
      return true;
    case "false":
    case "(false)":
      return false;
    case "null":
    case "(null)":
      return null;
    case "empty":
    case "(empty)":
      return "";
  }

  if (!isNaN(value) && value !== "") {
    return Number(value);
  }

  return value;
};

/**
 * Process-level safety net.
 *
 * `config/env.js` is the first import in every entry point — the Fastify
 * server (`app.js`), the cron bootstrap (`cron.js`), and every `fly` CLI
 * command — so these handlers are installed before anything else can throw.
 *
 * Under `fastify start`, close-with-grace also listens for these events and
 * calls `process.exit(1)`; because we register first, we at least log the
 * offending value before it shuts the server down. Outside Fastify (e.g.
 * `fly farm <farmer>`), no such handler exists, so logging here keeps a single
 * stray async error from silently taking the whole command down.
 */
if (!globalThis.__nilecloudProcessGuards) {
  globalThis.__nilecloudProcessGuards = true;

  process.on("unhandledRejection", (reason) => {
    console.error(
      "[nilecloud] Unhandled promise rejection:",
      reason instanceof Error ? reason.stack || reason.message : reason,
    );
  });

  process.on("uncaughtException", (error) => {
    console.error(
      "[nilecloud] Uncaught exception:",
      error?.stack || error?.message || error,
    );
  });
}
