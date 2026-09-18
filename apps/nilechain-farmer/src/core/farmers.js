import { createFarmer } from "@/lib/createFarmer";
import { customLogger } from "@/utils";
import path from "path-browserify";

// Import farmers directly — the pnpm symlink breaks import.meta.glob on this system
import ArtFarmer from "@nile/shared/farmers/ArtFarmer.js";
import DreamcoinProFarmer from "@nile/shared/farmers/DreamcoinProFarmer.js";
import SlpyFarmer from "@nile/shared/farmers/SlpyFarmer.js";
import SurfEarnFarmer from "@nile/shared/farmers/SurfEarnFarmer.js";
import TonoreumFarmer from "@nile/shared/farmers/TonoreumFarmer.js";
import RigniteFarmer from "@nile/shared/farmers/RigniteFarmer.js";
import UsdtflowFarmer from "@nile/shared/farmers/UsdtflowFarmer.js";
import MoolaFarmer from "@nile/shared/farmers/MoolaFarmer.js";
import MrgFarmer from "@nile/shared/farmers/MrgFarmer.js";
import UtyaFarmer from "@nile/shared/farmers/UtyaFarmer.js";
import FlamesFarmer from "@nile/shared/farmers/FlamesFarmer.js";

const farmerClasses = [
  ArtFarmer,
  DreamcoinProFarmer,
  RigniteFarmer,
  SlpyFarmer,
  SurfEarnFarmer,
  TonoreumFarmer,
  UsdtflowFarmer,
  MoolaFarmer,
  MrgFarmer,
  UtyaFarmer,
  FlamesFarmer,
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



