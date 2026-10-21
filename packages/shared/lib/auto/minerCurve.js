/**
 * The miner curve.
 *
 * The drop runs 1,000 levels, each one costing more holding than the last and
 * mining faster than the one before it. The page draws the curve from these
 * formulas, so the farmer prices a level exactly the way the app does.
 */

/** The highest level the drop has. */
export const MAXIMUM_MINER_LEVEL = 1000;

/**
 * The holding a level costs.
 *
 * Five bands, each a different power curve, joined at the levels the page
 * treats as milestones: 1, 203, 450, 650 and 850.
 *
 * @param {number} level
 * @returns {number} the holding the level asks for
 */
export function getMinerRequiredHolding(level) {
  const e = Number(level) || 0;

  if (e <= 0) return 0;
  if (e === 1) return 100;
  if (e === 203) return 1e4;
  if (e >= MAXIMUM_MINER_LEVEL) return 3875968992;

  if (e <= 203) {
    const t = (e - 1) / 202;
    return Math.round(100 + 9900 * Math.pow(t, 1.8));
  }

  if (e <= 450) {
    const t = (e - 203) / 247;
    return Math.round(1e4 + 24e4 * Math.pow(t, 2));
  }

  if (e <= 650) {
    const t = (e - 450) / 200;
    return Math.round(25e4 + 26881780 * Math.pow(t, 2.2));
  }

  if (e <= 850) {
    const t = (e - 650) / 200;
    return Math.round(27131780 + 321705420 * Math.pow(t, 2.5));
  }

  const n = (e - 850) / 150;
  return Math.round(348837200 + 3527131792 * Math.pow(n, 2.6));
}

/**
 * The speed a level mines at, in TH/s.
 *
 * @param {number} level
 * @returns {number}
 */
export function getMinerSpeed(level) {
  const e = Number(level) || 0;

  if (e <= 0) return 0;
  if (e === 1) return 0.2;
  if (e === 203) return 7.56;
  if (e >= MAXIMUM_MINER_LEVEL) return 5000;

  if (e <= 203) {
    const s = 0.2 + (e - 1) * 0.03643564356435643;
    return Number(s.toFixed(2));
  }

  const n = (e - 203) / 797;
  const t = 7.56 + (5000 - 7.56) * Math.pow(n, 2.1);

  return Number(t.toFixed(2));
}

/**
 * What a level mines in a day.
 *
 * @param {number} level
 * @returns {number} the MRG a day at that level
 */
export function getMinerDailyOutput(level) {
  const e = Number(level) || 0;

  if (e <= 0) return 0;
  if (e === 1) return 5;

  return Number((getMinerSpeed(e) * 25).toFixed(2));
}

/**
 * The highest level a holding covers.
 *
 * A connected wallet grants the first level for free, so an account that has
 * bound one is never at level zero.
 *
 * @param {number} holding
 * @param {boolean} [walletConnected]
 * @returns {number} the level the holding reaches
 */
export function findMinerLevelForHolding(holding, walletConnected = true) {
  const e = Number(holding) || 0;

  if (!walletConnected && e <= 0) return 0;
  if (e < 100) return walletConnected ? 1 : 0;

  let low = 1;
  let high = MAXIMUM_MINER_LEVEL;
  let best = 1;

  while (low <= high) {
    const mid = Math.floor((low + high) / 2);

    if (e >= getMinerRequiredHolding(mid)) {
      best = mid;
      low = mid + 1;
    } else {
      high = mid - 1;
    }
  }

  return best;
}
