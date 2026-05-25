import { createFarmer } from "@/lib/createFarmer";
import { customLogger } from "@/utils";
import path from "path-browserify";

// Import farmers directly — the pnpm symlink breaks import.meta.glob on this system
import ADCLICKERFarmer from "@purrfect/shared/farmers/ADCLICKERFarmer.js";
import ATFFarmer from "@purrfect/shared/farmers/ATFFarmer.js";
import DreamcoinProFarmer from "@purrfect/shared/farmers/DreamcoinProFarmer.js";
import HeadCoinFarmer from "@purrfect/shared/farmers/HeadCoinFarmer.js";
import SpaceJumpFarmer from "@purrfect/shared/farmers/SpaceJumpFarmer.js";

const farmerClasses = [
  ADCLICKERFarmer,
  ATFFarmer,
  DreamcoinProFarmer,
  HeadCoinFarmer,
  SpaceJumpFarmer,
];

const farmersIconGlob = import.meta.glob(
  "../../node_modules/@purrfect/shared/assets/images/farmers/*.png",
  {
    eager: true,
    import: "default",
    query: {
      w: 80,
      h: 80,
      format: "webp",
    },
  },
);

const farmerIcons = Object.entries(farmersIconGlob).reduce(
  (result, [filepath, icon]) => {
    result.set(path.basename(filepath, ".png"), icon);
    return result;
  },
  new Map(),
);

const farmers = farmerClasses.map((Farmer) =>
  createFarmer(Farmer, {
    icon: Farmer.id === "spacejump" ? "/spacejump-icon.png" : farmerIcons.get(Farmer.id),
  }),
);

const farmersMap = farmers.reduce((result, farmer) => {
  result.set(farmer.id, {
    title: farmer.title,
    icon: farmer.icon,
    singleton: farmer.singleton,
    FarmerClass: farmer.FarmerClass,
  });
  return result;
}, new Map());

customLogger("FARMERS", farmers);
customLogger("FARMERS MAP", farmersMap);

export default farmers;
export { farmersMap };



