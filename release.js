import { execSync } from "child_process";
import { readFileSync, writeFileSync } from "fs";

const pkg = JSON.parse(readFileSync("package.json", "utf8"));
const [major, minor, patch] = pkg.version.split(".").map(Number);
pkg.version = `${major}.${minor}.${patch + 1}`;
writeFileSync("package.json", JSON.stringify(pkg, null, 2));

const version = pkg.version;

// Build
execSync("pnpm build:farmer", { stdio: "inherit" });

// Rename zip
execSync(`cd apps/purrfect-farmer/dist-bundle && ren "purrfect-farmer-v6.1.1.zip" "nilechain-v${version}.zip"`, { shell: "cmd" });

// Commit and push
execSync("git add -A");
execSync(`git commit -m "Release v${version}"`);
execSync("git push origin main");

// Create release with zip
execSync(`gh release create v${version} "apps/purrfect-farmer/dist-bundle/nilechain-v${version}.zip" --title "NileChain v${version}" --notes "NileChain v${version}" --repo Leonorm56/NileChain`);

console.log("Released v" + version);