import { test } from "node:test";
import assert from "node:assert/strict";
import BaseFarmer from "../packages/shared/lib/BaseFarmer.js";

// shouldRetryRequest does not read `this`, so the method is exercised directly
// on the prototype and the BaseFarmer constructor (which builds a logging proxy,
// an AbortController and parses a Telegram link) never has to run.
const shouldRetry = (error) => BaseFarmer.prototype.shouldRetryRequest(error);

const errorWith = ({ body, headers } = {}) => ({
  response: {
    ...(body === undefined ? {} : { data: { retry_after: body } }),
    ...(headers === undefined ? {} : { headers }),
  },
});

const secondsFromNow = (seconds) =>
  new Date(Date.now() + seconds * 1000).toUTCString();

test("retries when the JSON body carries retry_after", () => {
  assert.equal(shouldRetry(errorWith({ body: 30 })), true);
});

test("retries when the Retry-After header carries delta-seconds", () => {
  // Railway's origin throttling sends the delay as a header, not in the body.
  assert.equal(shouldRetry(errorWith({ headers: { "retry-after": "120" } })), true);
});

test("retries when the Retry-After header is zero", () => {
  // 0 means "retry now" - it is a signal, not an absence of one.
  assert.equal(shouldRetry(errorWith({ headers: { "retry-after": "0" } })), true);
});

test("retries when the Retry-After header is an HTTP date in the future", () => {
  assert.equal(
    shouldRetry(errorWith({ headers: { "retry-after": secondsFromNow(120) } })),
    true,
  );
});

test("retries on a literal IMF-fixdate and a literal RFC 850 date", () => {
  assert.equal(
    shouldRetry(errorWith({ headers: { "retry-after": "Sun, 06 Nov 2094 08:49:37 GMT" } })),
    true,
  );
  assert.equal(
    shouldRetry(errorWith({ headers: { "retry-after": "Sunday, 06-Nov-94 08:49:37 GMT" } })),
    true,
  );
});

test("does not retry on the obsolete asctime date form", () => {
  // Deliberately unsupported: asctime carries no timezone, and V8 would read it
  // as local time rather than UTC.
  assert.equal(
    shouldRetry(errorWith({ headers: { "retry-after": "Sun Nov  6 08:49:37 1994" } })),
    false,
  );
});

test("retries when the Retry-After date has already passed", () => {
  assert.equal(
    shouldRetry(errorWith({ headers: { "retry-after": secondsFromNow(-120) } })),
    true,
  );
});

test("retries when both the body and the header signal a wait", () => {
  assert.equal(
    shouldRetry(errorWith({ body: 5, headers: { "retry-after": "9" } })),
    true,
  );
});

test("does not retry when neither the body nor the header signal a wait", () => {
  assert.equal(shouldRetry(errorWith({ headers: {} })), false);
});

test("does not retry on an unparseable Retry-After value", () => {
  assert.equal(shouldRetry(errorWith({ headers: { "retry-after": "soon" } })), false);
  assert.equal(shouldRetry(errorWith({ headers: { "retry-after": "" } })), false);
  assert.equal(shouldRetry(errorWith({ headers: { "retry-after": "   " } })), false);
  // Date.parse alone reads all of these as dates; the shape check is what stops
  // a malformed header becoming a spurious retry.
  assert.equal(shouldRetry(errorWith({ headers: { "retry-after": "5.5" } })), false);
  assert.equal(shouldRetry(errorWith({ headers: { "retry-after": "1e3" } })), false);
});

test("does not retry on a negative or signed Retry-After value", () => {
  assert.equal(shouldRetry(errorWith({ headers: { "retry-after": "-1" } })), false);
  assert.equal(shouldRetry(errorWith({ headers: { "retry-after": "+1" } })), false);
});

test("trusts a JSON body retry_after over an unparseable header", () => {
  assert.equal(
    shouldRetry(errorWith({ body: 30, headers: { "retry-after": "soon" } })),
    true,
  );
});

test("does not retry on a zero body retry_after when no header is present", () => {
  // A falsy body value falls through to the header check, which is absent.
  assert.equal(shouldRetry(errorWith({ body: 0 })), false);
});

test("survives an error with no response at all", () => {
  assert.equal(shouldRetry(new Error("socket hang up")), false);
  assert.equal(shouldRetry({ response: {} }), false);
  assert.equal(shouldRetry({ response: { headers: undefined } }), false);
  assert.equal(shouldRetry(undefined), false);
});
