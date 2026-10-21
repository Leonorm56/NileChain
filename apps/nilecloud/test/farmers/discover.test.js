import * as assert from "node:assert";
import { test } from "node:test";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { discoverFarmerClasses, isFarmerFile } from "../../farmers/discover.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FARMERS_DIR = path.resolve(
  __dirname,
  "../../node_modules/@nile/shared/farmers",
);

test("a test file next to a farmer is not a farmer", () => {
  assert.equal(isFarmerFile("LootVaultFarmer.js"), true);
  assert.equal(isFarmerFile("LootVaultFarmer.test.js"), false);
  assert.equal(isFarmerFile("LootVaultFarmer.spec.js"), false);
  assert.equal(isFarmerFile("icon.png"), false);
});

test("the shared package ships a test file beside a farmer", () => {
  /* The reason the filter exists — if this ever changes, the filter is
     still correct, but the cloud no longer needs it. */
  const files = fs.readdirSync(FARMERS_DIR);
  assert.ok(
    files.some((file) => file.endsWith(".test.js")),
    "no farmer test file was found — the discovery filter is no longer exercised",
  );
});

test("every discovered farmer is a class with an id", async () => {
  const classes = await discoverFarmerClasses(FARMERS_DIR);

  assert.ok(classes.length > 0, "no farmers were discovered");

  for (const FarmerClass of classes) {
    assert.equal(typeof FarmerClass, "function");
    assert.equal(typeof FarmerClass.id, "string");
    assert.ok(FarmerClass.id.length > 0, "a farmer has no id");
  }
});

test("a test file in the folder is never loaded as a farmer", async () => {
  const classes = await discoverFarmerClasses(FARMERS_DIR);

  const ids = classes.map((FarmerClass) => FarmerClass.id);

  assert.ok(!ids.includes(undefined), "a module without a default export leaked in");
});
