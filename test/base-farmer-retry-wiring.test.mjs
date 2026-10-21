import { test } from "node:test";
import assert from "node:assert/strict";
import BaseFarmer, {
  planRetry,
  retryDelaySeconds,
} from "../packages/shared/lib/BaseFarmer.js";

const errorWith = ({ body, headers, status = 503, config = { url: "/api/farm" } } = {}) => ({
  config,
  response: {
    status,
    ...(body === undefined ? {} : { data: { retry_after: body } }),
    ...(headers === undefined ? {} : { headers }),
  },
});

const secondsFromNow = (seconds) =>
  new Date(Date.now() + seconds * 1000).toUTCString();

/* ----------------------------------------------------------------------- */
/* retryDelaySeconds - how long the error asks us to wait                   */
/* ----------------------------------------------------------------------- */

test("reports the advertised wait from the body", () => {
  assert.equal(retryDelaySeconds(errorWith({ body: 30 })), 30);
});

test("accepts a numeric string body, as the original truthiness check did", () => {
  assert.equal(retryDelaySeconds(errorWith({ body: "45" })), 45);
});

test("reports nothing for a body that is zero or unparseable", () => {
  assert.equal(retryDelaySeconds(errorWith({ body: 0 })), null);
  assert.equal(retryDelaySeconds(errorWith({ body: "abc" })), null);
});

test("reports the advertised wait from the header", () => {
  assert.equal(retryDelaySeconds(errorWith({ headers: { "retry-after": "120" } })), 120);
  assert.equal(
    retryDelaySeconds(errorWith({ headers: { "retry-after": secondsFromNow(90) } })),
    90,
  );
});

test("reports zero, not nothing, when the header asks for an immediate retry", () => {
  // Zero is a signal; the caller must be able to tell it from silence.
  assert.equal(retryDelaySeconds(errorWith({ headers: { "retry-after": "0" } })), 0);
  assert.equal(
    retryDelaySeconds(errorWith({ headers: { "retry-after": secondsFromNow(-60) } })),
    0,
  );
});

test("the body wins over the header, and silence is silence", () => {
  assert.equal(
    retryDelaySeconds(errorWith({ body: 5, headers: { "retry-after": "9" } })),
    5,
  );
  assert.equal(retryDelaySeconds(errorWith({ headers: {} })), null);
  assert.equal(retryDelaySeconds(new Error("socket hang up")), null);
  assert.equal(retryDelaySeconds(undefined), null);
});

/* ----------------------------------------------------------------------- */
/* planRetry - whether to replay, and why not when we don't                 */
/* ----------------------------------------------------------------------- */

test("plans a retry when the server asked for a wait", () => {
  const plan = planRetry({ error: errorWith({ body: 10 }) });

  assert.equal(plan.retry, true);
  assert.equal(plan.waitSeconds, 10);
  assert.equal(plan.reason, "signalled");
});

test("refuses to retry a plain failure with no advertised wait", () => {
  const plan = planRetry({ error: errorWith({ headers: {} }) });

  assert.equal(plan.retry, false);
  assert.equal(plan.reason, "not-signalled");
});

test("refuses to retry a request that cannot be replayed", () => {
  // Built by hand: passing `config: undefined` to the helper would fall back to
  // its default and hide the very case under test.
  const error = { response: { data: { retry_after: 10 } } };
  const plan = planRetry({ error });

  assert.equal(plan.retry, false);
  assert.equal(plan.reason, "no-config");
  assert.equal(plan.waitSeconds, 10, "the wait is still reported for the log");
});

test("refuses to retry once the attempts are spent", () => {
  const plan = planRetry({
    error: errorWith({ body: 10 }),
    attemptsMade: 2,
    maxAttempts: 2,
  });

  assert.equal(plan.retry, false);
  assert.equal(plan.reason, "attempts-exhausted");
});

test("refuses to retry when the farmer was aborted", () => {
  const plan = planRetry({ error: errorWith({ body: 10 }), aborted: true });

  assert.equal(plan.retry, false);
  assert.equal(plan.reason, "aborted");
});

test("refuses a wait longer than this cycle can hold", () => {
  const plan = planRetry({
    error: errorWith({ body: 300 }),
    maxWaitSeconds: 60,
  });

  assert.equal(plan.retry, false);
  assert.equal(plan.reason, "wait-too-long");
  assert.equal(plan.waitSeconds, 300, "the wait is still reported for the log");
});

