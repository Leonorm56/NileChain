import { sendWebviewMessage } from "@/utils";
import useBackupAndRestore from "./useBackupAndRestore";
import { useEffect } from "react";
import useMemoizedCallback from "./useMemoizedCallback";

export default function useWhiskerData(app) {
  const [backup, restore] = useBackupAndRestore(app);

  const getBackupData = useMemoizedCallback(backup);
  const restoreBackupData = useMemoizedCallback(restore);

  const updateSettings = useMemoizedCallback(app.updateSettings);
  const updateSharedSettings = useMemoizedCallback(app.updateSharedSettings);
  const updateActiveAccount = useMemoizedCallback(app.updateActiveAccount);

  /** Whisker Message */
  useEffect(() => {
    if (window.electron?.ipcRenderer) {
      /** Whether whisker data has arrived yet (host may drop the one-shot
       * delivery if the webview mounts before the guest page is ready). */
      let receivedWhiskerData = false;
      let attempts = 0;
      let retryTimer = null;

      /** Request whisker data, retrying until the host actually replies. */
      const requestWhiskerData = () => {
        attempts += 1;
        console.log("Requesting for Whisker data...", { attempts });
        sendWebviewMessage({
          action: "get-whisker-data",
        });
      };

      /** Message Listener */
      const listener = (_event, { action, data }) => {
        console.log("Received message from Whisker...", { action, data });

        /** Mark delivery so the retry loop can stop. */
        if (action === "set-whisker-data") {
          receivedWhiskerData = true;
          if (retryTimer) {
            clearInterval(retryTimer);
            retryTimer = null;
          }
        }

        /** Reply to Message */
        const reply = (data) => {
          sendWebviewMessage({
            action: `response-${action}`,
            data,
          });
        };

        switch (action) {
          /** Get Backup Data */
          case "get-backup-data":
            console.log("Creating backup for Whisker...");
            getBackupData().then((data) => {
              reply(data);
            });
            break;

          /** Restore Backup Data */
          case "restore-backup-data":
            console.log("Restoring backup from Whisker...", data);
            const { data: backupData } = data;
            restoreBackupData(backupData).then(() => {
              reply(true);
            });
            break;

          /** Get Account Data — report the active account's telegram init data
           * so the host app can display profile picture/username in its lists. */
          case "get-account-data":
            console.log("Sending account data to Whisker...");
            reply({
              telegramInitData: app.account?.telegramInitData ?? null,
            });
            break;

          /** Set Whisker Data */
          case "set-whisker-data":
            console.log("Updating app from Whisker data...", data);

            const { account, settings, sharedSettings } = data;

            /** Expose Partition */
            window.WHISKER_PARTITION = account.partition;

            /** Update Account */
            updateActiveAccount(account);

            /** Update Settings */
            updateSettings({ ...settings }, false);

            /** Update Shared Settings */
            updateSharedSettings({ ...sharedSettings }, false);

            break;
        }
      };

      /** Add Listener */
      window.electron.ipcRenderer.on("host-message", listener);

      /** Request for Whisker Data — first attempt right away, then retry
       * every 3s until the host delivers (covers webview mount races where
       * the one-shot request/reply is dropped before the guest page loads). */
      requestWhiskerData();
      retryTimer = setInterval(() => {
        if (receivedWhiskerData || attempts >= 30) {
          clearInterval(retryTimer);
          retryTimer = null;
          return;
        }
        requestWhiskerData();
      }, 3000);

      return () => {
        if (retryTimer) {
          clearInterval(retryTimer);
          retryTimer = null;
        }
        window.electron.ipcRenderer.removeListener("host-message", listener);
      };
    }
  }, [
    getBackupData,
    updateSettings,
    updateSharedSettings,
    updateActiveAccount,
    restoreBackupData,
  ]);
}



