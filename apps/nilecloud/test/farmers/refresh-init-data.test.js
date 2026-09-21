import * as assert from "node:assert";
import { test } from "node:test";

import refreshInitData from "../../lib/refreshInitData.js";

test("a stalled refresh is retried and the second attempt wins", async () => {
  let attempts = 0;
  const failures = [];

  const result = await refreshInitData({
    attempt: async () => {
      attempts += 1;
      if (attempts === 1) throw new Error("MTProto stalled");
    },
    onFailure: (error, attemptNo) => failures.push([error.message, attemptNo]),
  });

  assert.deepStrictEqual(result, { ok: true, attempts: 2, error: null });
  assert.strictEqual(attempts, 2);
  assert.deepStrictEqual(failures, [["MTProto stalled", 1]]);
});

test("a refresh that works first time is not retried", async () => {
  let attempts = 0;

  const result = await refreshInitData({
    attempt: async () => {
      attempts += 1;
    },
  });

  assert.deepStrictEqual(result, { ok: true, attempts: 1, error: null });
  assert.strictEqual(attempts, 1);
});

test("a refresh that keeps failing stops at the attempt limit", async () => {
  let attempts = 0;
  const failures = [];
  const stall = new Error("Telegram init-data refresh timed out (MTProto stalled)");

  const result = await refreshInitData({
    attempt: async () => {
      attempts += 1;
      throw stall;
    },
    onFailure: (error) => failures.push(error),
  });

  assert.strictEqual(attempts, 2);
  assert.strictEqual(result.ok, false);
  assert.strictEqual(result.attempts, 2);
  assert.strictEqual(result.error, stall);
  assert.strictEqual(failures.length, 2, "each failed attempt is reported");
});

test("the attempt limit is configurable", async () => {
  let attempts = 0;

  const result = await refreshInitData({
    attempts: 3,
    attempt: async () => {
      attempts += 1;
      throw new Error("nope");
    },
  });

  assert.strictEqual(attempts, 3);
  assert.strictEqual(result.attempts, 3);
});

test("a failed refresh never throws — the cycle must carry on", async () => {
  await assert.doesNotReject(() =>
    refreshInitData({
      attempt: async () => {
        throw new Error("SESSION_REVOKED");
      },
    }),
  );
});
