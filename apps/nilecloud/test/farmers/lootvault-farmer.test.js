import * as assert from "node:assert";
import { test } from "node:test";

import LootVaultFarmer from "@nile/shared/farmers/LootVaultFarmer.js";

const INIT_DATA =
  "query_id=AAEQM0VWAwAAABAzRVYMG2ra&user=%7B%22id%22%3A7889826576%7D" +
  "&auth_date=1792434814&signature=abc&hash=def";

const WALLET = "UQBpJM8mSdqrdDjYGDoVMZPxeKv7gPCDlxRwNmIP_OZhlEoM";

/** A logger that records what the farmer wrote. */
function recordingLogger() {
  const lines = [];
  const chain = new Proxy(function () {}, {
    get: () => chain,
    apply: (_self, _this, args) => args[0] ?? "",
  });
  const record = (level) => (...args) => lines.push({ level, args });

  return {
    lines,
    log: record("log"),
    info: record("info"),
    warn: record("warn"),
    error: record("error"),
    success: record("success"),
    newline: () => {},
    keyValue: () => {},
    output: () => {},
    chalk: chain,
    c: chain,
  };
}

/**
 * A stand-in for the axios instance the host hands the farmer.
 *
 * `routes` maps "METHOD url" to either a response body or a function of
 * (body). Every call is recorded so a test can assert what was asked of the
 * API, in order.
 */
function fakeApi(routes = {}) {
  const calls = [];

  const respond = (method, url, body) => {
    calls.push({ method, url, body });

    const route = routes[`${method} ${url}`];
    if (route === undefined) {
      throw new Error(`unexpected ${method} ${url}`);
    }
    if (typeof route === "function") return route(body, calls);
    return route;
  };

  return {
    calls,
    get: (url, config = {}) => {
      const res = respond("GET", url, config);
      return Promise.resolve({ status: 200, data: res, config });
    },
    post: (url, body, config = {}) => {
      const res = respond("POST", url, body);
      return Promise.resolve({ status: 200, data: res, config });
    },
  };
}

/** A farmer wired up to a scripted API, with the host's delays stubbed out. */
function makeFarmer(routes) {
  const logger = recordingLogger();
  const delays = [];
  const farmer = new LootVaultFarmer();

  farmer.logger = logger;
  farmer.api = fakeApi(routes);
  farmer.utils = {
    delay: async (ms) => {
      delays.push(ms);
    },
    delayForSeconds: async () => {},
  };
  farmer.setTelegramWebApp({
    initData: INIT_DATA,
    initDataUnsafe: { user: { id: 7889826576, username: "paulponi" } },
  });

  return { farmer, logger, delays };
}

const ACCOUNT = { registered: true, isAdmin: false, maintenance: false };

const STREAK_CLAIMABLE = {
  streak: {
    currentDay: 0,
    nextDay: 1,
    nextReward: 15,
    canClaim: true,
    cooldownMs: 0,
    expiresInMs: 0,
    totalClaimed: 0,
    streakCount: 0,
    isBroken: false,
  },
  tasks: [],
};

test("the auth header carries the Telegram init data", () => {
  const { farmer } = makeFarmer({});

  assert.deepEqual(farmer.getAuthHeaders(), { "X-TG-Init": INIT_DATA });
});

test("verification reads the account state", async () => {
  const { farmer } = makeFarmer({
    "GET https://lootvault.lol/vx/a0": { ok: true, d: ACCOUNT },
  });

  const account = await farmer.verifyAccount();

  assert.deepEqual(account, ACCOUNT);
  assert.equal(farmer.api.calls[0].method, "GET");
  assert.equal(farmer.api.calls[0].url, "https://lootvault.lol/vx/a0");
});

test("a rejected init data is surfaced, not swallowed", async () => {
  const { farmer } = makeFarmer({
    "GET https://lootvault.lol/vx/a0": { ok: false, e: "no_auth" },
  });

  await assert.rejects(
    () => farmer.verifyAccount(),
    /no_auth/,
  );
});

test("maintenance stops the run before anything is claimed", async () => {
  const { farmer } = makeFarmer({
    "GET https://lootvault.lol/vx/a0": {
      ok: true,
      d: { registered: true, isAdmin: false, maintenance: true },
    },
  });

  await assert.rejects(() => farmer.login(), /maintenance/i);
});

