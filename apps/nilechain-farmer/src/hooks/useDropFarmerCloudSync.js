import { useRef } from "react";
import { customLogger } from "@/utils";
import toast from "react-hot-toast";
import { useCallback } from "react";
import useCloudSyncMutation from "./useCloudSyncMutation";
import { useLayoutEffect } from "react";
import useSyncedRef from "./useSyncedRef";

export default function useDropFarmerCloudSync({
  id,
  title,
  account,
  instance,
  queryClient,
  shouldSyncToCloud,
  telegramWebApp,
}) {
  /** Cloud Sync Mutation */
  const { isPending, mutateAsync } = useCloudSyncMutation(id, queryClient);
  const isPendingRef = useSyncedRef(isPending);
  const lastSentHashRef = useRef(null);

  const accountTitle = account.title;
  const accountUserId = account.user?.id;

  const syncToCloud = useCallback(async () => {
    const initData = instance.getInitData();
    if (!initData) {
      customLogger(`SYNC SKIPPED for ${id} — no initData available yet`);
      return;
    }
    const hash = telegramWebApp?.initData || "";
    if (hash && hash === lastSentHashRef.current) {
      customLogger(`SYNC SKIPPED for ${id} — initData unchanged`);
      return;
    }
    lastSentHashRef.current = hash;
    const cookies = await instance.getCookiesForSync?.();
    const data = {
      farmer: id,
      title: accountTitle,
      userId: instance.getUserId() || accountUserId,
      initData,
      headers: instance.api.defaults.headers.common,
      cookies: cookies || [],
    };
    customLogger("SYNCING FARMER TO CLOUD", data);
    mutateAsync(data).then(() => {
      toast.success(`${title} - Synced to Cloud`);
    });
  }, [
    id,
    title,
    accountTitle,
    accountUserId,
    instance,
    mutateAsync,
    telegramWebApp,
  ]);

  /** Sync to Cloud */
  useLayoutEffect(() => {
    if (isPendingRef.current) return;
    if (shouldSyncToCloud) {
      syncToCloud();
    }
  }, [shouldSyncToCloud, syncToCloud]);
}



