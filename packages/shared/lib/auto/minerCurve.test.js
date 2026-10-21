import assert from "node:assert/strict";
import { test } from "node:test";

import {
  MAXIMUM_MINER_LEVEL,
  findMinerLevelForHolding,
  getMinerDailyOutput,
  getMinerRequiredHolding,
  getMinerSpeed,
} from "./minerCurve.js";

/**
 * The curve the drop's own page draws from. The levels where the page treats
 * something as a milestone are the ones the curve is pinned to, so those are
 * the values worth holding still.
 */
test("the curve starts where the page starts it", () => {
  assert.equal(MAXIMUM_MINER_LEVEL, 1000);
  assert.equal(getMinerRequiredHolding(0), 0);
  assert.equal(getMinerRequiredHolding(1), 100);
  assert.equal(getMinerRequiredHolding(203), 10_000);
  assert.equal(getMinerRequiredHolding(450), 250_000);
  assert.equal(getMinerRequiredHolding(650), 27_131_780);
  assert.equal(getMinerRequiredHolding(850), 348_837_200);
  assert.equal(getMinerRequiredHolding(1000), 3_875_968_992);
});

test("the curve only ever asks for more", () => {
  let previous = 0;

  for (let level = 1; level <= MAXIMUM_MINER_LEVEL; level += 37) {
    const required = getMinerRequiredHolding(level);
    assert.ok(
      required > previous,
      `level ${level} asks for ${required}, no more than level ${level - 1}'s ${previous}`,
    );
    previous = required;
  }
});

test("the speed grows with the level", () => {
  assert.equal(getMinerSpeed(0), 0);
  assert.equal(getMinerSpeed(1), 0.2);
  assert.equal(getMinerSpeed(203), 7.56);
  assert.equal(getMinerSpeed(1000), 5000);

  assert.ok(getMinerSpeed(500) > getMinerSpeed(300));
  assert.ok(getMinerSpeed(900) > getMinerSpeed(500));
});

test("the daily output follows the speed", () => {
  assert.equal(getMinerDailyOutput(0), 0);
  assert.equal(getMinerDailyOutput(1), 5);
  assert.equal(getMinerDailyOutput(203), 189);
  assert.equal(getMinerDailyOutput(1000), 125_000);
});

test("a holding finds the level it reaches", () => {
  /* A holding under the first level still reaches level 1 with a wallet. */
  assert.equal(findMinerLevelForHolding(0, true), 1);
  assert.equal(findMinerLevelForHolding(0, false), 0);

  /* Exactly the level's own holding reaches that level. */
  for (const level of [1, 10, 203, 450, 650, 850, 1000]) {
    const required = getMinerRequiredHolding(level);
    assert.equal(findMinerLevelForHolding(required, true), level);
  }

  /* Just under the next level's holding stops short of it. */
  const level203 = getMinerRequiredHolding(203);
  assert.equal(findMinerLevelForHolding(level203 - 1, true), 202);
});
