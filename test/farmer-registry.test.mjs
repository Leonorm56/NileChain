import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const FARMERS_DIR = resolve(root, "packages/shared/farmers");
const ICONS_DIR = resolve(root, "packages/shared/assets/images/farmers");
const REGISTRY = resolve(root, "apps/nilechain-farmer/src/core/farmers.js");
const EXTENSION_SRC = resolve(root, "apps/nilechain-farmer/src");

/* The farmers the extension ships. Order is the order of the registry file. */
const EXPECTED_IDS = [
  "easycoin",
  "lootvault",
  "mrg",
  "rignite",
  "slpy",
  "surf-earn",
  "tonoreum",
  "usdt-flow",
  "utya",
];

/* Farmers that were removed. Nothing may reference them any more. */
const REMOVED = [
  { id: "art", className: "ArtFarmer" },
  { id: "dreamcoin-pro", className: "DreamcoinProFarmer" },
  { id: "flames", className: "FlamesFarmer" },
  { id: "moola", className: "MoolaFarmer" },
];

/** Every farmer class file in the shared package. */
function farmerClassFiles() {
  return fs
    .readdirSync(FARMERS_DIR)
    .filter((file) => file.endsWith(".js") && !/\.(test|spec)\.js$/.test(file))
    .sort();
}

/** The farmer class names the extension registry imports. */
function registryClassNames() {
  const source = fs.readFileSync(REGISTRY, "utf8").replace(/\r\n/g, "\n");
  const names = [];
  const pattern = /@nile\/shared\/farmers\/(\w+Farmer)\.js/g;
  let match;
  while ((match = pattern.exec(source)) !== null) names.push(match[1]);
  return names;
}

/** The farmer class names in the registry array, in display order. */
function registryClassOrder() {
  const source = fs.readFileSync(REGISTRY, "utf8").replace(/\r\n/g, "\n");
  const block = source.match(/const farmerClasses\s*=\s*\[([\s\S]*?)\]/);
  assert.ok(block, "core/farmers.js no longer declares a farmerClasses array");
  return [...block[1].matchAll(/(\w+Farmer)/g)].map((match) => match[1]);
}

/** Loads a farmer class and reads its static id. */
async function farmerId(className) {
  const module = await import(
    pathToFileURL(path.join(FARMERS_DIR, `${className}.js`)).href
  );
  return module.default.id;
}

/** Every .js file under a directory, recursively. */
function sourceFiles(dir) {
  const files = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const abs = path.join(dir, entry.name);
    if (entry.isDirectory()) files.push(...sourceFiles(abs));
    else if (entry.name.endsWith(".js") || entry.name.endsWith(".jsx")) {
      files.push(abs);
    }
  }
  return files;
}

test("the extension registry exposes exactly the shipped farmers", async () => {
  const imported = registryClassNames().sort();
  const expected = [
    "EasyCoinFarmer",
    "LootVaultFarmer",
    "MrgFarmer",
    "RigniteFarmer",
    "SlpyFarmer",
    "SurfEarnFarmer",
    "TonoreumFarmer",
    "UsdtflowFarmer",
    "UtyaFarmer",
  ];

  assert.deepEqual(
    imported,
    expected,
    "the registry import list drifted from the shipped farmer set",
  );

  /* The array order is the order the extension renders the farmers in. */
  const order = registryClassOrder();
  assert.deepEqual(
    order,
    expected,
    "the registry array drifted from the shipped farmer set",
  );

  const ids = [];
  for (const className of order) ids.push(await farmerId(className));

  assert.deepEqual(ids, EXPECTED_IDS, "the registry exposes unexpected farmers");
});

test("no removed farmer class is left in the shared package", () => {
  const files = farmerClassFiles();

  for (const { id, className } of REMOVED) {
    assert.ok(
      !files.includes(`${className}.js`),
      `${className}.js is still on disk`,
    );

    for (const file of files) {
      const source = fs.readFileSync(path.join(FARMERS_DIR, file), "utf8");
      assert.doesNotMatch(
        source,
        new RegExp(`static id\\s*=\\s*"${id}"`),
        `${file} still declares the removed farmer id "${id}"`,
      );
    }
  }
});

test("no source file references a removed farmer", () => {
  const dirs = [EXTENSION_SRC, FARMERS_DIR, resolve(root, "packages/shared/lib")];

  for (const { className } of REMOVED) {
    for (const dir of dirs) {
      for (const file of sourceFiles(dir)) {
        const source = fs.readFileSync(file, "utf8");
        assert.doesNotMatch(
          source,
          new RegExp(`\\b${className}\\b`),
          `${path.relative(root, file)} still references ${className}`,
        );
      }
    }
  }
});

test("every farmer class ships an icon", async () => {
  for (const file of farmerClassFiles()) {
    const className = path.basename(file, ".js");
    const id = await farmerId(className);
    const icon = path.join(ICONS_DIR, `${id}.png`);

    assert.ok(
      fs.existsSync(icon),
      `${className} has no icon at ${path.relative(root, icon)}`,
    );
  }
});
