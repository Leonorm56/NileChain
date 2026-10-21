import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { inspectExtensionPackage } from "../scripts/check-packaged-extension.js";
import { getPackageJson } from "../scripts/get-package-json.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DIST_EXTENSION = path.resolve(__dirname, "../dist-extension");

/** Writes a minimal but structurally faithful extension package. */
function makeFixture(t, overrides = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "nilechain-pkg-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));

  const manifest = {
    manifest_version: 3,
    name: "Fixture",
    version: "1.0.15",
    icons: { 16: "icon.png" },
    background: { service_worker: "extension/sw.js", type: "module" },
    action: { default_popup: "index.html" },
    side_panel: { default_path: "index.html" },
    declarative_net_request: {
      rule_resources: [{ id: "core", enabled: true, path: "rules.json" }],
    },
    content_scripts: [
      {
        matches: ["*://*/*"],
        js: ["extension/content-script.js"],
        css: ["extension/content-script.css"],
      },
    ],
    ...overrides.manifest,
  };

  const files = {
    "manifest.json": JSON.stringify(manifest, null, 2),
    "index.html":
      '<!DOCTYPE html><html><body><div id="root"></div>' +
      '<script type="module" src="/assets/app.js"></script></body></html>',
    "assets/app.js": "globalThis.__nilechain = true;\n",
    "extension/sw.js": "globalThis.__nilechainWorker = true;\n",
    "extension/content-script.js": "void 0;\n",
    "extension/content-script.css": "body{color:#fff}\n",
    "rules.json": JSON.stringify([{ id: 1, action: { type: "block" } }]),
    "icon.png": "fakepng",
    ...overrides.files,
  };

  for (const [rel, source] of Object.entries(files)) {
    if (source === null) continue;
    const abs = path.join(dir, rel);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, source);
  }

  const remove = overrides.remove ?? [];
  for (const rel of remove) fs.rmSync(path.join(dir, rel), { force: true });

  return { dir, manifest, expectedVersion: overrides.expectedVersion ?? "1.0.15" };
}

/** Asserts at least one problem matches the pattern, and reports all of them. */
function assertProblem(problems, pattern) {
  assert.ok(
    problems.some((p) => pattern.test(p)),
    `expected a problem matching ${pattern}\nactually got:\n  - ${problems.join("\n  - ")}`
  );
}

describe("inspectExtensionPackage", () => {
  it("accepts a well-formed package", (t) => {
    const { dir, expectedVersion } = makeFixture(t);
    const { problems, stats } = inspectExtensionPackage(dir, { expectedVersion });

    assert.deepEqual(problems, []);
    assert.ok(stats.javascriptFiles >= 3, "should have inspected the JS files");
  });

  it("flags a manifest version that drifted from package.json", (t) => {
    const { dir, expectedVersion } = makeFixture(t, {
      files: {
        "manifest.json": JSON.stringify({ manifest_version: 3, version: "1.0.14" }),
      },
    });
    const { problems } = inspectExtensionPackage(dir, { expectedVersion });

    assertProblem(problems, /manifest\.json version 1\.0\.14/);
    assertProblem(problems, /package\.json version 1\.0\.15/);
  });

  it("flags a missing service worker", (t) => {
    const { dir, expectedVersion } = makeFixture(t, {
      remove: ["extension/sw.js"],
    });
    const { problems } = inspectExtensionPackage(dir, { expectedVersion });

    assertProblem(problems, /background\.service_worker.*extension\/sw\.js/);
  });

  it("flags a missing content script", (t) => {
    const { dir, expectedVersion } = makeFixture(t, {
      remove: ["extension/content-script.js"],
    });
    const { problems } = inspectExtensionPackage(dir, { expectedVersion });

    assertProblem(problems, /content_scripts.*content-script\.js/);
  });

  it("flags a declarativeNetRequest rules file that was never emitted", (t) => {
    const { dir, expectedVersion } = makeFixture(t, { remove: ["rules.json"] });
    const { problems } = inspectExtensionPackage(dir, { expectedVersion });

    assertProblem(problems, /declarative_net_request.*rules\.json/);
  });

  it("flags an index.html whose hashed entry was not emitted (blank screen)", (t) => {
    const { dir, expectedVersion } = makeFixture(t, {
      files: {
        "index.html":
          '<!DOCTYPE html><html><body><div id="root"></div>' +
          '<script type="module" src="/assets/index-DEADBEEF.js"></script></body></html>',
      },
    });
    const { problems } = inspectExtensionPackage(dir, { expectedVersion });

    assertProblem(problems, /index\.html references.*index-DEADBEEF\.js/);
  });

  it("flags an index.html with no mount point", (t) => {
    const { dir, expectedVersion } = makeFixture(t, {
      files: {
        "index.html":
          '<!DOCTYPE html><html><body><script type="module" src="/assets/app.js"></script></body></html>',
      },
    });
    const { problems } = inspectExtensionPackage(dir, { expectedVersion });

    assertProblem(problems, /no #root mount point/);
  });

  it("flags a truncated bundle that no longer parses", (t) => {
    const { dir, expectedVersion } = makeFixture(t, {
      files: { "assets/app.js": "function broken( {\n" },
    });
    const { problems } = inspectExtensionPackage(dir, { expectedVersion });

    assertProblem(problems, /assets\/app\.js does not parse/);
  });

  it("flags an empty bundle", (t) => {
    const { dir, expectedVersion } = makeFixture(t, {
      files: { "assets/app.js": "" },
    });
    const { problems } = inspectExtensionPackage(dir, { expectedVersion });

    assertProblem(problems, /assets\/app\.js is empty/);
  });

  it("flags a directory that is not a built extension at all", (t) => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "nilechain-empty-"));
    t.after(() => fs.rmSync(dir, { recursive: true, force: true }));

    const { problems } = inspectExtensionPackage(dir, { expectedVersion: "1.0.15" });

    assertProblem(problems, /manifest\.json is missing/);
  });
});

describe("the packaged extension", () => {
  it("passes the smoke test after a build", () => {
    assert.ok(
      fs.existsSync(DIST_EXTENSION),
      "dist-extension is missing — run `pnpm build-extension` before the tests"
    );

    const { version } = getPackageJson();
    const { problems, stats } = inspectExtensionPackage(DIST_EXTENSION, {
      expectedVersion: version,
    });

    assert.ok(
      stats.javascriptFiles > 0,
      "no JavaScript was inspected — the build looks empty"
    );
    assert.deepEqual(problems, [], `packaged extension has problems:\n  - ${problems.join("\n  - ")}`);
  });
});