test("a plan always carries a reason and a wait, retry or not", () => {
  for (const input of [{}, { error: undefined }, { error: new Error("x") }]) {
    const plan = planRetry(input);
    assert.equal(typeof plan.reason, "string");
    assert.ok(plan.waitSeconds === null || typeof plan.waitSeconds === "number");
  }
});

/* ----------------------------------------------------------------------- */
/* registerRetryInterceptor - the wiring into the request path              */
/* ----------------------------------------------------------------------- */

const makeHarness = ({ aborted = false, options } = {}) => {
  const handlers = [];
  const delays = [];
  const replays = [];

  const api = Object.assign(
    (config) => {
      replays.push(config);
      return Promise.resolve({ ok: true });
    },
    {
    interceptors: {
      response: {
        use: (fulfilled, rejected) => {
          handlers.push({ fulfilled, rejected });
          return 7;
        },
        eject: () => {},
      },
    },
  });

  const farmer = {
    api,
    signal: { aborted },
    utils: { delay: async (ms) => delays.push(ms) },
  };

  const id = BaseFarmer.prototype.registerRetryInterceptor.call(farmer, options);

  return { handlers, delays, replays, id };
};

test("the interceptor registers a response failure handler", () => {
  const { handlers, id } = makeHarness();

  assert.equal(handlers.length, 1);
  assert.equal(typeof handlers[0].fulfilled, "function", "responses still pass through");
  assert.equal(typeof handlers[0].rejected, "function");
  assert.equal(id, 7, "the interceptor id is returned so it can be ejected");
});

test("a 503 with an advertised wait is replayed after that wait", async () => {
  const { handlers, delays, replays } = makeHarness();
  const error = errorWith({ headers: { "retry-after": "2" } });

  await handlers[0].rejected(error);

  assert.equal(error.config.retryAttempts, 1);
  assert.deepEqual(delays, [2000], "slept for exactly the advertised wait");
  assert.deepEqual(replays, [error.config], "the same config was replayed");
});

test("each replay is counted so the interceptor cannot loop forever", async () => {
  const { handlers, delays } = makeHarness({ options: { maxAttempts: 2 } });

  const first = errorWith({ body: 1 });
  await handlers[0].rejected(first);
  assert.equal(first.config.retryAttempts, 1);

  // The replayed request fails the same way, and the counter is already 1.
  await handlers[0].rejected(first);
  assert.equal(first.config.retryAttempts, 2);

  await assert.rejects(
    () => handlers[0].rejected(first),
    (error) => error === first,
    "the third attempt is refused once maxAttempts is reached",
  );

  assert.equal(first.config.retryAttempts, 2, "a refused retry does not consume an attempt");
  assert.equal(delays.length, 2, "only the two accepted attempts slept");
});

test("a failure with no advertised wait is rejected untouched", async () => {
  const { handlers, delays } = makeHarness();
  const error = errorWith({ headers: {} });

  await assert.rejects(
    () => handlers[0].rejected(error),
    (rejected) => rejected === error,
  );

  assert.deepEqual(delays, []);
  assert.equal(error.config.retryAttempts, undefined);
});

test("an aborted farmer does not sleep and does not replay", async () => {
  const { handlers, delays } = makeHarness({ aborted: true });
  const error = errorWith({ body: 5 });

  await assert.rejects(
    () => handlers[0].rejected(error),
    (rejected) => rejected === error,
  );

  assert.deepEqual(delays, []);
});

test("a wait this cycle cannot hold is refused rather than slept through", async () => {
  const { handlers, delays } = makeHarness({ options: { maxWaitSeconds: 10 } });
  const error = errorWith({ body: 600 });

  await assert.rejects(
    () => handlers[0].rejected(error),
    (rejected) => rejected === error,
  );

  assert.deepEqual(delays, []);
});

test("requests that are not axios failures are rejected, not retried", async () => {
  const { handlers, delays } = makeHarness();

  for (const bad of [undefined, null, new Error("boom"), {}]) {
    await assert.rejects(() => handlers[0].rejected(bad));
  }

  assert.deepEqual(delays, []);
});
