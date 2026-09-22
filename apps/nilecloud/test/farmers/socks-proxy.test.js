import * as assert from "node:assert";
import { test } from "node:test";

import toSocksProxy from "../../lib/socksProxy.js";

/**
 * Regression: gramjs only takes its SOCKS branch when the proxy object has NO
 * `MTProxy` key. `parseProxy` used to always add `MTProxy: false`, so the proxy
 * was silently ignored and every account connected straight from the box IP.
 */
test("a parsed proxy carries no MTProxy key, so gramjs uses the SOCKS branch", () => {
  const parsed = toSocksProxy("user:pass@85.198.47.20:8080");

  assert.ok(!("MTProxy" in parsed), "an MTProxy key makes gramjs skip the proxy");
  assert.strictEqual(parsed.socksType, 5);
});

test("a proxy string is split into the fields gramjs needs", () => {
  const parsed = toSocksProxy("user:pass@85.198.47.20:8080");

  assert.deepStrictEqual(parsed, {
    ip: "85.198.47.20",
    port: 8080,
    username: "user",
    password: "pass",
    socksType: 5,
    timeout: 20,
  });
});

test("the SOCKS timeout is a real one, not the 2 seconds that failed every dial", () => {
  assert.strictEqual(toSocksProxy("u:p@1.2.3.4:1080").timeout, 20);
  assert.strictEqual(toSocksProxy("u:p@1.2.3.4:1080", 45).timeout, 45);
});

test("no proxy parses to null, so the client connects directly", () => {
  assert.strictEqual(toSocksProxy(null), null);
  assert.strictEqual(toSocksProxy(""), null);
  assert.strictEqual(toSocksProxy(undefined), null);
});

test("a malformed proxy is refused rather than dialled as garbage", () => {
  assert.strictEqual(toSocksProxy("user:pass@1.2.3.4"), null, "no port");
  assert.strictEqual(toSocksProxy("user:pass@:8080"), null, "no host");
  assert.strictEqual(toSocksProxy("nonsense"), null);
});
