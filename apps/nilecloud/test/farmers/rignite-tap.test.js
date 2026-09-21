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
/** A controllable `Date.now`, for the time-based backoff and lane recovery. */
function fakeClock() {
  const realNow = Date.now;
  let now = realNow();

  return {
    install: () => {
      Date.now = () => now;
    },
    restore: () => {
      Date.now = realNow;
    },
    advance: (ms) => {
      now += ms;
    },
    now: () => now,
  };
}

function makeFarmer({ tap, batteryCap = 1_000, onDelay }) {
  const logger = recordingLogger();
  const delays = [];
  const farmer = new RigniteFarmer();

  farmer.logger = logger;
  farmer.utils = {
    delay: async (ms) => {
      delays.push(ms);
      onDelay?.(ms);
    },
  };
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

test("a burst the API refuses shrinks the next burst's lane width", async () => {
  const calls = [];

  const { farmer } = makeFarmer({
    tap: async (count) => {
      calls.push(count);
      // Lanes 1-20 (the first burst) are refused; whatever the next burst's
      // width is, it credits and finishes the pass.
      if (calls.length <= 20) throw apiRefusal();
      return { accepted: count, batteryEnergy: 1_000, coins: 5 };
    },
  });

  await farmer.tapUntilBatteryFull();

  assert.strictEqual(
    calls.length,
    30,
    "20 refused lanes must be followed by 10, not another 20 — the width halves",
  );
});

test("the lane width is restored in full after a quiet stretch", async () => {
  const clock = fakeClock();
  const calls = [];
  clock.install();

  try {
    const { farmer } = makeFarmer({
      // The next burst's width is decided before its lanes are built, so the
      // quiet stretch has to happen in the backoff between the two bursts.
      onDelay: () => clock.advance(2_500),
      tap: async (count) => {
        calls.push(count);
        if (calls.length <= 20) throw apiRefusal();
        return { accepted: count, batteryEnergy: 1_000, coins: 5 };
      },
    });

    await farmer.tapUntilBatteryFull();

    assert.strictEqual(
      calls.length,
      40,
      "after 2.5s without a refusal the burst must be back at the full 20 lanes",
    );
  } finally {
    clock.restore();
  }
});

test("the lane width never shrinks below one request", async () => {
  const clock = fakeClock();
  clock.install();

  try {
    let calls = 0;
    const bursts = [];
    const { farmer } = makeFarmer({
      // Each backoff separates two bursts, so recording the call count at
      // every backoff gives the size of the burst that just finished. The tap
      // pass's opening buyTapBoosts race also calls delay, before any burst,
      // so only record once requests have actually been sent.
      onDelay: () => {
        if (calls) bursts.push(calls);
      },
      tap: async () => {
        calls += 1;
        clock.advance(1);
        throw apiRefusal(); // every burst refused, for the whole pass
      },
    });

    await farmer.tapUntilBatteryFull();

    // `bursts` holds the running call count at each backoff, so the size of a
    // burst is the step between two entries.
    const sizes = bursts.map((count, i) => count - (bursts[i - 1] ?? 0));

    assert.ok(bursts.length >= 3, "repeated refusals must keep retrying");
    assert.ok(
      sizes[1] < sizes[0],
      "the second burst must be narrower than the first",
    );
    assert.ok(
      Math.min(...sizes) >= 1,
      "the width must never reach zero and silence the pass",
    );
  } finally {
    clock.restore();
  }
});

test("the narrowed width carries into the next tap pass", async () => {
  const clock = fakeClock();
  clock.install();

  try {
    let calls = 0;
    let refusing = true;
    const { farmer } = makeFarmer({
      // Pass 1 is refused on every lane; pass 2 answers normally.
      tap: async (count) => {
        calls += 1;
        clock.advance(1);
        if (refusing) throw apiRefusal();
        return { accepted: count, batteryEnergy: 1_000, coins: 5 };
      },
    });

    await farmer.tapUntilBatteryFull();
    const narrowed = farmer.tapLaneWidth;

    assert.ok(narrowed < 20, "a refused pass must leave the width narrowed");

    // Second pass: count the lanes of its very first burst. Skip the opening
    // buyTapBoosts race, which also calls delay before any burst is sent.
    refusing = false;
    calls = 0;
    farmer.user_data = { ...farmer.user_data, batteryEnergy: 0 };
    const firstBurst = [];
    farmer.utils.delay = async () => {
      if (calls) firstBurst.push(calls);
    };
    await farmer.tapUntilBatteryFull();

    assert.strictEqual(
      firstBurst[0],
      narrowed,
      "the next pass must start at the width the previous one learned, not 20",
    );
  } finally {
    clock.restore();
  }
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
