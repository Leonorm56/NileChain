import assert from "node:assert/strict";
import test from "node:test";

import LootVaultFarmer, {
  MIN_COLLECT_NANO,
  isCollectable,
  isRegistered,
  nanoToLoot,
  pendingMinedNano,
} from "./LootVaultFarmer.js";

/* A dashboard payload as the server returned it during registration. */
const dashboard = {
  b: "15000000000",
  m: 1,
  r: "25000000000",
  lm: 1_792_434_950_090,
  ts: 1_792_435_000_090,
  lvl: 1,
  league: { name: "Бронзовая лига" },
};

/* The same account ten minutes after a collection: ~4.2 LOOT accrued. */
const accruedDashboard = { ...dashboard, ts: dashboard.lm + 600_000 };

test("nanoToLoot renders nano balances as LOOT with four decimals", () => {
  assert.equal(nanoToLoot("15000000000"), "15.0000");
  assert.equal(nanoToLoot("1928951388"), "1.9290");
  assert.equal(nanoToLoot(0), "0.0000");
});

test("nanoToLoot survives a missing or unreadable amount", () => {
  assert.equal(nanoToLoot(undefined), "0.0000");
  assert.equal(nanoToLoot("not-a-number"), "0.0000");
});

test("pendingMinedNano prices the time since the last collection", () => {
  /* 25 LOOT/hour over 50 seconds. */
  assert.equal(pendingMinedNano(dashboard), 347_222_222);
});

test("pendingMinedNano is zero without a rate or a last-mined stamp", () => {
  assert.equal(pendingMinedNano({}), 0);
  assert.equal(pendingMinedNano({ ...dashboard, r: "0" }), 0);
  assert.equal(pendingMinedNano({ ...dashboard, lm: 0 }), 0);
});

test("pendingMinedNano never goes negative when the clocks disagree", () => {
  assert.equal(pendingMinedNano({ ...dashboard, lm: dashboard.ts + 1_000 }), 0);
});

test("isCollectable waits for the app's one LOOT minimum", () => {
  assert.equal(MIN_COLLECT_NANO, 1_000_000_000);

  /* 144 seconds of mining at 25 LOOT/hour is exactly 1 LOOT. */
  assert.equal(
    isCollectable({ ...dashboard, ts: dashboard.lm + 144_000 }),
    true,
  );
  assert.equal(
    isCollectable({ ...dashboard, ts: dashboard.lm + 143_999 }),
    false,
  );
});

test("isRegistered accepts the wallet flag the app treats as registered", () => {
  assert.equal(isRegistered({ registered: true }), true);
  assert.equal(isRegistered({ registered: false, w: true }), true);
  assert.equal(isRegistered({ registered: false, w: false }), false);
  assert.equal(isRegistered(undefined), false);
});

/** A farmer wired to a fake API that records the calls it receives. */
function createHarness(dashboard, handlers = {}) {
  const farmer = new LootVaultFarmer();
  const calls = [];

  farmer.logger = {
    newline() {},
    keyValue() {},
    info() {},
    warn() {},
    success() {},
    error() {},
    log() {},
  };
  farmer.utils = { ...farmer.utils, delay: async () => {} };

  farmer.api = {
    get: async (url) => {
      calls.push({ method: "GET", url });
      return { data: handlers[url]?.() ?? { ok: true, d: dashboard } };
    },
    post: async (url, body) => {
      calls.push({ method: "POST", url, body });
      return { data: handlers[url]?.() ?? { ok: true, d: {} } };
    },
  };

  return { farmer, calls };
}

test("collectMined previews, solves the captcha and collects once", async () => {
  const preview = {
    ok: true,
    d: { canCollect: true, totalMined: "1928951388" },
  };
  const collected = {
    ok: true,
    d: {
      mined: "1961055555",
      newBalance: "16961055555",
      txHash: "38e5b40e",
    },
  };

  const { farmer, calls } = createHarness(accruedDashboard, {
    "https://lootvault.lol/vx/m4/preview": () => preview,
    "https://lootvault.lol/vx/m4": () => collected,
  });
  farmer.solveSliderCaptcha = async () => "captcha-token";

  assert.equal(await farmer.collectMined(), true);
  assert.deepEqual(
    calls.map((call) => `${call.method} ${call.url}`),
    [
      "GET https://lootvault.lol/vx/d2",
      "GET https://lootvault.lol/vx/m4/preview",
      "POST https://lootvault.lol/vx/m4",
    ],
  );
  assert.deepEqual(calls[2].body, { captchaToken: "captcha-token" });
});

test("collectMined stays quiet below one LOOT of accrual", async () => {
  const { farmer, calls } = createHarness({
    ...dashboard,
    ts: dashboard.lm + 60_000,
  });
  farmer.solveSliderCaptcha = async () => {
    throw new Error("the captcha must not be solved");
  };

  assert.equal(await farmer.collectMined(), false);
  assert.deepEqual(
    calls.map((call) => call.url),
    ["https://lootvault.lol/vx/d2"],
  );
});

test("collectMined honours a preview that refuses the collection", async () => {
  const { farmer, calls } = createHarness(accruedDashboard, {
    "https://lootvault.lol/vx/m4/preview": () => ({
      ok: true,
      d: { canCollect: false, totalMined: "1928951388" },
    }),
  });
  farmer.solveSliderCaptcha = async () => {
    throw new Error("the captcha must not be solved");
  };

  assert.equal(await farmer.collectMined(), false);
  assert.equal(calls.at(-1).url, "https://lootvault.lol/vx/m4/preview");
});

test("collectMined survives a dashboard the server refuses", async () => {
  const { farmer } = createHarness(accruedDashboard, {
    "https://lootvault.lol/vx/d2": () => ({ ok: false, e: "network_error" }),
  });

  assert.equal(await farmer.collectMined(), false);
});

test("collectMined reports a failed captcha instead of throwing", async () => {
  const { farmer, calls } = createHarness(accruedDashboard, {
    "https://lootvault.lol/vx/m4/preview": () => ({
      ok: true,
      d: { canCollect: true, totalMined: "1928951388" },
    }),
  });
  farmer.solveSliderCaptcha = async () => {
    throw new Error("too_fast");
  };

  assert.equal(await farmer.collectMined(), false);
  assert.equal(calls.at(-1).url, "https://lootvault.lol/vx/m4/preview");
});
