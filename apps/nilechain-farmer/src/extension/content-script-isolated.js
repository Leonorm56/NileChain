import "./bridge/bridge-isolated";
import "./telegram-web/telegram-web-isolated";

import { TELEGRAM_WEB_HOSTS } from "@/constants";
import { createListener, customLogger, getUserAgent, uuid } from "@/utils";

import {
  decryptData,
  encryptData,
  watchTelegramMiniApp,
} from "./content-script-utils";
import { setupMiniAppToolbar } from "./mini-app/mini-app-toolbar-isolated";

if (!TELEGRAM_WEB_HOSTS.includes(location.host)) {
  /** Initial Location Href */
  const INITIAL_LOCATION = location.href;

  /** Post window message */
  const postWindowMessage = (data) => {
    return new Promise((resolve) => {
      /** Generate ID */
      const id = data.id || uuid();

      window.addEventListener(
        "message",
        createListener((listener, ev) => {
          try {
            if (
              ev.source === window &&
              ev.data?.id === id &&
              ev.data?.type === "response"
            ) {
              window.removeEventListener("message", listener);
              resolve(decryptData(ev.data.payload));
            }
          } catch (e) {
            console.error(e);
          }
        })
      );
      window.postMessage(
        {
          id,
          type: "request",
          payload: encryptData(data),
        },
        "*"
      );
    });
  };

  /** Open Telegram Link */
  async function openTelegramLink({ id, url }) {
    return await postWindowMessage({
      id,
      action: "open-telegram-link",
      data: {
        url,
      },
    });
  }

  /** Update User-Agent */
  async function updateUserAgent() {
    const userAgent = await getUserAgent();

    return await postWindowMessage({
      action: "set-user-agent",
      data: {
        userAgent,
      },
    });
  }

  /** Get Telegram WebApp */
  async function getTelegramWebApp() {
    return await postWindowMessage({
      action: "get-telegram-web-app",
    });
  }

  /** Close Bot */
  async function closeBot({ id }) {
    return await postWindowMessage({
      id,
      action: "close-bot",
    });
  }

  let _initialized = false;

  /** Initialize */
  function initialize() {
    if (_initialized) return;
    _initialized = true;
    customLogger("Initializing Telegram Mini-App Integration...");

    /** Connect to Messaging */
    const port = chrome.runtime.connect(chrome.runtime.id, {
      name: `mini-app:${location.host}`,
    });

    /** Dispatch TelegramWebApp */
    const dispatchTelegramWebApp = async (data) => {
      try {
        port.postMessage({
          action: `set-telegram-web-app:${location.host}`,
          data: {
            host: location.host,
            telegramWebApp: {
              ...data,
              initLocationHref: INITIAL_LOCATION,
            },
          },
        });
      } catch (e) {
        console.error(e);
      }
    };

    /** Listen for TelegramWebApp */
    const listenForTelegramWeb = (ev) => {
      if (ev.source === window && ev.data?.type === "init") {
        window.removeEventListener("message", listenForTelegramWeb);

        const telegramWebApp = decryptData(ev.data?.payload);

        customLogger(`TELEGRAM WEB APP: ${location.host}`, telegramWebApp);
        dispatchTelegramWebApp(telegramWebApp);
      }
    };

    /** Handle Port Messages */
    port.onMessage?.addListener(async (message) => {
      const { id, action, data } = message;
      const reply = (data) => {
        port.postMessage({
          id,
          data,
          type: "response",
        });
      };

      switch (action) {
        case `get-telegram-web-app:${location.host}`:
          const telegramWebApp = await getTelegramWebApp();
          dispatchTelegramWebApp(telegramWebApp);
          break;

        case "open-telegram-link":
          await openTelegramLink({ id, ...data });
          try {
            reply(true);
          } catch (e) {
            console.error(e);
          }
          break;

        case "close-bot":
          await closeBot({ id });
          try {
            reply(true);
          } catch (e) {
            console.error(e);
          }
          break;
      }
    });

    /** Listen for TelegramWebApp */
    window.addEventListener("message", listenForTelegramWeb);

    /** Update User-Agent */
    updateUserAgent();

    /** Setup Mini-App Toolbar */
    setupMiniAppToolbar();
  }

  watchTelegramMiniApp(initialize);
}

/**
 * NileWallet bridge for THE NILE (Electron) desktop app.
 *
 * The main process runs `executeJavaScript` which executes in the MAIN world.
 * `chrome.runtime.sendMessage` is only available in the ISOLATED world.
 * This bridge listens for `window.postMessage` from the main world and
 * forwards wallet messages to the service worker via chrome.runtime.sendMessage.
 */
/*
 * Keep the service worker alive with a persistent port.
 * Without this, MV3 SW goes dormant and sendMessage has no listener.
 */
let _nwPort = null;
try {
  _nwPort = chrome.runtime.connect({ name: "nile-wallet-bridge-keepalive" });
  _nwPort.onDisconnect.addListener(() => {
    _nwPort = null;
    try { _nwPort = chrome.runtime.connect({ name: "nile-wallet-bridge-keepalive" }); } catch {}
  });
  setInterval(() => { try { _nwPort?.postMessage({ type: "ping" }); } catch {} }, 15000);
} catch {}

/**
 * NileWallet bridge for THE NILE (Electron) desktop app.
 * Listens for window.postMessage from MAIN world and forwards
 * to the service worker via a port (not sendMessage).
 */
window.addEventListener("message", (ev) => {
  if (ev.source !== window) return;
  if (ev.data?.type !== "nile-wallet-request") return;

  const { id, action, payload } = ev.data;

  /* Use a fresh port per-request to guarantee the SW is awake.
   * sendMessage alone fails because the SW may be dormant. */
  try {
    const port = chrome.runtime.connect({ name: `nile-wallet-req:${id}` });
    const timer = setTimeout(() => {
      try { port.disconnect(); } catch {}
      window.postMessage({ type: "nile-wallet-response", id, result: { ok: false, error: "bridge-timeout" } }, "*");
    }, 15000);

    port.onMessage.addListener((response) => {
      clearTimeout(timer);
      try { port.disconnect(); } catch {}
      window.postMessage({ type: "nile-wallet-response", id, result: response || { ok: false, error: "No response" } }, "*");
    });

    port.onDisconnect.addListener(() => {
      clearTimeout(timer);
      const err = chrome.runtime?.lastError?.message || "port-disconnected";
      window.postMessage({ type: "nile-wallet-response", id, result: { ok: false, error: err } }, "*");
    });

    port.postMessage({ action, ...(payload || {}) });
  } catch (e) {
    window.postMessage({ type: "nile-wallet-response", id, result: { ok: false, error: e.message } }, "*");
  }
});



