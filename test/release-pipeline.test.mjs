import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");

const WORKFLOW = ".github/workflows/release.yml";
const AI_FOLDERS = [".claude", ".kilo", ".freebuff"];

// The asset globs listed under the `files: |` block of the release step.
function workflowAssetGlobs() {
  const yml = readFileSync(resolve(root, WORKFLOW), "utf8").replace(/\r\n/g, "\n");
  const lines = yml.split("\n");
  const start = lines.findIndex((line) => /^\s*files:\s*\|/.test(line));
  assert.notEqual(start, -1, `${WORKFLOW} no longer has a files: block`);

  const indent = lines[start].match(/^\s*/)[0].length;
  const globs = [];
  for (const line of lines.slice(start + 1)) {
    if (!line.trim()) continue;
    if (line.match(/^\s*/)[0].length <= indent) break;
    globs.push(line.trim());
  }
  return globs;
}

// The asset arguments passed to `gh release create` in the repo release script.
function releaseScriptAssets() {
  const src = readFileSync(resolve(root, "release.js"), "utf8").replace(/\r\n/g, "\n");
  const block = src.match(/const assets = \[([\s\S]*?)\]\.join\(/);
  assert.ok(block, "release.js no longer builds an assets list");
  return block[1]
    .split("\n")
    .map((line) => line.trim().replace(/,$/, ""))
    .filter((line) => line.startsWith("`") || line.startsWith("\""));
}

test("the release workflow publishes only the nilechain-farmer zip", () => {
  const globs = workflowAssetGlobs();
  assert.deepEqual(globs, ["apps/nilechain-farmer/dist-bundle/nilechain-farmer-v*.zip"]);
});

test("the release workflow never publishes a crx or another bundle type", () => {
  // "nilechain-farmer-*.zip" would also sweep up the bridge and thenile bundles.
  for (const glob of workflowAssetGlobs()) {
    assert.ok(
      glob.endsWith("nilechain-farmer-v*.zip"),
      `release asset is not the farmer archive: ${glob}`,
    );
    assert.ok(!glob.endsWith(".crx"), `release asset is a crx file: ${glob}`);
  }
});

test("release.js attaches only the nilechain-farmer zip", () => {
  const assets = releaseScriptAssets();
  assert.equal(assets.length, 1, `release.js attaches ${assets.length} assets`);
  assert.match(assets[0], /nilechain-farmer-v\$\{version\}\.zip/);
  assert.doesNotMatch(assets[0], /\.crx/);
});

test("the repo version and the published bundle version agree", () => {
  // bundle-extension.js names the zip and stamps the extension manifest from the farmer
  // package, while the release tag comes from the root package. They must not drift.
  const rootPkg = JSON.parse(readFileSync(resolve(root, "package.json"), "utf8"));
  const farmerPkg = JSON.parse(
    readFileSync(resolve(root, "apps/nilechain-farmer/package.json"), "utf8"),
  );
  assert.equal(farmerPkg.version, rootPkg.version);
});

test("AI agent folders are not tracked", () => {
  // Scoped to the agent folders so the 50k tracked node_modules entries are never read.
  const pathspecs = [
    ...AI_FOLDERS.map((folder) => `:(glob)**/${folder}/**`),
    ":!node_modules/**",
  ];
  const tracked = execFileSync("git", ["ls-files", "--", ...pathspecs], {
    cwd: root,
    encoding: "utf8",
    maxBuffer: 8 * 1024 * 1024,
  })
    .split("\n")
    .filter(Boolean);

  assert.deepEqual(tracked, [], `tracked AI agent files: ${tracked.join(", ")}`);
});