test("an unregistered account is not claimed for", async () => {
  const { farmer } = makeFarmer({
    "GET https://lootvault.lol/vx/a0": {
      ok: true,
      d: { registered: false, isAdmin: false, maintenance: false },
    },
  });

  const result = await farmer.claimDailyStreak();

  assert.equal(result, false);
  assert.equal(
    farmer.api.calls.filter((call) => call.url.includes("tk2")).length,
    0,
    "an unregistered account must not reach the claim endpoint",
  );
});

test("the claim verifies the account first", async () => {
  const { farmer } = makeFarmer({
    "GET https://lootvault.lol/vx/a0": { ok: true, d: ACCOUNT },
    "GET https://lootvault.lol/vx/tk1": { ok: true, d: STREAK_CLAIMABLE },
    "POST https://lootvault.lol/vx/tk2/streak": {
      ok: true,
      d: {
        claimedDay: 1,
        reward: 15,
        boxesCount: 0,
        partsCount: 0,
        droppedItems: [],
        newBalance: "15000000000",
        streakStatus: { currentDay: 1, nextDay: 2, canClaim: false },
      },
    },
  });

  const claimed = await farmer.claimDailyStreak();

  assert.equal(claimed, true);

  const urls = farmer.api.calls.map((call) => call.url);
  assert.equal(urls[0], "https://lootvault.lol/vx/a0", "verification comes first");
  assert.equal(urls[1], "https://lootvault.lol/vx/tk1");
  assert.equal(urls[2], "https://lootvault.lol/vx/tk2/streak");
});

test("a streak that cannot be claimed is left alone", async () => {
  const { farmer } = makeFarmer({
    "GET https://lootvault.lol/vx/a0": { ok: true, d: ACCOUNT },
    "GET https://lootvault.lol/vx/tk1": {
      ok: true,
      d: {
        streak: { currentDay: 3, nextDay: 4, canClaim: false, cooldownMs: 86_400_000 },
        tasks: [],
      },
    },
  });

  const claimed = await farmer.claimDailyStreak();

  assert.equal(claimed, false);
  assert.equal(
    farmer.api.calls.filter((call) => call.url.includes("tk2")).length,
    0,
    "the claim endpoint must not be called when the streak is not ready",
  );
});

test("the wallet is checked before it is connected", async () => {
  const { farmer } = makeFarmer({
    "POST https://lootvault.lol/vx/wc3": { ok: true, d: { available: true, own: false } },
    "POST https://lootvault.lol/vx/w6": { ok: true, d: { addr: WALLET } },
  });

  const result = await farmer.connectWallet(WALLET);

  assert.equal(result, true);
  assert.deepEqual(
    farmer.api.calls.map((call) => call.url),
    ["https://lootvault.lol/vx/wc3", "https://lootvault.lol/vx/w6"],
  );
  assert.deepEqual(farmer.api.calls[0].body, { addr: WALLET });
});

test("a wallet bound to another account is not connected", async () => {
  const { farmer } = makeFarmer({
    "POST https://lootvault.lol/vx/wc3": { ok: true, d: { available: false, own: false } },
  });

  const result = await farmer.connectWallet(WALLET);

  assert.equal(result, false);
  assert.equal(
    farmer.api.calls.filter((call) => call.url.includes("/vx/w6")).length,
    0,
    "an unavailable wallet must not reach the connect endpoint",
  );
});

test("the connected wallet is remembered", async () => {
  const store = new Map();
  const { farmer } = makeFarmer({
    "POST https://lootvault.lol/vx/wc3": { ok: true, d: { available: true, own: false } },
    "POST https://lootvault.lol/vx/w6": { ok: true, d: { addr: WALLET } },
  });

  farmer.storage = {
    get: async (key) => store.get(key),
    set: async (key, value) => store.set(key, value),
  };

  await farmer.connectWallet(WALLET);

  assert.equal(await farmer.getWalletAddress(), WALLET);
});

