import * as assert from "node:assert";
import fs from "node:fs";
import { test } from "node:test";

import EasyCoinFarmer from "@nile/shared/farmers/EasyCoinFarmer.js";

import {
  ALLOWED_ROUTES,
  KNOWN_UNIMPLEMENTED,
  SECRET_PATTERNS,
  assertNothingSpends,
  assertPayIsAlwaysKey,
  assertRoutesAllowed,
  fixturePath,
  loadFixture,
  newestState,
  replayFarmer,
} from "./easycoin-replay.js";

/** The fixtures that must exist for this suite to mean anything. */
const FIXTURES = ["easy", "easy2"];

/** A timestamp far enough ahead that nothing gated on it can fire. */
const LATER = Math.floor(Date.now() / 1000) + 86_400;

const inertChain = new Proxy(function () {}, {
  get: () => inertChain,
  apply: (_self, _this, args) => args[0] ?? "",
});

/** A logger that swallows output but stays callable. */
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

test("redacted fixtures carry no credentials", () => {
  for (const name of FIXTURES) {
    const text = fs.readFileSync(fixturePath(name), "utf8");

    for (const pattern of SECRET_PATTERNS) {
      assert.ok(
        !pattern.test(text),
        `${name}.json contains a credential shape: ${pattern}`,
      );
    }

    assert.match(
      text,
      /\[REDACTED\]/,
      `${name}.json has no redaction marker — the script may not have run`,
    );
  }
});

test("every route in the fixtures is one we call, or one we ruled out", () => {
  for (const name of FIXTURES) {
    const fixture = loadFixture(name);

    const unknown = [
      ...new Set(
        fixture.records
          .map((record) => record.path)
          .filter(
            (routePath) =>
              !ALLOWED_ROUTES.has(routePath) &&
              !KNOWN_UNIMPLEMENTED.has(routePath),
          ),
      ),
    ];

    assert.deepStrictEqual(
      unknown,
      [],
      `${name}.json carries routes that are neither callable nor explicitly ruled out`,
    );
  }
});

/**
 * Give the farmer a Telegram identity, which a running account always has —
 * `logUserInfo` reports the user from it, and without one the log path takes a
 * deliberate fallback rather than the normal route.
 */
function withIdentity(farmer) {
  farmer.telegramWebApp = {
    initDataUnsafe: { user: { id: 1000000001, username: "redacted_user" } },
  };
  return farmer;
}

test("a full cycle touches only evidenced routes and never spends", async () => {
  const fixture = loadFixture("easy");
  const farmer = withIdentity(new EasyCoinFarmer());
  farmer.logger = silentLogger();

  const { calls, missing } = replayFarmer(farmer, fixture, {
    state: openGates(fixture),
  });

  await farmer.process();

  assertRoutesAllowed(calls);
  assertNothingSpends(calls);
  assertPayIsAlwaysKey(calls);

  // The one route with bundle evidence but no captured pair: no cycle finished
  // in either session, so there is nothing to replay. Recorded rather than
  // faked — if another route ever shows up here, the allowlist is out of date.
  assert.deepStrictEqual([...missing], ["POST /api/mines/collect"]);
});

test("a cycle still runs its whole action list from a real captured state", async () => {
  const fixture = loadFixture("easy");
  const farmer = withIdentity(new EasyCoinFarmer());
  farmer.logger = silentLogger();

  const { calls } = replayFarmer(farmer, fixture, { state: openGates(fixture) });
  await farmer.process();

  const posted = new Set(
    calls.filter((call) => call.method === "POST").map((call) => call.path),
  );

  for (const routePath of [
    "/api/mines/collect",
    "/api/box/open",
    "/api/daily/claim",
    "/api/bonus/claim",
    "/api/ladder/claim",
    "/api/wheel/spin",
    "/api/chest/claim",
    "/api/slots/spin",
    "/api/dig/open",
    "/api/tasks/check",
  ]) {
    assert.ok(posted.has(routePath), `a full cycle should reach ${routePath}`);
  }
});

test("nothing fires when every gate is closed", async () => {
  const fixture = loadFixture("easy");
  const farmer = withIdentity(new EasyCoinFarmer());
  farmer.logger = silentLogger();

  const { calls } = replayFarmer(farmer, fixture, {
    state: closedGates(fixture),
  });

  await farmer.process();

  assert.deepStrictEqual(
    calls.filter((call) => call.method === "POST"),
    [],
    "a closed gate must never produce a call",
  );
});

/**
 * The newest captured state with every actionable gate opened, so a cycle runs
 * its whole list. Values are only as realistic as they need to be to open a
 * gate; the responses still come from the capture.
 */
export function openGates(fixture) {
  const state = structuredClone(newestState(fixture));

  state.mines = [{ id: 1, mineId: "meadow_old_shaft", slot: 0, pending: 5 }];
  state.balances = {
    ...state.balances,
    keys: { wooden: 1, iron: 0, golden: 0, diamond: 0, mythic: 0 },
    tickets: 3,
    slotTokens: 2,
    spins: 0,
    // Zero on purpose: the `easy` capture holds no scratch card, so leaving one
    // here would make the cycle call a route this fixture cannot answer.
    scratchCards: 0,
  };
  state.dig = { day: 1, opened: {}, tickets: 2, done: false };
  state.streak = { ...state.streak, claimable: true };
  state.ladder = { ...state.ladder, freeReadyAt: 0 };
  state.wheel = { ...state.wheel, freeToday: 1 };
  state.daily = [{ id: "spin", progress: 1, need: 1, claimed: false }];
  state.tasks = [{ id: "box1", done: false, ready: true }];
  // The chest runs on its own cooldown, so its gate has to be opened too — the
  // captured `readyAt` is whatever the other account was waiting on.
  state.meta = { ...state.meta, chest: { readyAt: 0 } };

  return state;
}

/** The same state with every gate shut, so any call at all is a bug. */
export function closedGates(fixture) {
  const state = openGates(fixture);

  state.mines = state.mines.map((mine) => ({ ...mine, pending: 0, slot: 0 }));
  state.balances = {
    ...state.balances,
    keys: { wooden: 0, iron: 0, golden: 0, diamond: 0, mythic: 0 },
    tickets: 0,
    slotTokens: 0,
    spins: 0,
    scratchCards: 0,
  };
  state.dig = { day: 1, opened: {}, tickets: 0, done: false };
  state.streak = { ...state.streak, claimable: false };
  state.ladder = { ...state.ladder, freeReadyAt: LATER };
  state.wheel = { ...state.wheel, freeToday: 0, spins: 0 };
  state.daily = [{ id: "spin", progress: 0, need: 1, claimed: false }];
  state.tasks = [{ id: "box1", done: false, ready: false }];
  state.seen = ["intro"];
  state.meta = {
    ...state.meta,
    chest: { readyAt: LATER },
    // Empty rather than inherited: a mission the capture left claimable is a
    // real call, and this fixture is asserting that *nothing* fires.
    missions: { missions: [] },
  };

  return state;
}
