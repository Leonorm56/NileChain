/**
 * Contract + logic harness for ArtFarmer.
 *
 * The transport is stubbed and the fixtures are the exact payloads captured in
 * `test/art.har` and `test/artwallet.har`, so every assertion below is a check
 * against what the live app really sends — including the urls, the
 * `X-Telegram-Init-Data` header, the JSON bodies and the order of the mining
 * calls. Nothing here touches the network or any real account.
 *
 * Run: node packages/shared/verify-art-farmer.mjs
 */
import ArtFarmer from "./farmers/ArtFarmer.js";

const UID = "6627962056";

/* ------------------------------------------------------------------ */
/* Fixtures (verbatim from the captures)                               */
/* ------------------------------------------------------------------ */

const USER = {
  id: UID,
  username: "leonaidas247",
  firstName: "Leo",
  role: "USER",
  level: 1,
  holdingWallet: 0,
  poolWallet: 190,
  todayPnl: 40,
  allTimeMined: 40,
  tonWalletAddress: "UQDSH2p9qTIVaJH0doIw7C75fQ5jc45vyRvanSmH6dgNIPgS",
  isVerified: true,
  miningStartedAt: 1789729768987,
  lastClaimedAt: 1789729765814,
  unlockedMiners: [1],
  completedTaskIds: ["task-a"],
  referredBy: "7466223274",
  adsWatchedCount: 0,
  adsPeriodStart: null,
  createdAt: "2026-09-16T14:43:58.746Z",
  isAdmin: false,
};

const SETTINGS = {
  tokenSymbol: "ART",
  atfPriceUsd: 0.0032,
  baseMiningSpeedTh: 0.2,
  miningCycleHours: 8,
  minWithdrawAtf: 800,
  adsEnabled: true,
  adsDailyLimit: 5,
  adsRewardAtf: 10,
};

const MINING_RUNNING = {
  isMining: true,
  elapsedSeconds: 20,
  totalDurationSeconds: 28800,
  accumulatedAtf: 0.0278,
  currentSpeedTh: 0.2,
  remainingSeconds: 28780,
  hourlyRate: 5,
};

const MINING_CLOSED = {
  isMining: false,
  elapsedSeconds: 0,
  totalDurationSeconds: 28800,
  accumulatedAtf: 40,
  currentSpeedTh: 0.2,
  remainingSeconds: 28800,
  hourlyRate: 5,
};

const TASKS = [
  {
    id: "task-a",
    title: "ART Telegram Channel",
    rewardAtf: 10,
    actionUrl: "https://t.me/ART_AIRDROP",
    category: "general",
    isActive: true,
    isCompleted: true,
  },
  {
    id: "task-b",
    title: "subscribe youtube",
    rewardAtf: 10,
    actionUrl: "https://youtube.com/@art_mining_yt",
    category: "general",
    isActive: true,
    isCompleted: false,
  },
  {
    id: "task-c",
    title: "ART (SPONSER V3)",
    rewardAtf: 10,
    actionUrl: "https://t.me/milonOFFICIALEARN",
    category: "general",
    isActive: true,
    isCompleted: false,
  },
];

/* ------------------------------------------------------------------ */
/* Stubbed transport                                                   */
/* ------------------------------------------------------------------ */

const INIT_DATA = "TESTINIT";
const calls = [];
let adRemaining = 5;

