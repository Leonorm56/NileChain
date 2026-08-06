import crypto from "node:crypto";

/** Chrome build versions (suffix used in realistic UAs). */
const CHROME_BUILDS = [
  "120.0.0.0",
  "121.0.0.0",
  "122.0.0.0",
  "123.0.0.0",
  "124.0.0.0",
  "125.0.0.0",
  "126.0.0.0",
  "127.0.0.0",
  "128.0.0.0",
  "129.0.0.0",
  "130.0.0.0",
  "131.0.0.0",
  "132.0.0.0",
  "133.0.0.0",
  "134.0.0.0",
  "135.0.0.0",
  "136.0.0.0",
  "137.0.0.0",
  "138.0.0.0",
];

/** Realistic Desktop Chrome UAs keyed by system version. */
const DESKTOP_PROFILES = [
  {
    systemVersion: "Windows 10",
    ua: (build) =>
      `Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${build} Safari/537.36`,
  },
  {
    systemVersion: "Windows 11",
    ua: (build) =>
      `Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${build} Safari/537.36`,
  },
  {
    systemVersion: "macOS 10.15.7",
    ua: (build) =>
      `Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${build} Safari/537.36`,
  },
  {
    systemVersion: "macOS 12.6",
    ua: (build) =>
      `Mozilla/5.0 (Macintosh; Intel Mac OS X 12_6) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${build} Safari/537.36`,
  },
  {
    systemVersion: "macOS 13.5",
    ua: (build) =>
      `Mozilla/5.0 (Macintosh; Intel Mac OS X 13_5) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${build} Safari/537.36`,
  },
  {
    systemVersion: "Linux x86_64",
    ua: (build) =>
      `Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${build} Safari/537.36`,
  },
];

/** Realistic Android (mobile Chrome) device variants. */
const MOBILE_PROFILES = [
  {
    systemVersion: "Android 13",
    ua: (build) =>
      `Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${build} Mobile Safari/537.36`,
  },
  {
    systemVersion: "Android 14",
    ua: (build) =>
      `Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${build} Mobile Safari/537.36`,
  },
  {
    systemVersion: "Android 13",
    ua: (build) =>
      `Mozilla/5.0 (Linux; Android 13; SM-S918B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${build} Mobile Safari/537.36`,
  },
  {
    systemVersion: "Android 12",
    ua: (build) =>
      `Mozilla/5.0 (Linux; Android 12; SM-A525F) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${build} Mobile Safari/537.36`,
  },
  {
    systemVersion: "Android 11",
    ua: (build) =>
      `Mozilla/5.0 (Linux; Android 11; Redmi Note 10) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${build} Mobile Safari/537.36`,
  },
];

/** Language codes that pair with a system language. */
const LANGUAGE_PAIRS = [
  { langCode: "en", systemLangCode: "en-US" },
  { langCode: "en", systemLangCode: "en-GB" },
  { langCode: "en", systemLangCode: "en-CA" },
];

/** Telegram Mini-App version labels. */
const APP_VERSIONS = ["2.1 K", "2.2 K", "2.3 K", "2.4 K"];

/** Pick a random element from a given array. */
function pick(list) {
  return list[crypto.randomInt(list.length)];
}

/**
 * Generate a unique, permanent device fingerprint for an account.
 *
 * @returns {{ deviceModel: string, systemVersion: string, appVersion: string, langCode: string, systemLangCode: string, platform: string }}
 */
export function generateFingerprint() {
  const useMobile = pick([false, false, false, true]);
  const profile = pick(useMobile ? MOBILE_PROFILES : DESKTOP_PROFILES);
  const build = pick(CHROME_BUILDS);
  const language = pick(LANGUAGE_PAIRS);

  return {
    deviceModel: profile.ua(build),
    systemVersion: profile.systemVersion,
    appVersion: pick(APP_VERSIONS),
    langCode: language.langCode,
    systemLangCode: language.systemLangCode,
    platform: useMobile ? "android" : "web",
  };
}

export default generateFingerprint;