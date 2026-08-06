import { createFarmer } from "@/lib/createFarmer";
import { customLogger } from "@/utils";
import path from "path-browserify";

// Import farmers directly — the pnpm symlink breaks import.meta.glob on this system
import ATFFarmer from "@nile/shared/farmers/ATFFarmer.js";
import DreamcoinProFarmer from "@nile/shared/farmers/DreamcoinProFarmer.js";
import OneGramFarmer from "@nile/shared/farmers/OneGramFarmer.js";
import SlpyFarmer from "@nile/shared/farmers/SlpyFarmer.js";
import SurfEarnFarmer from "@nile/shared/farmers/SurfEarnFarmer.js";
import TonoreumFarmer from "@nile/shared/farmers/TonoreumFarmer.js";

const farmerClasses = [
  ATFFarmer,
  DreamcoinProFarmer,
  OneGramFarmer,
  SlpyFarmer,
  SurfEarnFarmer,
  TonoreumFarmer,
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
    icon: farmerIcons.get(Farmer.id),
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



