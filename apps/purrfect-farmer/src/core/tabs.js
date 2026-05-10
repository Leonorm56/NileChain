import ATFAutoIcon from "@/assets/images/atf-auto.png?format=webp&w=80";
import AppIcon from "@/assets/images/icon.png?format=webp&w=80";
import BackupAndRestoreIcon from "@/assets/images/backup-and-restore.png?format=webp&w=80";
import CloudIcon from "@/assets/images/cloud.png?format=webp&w=80";
import CloudTelegramSessionIcon from "@/assets/images/cloud-telegram-session.png?format=webp&w=80";
import LocalTelegramSessionIcon from "@/assets/images/local-telegram-session.png?format=webp&w=80";
import MyCloudIcon from "@/assets/images/my-cloud.png?format=webp&w=80";
import ReorderTelegramWebIcon from "@/assets/images/reorder-telegram-web.png?format=webp&w=80";
import SpiderIcon from "@/assets/images/spider-logo.png?format=webp&w=80";
import TelegramCleanerIcon from "@/assets/images/telegram-cleaner.png?format=webp&w=80";
import TelegramToNileGramIcon from "@/assets/images/telegram-to-purrfect-gram.png?format=webp&w=80";
import TelegramWebAIcon from "@/assets/images/telegram-web-a.png?format=webp&w=80";
import TelegramWebKIcon from "@/assets/images/telegram-web-k.png?format=webp&w=80";
import TinyFlyIcon from "@/assets/images/fly.png?format=webp&w=80";
import WhiskersIcon from "@/assets/images/whiskers.png?format=webp&w=80";
import { createElement } from "react";
import farmers from "./farmers";
import { lazy } from "react";

// Helper to handle dynamic import failures gracefully
const safeImport = (importFn) => {
  return lazy(() =>
    importFn().catch((err) => {
      console.error("Failed to load component:", err);
      // Return empty component on failure
      return { default: () => null };
    }),
  );
};

export const Welcome = safeImport(() => import("@/app/Welcome"));
export const Browser = safeImport(() => import("@/app/Browser"));
export const TelegramWeb = safeImport(() => import("@/app/TelegramWeb"));
export const TelegramCleaner = safeImport(() => import("@/app/TelegramCleaner"));
export const TinyFly = safeImport(() => import("@/app/TinyFly"));
export const HeadlessPicker = safeImport(() => import("@/app/HeadlessPicker"));
export const BackupAndRestore = safeImport(() => import("@/app/BackupAndRestore"));
export const WhiskersToFarmer = safeImport(() => import("@/app/WhiskersToFarmer"));
export const TelegramToNileGram = safeImport(() =>
  import("@/app/TelegramToNileGram"),
);

export const ReorderTelegramWeb = safeImport(() =>
  import("@/app/ReorderTelegramWeb"),
);

export const Spider = safeImport(() => import("@/app/Spider"));
export const ATFAuto = safeImport(() => import("@/app/ATFAuto"));
export const MyCloud = safeImport(() => import("@/app/MyCloud"));
export const CloudManager = lazy(() => import("@/app/CloudManager"));
export const LocalTelegramSession = lazy(
  () => import("@/app/LocalTelegramSession"),
);
export const CloudTelegramSession = lazy(
  () => import("@/app/CloudTelegramSession"),
);

export const app = [
  /** App */
  {
    id: "app",
    title: import.meta.env.VITE_APP_NAME,
    icon: AppIcon,
    component: createElement(Welcome),
  },
];

export const telegramWeb = [
  /** Telegram-Web */
  {
    id: "telegram-web-k",
    title: "Telegram WebK",
    icon: TelegramWebKIcon,
    component: createElement(TelegramWeb, { version: "k" }),
  },
  {
    id: "telegram-web-a",
    title: "Telegram WebA",
    icon: TelegramWebAIcon,
    component: createElement(TelegramWeb, { version: "a" }),
  },
];

export const utils = [
  /** Extra */
  {
    name: "Extra",
    list: [
      /** ATF Auto */
      {
        id: "atf-auto",
        title: "ATF Auto",
        icon: ATFAutoIcon,
        component: createElement(ATFAuto),
        singleton: true,
      },
    ],
  },
  /** Account */
  {
    name: "Account",
    list: [
      /** Spider */
      {
        id: "spider",
        title: "Spider",
        icon: SpiderIcon,
        component: createElement(Spider),
      },

      /** Telegram Cleaner */
      {
        id: "telegram-cleaner",
        title: "Telegram Cleaner",
        icon: TelegramCleanerIcon,
        component: createElement(TelegramCleaner),
      },
    ],
  },
  {
    name: "Session",
    list: [
      /** Local Telegram Session */
      {
        id: "local-telegram-session",
        title: "Local Telegram Session",
        icon: LocalTelegramSessionIcon,
        component: createElement(LocalTelegramSession),
      },

      /** Cloud Telegram Session */
      {
        id: "cloud-telegram-session",
        title: "Cloud Telegram Session",
        icon: CloudTelegramSessionIcon,
        component: createElement(CloudTelegramSession),
      },
    ],
  },

  /** Farming */
  {
    name: "Farming",
    list: [
      /** Headless Mode */
      {
        id: "headless-mode",
        title: "Headless Mode",
        icon: AppIcon,
        component: createElement(HeadlessPicker),
      },

      /** Tiny Fly */
      {
        id: "tiny-fly",
        title: "Tiny Fly",
        icon: TinyFlyIcon,
        component: createElement(TinyFly),
      },
    ],
  },

  /** Cloud */
  {
    name: "Cloud",
    list: [
      /** My Cloud */
      {
        id: "my-cloud",
        title: "My Cloud",
        icon: MyCloudIcon,
        component: createElement(MyCloud),
      },
      /** Cloud Manager */
      {
        id: "cloud-manager",
        title: "Cloud Manager",
        icon: CloudIcon,
        component: createElement(CloudManager),
      },
    ],
  },

  /** Telegram Web */
  {
    name: "Telegram Web",
    list: [
      /** Telegram to Nile Gram */
      {
        id: "telegram-to-purrfect-gram",
        title: "Telegram to Nile Gram",
        icon: TelegramToNileGramIcon,
        component: createElement(TelegramToNileGram),
      },

      /** Reorder Telegram Web */
      {
        id: "reorder-telegram-web",
        title: "Reorder Telegram Web",
        icon: ReorderTelegramWebIcon,
        component: createElement(ReorderTelegramWeb),
      },
    ],
  },

  /** Backup and Restore */
  {
    name: "Backup and Restore",
    list: [
      /** Whiskers to Farmer */
      {
        id: "whiskers-to-farmer",
        title: "Whiskers to Farmer",
        icon: WhiskersIcon,
        component: createElement(WhiskersToFarmer),
      },

      /** Backup and Restore */
      {
        id: "backup-and-restore",
        title: "Backup and Restore",
        icon: BackupAndRestoreIcon,
        component: createElement(BackupAndRestore),
      },
    ],
  },
];

export { farmers };
export default [
  ...app,
  ...telegramWeb,
  ...utils.map((u) => u.list).flat(),
  ...farmers,
];

