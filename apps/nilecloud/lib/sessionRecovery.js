import fsp from "node:fs/promises";
import crypto from "node:crypto";
import path from "node:path";

/**
 * Rebuild an account's Telegram session from the one it already holds.
 *
 * No phone number and no login code: the session we have accepts a login token
 * that a fresh client exported (`GramClient.cloneSession`). Accounts with 2FA
 * need a candidate password — the caller supplies them.
 *
 * This is the recovery for a session that connects but never answers: nothing
 * about a new client, a new proxy or a retry fixes that, because the session
 * itself is the dead half.
 */

/** Read the session string an account is currently using */
export async function readSessionString(sessionsPath, sessionName) {
  const filePath = path.join(sessionsPath, `session_${sessionName}.json`);

  let file;

  try {
    file = JSON.parse(await fsp.readFile(filePath, "utf8"));
  } catch {
    throw new Error("Session file is missing or unreadable");
  }

  const sessionString = typeof file === "string" ? file : file?.session;

  if (!sessionString) {
    throw new Error("Session file holds no session string");
  }

  return { filePath, sessionString };
}

/**
 * @param {object} options
 * @param {typeof import("./GramClient.js").default} options.GramClient
 * @param {object} options.account Account row (must carry `session`)
 * @param {object|null} [options.farmer] Farmer row to reset on success
 * @param {string} options.sessionsPath Directory holding `session_*.json`
 * @param {string[]} [options.passwords] Candidate 2FA passwords
 * @param {string|null} [options.proxy] Proxy string for the Telegram clients
 * @returns {Promise<{ session: string, user: object|null }>}
 */
export default async function cloneAccountSession({
  GramClient,
  account,
  farmer = null,
  sessionsPath,
  passwords = [],
  proxy = null,
}) {
  if (!account?.session) {
    throw new Error("Account has no session to clone from");
  }

  const { filePath, sessionString } = await readSessionString(
    sessionsPath,
    account.session,
  );

  const cloned = await GramClient.cloneSession(sessionString, {
    passwords,
    proxy,
  });

  /** Store the new session under a fresh name and point the account at it */
  const session = crypto.randomBytes(8).toString("hex");

  await GramClient.writeSession(session, cloned.session);
  await account.update({ session });

  if (farmer) {
    /** The old failure counts belonged to the old session */
    await farmer.update({
      errorCount: 0,
      isBanned: false,
      active: true,
      initData: null,
    });
  }

  /** Drop the replaced session file */
  await fsp.unlink(filePath).catch(() => {});

  return { session, user: cloned.user ?? null };
}