test("the wallet connection is offered as a tool", () => {
  const { farmer } = makeFarmer({});

  const tools = farmer.createTools();
  const wallet = tools.find((group) => group.name === "Wallet");

  assert.ok(wallet, "there is no Wallet tool group");
  assert.equal(wallet.list[0].id, "connect-wallet");
  assert.equal(typeof wallet.list[0].action, "function");
});

test("the streak message says when the next claim unlocks", async () => {
  const { farmer, logger } = makeFarmer({
    "GET https://lootvault.lol/vx/a0": { ok: true, d: ACCOUNT },
    "GET https://lootvault.lol/vx/tk1": {
      ok: true,
      d: {
        streak: {
          currentDay: 1,
          nextDay: 2,
          nextReward: 25,
          canClaim: false,
          cooldownMs: 83_878_815,
          expiresInMs: 170_277_815,
        },
        tasks: [],
      },
    },
  });

  await farmer.claimDailyStreak();

  const text = logger.lines.map((line) => line.args.join(" ")).join("\n");
  assert.match(text, /unlocks in 23\.3h/, "the log should say how long is left");
});

test("a streak that lapses before it unlocks is flagged", async () => {
  const { farmer, logger } = makeFarmer({
    "GET https://lootvault.lol/vx/a0": { ok: true, d: ACCOUNT },
    "GET https://lootvault.lol/vx/tk1": {
      ok: true,
      d: {
        streak: {
          currentDay: 9,
          nextDay: 10,
          nextReward: 190,
          canClaim: false,
          /* The streak lapses in 2h but the claim only unlocks in 24h. */
          cooldownMs: 86_400_000,
          expiresInMs: 7_200_000,
        },
        tasks: [],
      },
    },
  });

  await farmer.claimDailyStreak();

  const warnings = logger.lines
    .filter((line) => line.level === "warn")
    .map((line) => line.args.join(" "))
    .join("\n");

  assert.match(warnings, /lapses in 2\.0h/, "a lapsing streak must be warned about");
});

/* --------------------------------------------------------------------- */
/* Registration                                                          */
/* --------------------------------------------------------------------- */

const UNREGISTERED = {
  registered: false,
  isAdmin: false,
  maintenance: false,
};

const CHALLENGE = { id: "18ad93f0f2b2c050cd09d5cc74e42a72", q: "1 - 5", type: "slider" };

/** A farmer that already has a wallet address bound. */
function makeWalletFarmer(routes) {
  const made = makeFarmer(routes);
  const store = new Map([["wallet", { address: WALLET }]]);
  made.farmer.storage = {
    get: async (key) => store.get(key),
    set: async (key, value) => store.set(key, value),
  };
  return made;
}

test("the slider captcha is solved with the gesture the app sends", async () => {
  const { farmer, delays } = makeFarmer({
    "POST https://lootvault.lol/vx/cp1": { ok: true, d: CHALLENGE },
    "POST https://lootvault.lol/vx/cp2": { ok: true, d: { token: "tok-1" } },
  });

  const token = await farmer.solveSliderCaptcha();

  assert.equal(token, "tok-1");

  const body = farmer.api.calls.find((call) => call.url.includes("/vx/cp2")).body;

  assert.equal(body.id, CHALLENGE.id);
  assert.equal(body.slide, true);

  /* The gestures the HAR captured ran 801-1646ms over 71-113 moves — about
     one move every 11-15ms. The replay has to sit in that band. */
  assert.ok(
    body.duration >= 800 && body.duration <= 1650,
    `duration ${body.duration} is outside the observed band`,
  );
  assert.ok(
    body.moves >= 40 && body.moves <= 160,
    `moves ${body.moves} is outside the observed band`,
  );
  const perMove = body.duration / body.moves;
  assert.ok(
    perMove >= 11 && perMove <= 15,
    `${perMove.toFixed(1)}ms per move is not a human gesture`,
  );

  /* The reported duration is the time the drag actually took. */
  assert.equal(delays.at(-1), body.duration);
});

test("a captcha the app does not use is refused", async () => {
  const { farmer } = makeFarmer({
    "POST https://lootvault.lol/vx/cp1": {
      ok: true,
      d: { id: "x", q: "1 + 7", type: "text" },
    },
  });

  await assert.rejects(() => farmer.solveSliderCaptcha(), /captcha type: text/);
});

