import fs from "node:fs";

const src = fs.readFileSync(
  "dist-extension/extension/chrome-service-worker.js",
  "utf8",
);

console.log("len", src.length);
console.log("has Buffer shim (globalThis.Buffer):", /globalThis\.Buffer/.test(src));
console.log("has window shim:", /globalThis\.window/.test(src));

const checks = [
  "document.createElement",
  "window.addEventListener",
  "window.localStorage",
  "window.open",
  "globalThis.document",
  "window.location",
  "document.addEventListener",
];

for (const b of checks) {
  const count = src.split(b).length - 1;
  console.log(b, "=>", count);
}

// Check what the SW actually wires up
console.log("has nile-wallet handlers:", src.includes("nile-wallet.vault-status"));
console.log("has setupNileWalletBackground:", src.includes("setupNileWalletBackground"));
console.log("first 2000 chars:", JSON.stringify(src.slice(0, 2000)));
