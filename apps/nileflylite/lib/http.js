import { logger } from "./logger.js";

const DEFAULT_HEADERS = {
  "User-Agent": "Mozilla/5.0 (Linux; Android 14; SM-S921B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.6778.135 Mobile Safari/537.36",
  "sec-ch-ua": '"Android WebView";v="131", "Chromium";v="131", "Not_A Brand";v="24"',
  "sec-ch-ua-mobile": "?1",
  "sec-ch-ua-platform": '"Android"',
  "sec-fetch-dest": "empty",
  "sec-fetch-mode": "cors",
  "sec-fetch-site": "same-origin",
  "x-requested-with": "org.telegram.messenger",
};

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

export async function post(url, body, extraHeaders = {}) {
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const params = new URLSearchParams(body);
      const res = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          ...DEFAULT_HEADERS,
          ...extraHeaders,
        },
        body: params.toString(),
      });
      const text = await res.text();
      if (!res.ok) {
        throw new Error(`HTTP ${res.status}: ${text.slice(0, 100)}`);
      }
      return { ok: true, data: text, status: res.status };
    } catch (err) {
      if (attempt < 3) {
        logger.warn(`HTTP attempt ${attempt} failed: ${err.message}, retrying...`);
        await sleep(5000);
      } else {
        return { ok: false, data: null, error: err.message };
      }
    }
  }
}

export async function postJson(url, jsonBody, extraHeaders = {}) {
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...extraHeaders,
        },
        body: JSON.stringify(jsonBody),
      });
      const text = await res.text();
      if (!res.ok) {
        if (res.status >= 400 && res.status < 500) {
          return { ok: false, data: text, error: `HTTP ${res.status}: ${text.slice(0, 100)}` };
        }
        throw new Error(`HTTP ${res.status}: ${text.slice(0, 100)}`);
      }
      return { ok: true, data: text, status: res.status };
    } catch (err) {
      if (attempt < 3) {
        logger.warn(`HTTP attempt ${attempt} failed: ${err.message}, retrying...`);
        await sleep(5000);
      } else {
        return { ok: false, data: null, error: err.message };
      }
    }
  }
}
