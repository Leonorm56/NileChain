import * as assert from "node:assert";
import { test } from "node:test";

import RigniteFarmer from "@nile/shared/farmers/RigniteFarmer.js";

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

const text = (line) => String(line.args[0] ?? "");

function makeTapFarmer(t, { userData = {}, tap } = {}) {
  const farmer = new RigniteFarmer();
  const logger = recordingLogger();
  const calls = { tap: 0, boosts: 0, refills: 0 };

  farmer.logger = logger;
  farmer.signal = { aborted: false };
  farmer.utils = { delay: async () => {} };
  farmer.buyTapBoosts = async () => {
    calls.boosts += 1;
  };
  farmer.fullEnergy = async () => {
    calls.refills += 1;
    // Refills energy only — the battery stays low, so the pass has something
    // left to do and the assertions can tell a refill from an instant finish.
    return { energy: 500, maxEnergy: 6500, batteryEnergy: 100 };
  };
  farmer.tap =
    tap ??
    (async (count) => {
      calls.tap += 1;
      return { accepted: count, batteryEnergy: 490030, coins: count };
    });
  farmer.user_data = {
    batteryCap: 490030,
    batteryEnergy: 0,
    energy: 0,
    maxEnergy: 6500,
    coins: 0,
    multitapLevel: 5,
    fullEnergyLeft: 0,
    ...userData,
  };

  return { farmer, logger, calls };
}

test("a pass with no energy and no refills does not pay for boosts to find out", async (t) => {
  const { farmer, logger, calls } = makeTapFarmer(t, {
    userData: { energy: 1, fullEnergyLeft: 0 },
  });

  const taps = await farmer.tapUntilBatteryFull();

  assert.strictEqual(taps, 0, "an empty bar credits nothing");
  assert.strictEqual(calls.tap, 0, "no tap request is worth sending");
  assert.strictEqual(
    calls.boosts,
    0,
    "the boost chain must not run just to rediscover an empty energy bar",
  );
  assert.strictEqual(
    logger.lines.filter((line) => text(line).includes("No taps possible")).length,
    1,
    "the empty state is reported once, not twice",
  );
});

test("a pass with energy still taps", async (t) => {
  const { farmer, calls } = makeTapFarmer(t, { userData: { energy: 1000 } });

  const taps = await farmer.tapUntilBatteryFull();

  assert.ok(taps > 0, "energy on the bar means the pass taps");
  assert.ok(calls.tap > 0, "the tap API is called");
});

test("a free refill counts as something to tap with", async (t) => {
  const { farmer, calls } = makeTapFarmer(t, {
    userData: { energy: 0, fullEnergyLeft: 2 },
    tap: async (count) => ({ accepted: count, batteryEnergy: 490030, coins: count }),
  });

  const taps = await farmer.tapUntilBatteryFull();

  assert.ok(calls.refills > 0, "a free refill is spent rather than the pass giving up");
  assert.ok(taps > 0, "and the refilled energy becomes taps");
});

test("a battery that is already full needs no pass at all", async (t) => {
  const { farmer, calls } = makeTapFarmer(t, {
    userData: { energy: 6500, batteryEnergy: 490030 },
  });

  const taps = await farmer.tapUntilBatteryFull();

  assert.strictEqual(taps, 0);
  assert.strictEqual(calls.tap, 0);
  assert.strictEqual(calls.boosts, 0, "no taps to buy boosts for");
});

/** Every task `process()` runs, stubbed, with the order recorded. */
function makeCycleFarmer(t, { onPass } = {}) {
  const farmer = new RigniteFarmer();
  const logger = recordingLogger();
  const order = [];
  const counts = { taps: 0, boosts: 0 };

  farmer.logger = logger;
  farmer.signal = { aborted: false };
  farmer.utils = { delay: async () => {} };
  farmer.user_data = {
    batteryCap: 490030,
    batteryEnergy: 0,
    energy: 1000,
    maxEnergy: 6500,
    coins: 0,
    multitapLevel: 5,
    fullEnergyLeft: 0,
  };

  farmer.login = async () => {};
  farmer.ensureAdMode = async () => {};
  farmer.logUserInfo = async () => {};
  farmer.buyTapBoosts = async () => {
    counts.boosts += 1;
    order.push("boosts");
  };
  farmer.watchFullEnergyAd = async () => order.push("energy-ad");
  farmer.watchBatteryAd = async () => order.push("battery-ad");
  farmer.collectEverything = async () => order.push("collect");
  farmer.upgradeItems = async () => order.push("upgrades");
  farmer.completeQuests = async () => order.push("quests");
  farmer.claimRewards = async () => order.push("rewards");
  farmer.watchMilestoneAds = async () => order.push("ads");
  farmer.claimAdMilestones = async () => order.push("milestones");
  farmer.claimGifts = async () => order.push("gifts");
  farmer.tapUntilBatteryFull = async () => {
    counts.taps += 1;
    order.push("tap");
    onPass?.(farmer, counts.taps);
    return 1;
  };

  return { farmer, logger, order, counts };
}

test("a spent energy bar ends the tap passes after the first one", async (t) => {
  const { farmer, counts } = makeCycleFarmer(t, {
    // The bar was drained by the pass, and nothing refills it mid-cycle.
    onPass: (f) => {
      f.user_data.energy = 0;
    },
  });

  await farmer.process();

  assert.strictEqual(
    counts.taps,
    1,
    "six passes that can only report an empty bar are five wasted round trips",
  );
});

test("all six passes still run while energy lasts", async (t) => {
  const { farmer, counts } = makeCycleFarmer(t);

  await farmer.process();

  assert.strictEqual(counts.taps, 6, "a productive pass must not cut the loop short");
});

test("boosts are bought once per cycle, before the passes", async (t) => {
  const { farmer, counts, order } = makeCycleFarmer(t);

  await farmer.process();

  assert.strictEqual(counts.boosts, 1, "the boost chain belongs to the cycle, not the pass");
  assert.ok(
    order.indexOf("boosts") < order.indexOf("tap"),
    "boosts must be bought before the first pass taps with them",
  );
});

test("a pass returning nothing while energy remains does not cut the loop short", async (t) => {
  const { farmer, counts } = makeCycleFarmer(t);
  // A transient API failure inside one pass leaves a pass with no taps but the
  // bar still full of energy — the remaining passes must still get their turn.
  farmer.tapUntilBatteryFull = async () => {
    counts.taps += 1;
    return 0;
  };

  await farmer.process();

  assert.strictEqual(counts.taps, 6, "energy on the bar means the passes keep going");
});
