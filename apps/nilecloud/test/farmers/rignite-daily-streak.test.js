import * as assert from "node:assert";
import { test } from "node:test";

import RigniteFarmer from "@nile/shared/farmers/RigniteFarmer.js";

/** Anything chalk-ish the logger hands out (chalk.bold.red(...), logger.c.green). */
const inertChain = new Proxy(function () {}, {
  get: () => inertChain,
  apply: (_self, _this, args) => args[0] ?? "",
});

/** A logger that swallows the farmer's output but returns usable values. */
function silentLogger() {
  return {
    log: () => {},
    info: () => {},
    warn: () => {},
    error: () => {},
    success: () => {},
    newline: () => {},
    keyValue: () => {},
    output: () => {},
    chalk: inertChain,
    c: inertChain,
  };
}

/** An axios-shaped rejection with an HTTP status. */
function httpError(status) {
  const error = new Error(`Request failed with status code ${status}`);
  error.response = { status, data: {} };
  return error;
}

/**
 * A farmer whose every task is stubbed: `process()` then records the order the
 * tasks ran in, so a task that throws where it shouldn't is visible as the
 * tasks after it going missing.
 */
function makeFarmer({ getDaily, claimDaily } = {}) {
  const farmer = new RigniteFarmer();
  const ran = [];

  farmer.logger = silentLogger();
  farmer.user_data = { coins: 0, batteryLevel: 0, batteryCap: 1, batteryEnergy: 0 };

  farmer.login = async () => {
    ran.push("login");
    return farmer.user_data;
  };
  farmer.ensureAdMode = async () => {};
  farmer.logUserInfo = async () => {};
  farmer.watchFullEnergyAd = async () => ran.push("Energy Ad");
  farmer.tapUntilBatteryFull = async () => ran.push("Tap");
  farmer.watchBatteryAd = async () => ran.push("Battery Ad");
  farmer.collectEverything = async () => ran.push("Collect");
  farmer.upgradeItems = async () => ran.push("Upgrades");
  farmer.getDaily = async () => {
    ran.push("Daily Streak");
    return getDaily ? getDaily() : { streak: 1, canClaim: false };
  };
  farmer.claimDaily = async () => {
    ran.push("claimDaily");
    return claimDaily ? claimDaily() : { state: { streak: 1 } };
  };

  return { farmer, ran };
}

/** The tasks that must always run, whatever the streak does. */
const TAIL = ["Collect", "Upgrades"];

test("a rate-limited Daily Streak (429) does not abort the cycle", async () => {
  const { farmer, ran } = makeFarmer({
    getDaily: () => {
      throw httpError(429);
    },
  });

  await assert.doesNotReject(() => farmer.process());
  assert.deepStrictEqual(
    ran.slice(-TAIL.length),
    TAIL,
    "Collect and Upgrades must still run after a 429 on the streak read",
  );
});

test("a rejected streak read (500) does not abort the cycle", async () => {
  const { farmer, ran } = makeFarmer({
    getDaily: () => {
      throw httpError(500);
    },
  });

  await assert.doesNotReject(() => farmer.process());
  assert.deepStrictEqual(ran.slice(-TAIL.length), TAIL);
});

test("a streak read that never resolves still leaves the cycle intact", async () => {
  const { farmer, ran } = makeFarmer({
    getDaily: () => {
      throw new Error("Network Error");
    },
  });

  await assert.doesNotReject(() => farmer.process());
  assert.deepStrictEqual(ran.slice(-TAIL.length), TAIL);
});

test("a claimable streak is still claimed", async () => {
  const { farmer, ran } = makeFarmer({
    getDaily: () => ({ streak: 4, canClaim: true }),
    claimDaily: () => ({ state: { streak: 5 }, coins: 10 }),
  });

  await farmer.process();

  assert.ok(ran.includes("claimDaily"), "a claimable streak must still be claimed");
  assert.deepStrictEqual(ran.slice(-TAIL.length), TAIL);
});

test("an unclaimable streak is retried once, then the cycle carries on", async () => {
  const { farmer, ran } = makeFarmer({
    getDaily: () => ({ streak: 4, canClaim: false }),
    claimDaily: () => {
      throw httpError(400);
    },
  });

  await farmer.process();

  assert.deepStrictEqual(ran.slice(-TAIL.length), TAIL);
});

test("a claim that is rate-limited (429) is not attempted forever", async () => {
  const { farmer, ran } = makeFarmer({
    getDaily: () => ({ streak: 4, canClaim: true }),
    claimDaily: () => {
      throw httpError(429);
    },
  });

  await farmer.process();

  assert.ok(
    ran.filter((task) => task === "claimDaily").length <= 2,
    "a rate-limited claim must not be retried in a loop",
  );
  assert.deepStrictEqual(ran.slice(-TAIL.length), TAIL);
});
