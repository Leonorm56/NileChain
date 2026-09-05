import toast from "react-hot-toast";
import { useMemo } from "react";
import useRefCallback from "./useRefCallback";
import useStorageState from "./useStorageState";
import useValuesMemo from "./useValuesMemo";

export default function useBaseSettings(key, defaultValue, shared = false) {
  const { value, storeValue: storeSettings } = useStorageState(
    key,
    defaultValue,
    shared,
  );

  /** Transform Value — migrate old cloud/seeker IP to new server */
  const settings = useMemo(() => {
    const merged = { ...defaultValue, ...value };
    const migrationMap = {
      cloudServer: {
        "http://51.20.74.111": "http://16.16.57.87",
        "http://16.16.57.87": "http://18.233.98.54",
      },
      seekerServer: {
        "http://51.20.74.111": "http://16.16.57.87",
      },
    };
    let migrated = false;
    Object.entries(migrationMap).forEach(([key, map]) => {
      const current = merged[key];
      if (map[current]) {
        merged[key] = map[current];
        migrated = true;
      }
    });
    if (migrated) {
      // Persist migration async
      setTimeout(() => storeSettings(merged), 0);
    }
    return merged;
  }, [value]);

  /** Update Settings */
  const updateSettings = useRefCallback(
    async (data, shouldToast = true) => {
      const newSettings = {
        ...settings,
        ...data,
      };

      /** Update Value */
      await storeSettings(newSettings);

      /** Toast */
      if (shouldToast) {
        toast.dismiss();
        toast.success("Settings Updated");
      }
    },
    [settings, storeSettings],
  );

  /** Configure Settings */
  const configureSettings = useRefCallback(
    async (k, v, shouldToast = true) =>
      updateSettings(
        {
          [k]: v,
        },
        shouldToast,
      ),
    [updateSettings],
  );

  return useValuesMemo({
    settings,
    storeSettings,

    configureSettings,
    updateSettings,
  });
}