test("registration follows the app's own call order", async () => {
  const { farmer } = makeWalletFarmer({
    "POST https://lootvault.lol/vx/cp1": { ok: true, d: CHALLENGE },
    "POST https://lootvault.lol/vx/cp2": { ok: true, d: { token: "tok-1" } },
    "POST https://lootvault.lol/vx/wc3": { ok: true, d: { available: true, own: false } },
    "POST https://lootvault.lol/vx/a1": { ok: true, d: { id: 2539, n: "Paul" } },
  });

  await farmer.register();

  assert.deepEqual(
    farmer.api.calls.map((call) => call.url),
    [
      "https://lootvault.lol/vx/cp1",
      "https://lootvault.lol/vx/cp2",
      "https://lootvault.lol/vx/wc3",
      "https://lootvault.lol/vx/a1",
    ],
    "registration must run captcha, then the wallet check, then the register",
  );

  assert.deepEqual(farmer.api.calls.at(-1).body, {
    captchaToken: "tok-1",
    addr: WALLET,
    termsAccepted: true,
  });
});

test("registration refuses a wallet bound to another account", async () => {
  const { farmer } = makeWalletFarmer({
    "POST https://lootvault.lol/vx/cp1": { ok: true, d: CHALLENGE },
    "POST https://lootvault.lol/vx/cp2": { ok: true, d: { token: "tok-1" } },
    "POST https://lootvault.lol/vx/wc3": { ok: true, d: { available: false, own: false } },
  });

  await assert.rejects(() => farmer.register(), /another account/);

  assert.equal(
    farmer.api.calls.filter((call) => call.url.includes("/vx/a1")).length,
    0,
    "a taken wallet must not reach the register endpoint",
  );
});

test("registration without a wallet says what it needs", async () => {
  const { farmer } = makeFarmer({
    "POST https://lootvault.lol/vx/cp1": { ok: true, d: CHALLENGE },
  });

  await assert.rejects(() => farmer.register(), /wallet address/i);

  assert.equal(
    farmer.api.calls.length,
    0,
    "no captcha should be burned when there is no address to register",
  );
});

test("the run registers an unregistered account before claiming", async () => {
  let registered = false;

  const { farmer } = makeWalletFarmer({
    "GET https://lootvault.lol/vx/a0": () => ({
      ok: true,
      d: { ...UNREGISTERED, registered },
    }),
    "POST https://lootvault.lol/vx/cp1": { ok: true, d: CHALLENGE },
    "POST https://lootvault.lol/vx/cp2": { ok: true, d: { token: "tok-1" } },
    "POST https://lootvault.lol/vx/wc3": { ok: true, d: { available: true, own: false } },
    "POST https://lootvault.lol/vx/a1": () => {
      registered = true;
      return { ok: true, d: { id: 2539, n: "Paul" } };
    },
    "GET https://lootvault.lol/vx/tk1": { ok: true, d: STREAK_CLAIMABLE },
    "POST https://lootvault.lol/vx/tk2/streak": {
      ok: true,
      d: {
        claimedDay: 1,
        reward: 15,
        boxesCount: 0,
        partsCount: 0,
        droppedItems: [],
        newBalance: "15000000000",
        streakStatus: { currentDay: 1, nextDay: 2, canClaim: false },
      },
    },
  });

  await farmer.process();

  const urls = farmer.api.calls.map((call) => call.url);
  const registerAt = urls.indexOf("https://lootvault.lol/vx/a1");
  const claimAt = urls.indexOf("https://lootvault.lol/vx/tk2/streak");

  assert.ok(registerAt > -1, "the account was never registered");
  assert.ok(claimAt > registerAt, "the streak must be claimed after registering");
});

/* --------------------------------------------------------------------- */
/* Task rewards                                                          */
/* --------------------------------------------------------------------- */

const CHANNEL_TASK = {
  id: 1,
  category: "social",
  title: "Subscribe to the Telegram channel",
  reward: 250,
  link: "https://t.me/lootvault_channel",
  checkType: "tg_channel",
  checkParam: "@lootvault_channel",
  status: "new",
};

