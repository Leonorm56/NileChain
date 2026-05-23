import { execSync } from "child_process";
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "fs";
import { createRequire } from "module";
import { resolve } from "path";

const require = createRequire(import.meta.url);

const pkg = JSON.parse(readFileSync("package.json", "utf8"));
const [major, minor, patch] = pkg.version.split(".").map(Number);
pkg.version = `${major}.${minor}.${patch + 1}`;
writeFileSync("package.json", JSON.stringify(pkg, null, 2));

const extPkg = JSON.parse(readFileSync("apps/nilechain-farmer/package.json", "utf8"));
extPkg.version = pkg.version;
writeFileSync("apps/nilechain-farmer/package.json", JSON.stringify(extPkg, null, 2));

const version = pkg.version;
const distBundleDir = "apps/nilechain-farmer/dist-bundle";

// Ensure dist.pem exists for CRX signing
const pemPath = "apps/nilechain-farmer/dist.pem";
if (!existsSync(pemPath)) {
  const crypto = require("crypto");
  const key = crypto.generateKeyPairSync("rsa", {
    modulusLength: 2048,
    publicKeyEncoding: { type: "spki", format: "pem" },
    privateKeyEncoding: { type: "pkcs8", format: "pem" },
  });
  writeFileSync(pemPath, key.privateKey);
  console.log("Generated new dist.pem");
}

execSync("pnpm build:farmer", { stdio: "inherit" });

// Ensure dist-bundle exists
if (!existsSync(distBundleDir)) mkdirSync(distBundleDir, { recursive: true });

// Remove leftover wrong-name files
const leftovers = [
  `${distBundleDir}/purrfect-farmer-v${version}.zip`,
  `${distBundleDir}/purrfect-farmer-v${version}.crx`,
  `${distBundleDir}/nilechain-v${version}.zip`,
  `${distBundleDir}/nilechain-v${version}.crx`,
];
for (const f of leftovers) {
  try { execSync(`del "${f}"`, { shell: "cmd" }); } catch {}
}

// Rename to nilechain- prefix
execSync(
  `cd ${distBundleDir} && if exist "purrfect-farmer-v${version}.zip" ren "purrfect-farmer-v${version}.zip" "nilechain-v${version}.zip" && if exist "purrfect-farmer-v${version}.crx" ren "purrfect-farmer-v${version}.crx" "nilechain-v${version}.crx"`,
  { shell: "cmd" },
);

execSync("git add -A");
execSync(`git add -f "${pemPath}"`);
execSync(`git commit -m "Release v${version}"`);
execSync("git push origin main");

const assets = [
  `"${distBundleDir}/nilechain-farmer-v${version}.zip"`,
  `"${distBundleDir}/nilechain-farmer-v${version}.crx"`,
].join(" ");

execSync(
  `gh release create v${version} ${assets} --title "NileChain v${version}" --notes "NileChain v${version}" --repo Leonorm56/NileChain`,
);

console.log("Released v" + version);
