import { useMutation } from "@tanstack/react-query";

import useAppContext from "./useAppContext";

export default function useCloudManagerReloginFarmerMutation() {
  const { cloudBackend } = useAppContext();

  return useMutation({
    mutationKey: ["app", "cloud", "manager", "farmer", "relogin"],
    mutationFn: (id) =>
      cloudBackend
        .post(`/api/manager/farmers/relogin`, { id })
        .then((res) => res.data),
  });
}