const REFERRAL_TASK = {
  id: 4,
  category: "partners",
  title: "Invite 3 active friends",
  reward: 250,
  link: "",
  checkType: "active_referrals",
  checkParam: "3",
  status: "new",
  progress: { current: 0, target: 3 },
};

test("a telegram task is joined, started and then claimed", async () => {
  const { farmer } = makeFarmer({
    "GET https://lootvault.lol/vx/tk1": {
      ok: true,
      d: { streak: STREAK_CLAIMABLE.streak, tasks: [CHANNEL_TASK] },
    },
    "POST https://lootvault.lol/vx/tk2/start": { ok: true, d: { started: true } },
    "POST https://lootvault.lol/vx/tk2/claim": { ok: true, d: { reward: 250 } },
  });

  farmer.tryToJoinTelegramLink = async (link) => {
    farmer.joined = link;
    return true;
  };

  const claimed = await farmer.claimTasks();

  assert.equal(claimed, 1);
  assert.equal(farmer.joined, CHANNEL_TASK.link, "the channel was never joined");

  assert.deepEqual(
    farmer.api.calls.map((call) => call.url),
    [
      "https://lootvault.lol/vx/tk1",
      "https://lootvault.lol/vx/tk2/start",
      "https://lootvault.lol/vx/tk2/claim",
    ],
  );

  assert.deepEqual(farmer.api.calls[1].body, { taskId: 1 });
  assert.deepEqual(farmer.api.calls[2].body, { taskId: 1 });
});

test("a task the account cannot satisfy is left alone", async () => {
  const { farmer } = makeFarmer({
    "GET https://lootvault.lol/vx/tk1": {
      ok: true,
      d: { streak: STREAK_CLAIMABLE.streak, tasks: [REFERRAL_TASK] },
    },
  });

  const claimed = await farmer.claimTasks();

  assert.equal(claimed, 0);
  assert.equal(
    farmer.api.calls.length,
    1,
    "a referral task must not reach the claim endpoint",
  );
});

test("a task that is already ready is claimed without starting it", async () => {
  const { farmer } = makeFarmer({
    "GET https://lootvault.lol/vx/tk1": {
      ok: true,
      d: {
        streak: STREAK_CLAIMABLE.streak,
        tasks: [{ ...CHANNEL_TASK, status: "ready" }],
      },
    },
    "POST https://lootvault.lol/vx/tk2/claim": { ok: true, d: { reward: 250 } },
  });

  const claimed = await farmer.claimTasks();

  assert.equal(claimed, 1);
  assert.deepEqual(
    farmer.api.calls.map((call) => call.url),
    ["https://lootvault.lol/vx/tk1", "https://lootvault.lol/vx/tk2/claim"],
  );
});

test("a task already claimed is not claimed twice", async () => {
  const { farmer } = makeFarmer({
    "GET https://lootvault.lol/vx/tk1": {
      ok: true,
      d: {
        streak: STREAK_CLAIMABLE.streak,
        tasks: [{ ...CHANNEL_TASK, status: "claimed" }],
      },
    },
  });

  assert.equal(await farmer.claimTasks(), 0);
  assert.equal(farmer.api.calls.length, 1);
});

test("a claim the server refuses is reported, not thrown", async () => {
  const { farmer, logger } = makeFarmer({
    "GET https://lootvault.lol/vx/tk1": {
      ok: true,
      d: { streak: STREAK_CLAIMABLE.streak, tasks: [CHANNEL_TASK] },
    },
    "POST https://lootvault.lol/vx/tk2/start": { ok: true, d: { started: true } },
    "POST https://lootvault.lol/vx/tk2/claim": {
      ok: false,
      msg: "Task conditions are not met",
    },
  });

  farmer.tryToJoinTelegramLink = async () => true;

  const claimed = await farmer.claimTasks();

  assert.equal(claimed, 0);

  const text = logger.lines.map((line) => line.args.join(" ")).join("\n");
  assert.match(text, /conditions are not met/);
});

