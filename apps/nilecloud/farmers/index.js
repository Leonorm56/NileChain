import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import createRunner from "./Runner.js";
import { discoverFarmerClasses } from "./discover.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const farmers = {};

const farmersDir = path.join(
  __dirname,
  "../node_modules/@nile/shared/farmers",
);

const farmerClasses = await discoverFarmerClasses(farmersDir);

for (const FarmerClass of farmerClasses) {
  if (FarmerClass.published) {
    farmers[FarmerClass.id] = createRunner(FarmerClass);
  }
}

export default farmers;
