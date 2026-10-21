/**
 * EasyCoin HAR-replay harness.
 *
 * Offline transport for the farmer, driven by redacted captures instead of the
 * live Worker. It exists to make three claims testable rather than asserted:
 *
 *   1. the farmer calls only routes we hold evidence for,
 *   2. it never calls a route that spends money or premium currency,
 *   3. a call never happens unless that action's gate is genuinely open.
 *
 * Route trust is split by strength of evidence, because "seen in a capture" and
 * "read in the game's bundle" are not the same thing:
 *
 *   - VERIFIED_IN_CAPTURE — a request/response pair exists in a HAR, so the
 *     replay can answer it with the shape the server really sent.
 *   - VERIFIED_IN_BUNDLE — the route appears in the game's own JavaScript. Real,
 *     but with no captured pair, so replaying it answers a synthetic logical
 *     failure instead of inventing a response shape.
 *   - KNOWN_UNIMPLEMENTED — bundle-known routes this farmer deliberately does
 *     not touch yet. They are listed so they are visibly out of scope, and they
 *     are *not* callable.
 *
 * Anything in none of those sets is UNVERIFIED, and a test fails if it is ever
 * called.
 */

import assert from "node:assert";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE_DIR = path.join(here, "..", "fixtures", "easycoin");

/** Routes with a captured request/response pair. */
export const VERIFIED_IN_CAPTURE = new Set([
  "/api/state",
  "/api/seen",
  "/api/ladder/claim",
  "/api/bonus/claim",
  "/api/wheel/spin",
  "/api/dig/open",
  "/api/chest/claim",
  "/api/slots/spin",
  "/api/scratch/play",
  "/api/daily/claim",
  "/api/daily/bump",
  "/api/missions/claim",
  "/api/box/open",
  "/api/mines/slot",
  "/api/tasks/open",
  "/api/tasks/check",
  "/api/combo/try",
]);

/**
 * Routes read out of the shipped bundle. `/api/mines/collect` is the claim the
 * whole game is about — the bundle's wrapper is
 * `collect: (n) => xe("/mines/collect", n === void 0 ? {} : { id: n })` — but no
 * capture contains one, because no cycle finished in either session.
 */
export const VERIFIED_IN_BUNDLE = new Set(["/api/mines/collect"]);

/** Bundle-known, deliberately unimplemented. Not callable. */
export const KNOWN_UNIMPLEMENTED = new Set([
  "/api/mines/fuse",
  "/api/mines/upgrade",
  "/api/achievements/claim",
  "/api/missions/bonus",
  "/api/pass/claim",
  "/api/pass/buy",
  "/api/piggy/break",
  "/api/hilo/start",
  "/api/hilo/guess",
  "/api/hilo/cashout",
  "/api/draw",
  "/api/away/seen",
  "/api/streak/buy",
  "/api/creator",
]);

/** The only routes a cycle may touch. */
export const ALLOWED_ROUTES = new Set([
  ...VERIFIED_IN_CAPTURE,
  ...VERIFIED_IN_BUNDLE,
]);

/**
 * Routes that spend real money or premium currency, or hand over an asset. The
 * farmer must never call these, whatever a future edit believes.
 */
export const FORBIDDEN_PATTERNS = [
  /\/shop\//, // boxes bought with GRAM
  /\/gemshop\//, // gems bought with GRAM
  /\/piggy\//, // piggy break
  /\/pass\//, // season pass
  /\/offers\//, // starter / flash offers
  /\/payments?\b/,
  /\/stars?\b/,
  /\/deposit/,
  /\/wallet/,
  /\/withdraw/,
  /\/isle\//, // separate 3D app, out of scope
  /\/hilo\//, // staked gambling
  /\/streak\/buy/, // paid streak repair
];

/** Credential shapes a fixture must never contain, checked by a test. */
export const SECRET_PATTERNS = [
  /tgWebAppData=/i,
  /query_id=/i,
  /auth_date=/i,
  /"authorization"/i,
  /"initData"/i,
  /"session"/i,
  /"proxy"/i,
];

/** Load a redacted fixture by name (`easy`, `easy2`). */
export function loadFixture(name) {
  return JSON.parse(
    fs.readFileSync(path.join(FIXTURE_DIR, `${name}.json`), "utf8"),
  );
}

