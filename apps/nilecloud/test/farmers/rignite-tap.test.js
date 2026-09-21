import * as assert from "node:assert";
import { test } from "node:test";

import RigniteFarmer from "@nile/shared/farmers/RigniteFarmer.js";

const TAP_LANES = 20;

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
 * The API refusing the call itself — a generic error body with a 500 behind it,
 * which is what the fleet logged as a bare "Tap failed: Error".
 */
function apiRefusal() {
  const error = new Error("Request failed with status code 500");
  error.response = { status: 500, data: { error: "Error" } };
  return error;
}

/**
 * A farmer whose tap pass can be driven to exhaustion: `tap` is scripted per
 * call, and a credited result carries the battery to full so the pass ends the
 * moment the API starts answering again.
 */
function makeFarmer({ tap, batteryCap = 1_000 }) {
  const logger = recordingLogger();
  const delays = [];
  const farmer = new RigniteFarmer();

  farmer.logger = logger;
  farmer.utils = { delay: async (ms) => delays.push(ms) };
  farmer.buyTapBoosts = async () => {};
  farmer.user_data = {
    batteryCap,
    batteryEnergy: 0,
    energy: 100_000,
    maxEnergy: 200_000,
    coins: 0,
    multitapLevel: 1,
    fullEnergyLeft: 0,
  };
  farmer.tap = tap;

  return { farmer, logger, delays };
}

test("a burst where every lane fails is retried, not abandoned", async () => {
  let calls = 0;

  const { farmer } = makeFarmer({
    tap: async (count) => {
      calls += 1;
      // The first burst fails outright, exactly as the server does under load.
      if (calls <= TAP_LANES) throw apiRefusal();
      return { accepted: count, batteryEnergy: 1_000, coins: 5 };
    },
  });

  const taps = await farmer.tapUntilBatteryFull();

  assert.ok(taps > 0, "taps must still be credited once the API answers again");
  assert.ok(
    calls > TAP_LANES,
    "the pass must retry after a whole burst failed instead of ending",
  );
});

test("a burst that fails on every lane is reported once, with the status", async () => {
  let calls = 0;

  const { farmer, logger } = makeFarmer({
    tap: async (count) => {
      calls += 1;
      if (calls === TAP_LANES + 1) throw apiRefusal(); // second burst fails too
      if (calls <= TAP_LANES) throw apiRefusal();
      return { accepted: count, batteryEnergy: 1_000, coins: 5 };
    },
  });

  await farmer.tapUntilBatteryFull();

  const warnings = logger.lines.filter((line) => line.level === "warn");
  assert.strictEqual(
    warnings.length,
    2,
    "one line per failed burst — not one per lane (20 lanes failed each time)",
  );
  assert.match(
    String(warnings[0].args.join(" ")),
    /500/,
    "the HTTP status must be in the message, so the cause is readable",
  );
  assert.match(String(warnings[0].args.join(" ")), new RegExp(`^Tap burst: ${TAP_LANES}/`));
});

test("a partly refused burst backs off instead of resuming at full pace", async () => {
  let calls = 0;

  const { farmer, delays } = makeFarmer({
    tap: async (count) => {
      calls += 1;
      // One lane fails while the rest credit: the API is struggling.
      if (calls === 1) throw apiRefusal();
      return { accepted: count, batteryEnergy: 1_000, coins: 5 };
    },
  });

  await farmer.tapUntilBatteryFull();

  assert.ok(
    Math.max(...delays) >= 25,
    "a request-level failure must trigger a real backoff, not the 1ms fast pace",
  );
});

test("a failure body like SESSION_TAKEN is still surfaced distinctly", async () => {
  let calls = 0;

  const { farmer, logger } = makeFarmer({
    tap: async (count) => {
      calls += 1;
      if (calls <= TAP_LANES) {
        const error = new Error("Request failed with status code 401");
        error.response = { status: 401, data: { error: "SESSION_TAKEN" } };
        throw error;
      }
      return { accepted: count, batteryEnergy: 1_000, coins: 5 };
    },
  });

  await farmer.tapUntilBatteryFull();

  const warnings = logger.lines.filter((line) => line.level === "warn").map((line) =>
    String(line.args.join(" ")),
  );
  assert.ok(
    warnings.some((line) => line.includes("SESSION_TAKEN")),
    "the API's own error string must survive into the log",
  );
});