function route(method, url, body) {
  const path = url.replace("https://art.tamimdev.dev/api", "").split("?")[0];

  if (method === "GET" && /^\/user\/[^/]+$/.test(path)) {
    return {
      user: { ...USER },
      settings: { ...SETTINGS },
      miningState: { ...MINING_RUNNING },
      unlockedCount: 1,
    };
  }
  if (method === "GET" && path === "/miners") return { miners: [] };
  if (method === "GET" && path === `/tasks/${UID}`) {
    return { tasks: TASKS.map((task) => ({ ...task })) };
  }
  if (method === "GET" && path === `/ads/status/${UID}`) {
    return {
      enabled: true,
      watched: 5 - adRemaining,
      limit: 5,
      remaining: adRemaining,
      rewardAtf: 10,
      resetsInSeconds: 86400,
    };
  }
  if (method === "GET" && path === `/referrals/${UID}`) {
    return { inviteLink: `https://t.me/ART_AIRDROP_BOT?start=${UID}` };
  }
  if (method === "POST" && path === "/user/claim-mining") {
    return {
      success: true,
      claimedAtf: 40,
      user: { ...USER },
      miningState: { ...MINING_CLOSED, accumulatedAtf: 0 },
    };
  }
  if (method === "POST" && path === "/user/start-mining") {
    return {
      success: true,
      user: { ...USER },
      miningState: { ...MINING_RUNNING },
    };
  }
  if (method === "POST" && path === "/ads/claim") {
    adRemaining -= 1;
    return {
      success: true,
      reward: 10,
      watched: 5 - adRemaining,
      limit: 5,
      remaining: adRemaining,
      rewardAtf: 10,
      enabled: true,
      resetsInSeconds: 86000,
      user: { ...USER },
    };
  }
  if (method === "POST" && path === "/tasks/claim") {
    return { success: true, reward: 10, message: "+10 ART", user: { ...USER } };
  }
  if (method === "POST" && path === "/user/connect-wallet") {
    return {
      success: true,
      user: { ...USER, tonWalletAddress: body.tonAddress },
      tonWalletAddress: body.tonAddress,
    };
  }
  if (method === "POST" && path === "/user/disconnect-wallet") {
    return { success: true, user: { ...USER, tonWalletAddress: null } };
  }
  return { unexpected: path };
}

const api = {
  get: async (url, config) => {
    calls.push({ method: "GET", url, config });
    return { data: route("GET", url) };
  },
  post: async (url, body, config) => {
    calls.push({ method: "POST", url, body, config });
    return { data: route("POST", url, body) };
  },
};

const logs = [];
const logger = {
  newline: () => logs.push(""),
  log: (m) => logs.push(String(m)),
  info: (m) => logs.push(`INFO ${m}`),
  success: (m) => logs.push(`OK ${m}`),
  warn: (m) => logs.push(`WARN ${m}`),
  error: (m) => logs.push(`ERR ${m}`),
  keyValue: (k, v) => logs.push(`KV ${k} = ${v}`),
  c: {
    magenta: (s) => s,
    green: (s) => s,
    red: (s) => s,
    gray: (s) => s,
    yellow: (s) => s,
  },
};

const store = {};
const storage = {
  get: async (key) => store[key],
  set: async (key, value) => {
    store[key] = value;
  },
  remove: async (key) => {
    delete store[key];
  },
};

function makeFarmer() {
  const farmer = new ArtFarmer();
  farmer.setApi(api);
  farmer.setLogger(logger);
  /* `setStorage` is added by the framework subclass, not by BaseFarmer. */
  farmer.storage = storage;
  farmer.setTelegramWebApp({
    initData: INIT_DATA,
    initDataUnsafe: {
      user: {
        id: 6627962056,
        username: "leonaidas247",
        first_name: "Leo",
        last_name: "",
      },
      start_param: "7466223274",
    },
  });
  /* Skip the real inter-request delays. */
  farmer.utils = { ...farmer.utils, delayForSeconds: async () => {} };
  farmer.signal = undefined;
  return farmer;
}

let pass = 0;
let fail = 0;
const check = (label, condition, detail = "") => {
  if (condition) {
    pass += 1;
    console.log(`  PASS  ${label}`);
  } else {
    fail += 1;
    console.log(`  FAIL  ${label}${detail ? `  <- ${detail}` : ""}`);
  }
};
const posts = () => calls.filter((call) => call.method === "POST");

/* ------------------------------------------------------------------ */
/* A. login + logging                                                  */
/* ------------------------------------------------------------------ */