/** Path to a fixture file, for tests that scan the raw text. */
export function fixturePath(name) {
  return path.join(FIXTURE_DIR, `${name}.json`);
}

/**
 * The newest recorded state.
 *
 * `GET /api/state` answers with the state itself, not a wrapper, which is why
 * this reads the body directly instead of looking for a `state` key.
 */
export function newestState(fixture) {
  const states = fixture.records.filter(
    (record) => record.path === "/api/state" && record.responseBody,
  );
  return states.length ? states[states.length - 1].responseBody : null;
}

/**
 * Point a farmer at the fixture instead of the network.
 *
 * Every accepted POST in the real API carries the refreshed state, so any
 * fixture reply that lacks one borrows the newest state. That keeps
 * `applyState` working across a whole cycle without pretending the capture came
 * from this account — it is a harness, not a simulator.
 *
 * Returns the recorded calls, the routes that had no fixture to answer them,
 * and the state being served.
 */
export function replayFarmer(farmer, fixture, { state } = {}) {
  const queues = new Map();

  for (const record of fixture.records) {
    const key = `${record.method} ${record.path}`;
    if (!queues.has(key)) queues.set(key, []);
    queues.get(key).push(record);
  }

  const calls = [];
  const missing = new Set();
  const fallbackState = state || newestState(fixture);

  const serve = (method, requestPath, payload) => {
    // The farmer's own `get`/`post` take paths relative to its `/api` base
    // (`/state`, `/box/open`), so normalise before matching against routes.
    const routePath = requestPath.startsWith("/api/")
      ? requestPath
      : `/api${requestPath}`;

    calls.push({ method, path: routePath, payload });

    // `login()` reads the state straight off this GET, so it has to answer with
    // the arranged state — a fixture copy would be the other account's board
    // and every gate the test set would evaporate.
    if (routePath === "/api/state") {
      queues.get(`${method} ${routePath}`)?.shift();
      return fallbackState;
    }

    const record = queues.get(`${method} ${routePath}`)?.shift();
    if (!record) {
      missing.add(`${method} ${routePath}`);
      // A logical refusal, not a thrown HTTP error: the farmer treats
      // `ok:false` as "skip this action", which is what a route with no
      // captured response deserves. Inventing a success shape here is how a
      // harness starts lying.
      return { ok: false, reason: "not_in_fixture" };
    }

    const body =
      record.responseBody && typeof record.responseBody === "object"
        ? { ...record.responseBody }
        : {};

    // The fixture supplies the action payload; the harness supplies the state.
    // Captured responses carry the *capture's* state, and letting that through
    // would silently overwrite the gates a test set up on the first POST — the
    // cycle would then run against the other account's board and assert
    // nothing.
    body.state = fallbackState;
    return body;
  };

  farmer.get = (requestPath) => Promise.resolve(serve("GET", requestPath));
  farmer.post = (requestPath, payload = {}) =>
    Promise.resolve(serve("POST", requestPath, payload));

  return { calls, missing, state: fallbackState };
}

/** Every recorded call must be a route we hold evidence for. */
export function assertRoutesAllowed(calls) {
  const offenders = calls.filter((call) => !ALLOWED_ROUTES.has(call.path));
  assert.deepStrictEqual(
    offenders.map((call) => `${call.method} ${call.path}`),
    [],
    "the farmer called a route with no capture and no bundle evidence",
  );
}

/** No call may touch a route that spends money or hands over an asset. */
export function assertNothingSpends(calls) {
  const offenders = calls.filter((call) =>
    FORBIDDEN_PATTERNS.some((pattern) => pattern.test(call.path)),
  );
  assert.deepStrictEqual(
    offenders.map((call) => `${call.method} ${call.path}`),
    [],
    "a cycle must never reach a route that spends money or an asset",
  );
}

/** Box opens must buy with a key, never with GRAM. */
export function assertPayIsAlwaysKey(calls) {
  const boxes = calls.filter((call) => call.path === "/api/box/open");
  for (const call of boxes) {
    assert.strictEqual(
      call.payload?.pay,
      "key",
      "omitting `pay` makes the server bill GRAM",
    );
  }
}
