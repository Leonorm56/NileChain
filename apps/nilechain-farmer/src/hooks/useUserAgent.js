import userAgents from "@nile/shared/resources/userAgents";

import useSharedStorageState from "./useSharedStorageState";

export default function useUserAgent() {
  return useSharedStorageState("user-agent", userAgents[0]).value;
}



