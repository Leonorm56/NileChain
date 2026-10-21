/**
 * The drop's own slider puzzle.
 *
 * The page draws a background with a piece cut out of it, and the user drags
 * the piece into the gap. It then posts three things: the answer, where the
 * piece has to sit, and the pointer trace of the drag that got it there.
 *
 * The trace is a list of `[elapsedMs, x, y]` triples — the page records the
 * pointer from the moment it goes down to the moment it comes up.
 */

/** The canvas the puzzle is drawn on. */
const CANVAS_WIDTH = 320;

/** The knob the user drags. */
const KNOB_SIZE = 44;

/** How far the knob travels across the track. */
export const MAX_DRAG_DISTANCE = CANVAS_WIDTH - KNOB_SIZE;

/** The answer scale — the drop reads 0 to 263 off the drag. */
export const SLIDER_X_MAX = 263;

/** The page caps how many points it records. */
const MAX_TRACE_POINTS = 2500;

/**
 * The pointer trace for a drag that ends at the given answer.
 *
 * The answer is scaled onto the track the way the page scales it, and the
 * drag eases the way a hand eases — slowing as it lands — so the trace reads
 * like a drag rather than a sweep.
 *
 * @param {number} sliderX - the answer, 0 to 263
 * @returns {number[][]} the `[elapsedMs, x, y]` triples
 */
export function buildSliderTrace(sliderX) {
  const answer = Math.max(0, Math.min(SLIDER_X_MAX, Number(sliderX) || 0));
  const distance = (answer / SLIDER_X_MAX) * MAX_DRAG_DISTANCE;

  const steps = Math.max(2, Math.min(240, Math.round(30 + distance / 4)));
  const duration = 700 + Math.round(Math.random() * 400);

  const trace = [];

  for (let i = 0; i <= steps; i++) {
    const p = i / steps;
    const eased = 1 - Math.pow(1 - p, 2.2);

    const elapsed = Math.round(p * duration);
    const x = Math.round(distance * eased * 10) / 10;
    const y = Math.round(Math.sin(p * Math.PI) * 1.4 * 10) / 10;

    trace.push([elapsed, x, y]);
  }

  if (trace.length > MAX_TRACE_POINTS) {
    trace.length = MAX_TRACE_POINTS;
  }

  return trace;
}

/**
 * Where the piece has to slide to.
 *
 * The answer is read off the two images the challenge hands over: the piece
 * is cut out of the background, so the gap is found by sliding the piece
 * across the background until its pixels line up.
 *
 * @param {object} challenge - `bgImage`, `pieceImage`, `pieceTop`, `pieceOffsetX`
 * @returns {number} the answer, 0 to 263
 */
export function findSliderX(challenge) {
  if (!challenge?.bgImage || !challenge?.pieceImage) {
    throw new Error("The puzzle challenge carries no images.");
  }

  throw new Error(
    "The slider puzzle is not solved yet — the piece has to be matched against the background.",
  );
}
