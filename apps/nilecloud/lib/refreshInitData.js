import { isMintStalledError } from "./mintStall.js";

/**
 * Run one Telegram connect + init-data refresh, retrying on failure.
 *
 * Telegram throttles the sessions this box farms from a single IP, so a refresh
 * regularly stalls past its timeout (measured on the rignite server: 2,926 of
 * 10,051 attempts failed, roughly half stalling inside `connect()` and half
 * inside the webview fetch). A failed refresh is not harmless — the farmer keeps
 * its previous init data, and once that goes stale Rignite answers `/auth` with
 * a 401 GENERIC which costs the account its entire cycle. Retrying once on a
 * fresh connection recovers the stalls that are transient.
 *
 * Every failure is retried, with two deliberate exceptions:
 *
 * - A **silent session** (`isFatalStall`): the connection is up but Telegram
 *   never answers on it — measured on this box at no reply inside 30s, alone,
 *   one account at a time, through its own proxy. Retrying it changes nothing,
 *   and rebuilding it cannot work either, because the rebuild waits on that very
 *   session to accept the login token. Failing fast is the only honest option.
 * - A **stall that repeats** (`recover`): the session answered (so a fresh client
 *   was worth the retry, and the rebuild can use that session), but the mint
 *   still never completed. Rebuild once, then make one attempt on the rebuilt
 *   session.
 *
 * There is otherwise no "fatal" class: a session that answers `SESSION_REVOKED`
 * twice in a row minted successfully eight times out of eight minutes later on
 * the rignite box, so refusing to retry would throw away the recovery.
 * Persistence of failure is what matters, and that is counted across cycles by
 * the caller.
 *
 * Never throws: a refresh that cannot succeed is reported, not raised, so the
 * caller can decide to carry on with the init data it already has.
 *
 * @param {object} options
 * @param {() => Promise<void>} options.attempt One connect + refresh, bounded by its own timeout.
 * @param {(error: Error, attemptNo: number) => void} [options.onFailure] Called after each failed attempt.
 * @param {number} [options.attempts] Total attempts to make (default 2).
 * @param {(error: Error) => Promise<boolean>} [options.recover] Rebuild the session after a repeated stall; true when a fresh one is ready.
 * @param {(error: Error) => boolean} [options.isFatalStall] A stall that cannot be retried or rebuilt.
 * @param {(error: Error) => boolean} [options.isStalled] Recognise the stall class.
 * @returns {Promise<{ ok: boolean, attempts: number, error: Error|null }>}
 */
export default async function refreshInitData({
  attempt,
  onFailure,
  attempts = 2,
  recover,
  isFatalStall = () => false,
  isStalled = isMintStalledError,
}) {
  let error = null;
  let recovered = false;

  for (let attemptNo = 1; attemptNo <= attempts; attemptNo += 1) {
    try {
      await attempt();
      return { ok: true, attempts: attemptNo, error: null };
    } catch (e) {
      error = e;
      onFailure?.(e, attemptNo);

      /**
       * Nothing to retry on and nothing to rebuild from: the session itself is
       * what stopped answering. Stop instead of spending the ceiling again.
       */
      if (isFatalStall(e)) {
        break;
      }

      /**
       * The retry budget is spent and the stall is still there, so the session
       * is the problem rather than the connection. Rebuild it once and try.
       */
      if (recover && !recovered && isStalled(e) && attemptNo >= attempts) {
        recovered = true;

        if (!(await recover(e))) {
          /** Nothing to retry on — stop rather than loop the ceiling */
          break;
        }

        try {
          await attempt();
          return { ok: true, attempts: attemptNo + 1, error: null };
        } catch (e2) {
          error = e2;
          onFailure?.(e2, attemptNo + 1);
          break;
        }
      }
    }
  }

  return { ok: false, attempts, error };
}
