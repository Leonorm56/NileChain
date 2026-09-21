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
 * Every failure is retried. There is deliberately no "fatal" class: a session
 * that answers `SESSION_REVOKED` twice in a row minted successfully eight times
 * out of eight minutes later on the rignite box, so refusing to retry would
 * throw away the recovery. Persistence of failure is what matters, and that is
 * counted across cycles by the caller.
 *
 * Never throws: a refresh that cannot succeed is reported, not raised, so the
 * caller can decide to carry on with the init data it already has.
 *
 * @param {object} options
 * @param {() => Promise<void>} options.attempt One connect + refresh, bounded by its own timeout.
 * @param {(error: Error, attemptNo: number) => void} [options.onFailure] Called after each failed attempt.
 * @param {number} [options.attempts] Total attempts to make (default 2).
 * @returns {Promise<{ ok: boolean, attempts: number, error: Error|null }>}
 */
export default async function refreshInitData({ attempt, onFailure, attempts = 2 }) {
  let error = null;

  for (let attemptNo = 1; attemptNo <= attempts; attemptNo += 1) {
    try {
      await attempt();
      return { ok: true, attempts: attemptNo, error: null };
    } catch (e) {
      error = e;
      onFailure?.(e, attemptNo);
    }
  }

  return { ok: false, attempts, error };
}
