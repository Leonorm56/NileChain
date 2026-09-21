/**
 * Telegram session health.
 *
 * A refresh that fails is not automatically a problem — Telegram throttles this
 * box (429s, stalled MTProto connections, flood waits) and the next cycle may
 * well succeed. Some failures are different in kind: the session itself is gone
 * (`SESSION_REVOKED`, `AUTH_KEY_UNREGISTERED`, a deactivated user). Retrying
 * those wastes a connect every cycle and, worse, the account quietly stops
 * earning because it can never mint fresh init data again — only a fresh phone
 * login fixes it. These helpers separate the two, and describe the dead ones.
 */

/**
 * Age at which init data is treated as critical. Rignite was observed working
 * at 20.2h and refusing at 26.1h, so the real wall sits in between; warning at
 * 18h leaves room to re-login before the account stops earning.
 */
export const INIT_DATA_STALE_HOURS = 18;

/**
 * Consecutive failed mints before an account is reported.
 *
 * One refusal proves nothing: a session that was refused twice in a row was
 * minting successfully eight times out of eight minutes later (measured). The
 * trigger has to be persistence, not a single error.
 */
export const MINT_FAILURE_ALERT_THRESHOLD = 3;

/**
 * Should this account be reported as needing help?
 *
 * @param {object} options
 * @param {number} options.consecutiveFailures Failed mints in a row (0 when the last cycle minted).
 * @param {number|null} [options.ageHours] Age of the init data actually in use.
 * @returns {boolean}
 */
export function shouldAlert({ consecutiveFailures = 0, ageHours = null } = {}) {
  /** Minting has failed repeatedly — it cannot renew its own init data */
  if (consecutiveFailures >= MINT_FAILURE_ALERT_THRESHOLD) {
    return true;
  }

  /** Whatever the cause, the data it farms with is about to expire */
  if (typeof ageHours === "number" && ageHours >= INIT_DATA_STALE_HOURS) {
    return true;
  }

  return false;
}

const DEAD_SESSION_PATTERNS = [
  /SESSION_REVOKED/,
  /SESSION_EXPIRED/,
  /AUTH_KEY_UNREGISTERED/,
  /AUTH_KEY_INVALID/,
  /USER_DEACTIVATED/,
];

/**
 * Does this error read like the session itself was rejected?
 *
 * Used to describe a failure in the log and in the alert — NOT to decide
 * whether to retry. The same session produced this and then minted 8/8 shortly
 * after, so a refusal is a symptom to report, never a reason to give up.
 *
 * Accepts whatever the client throws — gramjs RPCErrors carry `errorMessage`,
 * plain Errors carry `message`, and some paths stringify — so nothing is missed
 * because it arrived in an unexpected shape.
 *
 * @param {unknown} error
 * @returns {boolean}
 */
export function isDeadSessionError(error) {
  if (!error) {
    return false;
  }

  const text = [
    typeof error === "string" ? error : null,
    error?.errorMessage,
    error?.description,
    error?.message,
  ]
    .filter(Boolean)
    .join(" ")
    .toUpperCase();

  if (!text) {
    return false;
  }

  return DEAD_SESSION_PATTERNS.some((pattern) => pattern.test(text));
}

/**
 * How old is this init data, in hours, according to the `auth_date` it carries?
 *
 * Rignite stops accepting init data once it is old enough (observed: fine at
 * 20.2h, refused at 26.1h), so the age is what tells you an account is on its
 * way out rather than already gone.
 *
 * @param {string} initData
 * @returns {number|null} Hours since auth_date, or null when it can't be read.
 */
export function initDataAgeHours(initData) {
  if (!initData || typeof initData !== "string") {
    return null;
  }

  try {
    const authDate = new URLSearchParams(initData).get("auth_date");

    if (!authDate) {
      return null;
    }

    const seconds = Number(authDate);

    if (!Number.isFinite(seconds)) {
      return null;
    }

    const age = (Date.now() / 1000 - seconds) / 3600;

    return age < 0 ? 0 : age;
  } catch {
    return null;
  }
}

/**
 * Build the `DEAD SESSION` message lines for the Telegram group.
 *
 * @param {object} options
 * @param {string} options.title Farmer title, e.g. "Rignite".
 * @param {Array<{ id: string|number, title?: string|null, username?: string|null, ageHours?: number|null, reason?: string|null }>} options.accounts
 * @returns {string[]} Lines to be joined by the bot.
 */
export function formatDeadSessionLines({ title, accounts = [] } = {}) {
  const lines = [
    `💀 <b>DEAD SESSION</b> — ${title} Farmer`,
    `<i>${accounts.length} account${accounts.length === 1 ? "" : "s"} can no longer authenticate — re-login required</i>`,
    "",
  ];

  for (const account of accounts) {
    const username = account.username ? ` @${account.username}` : "";
    const name = account.title ? ` — ${account.title}` : "";
    const age =
      typeof account.ageHours === "number"
        ? `init data ${account.ageHours.toFixed(1)}h old`
        : "";
    const detail = [age, account.reason].filter(Boolean).join(", ");

    lines.push(
      `• <code>${account.id}</code>${username}${name}${detail ? ` (${detail})` : ""}`,
    );
  }

  return lines;
}
