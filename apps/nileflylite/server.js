import http from "node:http";
import { readAccounts, writeAccounts, findAccount, upsertAccount, getConfig } from "./lib/storage.js";
import { logger } from "./lib/logger.js";
import { startPhoneAuth, submitCode, submitPassword, waitForAuth, loadSession, logoutSession, deleteSessionFile } from "./lib/gram-client.js";
import { getInitDataUnsafe } from "./lib/telegram-utils.js";

process.on("unhandledRejection", (err) => {
  logger.error("Unhandled rejection:", err?.message || err);
});
process.on("uncaughtException", (err) => {
  logger.error("Uncaught exception:", err?.message || err);
});

const config = getConfig();
const PORT = config.server.port || 3000;

function sendJson(res, status, data) {
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify(data));
}

function parseBody(req) {
  return new Promise((resolve) => {
    let body = "";
    req.on("data", (chunk) => (body += chunk));
    req.on("end", () => {
      try {
        resolve(JSON.parse(body));
      } catch {
        resolve(null);
      }
    });
    req.on("error", () => resolve(null));
  });
}

const server = http.createServer(async (req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");

  if (req.method === "OPTIONS") {
    res.writeHead(204);
    res.end();
    return;
  }

  const url = new URL(req.url, `http://${req.headers.host}`);
  const path = url.pathname;
  const method = req.method;

  try {
    // GET /api/server — extension checks this first
    if (path === "/api/server" && method === "GET") {
      return sendJson(res, 200, { name: "NileFlyLite" });
    }

    // GET /api/status
    if (path === "/api/status" && method === "GET") {
      const accounts = readAccounts();
      return sendJson(res, 200, {
        server: "nileflylite",
        accounts: accounts.map((a) => ({
          id: a.id,
          title: a.title || "",
          headcoin: a.headcoin || null,
          tradingwars: a.tradingwars || null,
          farmers: a.farmers || {},
        })),
      });
    }

    // POST /api/subscription — always active
    if (path === "/api/subscription" && method === "POST") {
      const body = await parseBody(req);
      const unsafe = body?.auth ? getInitDataUnsafe(body.auth) : null;
      const userId = unsafe?.user?.id?.toString();
      const account = userId ? findAccount(userId) : null;

      return sendJson(res, 200, {
        subscription: { endsAt: null },
        account: {
          session: (account?.initData || account?.session) ? "active" : null,
          proxy: null,
        },
      });
    }

    // POST /api/farmers — list farmers for account (extension polls every 10s)
    if (path === "/api/farmers" && method === "POST") {
      const body = await parseBody(req);
      const unsafe = body?.auth ? getInitDataUnsafe(body.auth) : null;
      const userId = unsafe?.user?.id?.toString();
      const account = userId ? findAccount(userId) : null;

      const farmers = [];
      if (account?.headcoin) {
        farmers.push({ id: account.id, farmer: "head-coin", initData: account.initData || "", active: true });
      }
      if (account?.tradingwars) {
        farmers.push({ id: account.id, farmer: "trading-wars", initData: account.initData || "", active: true });
      }
      return sendJson(res, 200, farmers);
    }

    // POST /api/farmers/activate — activate a farmer for this account
    if (path === "/api/farmers/activate" && method === "POST") {
      const body = await parseBody(req);
      const unsafe = body?.auth ? getInitDataUnsafe(body.auth) : null;
      const userId = unsafe?.user?.id?.toString();
      const farmerId = body?.id;
      if (userId && farmerId) {
        const farmerConfig = { enabled: true, lastRun: null };
        if (farmerId === "head-coin") {
          await writeAccounts(upsertAccount({ id: userId, headcoin: { ...farmerConfig, coins: 0, profit: 0, dailyBonusClaimed: false } }));
        } else if (farmerId === "trading-wars") {
          await writeAccounts(upsertAccount({ id: userId, tradingwars: farmerConfig }));
        }
      }
      return sendJson(res, 200, { ok: true });
    }

    // POST /api/farmers/deactivate — deactivate a farmer
    if (path === "/api/farmers/deactivate" && method === "POST") {
      const body = await parseBody(req);
      const unsafe = body?.auth ? getInitDataUnsafe(body.auth) : null;
      const userId = unsafe?.user?.id?.toString();
      const farmerId = body?.id;
      if (userId && farmerId) {
        const accounts = readAccounts();
        const account = accounts.find(a => a.id === userId);
        if (account) {
          if (farmerId === "head-coin") {
            account.headcoin = { enabled: false, lastRun: null, coins: 0, profit: 0, dailyBonusClaimed: false };
          } else if (farmerId === "trading-wars") {
            account.tradingwars = { enabled: false, lastRun: null };
          }
          await writeAccounts(accounts);
        }
      }
      return sendJson(res, 200, { ok: true });
    }

    // GET /api/manager/user — stub
    if (path === "/api/manager/user" && method === "GET") {
      return sendJson(res, 200, { id: 1, username: "admin", email: "admin@local" });
    }

    // POST /api/sync — accept initData from extension
    if (path === "/api/sync" && method === "POST") {
      const body = await parseBody(req);
      if (!body) return sendJson(res, 400, { error: "Invalid JSON" });

      const initData = body.auth || body.initData;
      if (!initData) return sendJson(res, 400, { error: "Missing initData" });

      const unsafe = getInitDataUnsafe(initData);
      const userId = unsafe?.user?.id?.toString();
      if (!userId) return sendJson(res, 400, { error: "Missing user ID in initData" });

      const farmer = body.farmer || "head-coin";
      const update = {
        id: userId,
        title: unsafe.user?.username || unsafe.user?.first_name || userId,
      };

      if (farmer === "trading-wars") {
        update.tradingwarsInitData = initData;
        update.tradingwars = { enabled: true, lastRun: null };
      } else {
        update.headcoinInitData = initData;
        update.initData = initData;
        update.headcoin = { enabled: true, lastRun: null, coins: 0, profit: 0, dailyBonusClaimed: false };
      }

      await writeAccounts(upsertAccount(update));
      return sendJson(res, 200, { ok: true, userId });
    }

    // POST /api/telegram/login — start phone auth
    if (path === "/api/telegram/login" && method === "POST") {
      const body = await parseBody(req);
      if (!body?.phone) return sendJson(res, 400, { error: "Missing phone" });

      const result = await startPhoneAuth(body.phone);
      return sendJson(res, 200, result);
    }

    // POST /api/telegram/code — submit verification code
    if (path === "/api/telegram/code" && method === "POST") {
      const body = await parseBody(req);
      if (!body?.session || !body?.code) return sendJson(res, 400, { error: "Missing session or code" });

      try {
        await submitCode(body.session, body.code);
        const result = await waitForAuth(body.session);

        if (result.user) {
          const userId = result.user.id?.toString();
          await writeAccounts(upsertAccount({
            id: userId,
            session: result.sessionString,
            headcoin: { enabled: true, lastRun: null, coins: 0, profit: 0, dailyBonusClaimed: false },
          }));
          return sendJson(res, 200, { user: { id: Number(userId) } });
        }

        if (result.type === "password") {
          return sendJson(res, 200, { type: "password", hint: result.hint });
        }

        return sendJson(res, 200, result);
      } catch (err) {
        return sendJson(res, 400, { error: err.message });
      }
    }

    // POST /api/telegram/password — submit 2FA password
    if (path === "/api/telegram/password" && method === "POST") {
      const body = await parseBody(req);
      if (!body?.session || !body?.password) return sendJson(res, 400, { error: "Missing session or password" });

      try {
        await submitPassword(body.session, body.password);
        const result = await waitForAuth(body.session);

        if (result.user) {
          const userId = result.user.id?.toString();
          await writeAccounts(upsertAccount({
            id: userId,
            session: result.sessionString,
            headcoin: { enabled: true, lastRun: null, coins: 0, profit: 0, dailyBonusClaimed: false },
          }));
          return sendJson(res, 200, { user: { id: Number(userId) } });
        }

        return sendJson(res, 200, result);
      } catch (err) {
        return sendJson(res, 400, { error: err.message });
      }
    }

    // POST /api/telegram/logout — logout and clear session
    if (path === "/api/telegram/logout" && method === "POST") {
      const body = await parseBody(req);
      if (!body?.auth) return sendJson(res, 400, { error: "Missing auth" });

      const unsafe = getInitDataUnsafe(body.auth);
      const userId = unsafe?.user?.id?.toString();

      if (userId) {
        const accounts = readAccounts();
        const account = accounts.find(a => a.id === userId);
        if (account?.session) {
          await logoutSession(account.session);
          account.session = null;
          account.initData = null;
          await writeAccounts(accounts);
        }
      }

      return sendJson(res, 200, { result: true });
    }

    // 404
    sendJson(res, 404, { error: "Not found" });
  } catch (err) {
    logger.error("Server error:", err.message);
    sendJson(res, 500, { error: "Internal server error" });
  }
});

server.listen(PORT, "0.0.0.0", () => {
  logger.success(`NileFlyLite server running on port ${PORT}`);
});
