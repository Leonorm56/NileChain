import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

/**
 * Is this file a farmer class?
 *
 * The shared package keeps a farmer's test file next to the farmer it tests,
 * so the folder holds more than classes. A test file has no default export,
 * and loading it would run the tests — so it is not a farmer.
 *
 * @param {string} file
 * @returns {boolean}
 */
export function isFarmerFile(file) {
  if (!file.endsWith(".js")) return false;
  return !/\.(test|spec)\.js$/.test(file);
}

/**
 * Load every farmer class in a directory.
 *
 * @param {string} farmersDir
 * @returns {Promise<Array<import("@nile/shared/lib/BaseFarmer.js").default>>}
 */
export async function discoverFarmerClasses(farmersDir) {
  const files = fs.readdirSync(farmersDir).filter(isFarmerFile);
  const classes = [];

  for (const file of files) {
    const FarmerClass = await import(
      pathToFileURL(path.join(farmersDir, file)).href
    ).then((m) => m.default);

    /* A module with no default export is not a farmer — skip it rather than
       reading a stat off undefined. */
    if (!FarmerClass) continue;

    classes.push(FarmerClass);
  }

  return classes;
}