test("the wallet tool saves the address for an account that is not registered", async () => {
  const { farmer } = makeFarmer({
    "GET https://lootvault.lol/vx/a0": { ok: true, d: UNREGISTERED },
  });

  farmer.promptInput = async () => WALLET;

  await farmer.connectWalletInteractive();

  /* The account does not exist server-side yet, so there is nothing to bind
     to — but the address has to be kept for the registration to use. */
  assert.equal(
    farmer.api.calls.filter((call) => call.url.includes("/vx/w6")).length,
    0,
    "an unregistered account has no wallet to bind yet",
  );
  assert.equal(await farmer.getWalletAddress(), WALLET);
});

test("registration asks for the wallet address when it has none", async () => {
  const { farmer } = makeFarmer({
    "POST https://lootvault.lol/vx/cp1": { ok: true, d: CHALLENGE },
    "POST https://lootvault.lol/vx/cp2": { ok: true, d: { token: "tok-1" } },
    "POST https://lootvault.lol/vx/wc3": { ok: true, d: { available: true, own: false } },
    "POST https://lootvault.lol/vx/a1": { ok: true, d: { id: 2539, n: "Paul" } },
  });

  const asked = [];
  farmer.promptInput = async (question) => {
    asked.push(question);
    return WALLET;
  };

  await farmer.register();

  assert.equal(asked.length, 1, "the farmer never asked for an address");
  assert.match(asked[0], /wallet address/i);

  /* The address is kept, so the next run does not ask again. */
  assert.equal(await farmer.getWalletAddress(), WALLET);
});

test("registration without an address and without a way to ask is refused", async () => {
  const { farmer } = makeFarmer({
    "POST https://lootvault.lol/vx/cp1": { ok: true, d: CHALLENGE },
  });

  await assert.rejects(() => farmer.register(), /wallet address/i);

  assert.equal(
    farmer.api.calls.length,
    0,
    "no captcha should be burned when there is no address to register",
  );
});

test("a cancelled request is not reported as a wallet failure", async () => {
  const { farmer, logger } = makeFarmer({
    "POST https://lootvault.lol/vx/wc3": () => {
      const error = new Error("canceled");
      error.code = "ERR_CANCELED";
      throw error;
    },
  });

  const result = await farmer.connectWallet(WALLET);

  assert.equal(result, false);

  const warnings = logger.lines
    .filter((line) => line.level === "warn")
    .map((line) => line.args.join(" "))
    .join("\n");

  assert.equal(
    warnings,
    "",
    "a cancelled run must not report a wallet failure",
  );
});

test("the referral link keeps the mini-app, not just the bot", () => {
  const { farmer } = makeFarmer({});

  const link = farmer.getReferralLink();

  /* Without the /app short name the link opens the bot's chat, and the
     mini-app never opens at all. */
  assert.match(link, /^https:\/\/t\.me\/LootVaultDexBot\/app\?/);

  /* The app reads the referral from the mini-app's start_param, so it has to
     travel as startapp. */
  assert.match(link, /startapp=ref_7889826576/);
});

test("the run verifies, reports and claims the daily streak", async () => {
  const { farmer } = makeFarmer({
    "GET https://lootvault.lol/vx/a0": { ok: true, d: ACCOUNT },
    "GET https://lootvault.lol/vx/d2": {
      ok: true,
      d: { b: "0", r: "25000000000", lm: 1_792_434_950_090, ts: 1_792_434_950_090 },
    },
    "GET https://lootvault.lol/vx/tk1": { ok: true, d: STREAK_CLAIMABLE },
    "POST https://lootvault.lol/vx/tk2/streak": {
      ok: true,
      d: {
        claimedDay: 1,
        reward: 15,
        boxesCount: 0,
        partsCount: 0,
        droppedItems: [],
        newBalance: "15000000000",
        streakStatus: { currentDay: 1, nextDay: 2, canClaim: false },
      },
    },
  });

  await farmer.process();

  const urls = farmer.api.calls.map((call) => call.url);
  assert.deepEqual(urls, [
    "https://lootvault.lol/vx/a0",
    "https://lootvault.lol/vx/d2",
    "https://lootvault.lol/vx/a0",
    "https://lootvault.lol/vx/tk1",
    "https://lootvault.lol/vx/tk2/streak",
    "https://lootvault.lol/vx/tk1",
  ]);
});
