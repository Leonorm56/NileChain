import { createFarmer } from "@/lib/createFarmer";
import { customLogger } from "@/utils";
import path from "path-browserify";

// Import farmers directly — the pnpm symlink breaks import.meta.glob on this system
import ADCLICKERFarmer from "@nile/shared/farmers/ADCLICKERFarmer.js";
import ATFFarmer from "@nile/shared/farmers/ATFFarmer.js";
import DreamcoinProFarmer from "@nile/shared/farmers/DreamcoinProFarmer.js";
import HeadCoinFarmer from "@nile/shared/farmers/HeadCoinFarmer.js";
import SpaceJumpFarmer from "@nile/shared/farmers/SpaceJumpFarmer.js";
import TradingWarsFarmer from "@nile/shared/farmers/TradingWarsFarmer.js";

const farmerClasses = [
  ADCLICKERFarmer,
  ATFFarmer,
  DreamcoinProFarmer,
  HeadCoinFarmer,
  SpaceJumpFarmer,
  TradingWarsFarmer,
];

const farmersIconGlob = import.meta.glob(
  "../../node_modules/@nile/shared/assets/images/farmers/*.png",
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



