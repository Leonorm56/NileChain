import { spawn, execSync } from "node:child_process";
import { existsSync } from "node:fs";
import { logger } from "./lib/logger.js";

async function up() {
  logger.newline();
  logger.log("  ╔═══════════════════════════════╗");
  logger.log("  ║      NileFlyLite — One Up     ║");
  logger.log("  ╚═══════════════════════════════╝");
  logger.newline();

  // 1. Install dependencies if needed
  if (!existsSync("node_modules/telegram")) {
    logger.info("First run — installing dependencies...");
    execSync("npm install --loglevel=error", { stdio: "inherit" });
    logger.success("Dependencies installed");
    logger.newline();
  }

  // 2. Check config
  try {
    const cfg = (await import("./lib/storage.js")).getConfig();
    if (!cfg.telegram.botToken) {
      logger.warn("No bot token in config.json — group messages disabled");
    }
    if (!cfg.server.port) {
      logger.warn("No port in config.json — using default 3000");
    }
  } catch {
    logger.warn("No config.json found — using defaults");
  }
  logger.newline();

  // 3. Start server
  logger.info("Starting HTTP server...");
  const server = spawn("node", ["server.js"], {
    stdio: ["ignore", "inherit", "inherit"],
  });

  server.on("error", (err) => {
    logger.error("Server failed to start:", err.message);
    process.exit(1);
  });

  // Wait for server to start
  await new Promise((r) => setTimeout(r, 1500));

  // 4. Run farming cycle
  logger.info("Running farming cycle...");
  logger.newline();

  const farm = spawn("node", ["run.js"], {
    stdio: ["ignore", "inherit", "inherit"],
  });

  const farmExit = new Promise((resolve) => farm.on("exit", resolve));
  const exitCode = await farmExit;

  logger.newline();
  if (exitCode === 0) {
    logger.success("Farming cycle complete");
  } else {
    logger.warn(`Farming cycle exited with code ${exitCode}`);
  }
  logger.newline();

  // 5. Server stays running
  logger.success("Server is running on port " + (await getPort()));
  logger.info("Point your extension to this server URL");
  logger.info("Press Ctrl+C to stop");
  logger.newline();

  // Keep alive
  await new Promise(() => {});
}

async function getPort() {
  try {
    const cfg = (await import("./lib/storage.js")).getConfig();
    return cfg.server.port || 3000;
  } catch {
    return 3000;
  }
}

up().catch((err) => {
  logger.error("Fatal:", err.message);
  process.exit(1);
});
