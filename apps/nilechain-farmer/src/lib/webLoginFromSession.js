import { TelegramClient } from "telegram";
import { StringSession } from "telegram/sessions";
import { NewMessage } from "telegram/events";
import { AuthKey } from "telegram/crypto/AuthKey";
import { postPortMessage } from "@/utils";

/**
 * Build Telegram Web localStorage JSON from a local StringSession.
 * Reuses Spider.js:289 pattern — same apiId/hash, same dc*_auth_key layout.
 * No code needed if the session is still authorized.
 */
export async function buildWebStorageFromSession(sessionString) {
  const { StringSession: SS } = await import("telegram/sessions");
  const { TelegramClient: TC } = await import("telegram");

  const session = new SS(sessionString);
  const client = new TC(session, 2496, "8da85b0d5bfe62527e5b244c209159c3", {
    appVersion: "2.2 K",
    systemLangCode: "en-US",
    langCode: "en",
    deviceModel: navigator.userAgent,
    systemVersion: navigator.platform,
    useWSS: true,
  });

  let user = null;
  let authKey = null;
  let dcId = null;
  try {
    await client.connect();

    const authorized = await client.isUserAuthorized();
    if (!authorized) {
      throw new Error("Local session is no longer authorized. Session expired.");
    }

    user = await client.getMe();
    authKey = client.session.authKey?.getKey()?.toString("hex");
    dcId = client.session.dcId;
  } finally {
    try {
      await client.destroy();
    } catch (_) {}
  }

  if (!authKey || !dcId) {
    throw new Error("Could not extract authKey/dcId from local session.");
  }

  const entry = {
    dcId,
    [`dc${dcId}_auth_key`]: authKey,
    dc2_auth_key: authKey,
    userId: user.id.toString(),
    auth_key_fingerprint: authKey.slice(0, 8),
  };

  return {
    account1: JSON.stringify(entry),
    _user: user,
    _dcId: dcId,
    _authKey: authKey,
  };
}

/**
 * Inject a Web account entry via port messaging.
 * Mirrors SpiderAccountsForm.jsx:37 transferTelegramWebData.
 * @param {"k"|"a"|"both"} target — which Web version to inject into
 */
export async function injectWebAccount(messaging, setActiveTab, closeTab, webStorage, target = "k") {
  const closeTelegramWeb = () => {
    closeTab("telegram-web-k");
    closeTab("telegram-web-a");
  };

  const injectOnce = (version) =>
    new Promise(async (resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error(`Web ${version.toUpperCase()} port timeout (15s)`)), 15000);

      messaging.handler.once(`port-connected:telegram-web-${version}`, async (port) => {
        clearTimeout(timeout);
        try {
          const current = await postPortMessage(port, {
            action: "get-local-storage",
          }).then((r) => r.data);

          let maxAccount = 0;
          for (const key in current) {
            const m = key.match(/account(\d+)/);
            if (m) {
              const n = parseInt(m[1], 10);
              if (n > maxAccount) maxAccount = n;
            }
          }
          const newAccountNumber = maxAccount + 1;
          const updated = {
            ...current,
            [`account${newAccountNumber}`]: webStorage.account1,
          };

          await postPortMessage(port, {
            action: "set-local-storage",
            data: updated,
          });

          closeTelegramWeb();
          resolve(newAccountNumber);
        } catch (e) {
          reject(e);
        }
      });

      setActiveTab(`telegram-web-${version}`);
    });

  await closeTelegramWeb();

  let n;
  if (target === "both") {
    // localStorage is per-origin (web.telegram.org) so one injection is
    // visible to both, but do both sequentially for determinism
    n = await injectOnce("k");
    // brief pause between the two injections
    await new Promise((r) => setTimeout(r, 800));
    try {
      await injectOnce("a");
    } catch (_) {
      // A injection best-effort — K already succeeded
    }
  } else {
    n = await injectOnce(target);
  }

  await setActiveTab("spider");
  return n;
}

/**
 * Fallback: intercept code from local session when direct authKey injection
 * is rejected by WebK (e.g. DC mismatch). Uses NewMessage {fromUsers:[777000]}
 * with /(\d{5})/ exactly like TelegramLogin.jsx:72 and Spider.js:165.
 * Caller is responsible for triggering WebK sendCode for the same phone.
 */
export function interceptCodeFromSession(sessionString, timeoutMs = 60000) {
  return new Promise(async (resolve, reject) => {
    let client;
    let timer;
    let handler;
    let eventBuilder;

    const cleanup = async () => {
      if (timer) clearTimeout(timer);
      try {
        if (client && handler && eventBuilder) client.removeEventHandler(handler, eventBuilder);
      } catch (_) {}
      try {
        if (client) await client.destroy();
      } catch (_) {}
    };

    timer = setTimeout(async () => {
      await cleanup();
      reject(new Error("Code intercept timeout — no message from 777000"));
    }, timeoutMs);

    try {
      const { StringSession: SS } = await import("telegram/sessions");
      const { TelegramClient: TC } = await import("telegram");
      const session = new SS(sessionString);
      client = new TC(session, 2496, "8da85b0d5bfe62527e5b244c209159c3", {
        appVersion: "2.2 K",
        systemLangCode: "en-US",
        langCode: "en",
        deviceModel: navigator.userAgent,
        systemVersion: navigator.platform,
        useWSS: true,
      });

      await client.connect();
      const ok = await client.isUserAuthorized();
      if (!ok) {
        await cleanup();
        return reject(new Error("Local session not authorized"));
      }

      handler = (event) => {
        const msg = event.message?.message || "";
        const m = msg.match(/(\d{5})/);
        if (m) {
          const code = m[1];
          cleanup().then(() => resolve(code));
        }
      };

      eventBuilder = new NewMessage({ fromUsers: [777000] });
      client.addEventHandler(handler, eventBuilder);
    } catch (e) {
      await cleanup();
      reject(e);
    }
  });
}

/**
 * Full flow: try direct authKey injection first; caller can fall back to
 * interceptCodeFromSession if Web still shows login screen.
 * @param {"k"|"a"|"both"} target
 */
export async function loginWebFromLocalSession({ sessionString, messaging, setActiveTab, closeTab, target = "k" }) {
  const webStorage = await buildWebStorageFromSession(sessionString);
  const accountNumber = await injectWebAccount(messaging, setActiveTab, closeTab, webStorage, target);
  return { accountNumber, user: webStorage._user };
}