console.log("\n=== A. login parses the live account shape ===");
{
  calls.length = 0;
  const farmer = makeFarmer();
  await farmer.login();
  farmer.logUserInfo();

  check("user_data populated", farmer.user_data.id === UID);
  check("mining_state populated", farmer.mining_state.isMining === true);
  check("settings captured", farmer.settings_data.tokenSymbol === "ART");
  check(
    "request is absolute (the api instance has no baseURL)",
    calls[0].url.startsWith(`https://art.tamimdev.dev/api/user/${UID}`),
    calls[0].url,
  );
  check(
    "init data sent as X-Telegram-Init-Data",
    calls[0].config.headers["X-Telegram-Init-Data"] === INIT_DATA,
    JSON.stringify(calls[0].config.headers),
  );
  check(
    "first-run params carry username + referredBy",
    calls[0].url.includes("username=leonaidas247") &&
      calls[0].url.includes("referredBy=7466223274"),
    calls[0].url,
  );
  check(
    "log surfaces the wallet and the live mining state",
    logs.some((line) => line.startsWith("KV Payout Wallet")) &&
      logs.some((line) => line.includes("running")),
    logs.filter((line) => line.startsWith("KV")).join(" | "),
  );
}

/* ------------------------------------------------------------------ */
/* B/C. mining                                                         */
/* ------------------------------------------------------------------ */

console.log("\n=== B. mining: a live cycle is left alone ===");
{
  calls.length = 0;
  const farmer = makeFarmer();
  await farmer.login();
  await farmer.syncMining();
  check(
    "no claim and no restart while the cycle is running",
    posts().length === 0,
    posts().map((call) => call.url).join(", "),
  );
}

console.log("\n=== C. mining: a closed cycle is claimed then restarted ===");
{
  calls.length = 0;
  const farmer = makeFarmer();
  await farmer.login();
  farmer.mining_state = { ...MINING_CLOSED };
  await farmer.syncMining();

  const order = posts().map((call) => call.url.split("/api")[1]);
  check(
    "claim-mining before start-mining",
    order[0] === "/user/claim-mining" && order[1] === "/user/start-mining",
    order.join(" -> "),
  );
  check(
    "claim body is { userId }",
    calls.find((call) => call.url.endsWith("/user/claim-mining")).body
      .userId === UID,
  );
  check(
    "start body is { userId }",
    calls.find((call) => call.url.endsWith("/user/start-mining")).body
      .userId === UID,
  );
}

/* ------------------------------------------------------------------ */
/* D. ads                                                              */
/* ------------------------------------------------------------------ */

console.log("\n=== D. ads: drains exactly the reported budget ===");
{
  calls.length = 0;
  adRemaining = 5;
  const farmer = makeFarmer();
  await farmer.login();
  await farmer.watchAds();

  const claims = calls.filter((call) => call.url.endsWith("/api/ads/claim"));
  check("5 claims for remaining=5", claims.length === 5, `got ${claims.length}`);
  check(
    "body is { userId } only - no ad proof exists to send",
    claims.every(
      (call) => JSON.stringify(call.body) === JSON.stringify({ userId: UID }),
    ),
    JSON.stringify(claims[0].body),
  );
  check("stops once remaining hits 0", adRemaining === 0);
}

console.log("\n=== D2. ads: an exhausted budget makes no calls ===");
{
  calls.length = 0;
  adRemaining = 0;
  const farmer = makeFarmer();
  await farmer.login();
  await farmer.watchAds();
  check("no claims when remaining=0", posts().length === 0);
}

/* ------------------------------------------------------------------ */
/* E. tasks                                                            */
/* ------------------------------------------------------------------ */

console.log("\n=== E. tasks: only unfinished, active tasks ===");
{
  calls.length = 0;
  const farmer = makeFarmer();
  await farmer.login();
  await farmer.completeTasks();

  const claims = calls.filter((call) => call.url.endsWith("/api/tasks/claim"));
  const ids = claims.map((call) => call.body.taskId).sort();
  check(
    "claims the 2 pending tasks and skips the completed one",
    JSON.stringify(ids) === JSON.stringify(["task-b", "task-c"]),
    JSON.stringify(ids),
  );
  check(
    "body is { userId, taskId }",
    claims[0].body.userId === UID && typeof claims[0].body.taskId === "string",
    JSON.stringify(claims[0].body),
  );
}

/* ------------------------------------------------------------------ */
/* F/G. wallet                                                         */
/* ------------------------------------------------------------------ */

