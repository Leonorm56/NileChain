import { TelegramClient } from "telegram";
import { StringSession } from "telegram/sessions/index.js";
import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";

import { getConfig } from "./storage.js";

const cfg = getConfig();
const API_ID = cfg.telegram.apiId || 2496;
const API_HASH = cfg.telegram.apiHash || "8da85b0d5bfe62527e5b244c209159c3";
const SESSIONS_DIR = path.resolve("sessions");

async function ensureDir() {
  await fs.mkdir(SESSIONS_DIR, { recursive: true });
}

function sessionPath(id) {
  return path.join(SESSIONS_DIR, `session_${id}.json`);
}

export const pendingAuths = new Map();

export async function startPhoneAuth(phone) {
  await ensureDir();
  const sessionId = crypto.randomBytes(8).toString("hex");

  const client = new TelegramClient(new StringSession(""), API_ID, API_HASH, {
    connectionRetries: 5,
    appVersion: "2.2 K",
    systemLangCode: "en-US",
    langCode: "en",
  });

  await client.connect();

  let codeResolve, passwordResolve, errorReject;
  const codePromise = new Promise((r) => { codeResolve = r; });
  const passwordPromise = new Promise((r) => { passwordResolve = r; });

  const authData = { client, codeResolve, passwordResolve, stage: "code", userId: null, sessionString: null };

  client.start({
    phoneNumber: async () => phone,
    phoneCode: async () => {
      authData.stage = "code";
      return codePromise;
    },
    password: async (hint) => {
      authData.stage = "password";
      authData.passwordHint = hint;
      return passwordPromise;
    },
    onError: (err) => {
      authData.error = err.message;
      authData.stage = "error";
    },
  }).then(async () => {
    const user = await client.getMe();
    authData.userId = user.id?.toString();
    authData.sessionString = client.session.save();
    authData.stage = "complete";
    await client.destroy();
    await fs.writeFile(sessionPath(sessionId), JSON.stringify(authData.sessionString));
  }).catch((err) => {
    authData.error = err.message;
    authData.stage = "error";
  });

  pendingAuths.set(sessionId, authData);

  return { session: sessionId };
}

export async function submitCode(sessionId, code) {
  const auth = pendingAuths.get(sessionId);
  if (!auth) throw new Error("Session not found");
  if (auth.stage !== "code") throw new Error(`Unexpected stage: ${auth.stage}`);

  auth.stage = "submitting";
  auth.codeResolve(code);
  return { type: "waiting" };
}

export async function submitPassword(sessionId, password) {
  const auth = pendingAuths.get(sessionId);
  if (!auth) throw new Error("Session not found");
  if (auth.stage !== "password") throw new Error(`Unexpected stage: ${auth.stage}`);

  auth.stage = "submitting";
  auth.passwordResolve(password);
  return { type: "waiting" };
}

export async function waitForAuth(sessionId, timeoutMs = 60000) {
  const auth = pendingAuths.get(sessionId);
  if (!auth) throw new Error("Session not found");

  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (auth.stage === "complete") {
      pendingAuths.delete(sessionId);
      return { user: { id: auth.userId }, sessionString: auth.sessionString };
    }
    if (auth.stage === "error") {
      pendingAuths.delete(sessionId);
      throw new Error(auth.error);
    }
    if (auth.stage === "password") {
      return { type: "password", hint: auth.passwordHint };
    }
    await new Promise((r) => setTimeout(r, 100));
  }

  pendingAuths.delete(sessionId);
  throw new Error("Authentication timeout");
}

export async function loadSession(sessionId) {
  try {
    const data = await fs.readFile(sessionPath(sessionId), "utf-8");
    return JSON.parse(data);
  } catch {
    return null;
  }
}

export async function createClientFromSession(sessionString) {
  const client = new TelegramClient(new StringSession(sessionString), API_ID, API_HASH, {
    connectionRetries: 5,
    appVersion: "2.2 K",
    systemLangCode: "en-US",
    langCode: "en",
  });
  client._loopStarted = true; // prevent update loop from starting — we only need one-off RPC calls
  await client.connect();
  return client;
}

export async function logoutSession(sessionString) {
  try {
    const client = await createClientFromSession(sessionString);
    await client.invoke(new (await import("telegram")).Api.auth.LogOut({}));
      await client.destroy();
    } catch (err) {
      logger.warn("Logout error:", err.message);
    }
}

export async function deleteSessionFile(sessionId) {
  try {
    await fs.unlink(sessionPath(sessionId));
  } catch {}
}

export async function refreshInitData(sessionString, botUsername, startParam, shortName) {
  const client = await createClientFromSession(sessionString);

  let url;
  try {
    const entity = await client.getInputEntity(botUsername);
    const me = await client.getMe();
    const api = await import("telegram");

    if (shortName) {
      const result = await client.invoke(
        new api.Api.messages.RequestAppWebView({
          platform: "android",
          peer: entity,
          app: new api.Api.InputBotAppShortName({
            botId: entity,
            shortName,
          }),
          startParam,
          themeParams: new api.Api.DataJSON({
            data: JSON.stringify({
              bg_color: "#ffffff", text_color: "#000000",
              hint_color: "#aaaaaa", link_color: "#006aff",
              button_color: "#2cab37", button_text_color: "#ffffff",
            }),
          }),
        })
      );
      url = result.url;
    } else {
      const result = await client.invoke(
        new api.Api.messages.RequestWebView({
          peer: entity,
          bot: entity,
          fromBotMenu: false,
          platform: "android",
          startParam,
        })
      );
      url = result.url;
    }
  } finally {
    try { await client.destroy(); } catch {}
  }

  if (!url) throw new Error("No URL returned");

  const parsedUrl = new URL(url);
  const hash = parsedUrl.hash.replace(/^#/, "");
  const startIdx = hash.indexOf("tgWebAppData=");
  if (startIdx === -1) throw new Error("No tgWebAppData in URL");
  const afterPrefix = hash.slice(startIdx + "tgWebAppData=".length);
  const endIdx = afterPrefix.indexOf("&");
  const rawValue = endIdx === -1 ? afterPrefix : afterPrefix.slice(0, endIdx);
  const initData = rawValue.replace(/%26/g, "&").replace(/%3D/g, "=");
  if (!initData) throw new Error("Empty tgWebAppData");

  return initData;
}
