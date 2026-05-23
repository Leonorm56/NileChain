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

        case "get-spacejump-status":
          try {
            const status = localStorage.getItem('spacejumpStatus');
            const userData = localStorage.getItem('spacejumpUserData');
            reply({ status: status ? JSON.parse(status) : null, userData: userData ? JSON.parse(userData) : null });
          } catch (e) {
            reply({ status: null, userData: null, error: e.message });
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

    /** Forward spacejump data to bridge */
    setInterval(() => {
      try {
        const status = localStorage.getItem('spacejumpStatus');
        const userData = localStorage.getItem('spacejumpUserData');
        if (status && userData) {
          port.postMessage({
            type: 'spacejump-status',
            data: { status: JSON.parse(status), userData: JSON.parse(userData) }
          });
        }
      } catch (e) {}
    }, 1000);

    /** Listen for commands from farmer (via bridge) and forward to game */
    port.onMessage.addListener((message) => {
      if (message.type === 'spacejump-command') {
        const { action, value } = message;
        // Primary: postMessage to main world IIFE
        window.postMessage({ type: 'spacejump:command', action, value }, '*');
        // Fallback: write to localStorage (main world polls sj_cmd every 2s)
        try {
          localStorage.setItem('sj_cmd', JSON.stringify({ action, value }));
        } catch (e) {}
        console.log('[SpaceJump] Command forwarded:', action, value);
      }
    });
  }

  /** SpaceJump: initialize bridge immediately (no Telegram dependency) */
  if (location.host.endsWith('mywebapp.ru') && location.pathname.startsWith('/SpaceJump')) {
    initialize();
  } else {
    watchTelegramMiniApp(initialize);
  }
}



