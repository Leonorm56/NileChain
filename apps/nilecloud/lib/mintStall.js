import { delay } from "@nile/shared/utils/delay.js";

/**
 * A stall: the connection came up, but Telegram never answers on it.
 *
 * Measured on the rignite box for the accounts that keep failing to mint:
 * `connect()` completes in ~2s, then the first invoke never returns — 30s bound,
 * no reply — repeatable alone, one account at a time, through that account's own
 * proxy. A healthy account answered the same call in 607ms.
 *
 * Because the connection *is* up, nothing connection-level notices; because the
 * session is what's broken, retrying it changes nothing. It just spends the mint
 * ceiling again, every cycle, forever, and the account earns nothing because its
 * init data can never be renewed.
 */

export class MintStalledError extends Error {
  constructor(message) {
    super(message);

    this.name = "MintStalledError";
    this.code = "MINT_STALLED";
  }
}

/**
 * The worse half of a stall: the session never answered at all.
 *
 * Retrying is pointless, and so is rebuilding — a rebuild waits on this very
 * session to accept the login token. Such an account needs a fresh login, so the
 * only useful thing to do is say so, quickly.
 */
export class SessionSilentError extends MintStalledError {
  constructor(message) {
    super(message);

    this.name = "SessionSilentError";
    this.code = "MINT_STALLED_SESSION";
  }
}

/** Does this failure mean the session itself is silent? */
export function isSessionSilentError(error) {
  return Boolean(error) && error.code === "MINT_STALLED_SESSION";
}

/** Stall wordings that can arrive as plain errors from a caller */
const STALL_PATTERNS = [/MTProto stalled/i, /never answered/i];

/** How long a live session gets to answer the first invoke */
export const DEFAULT_SESSION_REPLY_TIMEOUT_MS = 8_000;

/**
 * Fail fast when the session is connected but cannot be talked to.
 *
 * Measured on the rignite box, for the accounts that fail to authenticate every
 * cycle: `connect()` completes in ~2s and the first invoke never returns — no
 * reply inside 30s — repeatable alone, one account at a time, through that
 * account's own proxy, while a healthy account answered the same call in 607ms.
 *
 * @param {object} client Connected Telegram client
 * @param {{ timeoutMs?: number }} [options]
 * @throws {MintStalledError} when the session never replies
 */
export async function assertSessionReplies(
  client,
  { timeoutMs = DEFAULT_SESSION_REPLY_TIMEOUT_MS } = {},
) {
  const replied = await Promise.race([
    /** Any reply proves the session is alive — including a refusal */
    client.isUserAuthorized().then(
      () => true,
      () => true,
    ),
    delay(timeoutMs, { precised: true }).then(() => false),
  ]);

  if (!replied) {
    throw new SessionSilentError(
      "Telegram session connected but never answered (dead session)",
    );
  }
}

/** Is this error the "connection up, no answer" failure? */
export function isMintStalledError(error) {
  if (!error) return false;
  if (error instanceof MintStalledError) return true;
  if (error.code === "MINT_STALLED") return true;

  const message = typeof error === "string" ? error : error.message || "";

  return STALL_PATTERNS.some((pattern) => pattern.test(message));
}
