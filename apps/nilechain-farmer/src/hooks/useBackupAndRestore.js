import storage from "@/lib/storage";
import { useCallback } from "react";
import { useMemo } from "react";

import useAppContext from "@/hooks/useAppContext";

export default function useBackupAndRestore(app) {
  const { configureSettings } = useAppContext() || app;

  /** Skip Onboarding */
  const skipOnboarding = useCallback(
    () => configureSettings("onboarded", true, false),
    [configureSettings]
  );

  /** Get Backup Data (chrome storage only; Telegram Web localStorage handled by the host) */
  const getBackupData = useCallback(
    () =>
      new Promise(async (resolve, reject) => {
        await skipOnboarding();

        const chromeLocalStorage = await storage.getAll();
        const data = {
          version: __APP_PACKAGE_VERSION__,
          time: Date.now(),
          data: {
            chromeLocalStorage,
          },
        };

        resolve(data);
      }),
    [skipOnboarding]
  );

  /** Restore Backup Data (chrome storage only; Telegram Web localStorage handled by the host) */
  const restoreBackupData = useCallback(
    (data) =>
      new Promise(async (resolve, reject) => {
        await skipOnboarding();
        await storage.set(data.chromeLocalStorage);

        resolve(true);
      }),
    [skipOnboarding]
  );

  return useMemo(
    () => [getBackupData, restoreBackupData],
    [getBackupData, restoreBackupData]
  );
}



