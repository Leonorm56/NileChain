import * as assert from "node:assert";
import { test } from "node:test";

import refreshInitData from "../../lib/refreshInitData.js";
import {
  MintStalledError,
  SessionSilentError,
  assertSessionReplies,
  isMintStalledError,
  isSessionSilentError,
} from "../../lib/mintStall.js";

test("a session that never replies is called dead without waiting for the mint ceiling", async () => {
  /** Never settles — exactly what the dead accounts do to the first invoke */
  const client = { isUserAuthorized: () => new Promise(() => {}) };

  await assert.rejects(
    () => assertSessionReplies(client, { timeoutMs: 40 }),
    SessionSilentError,
  );
});

test("a refusal still counts as an answer, because the session is alive", async () => {
  const client = {
    isUserAuthorized: async () => {
      throw new Error("401: SESSION_REVOKED");
    },
  };

  await assert.doesNotReject(() => assertSessionReplies(client, { timeoutMs: 500 }));
});

test("a healthy session needs no timeout at all", async () => {
  const client = { isUserAuthorized: async () => true };

  await assert.doesNotReject(() => assertSessionReplies(client, { timeoutMs: 500 }));
});

/**
 * A silent session is the failure these accounts hit: the connection comes up in
 * ~2s and the first invoke never returns, measured at no reply inside 30s, alone,
 * one account at a time, through its own proxy. Neither a retry nor a rebuild can
 * help — the rebuild waits on that same session — so it must fail fast.
 */
test("a silent session is not retried and not rebuilt — it fails fast", async () => {
  let attempts = 0;
  let recoveries = 0;

  const result = await refreshInitData({
    attempt: async () => {
      attempts += 1;
      throw new SessionSilentError(
        "Telegram session connected but never answered (dead session)",
      );
    },
    isFatalStall: isSessionSilentError,
    recover: async () => {
      recoveries += 1;
      return true;
    },
  });

  assert.strictEqual(attempts, 1, "no second ceiling is spent on the same session");
  assert.strictEqual(recoveries, 0, "a rebuild cannot work from a silent session");
  assert.strictEqual(result.ok, false);
  assert.ok(isSessionSilentError(result.error));
});

/** A stall with a live session: the fresh-client retry is spent first, then the rebuild */
test("a stall with a live session is retried first, then rebuilt, then retried again", async () => {
  let attempts = 0;
  let recoveries = 0;

  const result = await refreshInitData({
    attempt: async () => {
      attempts += 1;
      /** Both attempts on the old session stall; the rebuilt one mints */
      if (attempts <= 2) {
        throw new MintStalledError(
          "Telegram init-data refresh timed out (MTProto stalled)",
        );
      }
    },
    recover: async () => {
      recoveries += 1;
      return true;
    },
  });

  assert.strictEqual(attempts, 3, "two attempts, then one on the rebuilt session");
  assert.strictEqual(recoveries, 1, "the rebuild happens after the retry, not instead of it");
  assert.strictEqual(result.ok, true);
});

test("a stall that cannot be recovered stops instead of looping", async () => {
  let attempts = 0;
  let recoveries = 0;

  const result = await refreshInitData({
    attempt: async () => {
      attempts += 1;
      throw new MintStalledError(
        "Telegram init-data refresh timed out (MTProto stalled)",
      );
    },
    recover: async () => {
      recoveries += 1;
      return false;
    },
  });

  assert.strictEqual(attempts, 2, "the retry budget, and no more");
  assert.strictEqual(recoveries, 1);
  assert.strictEqual(result.ok, false);
  assert.ok(isMintStalledError(result.error));
});

test("recovery is attempted once, even when the rebuilt session also stalls", async () => {
  let attempts = 0;
  let recoveries = 0;

  const result = await refreshInitData({
    attempt: async () => {
      attempts += 1;
      throw new MintStalledError(
        "Telegram init-data refresh timed out (MTProto stalled)",
      );
    },
    recover: async () => {
      recoveries += 1;
      return true;
    },
  });

  assert.strictEqual(recoveries, 1, "no recovery loop");
  assert.strictEqual(attempts, 3, "two attempts on the old session, one on the new");
  assert.strictEqual(result.ok, false);
});

test("a transient failure is still retried and never triggers recovery", async () => {
  let attempts = 0;
  let recoveries = 0;

  const result = await refreshInitData({
    attempt: async () => {
      attempts += 1;
      throw new Error("read ECONNRESET");
    },
    recover: async () => {
      recoveries += 1;
      return true;
    },
  });

  assert.strictEqual(recoveries, 0);
  assert.strictEqual(attempts, 2, "transient failures keep the normal retry");
  assert.strictEqual(result.ok, false);
});

test("without a recover hook a stall keeps the old retry behaviour", async () => {
  let attempts = 0;

  const result = await refreshInitData({
    attempt: async () => {
      attempts += 1;
      throw new MintStalledError(
        "Telegram init-data refresh timed out (MTProto stalled)",
      );
    },
  });

  assert.strictEqual(attempts, 2);
  assert.strictEqual(result.ok, false);
});

test("a stall is recognised by class and by message", () => {
  assert.strictEqual(isMintStalledError(new MintStalledError("x")), true);
  assert.strictEqual(
    isMintStalledError(new Error("Telegram init-data refresh timed out (MTProto stalled)")),
    true,
  );
  assert.strictEqual(
    isMintStalledError(new Error("Telegram client did not connect (MTProto unreachable)")),
    false,
    "a connection that never came up is a different failure",
  );
  assert.strictEqual(isMintStalledError(new Error("401: SESSION_REVOKED")), false);
  assert.strictEqual(isMintStalledError(null), false);
});

test("only a silent session is fatal — a webview stall is not", () => {
  const silent = new SessionSilentError("never answered");
  const webview = new MintStalledError("init-data refresh timed out (MTProto stalled)");

  assert.strictEqual(isSessionSilentError(silent), true);
  assert.strictEqual(isSessionSilentError(webview), false);
  assert.strictEqual(isMintStalledError(silent), true, "both are stalls");
  assert.strictEqual(isSessionSilentError(null), false);
});