console.log("\n=== F. wallet: collect the address the account has on file ===");
{
  calls.length = 0;
  delete store.wallet;
  const farmer = makeFarmer();
  await farmer.login();
  const collected = await farmer.collectWallet();

  check(
    "returns the on-file address",
    collected === USER.tonWalletAddress,
    String(collected),
  );
  check(
    "persists it under this account's wallet key",
    store.wallet?.address === USER.tonWalletAddress,
    JSON.stringify(store.wallet),
  );
  check(
    "records the owning userId + a timestamp",
    store.wallet.userId === 6627962056 && Boolean(store.wallet.collectedAt),
    JSON.stringify(store.wallet),
  );
  check("collection is read-only", posts().length === 0);
}

console.log("\n=== G. wallet: linking an address ===");
{
  calls.length = 0;
  delete store.wallet;
  const farmer = makeFarmer();
  await farmer.login();
  const address = "UQCBV-LC5D-7UjN9uhueLEyx0R4nNGmEcUu8FigLp04vJ4dL";
  const linked = await farmer.linkWallet(address);

  const call = calls.find((c) => c.url.endsWith("/api/user/connect-wallet"));
  check("POSTs /user/connect-wallet", Boolean(call));
  check(
    "body is { userId, tonAddress }",
    call?.body.userId === UID && call?.body.tonAddress === address,
    JSON.stringify(call?.body),
  );
  check(
    "surfaces success and stores the address",
    linked === true && store.wallet.address === address,
  );
}

console.log("\n=== G2. wallet: ensureWallet keeps an already-linked account ===");
{
  calls.length = 0;
  delete store.wallet;
  const farmer = makeFarmer();
  await farmer.login();
  const ok = await farmer.ensureWallet();
  check("reports the wallet as connected", ok === true);
  check("collects it without re-linking", posts().length === 0);
  check("stored the on-file address", store.wallet.address === USER.tonWalletAddress);
}

/* ------------------------------------------------------------------ */
/* H. guards + shape                                                   */
/* ------------------------------------------------------------------ */

console.log("\n=== H. guards ===");
{
  const farmer = makeFarmer();
  farmer.setTelegramWebApp({ initData: "", initDataUnsafe: {} });
  let guarded = false;
  try {
    farmer.getAccountId();
  } catch (error) {
    guarded = /No Telegram user id/.test(error.message);
  }
  check("getAccountId throws without a mini-app session", guarded);
}

console.log("\n=== I. every request carried the init-data header ===");
check(
  "unanimous across all recorded calls",
  calls.every(
    (call) => call.config?.headers["X-Telegram-Init-Data"] === INIT_DATA,
  ),
  `${calls.length} calls`,
);

console.log("\n=== J. declaration + referral link ===");
{
  const farmer = makeFarmer();
  check("id", ArtFarmer.id === "art");
  check("host", ArtFarmer.host === "art.tamimdev.dev");
  check(
    "referral link is this account's own",
    farmer.getReferralLink() === `https://t.me/ART_AIRDROP_BOT?start=${UID}`,
    farmer.getReferralLink(),
  );
  const groups = farmer.tools.map((group) => group.name);
  check(
    "tool groups: Wallet / Mining / Ads / Tasks",
    JSON.stringify(groups) ===
      JSON.stringify(["Wallet", "Mining", "Ads", "Tasks"]),
    JSON.stringify(groups),
  );
  const walletTools = farmer.tools
    .find((group) => group.name === "Wallet")
    .list.map((tool) => tool.id);
  check(
    "Wallet group offers connect / collect / disconnect",
    JSON.stringify(walletTools) ===
      JSON.stringify(["connect-wallet", "collect-wallet", "disconnect-wallet"]),
    JSON.stringify(walletTools),
  );
  const collect = farmer.tools
    .find((group) => group.name === "Wallet")
    .list.find((tool) => tool.id === "collect-wallet");
  check("Collect Wallet mirrors across accounts", collect.dispatch === true);
}

/* ------------------------------------------------------------------ */

console.log("\n---------------------------------------------");
console.log(`RESULT: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
