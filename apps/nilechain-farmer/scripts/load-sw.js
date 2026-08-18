import fs from "node:fs";
import vm from "node:vm";

const src = fs.readFileSync(
  "dist-extension/extension/chrome-service-worker.js",
  "utf8",
);

// Stub the chrome APIs the SW touches during load + setupExtension
const noop = () => {};
const chromeStub = {
  runtime: {
    onMessage: { addListener: noop },
    onStartup: { addListener: noop },
    onInstalled: { addListener: noop },
    getPlatformInfo: () => Promise.resolve({ os: "win" }),
    getURL: (p) => p,
    onConnectExternal: { addListener: noop },
  },
  action: {
    onClicked: { addListener: noop },
    setPopup: () => Promise.resolve(),
  },
  sidePanel: {
    setPanelBehavior: () => Promise.resolve(),
  },
  windows: { getAll: () => Promise.resolve([]), update: noop, create: noop },
  storage: {
    local: {
      get: () => Promise.resolve({}),
      set: noop,
      remove: noop,
      onChanged: { addListener: noop },
    },
  },
  proxy: {
    settings: { set: () => Promise.resolve() },
  },
  webRequest: { onAuthRequired: { addListener: noop } },
  tabs: { query: () => Promise.resolve([]), update: noop },
};

const sandbox = {
  chrome: chromeStub,
  self: {},
  globalThis: {},
  console,
  URL,
  URLSearchParams,
  TextEncoder,
  TextDecoder,
  crypto: globalThis.crypto,
  fetch: () => Promise.reject(new Error("no net")),
  EventSource: class { constructor() {} close() {} },
  setTimeout,
  clearTimeout,
  setInterval,
  clearInterval,
  Promise,
  Date,
  Math,
  JSON,
  Object,
  Array,
  String,
  Number,
  Boolean,
  RegExp,
  Uint8Array,
  Uint32Array,
  Int32Array,
  BigInt,
  Map,
  Set,
  WeakMap,
  Buffer,
  navigator: {},
  location: { href: "", protocol: "chrome-extension:", host: "" },
};

sandbox.globalThis = sandbox;
sandbox.self = sandbox;

try {
  vm.runInNewContext(src, sandbox, { timeout: 15000 });
  console.log("SW LOADED OK (no throw)");
} catch (e) {
  console.log("SW LOAD FAILED:");
  console.log(String(e && e.stack ? e.stack : e).split("\n").slice(0, 15).join("\n"));
}
