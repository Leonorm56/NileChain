import assert from "node:assert/strict";
import { test } from "node:test";

import {
  MAX_DRAG_DISTANCE,
  SLIDER_X_MAX,
  buildSliderTrace,
  findSliderX,
} from "./sliderCaptcha.js";

test("the trace is a list of elapsed-millisecond, x and y triples", () => {
  const trace = buildSliderTrace(100);

  assert.ok(trace.length > 1, "the trace has no points");

  for (const point of trace) {
    assert.equal(point.length, 3, "a point is not [t, x, y]");
    assert.equal(typeof point[0], "number");
    assert.equal(typeof point[1], "number");
    assert.equal(typeof point[2], "number");
  }
});

test("the trace starts at zero and ends where the drag ended", () => {
  const trace = buildSliderTrace(0);

  assert.deepEqual(trace[0], [0, 0, 0]);
  assert.equal(trace.at(-1)[1], 0);

  const moved = buildSliderTrace(SLIDER_X_MAX);
  assert.equal(moved.at(-1)[1], MAX_DRAG_DISTANCE);
});

test("the drag only ever moves forward", () => {
  const trace = buildSliderTrace(200);

  let previous = -1;
  for (const [, x] of trace) {
    assert.ok(x >= previous, "the drag went backwards");
    previous = x;
  }
});

test("the answer scales onto the track the way the page scales it", () => {
  /* The page reads the answer off the drag: round(x / 276 * 263). */
  for (const answer of [0, 50, 131, 200, 263]) {
    const trace = buildSliderTrace(answer);
    const drag = trace.at(-1)[1];
    const scaled = Math.round((drag / MAX_DRAG_DISTANCE) * SLIDER_X_MAX);

    assert.equal(scaled, answer, `answer ${answer} came back as ${scaled}`);
  }
});

test("the trace takes a human amount of time", () => {
  const trace = buildSliderTrace(200);
  const elapsed = trace.at(-1)[0];

  assert.ok(elapsed >= 700, `the drag took ${elapsed}ms`);
  assert.ok(elapsed <= 1200, `the drag took ${elapsed}ms`);
});

test("a challenge with no images is refused", () => {
  assert.throws(() => findSliderX({}), /no images/);
});
