import * as assert from "node:assert";
import { test } from "node:test";

import RigniteFarmer from "@nile/shared/farmers/RigniteFarmer.js";

/** Anything chalk-ish the logger hands out. */
const inertChain = new Proxy(function () {}, {
  get: () => inertChain,
  apply: (_self, _this, args) => args[0] ?? "",
});

function recordingLogger() {
  const lines = [];
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
    chalk: inertChain,
    c: inertChain,
  };
}

/**
 * The ad-watch log is mirrored in a module-level Map keyed by user id, so every
 * test takes a fresh id — otherwise one test's watches would throttle the next.
 */
let nextUserId = 9000000000;
function uniqueUserId() {
  nextUserId += 1;
  return nextUserId;
}

/**
 * The watch log is deduped by timestamp, so two watches inside the same
 * millisecond collapse into one. Real watches are 10–15s apart; the tests move
 * the clock the same way instead of recording instantaneously.
 */
const REAL_NOW = Date.now;

function fakeClock() {
  let now = REAL_NOW();
  return {
    install: () => {
      Date.now = () => now;
    },
    restore: () => {
      Date.now = REAL_NOW;
    },
    advance: (ms) => {
      now += ms;
    },
  };
}

const WATCH_MS = 20_000;

/**
 * A farmer whose ad flow is fully scripted: intent/complete/getMe never touch
 * the network, so the only thing under test is the budget gate in front of them.
 */
function makeAdFarmer(t, { userData = {}, watchedKey } = {}) {
  const farmer = new RigniteFarmer();
  const logger = recordingLogger();
  const calls = { intent: [], complete: 0, me: 0 };
  const store = new Map();
  const userId = watchedKey ?? uniqueUserId();
  const clock = fakeClock();
  clock.install();
  t.after(() => clock.restore());

  farmer.logger = logger;
  farmer.getUserId = () => userId;
  farmer.storage = {
    get: async (key) => store.get(key),
    set: async (key, value) => void store.set(key, value),
  };
  farmer.signal = { aborted: false };
  farmer.utils = { delay: async () => {} };
  farmer.getUserRandomGenerator = () => () => 0;
  farmer.user_data = {
    energy: 0,
    maxEnergy: 6500,
    batteryEnergy: 0,
    batteryCap: 490030,
    ...userData,
  };
  farmer.adIntent = async (type) => {
    calls.intent.push(type);
    return { ok: true };
  };
  farmer.adComplete = async () => {
    calls.complete += 1;
    return { ok: true };
  };
  farmer.getMe = async () => {
    calls.me += 1;
    return { energy: 6500, maxEnergy: 6500 };
  };

  return {
    farmer,
    logger,
    calls,
    clock,
    /** Seed `n` completed watches in the current rolling hour. */
    seed: async (n) => {
      for (let i = 0; i < n; i += 1) {
        clock.advance(WATCH_MS);
        await farmer.recordAdWatch();
      }
    },
  };
}

test("two watches in the hour no longer retire the energy ad", async (t) => {
  const { farmer, calls, seed, clock } = makeAdFarmer(t);
  await seed(2);
  clock.advance(WATCH_MS);

  await farmer.watchFullEnergyAd();

  assert.deepStrictEqual(
    calls.intent,
    ["full_energy"],
    "the game's own remaining count, not our old 2/hour tally, decides whether to ask",
  );
});

test("the hourly ceiling stops the account at six watches", async (t) => {
  const { farmer, calls, seed } = makeAdFarmer(t);
  await seed(6);

  assert.strictEqual(await farmer.adsLeftThisHour(), 0, "six watches fill the hour");

  await farmer.watchFullEnergyAd();

  assert.deepStrictEqual(calls.intent, [], "a spent hour must not call the ad API");
});

test("the ceiling is per account, not shared across the fleet", async (t) => {
  const spent = makeAdFarmer(t);
  await spent.seed(6);

  const fresh = makeAdFarmer(t);

  assert.strictEqual(await spent.farmer.adsLeftThisHour(), 0);
  assert.strictEqual(
    await fresh.farmer.adsLeftThisHour(),
    6,
    "one account's spent budget must not silence another's",
  );
});

test("a server that reports no energy ads left is not asked", async (t) => {
  const { farmer, calls } = makeAdFarmer(t, { userData: { adEnergyLeft: 0 } });

  await farmer.watchFullEnergyAd();

  assert.deepStrictEqual(calls.intent, [], "adEnergyLeft 0 means ask nothing");
});

test("an account whose /me omits the field is still asked", async (t) => {
  const { farmer, calls } = makeAdFarmer(t, { userData: {} });

  await farmer.watchFullEnergyAd();

  assert.deepStrictEqual(
    calls.intent,
    ["full_energy"],
    "an unverified field must never be treated as zero, or the ad never runs",
  );
});

test("a server-reported count above zero still allows the ad", async (t) => {
  const { farmer, calls } = makeAdFarmer(t, { userData: { adEnergyLeft: 3 } });

  await farmer.watchFullEnergyAd();

  assert.deepStrictEqual(calls.intent, ["full_energy"]);
});

test("an already-full energy bar spends no watch", async (t) => {
  const { farmer, calls } = makeAdFarmer(t, { userData: { energy: 6500, maxEnergy: 6500 } });

  await farmer.watchFullEnergyAd();

  assert.deepStrictEqual(
    calls.intent,
    [],
    "a full bar would burn one of the hour's watches refilling nothing",
  );
});

test("an unknown max energy is not read as a full bar", async (t) => {
  const { farmer, calls } = makeAdFarmer(t, {
    userData: { energy: 6500, maxEnergy: undefined },
  });

  await farmer.watchFullEnergyAd();

  assert.deepStrictEqual(
    calls.intent,
    ["full_energy"],
    "a missing maxEnergy must not silently switch the ad off",
  );
});

test("only a completed watch consumes the hourly budget", async (t) => {
  const { farmer, calls, seed, clock } = makeAdFarmer(t);
  await seed(1);

  // The intent is refused, so nothing is watched and nothing is spent.
  farmer.adIntent = async () => ({ ok: false });
  clock.advance(WATCH_MS);
  await farmer.watchFullEnergyAd();

  assert.strictEqual(calls.complete, 0);
  assert.strictEqual(await farmer.adsLeftThisHour(), 5, "a refused ad costs no budget");

  // Now let it complete: that one is spent.
  farmer.adIntent = async (type) => {
    calls.intent.push(type);
    return { ok: true };
  };
  clock.advance(WATCH_MS);
  await farmer.watchFullEnergyAd();

  assert.strictEqual(await farmer.adsLeftThisHour(), 4, "a completed ad costs one");
});

test("the battery ad keeps its own daily quota alongside the hourly ceiling", async (t) => {
  const { farmer, calls } = makeAdFarmer(t, { userData: { batteryAdLeft: 0 } });

  await farmer.watchBatteryAd();

  assert.deepStrictEqual(calls.intent, [], "no battery ads left today means no call");
});
