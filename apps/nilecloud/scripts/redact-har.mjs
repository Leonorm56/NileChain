#!/usr/bin/env node
/**
 * Redact a Chrome HAR into a committable fixture.
 *
 * The captures this project works from contain live secrets: Telegram
 * `initData` in query strings and bodies, `Authorization` headers, cookies, and
 * our own NileCloud `/api/subscription` calls carrying an account `auth`
 * string. None of that may reach the repo, so this script keeps only the game
 * API and strips every credential-shaped thing out of it.
 *
 * Usage:
 *   node scripts/redact-har.mjs <input.har> <output.json> [--all-hosts]
 *
 * Default hosts: the EasyCoin Cloudflare Worker and its "isle" sibling. Our own
 * infrastructure is deliberately not in that list — the `auth` string on
 * `/api/subscription` is exactly the kind of thing this exists to keep out.
 */

import fs from "node:fs";
import path from "node:path";

/** Hosts that belong to the game, not to us. */
const GAME_HOSTS = new Set([
  "ezzgold.easyciin.workers.dev",
  "ezzcoinapp.easyciin.workers.dev",
]);

/** Header names that are always dropped, matched case-insensitively. */
const DROP_ALL_HEADERS = true;

/** Field names whose value is replaced outright, wherever they appear. */
const SECRET_FIELDS =
  /^(authorization|cookie|cookies|set-cookie|initdata|init_data|tgwebappdata|auth|session|sessionid|session_id|proxy|password|secret|token|hash|query_id|auth_date|signature)$/i;

/** Telegram identity we do not want in the repo, mapped to stable stand-ins. */
const IDENTITY_FIELDS = new Map([
  ["tgid", 1000000001],
  ["telegramid", 1000000001],
  ["username", "redacted_user"],
  ["firstname", "Redacted"],
  ["lastname", "User"],
  ["photourl", "[REDACTED-URL]"],
]);

/** Anything that looks like init data sitting inside a plain string. */
const INLINE_SECRETS = [
  /tgWebAppData=[^&\s"']+/gi,
  /user=%7B[^&\s"']+/gi,
  /\bhash=[0-9a-f]{16,}/gi,
  /\bquery_id=[A-Za-z0-9_-]{10,}/gi,
  /\bauth_date=\d+/gi,
];

const REDACTED = "[REDACTED]";

/** Replace `<value>` with `mask`, keeping the shape of the input. */
function redactValue(key, value) {
  const lower = String(key).toLowerCase();

  if (IDENTITY_FIELDS.has(lower)) return IDENTITY_FIELDS.get(lower);
  if (SECRET_FIELDS.test(lower)) return REDACTED;

  if (typeof value === "string") {
    let out = value;
    for (const pattern of INLINE_SECRETS) {
      out = out.replace(pattern, REDACTED);
    }
    return out;
  }

  if (Array.isArray(value)) return value.map((item) => redactValue(key, item));

  if (value && typeof value === "object") {
    const result = {};
    for (const [k, v] of Object.entries(value)) {
      result[k] = redactValue(k, v);
    }
    return result;
  }

  return value;
}

/** Parse a HAR body, decoding base64 when the exporter used it. */
function readBody(content) {
  if (!content || typeof content.text !== "string") return null;

  const raw =
    content.encoding === "base64"
      ? Buffer.from(content.text, "base64").toString("utf8")
      : content.text;

  if (!raw) return null;

  try {
    return redactValue("", JSON.parse(raw));
  } catch {
    // Not JSON — still scrub it, it may be a URL or an error page.
    return redactValue("", raw);
  }
}

/** Turn one HAR entry into a fixture record, or null when it is not ours. */
function toRecord(entry) {
  let url;
  try {
    url = new URL(entry.request?.url || "");
  } catch {
    return null;
  }

  if (!GAME_HOSTS.has(url.host)) return null;

  // The captures are mostly art: `game-assets/*.webp`, `isle-assets/*.glb`,
  // emoji PNGs, the 3D isle and the app bundle itself. None of it is behaviour,
  // and none of it belongs in a fixture that tests action ordering.
  if (!/^\/api\//.test(url.pathname)) return null;

  // The 3D "isle" side app is a separate product and explicitly out of scope.
  if (url.pathname.startsWith("/api/isle")) return null;

  const record = {
    method: entry.request?.method || "GET",
    host: url.host,
    path: url.pathname,
    status: entry.response?.status ?? null,
    requestBody:
      entry.request?.postData?.text && entry.request.postData.text.length <= 20000
        ? readBody({ text: entry.request.postData.text })
        : null,
    responseBody: readBody(entry.response?.content),
  };

  // The query string can carry the start param or init data; keep the key names
  // so tests can assert on routing, never the values.
  const query = url.search ? redactValue("", url.search) : null;
  if (query && query !== "?") record.query = query;

  if (DROP_ALL_HEADERS) record.headersDropped = Object.keys(entry.request?.headers || {}).length;

  return record;
}

function main() {
  const [input, output] = process.argv.slice(2);

  if (!input || !output) {
    console.error("usage: node scripts/redact-har.mjs <input.har> <output.json>");
    process.exit(1);
  }

  const har = JSON.parse(fs.readFileSync(input, "utf8"));
  const entries = har.log?.entries || [];

  const records = entries.map(toRecord).filter(Boolean);

  const byPath = new Map();
  for (const record of records) {
    const key = `${record.method} ${record.path}`;
    byPath.set(key, (byPath.get(key) || 0) + 1);
  }

  const fixture = {
    source: path.basename(input),
    redactedAt: new Date().toISOString().slice(0, 10),
    hosts: [...new Set(records.map((r) => r.host))],
    counts: Object.fromEntries([...byPath].sort()),
    records,
  };

  fs.mkdirSync(path.dirname(output), { recursive: true });
  fs.writeFileSync(output, `${JSON.stringify(fixture, null, 2)}\n`);

  console.log(`${path.basename(input)}: ${entries.length} entries -> ${records.length} game records`);
  for (const [key, count] of [...byPath].sort()) {
    console.log(`  ${String(count).padStart(3)}x ${key}`);
  }
  console.log(`written: ${output}`);
}

main();
