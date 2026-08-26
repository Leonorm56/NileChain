import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * Get Core Net Rules
 * @returns {chrome.declarativeNetRequest.Rule[]}
 */
function getCoreNetRules() {
  const BRIDGE = "https://bridge.tonapi.io";
  const deadBridges = [
    "bridge.stower.money",
    "bridge.mirai.app",
    "go-bridge.tomo.inc",
  ];

  const redirectRules = deadBridges.map((host, i) => ({
    id: 100 + i,
    priority: 2,
    action: {
      type: "redirect",
      redirect: { regexSubstitution: `${BRIDGE}/\\1` },
    },
    condition: {
      regexFilter: `^https://${host.replace(/\./g, "\\.")}/(.*)$`,
      resourceTypes: [
        "xmlhttprequest",
        "fetch",
        "eventsource",
        "other",
      ],
    },
  }));

  return [
    {
      id: 1,
      priority: 1,
      action: {
        type: "modifyHeaders",
        responseHeaders: [
          {
            header: "content-security-policy",
            operation: "remove",
          },
          {
            header: "x-frame-options",
            operation: "remove",
          },
          {
            header: "cross-origin-embedder-policy",
            operation: "remove",
          },
          {
            header: "cross-origin-opener-policy",
            operation: "remove",
          },
          {
            header: "cross-origin-resource-policy",
            operation: "remove",
          },
        ],
      },
      condition: {
        urlFilter: "*",
      },
    },
    ...redirectRules,
  ];
}

/**
 * Generate Chrome Manifest
 * @returns {import("vite").Plugin}
 */
export function generateChromeManifest(env, pkg) {
  const isPWA = typeof process.env.VITE_PWA !== "undefined";
  const isBridge = typeof process.env.VITE_BRIDGE !== "undefined";
  const isThenile = typeof process.env.VITE_THENILE !== "undefined";
  const isIndex = process.env.VITE_ENTRY === "index";
  const enabled = isPWA === false && isIndex;

  return {
    name: "generate-chrome-manifest",
    async generateBundle() {
      const namePrefix = isThenile ? "(TheNile) " : isBridge ? "(Bridge) " : "";
      // VITE_PWA_URL is optional (empty in CI when the secret is unset). Guard the parse
      // so a missing/invalid value can't crash the build; the PWA-origin entry is only
      // consumed by the bridge's externally_connectable, and localhost is always allowed.
      let pwaHostname = null;
      try {
        if (env.VITE_PWA_URL) pwaHostname = new URL(env.VITE_PWA_URL).hostname;
      } catch {
        pwaHostname = null;
      }
      const matches = [
        ...(pwaHostname ? [`*://${pwaHostname}/*`] : []),
        "*://localhost/*",
      ];

      const manifest = {
        manifest_version: 3,
        name: namePrefix + env.VITE_APP_NAME,
        description: namePrefix + env.VITE_APP_DESCRIPTION,
        version: pkg.version,
        icons: {
          16: "nile-icon-16.png",
          32: "nile-icon-32.png",
          48: "nile-icon-48.png",
          128: "nile-icon-128.png",
        },
        permissions: [
          "tabs",
          "activeTab",
          "storage",
          "unlimitedStorage",
          "webRequest",
          "declarativeNetRequest",
          "downloads",
          "alarms",
        ].concat(
          !isThenile
            ? [
                "proxy",
                "cookies",
                "windows",
                "sidePanel",
                "notifications",
                "webNavigation",
                "webRequestAuthProvider",
                "system.display",
                "scripting",
              ]
            : []
        ),
        ...(!isThenile
          ? {
              background: {
                service_worker: "extension/chrome-service-worker.js",
                type: "module",
              },
              action: {
                default_icon: {
                  16: "nile-icon-16.png",
                  32: "nile-icon-32.png",
                  48: "nile-icon-48.png",
                  128: "nile-icon-128.png",
                },
                default_title: namePrefix + `Open ${env.VITE_APP_NAME}`,
                default_popup: isBridge ? "pwa-iframe.html" : "index.html",
              },
              side_panel: {
                default_path: isBridge ? "pwa-iframe.html" : "index.html",
              },
              declarative_net_request: {
                rule_resources: [
                  {
                    id: "core",
                    enabled: true,
                    path: "rule_resources/core.json",
                  },
                ],
              },
            }
          : {}),

        host_permissions: ["*://*/*", "ws://*/*", "wss://*/*"],
        web_accessible_resources: [
          {
            resources: [
              "assets/*.woff",
              "assets/*.woff2",
              "browser-sandbox.html",
              "tonconnect-provider.js",
            ],
            matches: ["*://*/*"],
          },
        ],
        externally_connectable: isBridge ? { matches } : undefined,
        content_scripts: [
          {
            matches: ["*://*/*"],
            js: ["extension/content-script-isolated.js"],
            css: ["extension/content-script-styles.css"],
            run_at: "document_start",
            world: "ISOLATED",
            all_frames: true,
          },
          {
            matches: ["*://*/*"],
            js: ["extension/content-script-main.js"],
            run_at: "document_start",
            world: "MAIN",
            all_frames: true,
          },
        ],

        content_security_policy: {
          extension_pages:
            "script-src 'self' 'wasm-unsafe-eval'; object-src 'self';",
          sandbox:
            "sandbox allow-scripts allow-forms allow-popups allow-modals;",
        },
        sandbox: {
          pages: [],
        },
      };

      /** @type {chrome.declarativeNetRequest.Rule[] | null} */
      const netRules = getCoreNetRules();

      this.emitFile({
        type: "asset",
        fileName: "rule_resources/core.json",
        source: JSON.stringify(netRules, null, 2),
      });

      this.emitFile({
        type: "asset",
        fileName: "manifest.json",
        source: JSON.stringify(manifest, null, 2),
      });
    },
    apply(config, { command }) {
      return command === "build" && enabled;
    },
  };
}


