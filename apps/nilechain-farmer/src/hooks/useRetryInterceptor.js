import { useLayoutEffect } from "react";
import { planRetry } from "@nile/shared/lib/BaseFarmer";

/**
 * Replay a throttled request after the wait the server advertised.
 *
 * Mirrors the cloud runner's retry interceptor: a 429 or 503 is the server
 * asking for time, not a verdict, so the request is replayed rather than
 * abandoned. Only failures that advertise a wait are replayed.
 *
 * The decision itself lives in `planRetry`, so this hook only owns the axios
 * wiring and the sleep.
 *
 * @param {import("axios").AxiosInstance} api
 * @param {{maxAttempts?: number, maxWaitSeconds?: number}} [options]
 */
export default function useRetryInterceptor(
  api,
  { maxAttempts = 2, maxWaitSeconds = 60 } = {}
) {
  /** Interceptor */
  useLayoutEffect(() => {
    const interceptor = api.interceptors.response.use(
      (response) => response,
      async (error) => {
        const config = error?.config;

        const plan = planRetry({
          error,
          attemptsMade: config?.retryAttempts ?? 0,
          maxAttempts,
          maxWaitSeconds,
        });

        if (!plan.retry) {
          return Promise.reject(error);
        }

        config.retryAttempts = (config.retryAttempts ?? 0) + 1;

        await new Promise((resolve) => {
          setTimeout(resolve, plan.waitSeconds * 1000);
        });

        return api(config);
      }
    );

    return () => {
      api.interceptors.response.eject(interceptor);
    };
  }, [api, maxAttempts, maxWaitSeconds]);
}
