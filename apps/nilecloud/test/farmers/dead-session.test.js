import * as assert from "node:assert";
import { test } from "node:test";

import refreshInitData from "../../lib/refreshInitData.js";
import {
  INIT_DATA_STALE_HOURS,
  MINT_FAILURE_ALERT_THRESHOLD,
  formatDeadSessionLines,
  initDataAgeHours,
  isDeadSessionError,
  shouldAlert,
} from "../../lib/sessionHealth.js";

/** An account that can never mint init data again without a fresh login. */
const deadErrors = [
  ["revoked (message)", new Error("401: SESSION_REVOKED")],
  ["revoked (bare string)", "SESSION_REVOKED"],
  [
    "auth key unregistered (RPCError shape)",
    Object.assign(new Error("AUTH_KEY_UNREGISTERED"), {
      errorMessage: "AUTH_KEY_UNREGISTERED",
      code: 401,
    }),
  ],
  ["session expired", new Error("SESSION_EXPIRED")],
  ["user deactivated", new Error("USER_DEACTIVATED_BAN")],
];

/** Throttling and network noise — the session is fine, Telegram just refused. */
const transientErrors = [
  ["stalled refresh", new Error("Telegram init-data refresh timed out (MTProto stalled)")],
  ["rate limited", new Error("Request failed with status code 429")],
  ["bad gateway", new Error("Request failed with status code 502")],
  ["socket reset", new Error("read ECONNRESET")],
  ["flood wait", new Error("FLOOD_WAIT_31")],
  ["generic", new Error("Error")],
  ["nothing at all", null],
];

for (const [name, error] of deadErrors) {
  test(`a dead session is recognised: ${name}`, () => {
    assert.strictEqual(isDeadSessionError(error), true);
  });
}

for (const [name, error] of transientErrors) {
  test(`a transient failure is not a dead session: ${name}`, () => {
    assert.strictEqual(isDeadSessionError(error), false);
  });
}

test("init data age is measured from the auth_date it carries", () => {
  const twoHoursAgo = Math.floor(Date.now() / 1000) - 2 * 3600;
  const initData = `query_id=AA&user=%7B%22id%22%3A1%7D&auth_date=${twoHoursAgo}&hash=abc`;

  const age = initDataAgeHours(initData);
  assert.ok(age > 1.9 && age < 2.1, `expected ~2h, got ${age}`);
});

test("init data age is unknown when there is no auth_date", () => {
  assert.strictEqual(initDataAgeHours("query_id=AA&hash=abc"), null);
  assert.strictEqual(initDataAgeHours(""), null);
  assert.strictEqual(initDataAgeHours(undefined), null);
});

/**
 * A SESSION_REVOKED is NOT proof of a dead login: the same session that was
 * refused twice in a row then minted successfully 8 times out of 8 minutes
 * later (measured on the rignite box). So it must still be retried.
 */
test("a refusal is retried like any other failure", async () => {
  let attempts = 0;

  const result = await refreshInitData({
    attempt: async () => {
      attempts += 1;
      throw new Error("401: SESSION_REVOKED (caused by messages.GetDialogs)");
    },
  });

  assert.strictEqual(attempts, 2, "no failure class may skip its retry");
  assert.strictEqual(result.ok, false);
});

test("a single refusal does not raise an alert", () => {
  assert.strictEqual(shouldAlert({ consecutiveFailures: 1, ageHours: 0.1 }), false);
  assert.strictEqual(shouldAlert({ consecutiveFailures: 2, ageHours: 5 }), false);
});

test("repeated failures do raise an alert", () => {
  assert.strictEqual(
    shouldAlert({
      consecutiveFailures: MINT_FAILURE_ALERT_THRESHOLD,
      ageHours: 0.1,
    }),
    true,
  );
  assert.strictEqual(
    shouldAlert({ consecutiveFailures: MINT_FAILURE_ALERT_THRESHOLD + 5, ageHours: 0.1 }),
    true,
  );
});

test("init data past the stale threshold alerts even without failures", () => {
  assert.strictEqual(
    shouldAlert({ consecutiveFailures: 0, ageHours: INIT_DATA_STALE_HOURS + 0.1 }),
    true,
  );
});

test("a healthy account never alerts", () => {
  assert.strictEqual(shouldAlert({ consecutiveFailures: 0, ageHours: 0.2 }), false);
  assert.strictEqual(
    shouldAlert({ consecutiveFailures: 0, ageHours: INIT_DATA_STALE_HOURS - 0.1 }),
    false,
  );
});

test("the dead session message names every account and says what to do", () => {
  const lines = formatDeadSessionLines({
    title: "Rignite",
    accounts: [
      { id: "8652464919", title: "farm 12", username: "farm12", ageHours: 26.7 },
      { id: "7993850025", title: "farm 3", username: null, ageHours: null },
    ],
  });

  const text = lines.join("\n");
  assert.match(text, /DEAD SESSION/);
  assert.match(text, /Rignite/);
  assert.match(text, /8652464919/);
  assert.match(text, /7993850025/);
  assert.match(text, /farm 12/);
  assert.match(text, /26\.7h/);
  assert.match(text, /2 account/);
});

test("the staleness threshold warns before Rignite's own wall", () => {
  /** Observed: accepted at 20.2h, refused at 26.1h */
  assert.ok(INIT_DATA_STALE_HOURS >= 12 && INIT_DATA_STALE_HOURS <= 22);
});

test("each account says why it needs a re-login", () => {
  const lines = formatDeadSessionLines({
    title: "Rignite",
    accounts: [
      {
        id: "8652464919",
        title: "Account 141",
        ageHours: 27.0,
        reason: "session revoked",
      },
      {
        id: "7993850025",
        title: "Account 3",
        ageHours: 26.4,
        reason: "mint failing",
      },
    ],
  });

  const text = lines.join("\n");
  assert.match(text, /session revoked/);
  assert.match(text, /mint failing/);
  assert.match(text, /2 accounts/);
});

test("an account with no known age still gets a line", () => {
  const lines = formatDeadSessionLines({
    title: "Rignite",
    accounts: [{ id: "8990507499", title: null, username: null, ageHours: null }],
  });

  const text = lines.join("\n");
  assert.match(text, /8990507499/);
  assert.match(text, /1 account/);
});
