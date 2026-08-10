import AdsGramClient from "../lib/AdsGramClient.js";
import BaseFarmer from "../lib/BaseFarmer.js";
import MonetagClient from "../lib/MonetagClient.js";

/* ------------------------------------------------------------------------- */
/* Transport                                                                 */
/*                                                                           */
/* Every request folds into the same HTTPS host; all of them hang off it.     */
/* ------------------------------------------------------------------------- */

const API_URL = "https://api.miningbuddies.site/api";

/*
 * Crypto scheme, mirrored from the drop's frontend bundle:
 *
 *  - `/auth/telegram`, `/config`, `/announcements` are the only POST paths
 *    that travel plaintext.
 *  - Every other POST body is wrapped in an AES-256-GCM envelope
 *    `{"v":1,"iv":b64url,"ct":b64url}`. WebCrypto's GCM appends the 16-byte
 *    tag to the ciphertext, so `ct` carries it.
 *  - The key is HKDF-SHA256 over the session secret (utf-8 IKM), the session
 *    id (utf-8 salt) and the info "mb-payload-v1".
 *  - The request is signed with the session secret: `x-signature` is an
 *    HMAC-SHA256 of the canonical
 *    `METHOD\npathname\nnonce\ntimestamp\nsha256hex(body)` where `pathname`
 *    is the full URL's path (e.g. `/api/ads/session`) and `path` includes the
 *    `/api` prefix. `x-xsrf-sign` is `sha256(xsrf:nonce:timestamp)`.
 *  - Responses are wrapped `{ok,data}` and may themselves arrive encrypted.
 *
 * GET requests are never encrypted or signed.
 */
const CRYPTO_INFO = "mb-payload-v1";

const encoder = new TextEncoder();
const decoder = new TextDecoder();

/**
 * Bytes -> unpadded base64url.
 *
 * Accepts an ArrayBuffer as well as a typed array: `crypto.subtle.encrypt`
 * and `.digest` both resolve to a raw ArrayBuffer, which is not iterable, so
 * the input has to be viewed before it can be walked byte by byte.
 */
function toBase64Url(bytes) {
  const view =
    bytes instanceof Uint8Array ? bytes : new Uint8Array(toArrayBuffer(bytes));

  let binary = "";
  for (const byte of view) binary += String.fromCharCode(byte);
  return btoa(binary)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

/** Normalise an ArrayBuffer / typed-array / DataView to an ArrayBuffer */
function toArrayBuffer(value) {
  if (value instanceof ArrayBuffer) return value;
  if (ArrayBuffer.isView(value)) {
    return value.buffer.slice(
      value.byteOffset,
      value.byteOffset + value.byteLength,
    );
  }
  return value;
}

/** base64url -> bytes */
function fromBase64Url(value) {
  const padded = value.replace(/-/g, "+").replace(/_/g, "/");
  const binary = atob(padded);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

/** Bytes -> hex */
function toHex(bytes) {
  return Array.from(new Uint8Array(bytes))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

/** SHA-256 hex */
async function sha256Hex(value) {
  const digest = await globalThis.crypto.subtle.digest(
    "SHA-256",
    encoder.encode(String(value)),
  );
  return toHex(digest);
}

/** HMAC-SHA256 hex */
async function hmacHex(secret, value) {
  const key = await globalThis.crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await globalThis.crypto.subtle.sign(
    "HMAC",
    key,
    encoder.encode(String(value)),
  );
  return toHex(signature);
}

/* ------------------------------------------------------------------------- */
/* Ads                                                                        */
/*                                                                           */
/* All three watch flows share the same skeleton: open a session, show the    */
/* ad (with a fallback provider when the primary has none), then complete it. */
/* The two click-required networks must actually be run against their own     */
/* SDK so the click tracker fires.                                            */
/* ------------------------------------------------------------------------- */

/** Networks that enforce the session's `minWatchSec` server-side */
const MIN_WATCH_PROVIDERS = ["adsgram", "monetag"];

/** Accepted providers, keyed to the client that can play one */
const PROVIDER_CLIENTS = { adsgram: "adsgram", monetag: "monetag" };

/** Margin over `minWatchSec`, so a watch is never rejected as too fast */
const AD_WATCH_MARGIN_SECONDS = 3;

/** Cooldown between ad runs */
const AD_COOLDOWN_SECONDS = 8;

/* ------------------------------------------------------------------------- */
/* Tasks                                                                      */
/* ------------------------------------------------------------------------- */

/**
 * `/tasks` answers with every category in one response — `daily`, `social`,
 * `exclusive`, `partner` — so the list is fetched once with no filter. The
 * `?category=` variant only narrows what is already there.
 */

/** Statuses the drop uses for a task it has already credited */
const TASK_DONE_STATUSES = ["done", "claimed", "completed"];

/** `verification.mode` values, i.e. what the drop checks before crediting */
const TASK_MODE_LINK = "link";
const TASK_MODE_MEMBER = "telegram_member";
const TASK_MODE_AD_SLOTS = "ad_slots";

/**
 * Error codes the drop raises when a session is no longer trusted. The web app
 * silently logs in again and replays the call once, which is what keeps a long
 * run alive past a session rotation.
 */
const SESSION_ERROR_CODES = [
  "SESSION_INVALID",
  "SESSION_MISMATCH",
  "SESSION_REQUIRED",
  "SIGNATURE_REQUIRED",
  "UNAUTHORIZED",
];

/**
 * Left between opening a task and claiming it, so the backend is satisfied
 * that the task was genuinely seen (the page claims ~1s after a visit).
 */
const TASK_CLAIM_DELAY_SECONDS = 2;

/** Gap between per-task attempts */
const TASK_GAP_SECONDS = 12;

/** Gap between mandatory-community joins, so the joins are not a burst */
const COMMUNITY_JOIN_GAP_SECONDS = 5;

/* ------------------------------------------------------------------------- */
/* Ad slots                                                                   */
/* ------------------------------------------------------------------------- */

/** How many rewarded ads (ad slots) a run should try to earn. */
const SLOTS_PER_RUN = 10;

/**
 * The rewarded-ad purpose. The withdraw flow names its purpose explicitly
 * (`withdraw`); the standard coin-earning ad uses this label.
 */
const SLOT_PURPOSE = "coins";

/** The purpose/ref pair the daily chest's gate ad is booked under */
const SLOT_PURPOSE_STREAK = "streak";

export default class MiningBuddiesFarmer extends BaseFarmer {
  static id = "mining-buddies";
  static title = "Mining Buddies";
  static emoji = "⛏️";
  static host = "miningbuddies.site";

  /** The web app host listed above, plus the API and ad networks it talks to */
  static get apiHosts() {
    return ["api.miningbuddies.site"];
  }
  static telegramLink =
    "https://t.me/MiningBuddiesBot/play?startapp=ref_6627962056";

  /**
   * Both ad networks are listed alongside the drop's own host so the
   * extension's declarativeNetRequest rules present the publisher origin on
   * ad calls too.
   */
  static domains = [
    "miningbuddies.site",
    "api.miningbuddies.site",
    "api.adsgram.ai",
    "e8ys.com",
    "my.rtmark.net",
  ];

  static path = "/";
  static referrerMode = "random";
  static apiDelay = 500;
  static singleton = true;
  static rating = 5;

  /**
   * The extension's automatic DNR rules inject `x-requested-with` and
   * `sec-ch-ua` on every domain listed above. Those headers are not CORS
   * safelisted, so every API call would trigger a preflight that the server
   * rejects (`Access-Control-Allow-Headers` only lists content-type, x-lang).
   * Override the preflight response headers for our own domains so the
   * in-app webview fetch calls succeed.
   */
  static netRequest = {
    responseHeaders: [
      {
        header: "access-control-allow-origin",
        operation: "set",
        value: "https://miningbuddies.site",
      },
      {
        header: "access-control-allow-credentials",
        operation: "set",
        value: "true",
      },
      {
        header: "access-control-allow-methods",
        operation: "set",
        value: "GET, HEAD, PUT, PATCH, POST, DELETE, OPTIONS",
      },
      {
        header: "access-control-allow-headers",
        operation: "set",
        value:
          "authorization, content-type, x-requested-with, x-enc, x-lang, x-nonce, x-session, x-signature, x-timestamp, x-xsrf-sign, sec-ch-ua, sec-ch-ua-mobile, sec-ch-ua-platform",
      },
      {
        header: "access-control-expose-headers",
        operation: "set",
        value: "x-enc, x-server-time",
      },
    ],
  };

  /* --------------------------------------------------------------------- */
  /* Transport                                                             */
  /*                                                                       */
  /* Each POST is signed per request, so signing headers cannot sit on the  */
  /* axios defaults the way a bearer token can. `configuredHeaders` are    */
  /* installed by `configureAuthHeaders` and combined with the live         */
  /* signature on every call.                                              */
  /* --------------------------------------------------------------------- */

  /** AdsGram, built once per run */
  get adsgram() {
    return (this._adsgram ||= new AdsGramClient(this));
  }

  /** Monetag, built once per run */
  get monetag() {
    return (this._monetag ||= new MonetagClient(this));
  }

  /** Fixed headers installed after login */
  get authHeaders() {
    return this._authHeaders || {};
  }

  /** GET an endpoint (never encrypted or signed) */
  get(path, params = {}, config = {}) {
    return this.api
      .get(`${API_URL}${path}`, {
        signal: this.signal,
        params,
        ...this.rawHeaders(),
        ...config,
      })
      .then((res) => this.unwrap(res.data));
  }

  /**
   * Pull the drop's error code out of a failed request. The code lives in the
   * encrypted body (`{ok:false,error:{code}}`), so the same AES unwrap that
   * every response goes through has to run on the error payload too.
   */
  async errorCodeOf(error) {
    const data = error?.response?.data;
    if (!data) return null;
    try {
      const unwrapped = await this.unwrapEnvelope(data);
      return unwrapped?.error?.code ?? null;
    } catch {
      return null;
    }
  }

  /**
   * POST a signed, encrypted body, replaying once through a fresh login when
   * the drop reports the session as stale.
   *
   * Whitelisted paths (`/auth/telegram` etc.) are sent plaintext; everything
   * else is wrapped in the AES-GCM envelope and signed.
   */
  async post(path, body = {}, retried = false) {
    const method = "POST";
    const encrypted = !["/auth/telegram", "/config", "/announcements"].includes(
      path,
    );

    const wire = encrypted ? await this.encrypt(body) : JSON.stringify(body);
    const headers = encrypted
      ? await this.signedHeaders(method, path, wire)
      : { ...this.rawHeaders(), "Content-Type": "application/json" };

    try {
      return await this.api
        .post(`${API_URL}${path}`, wire, {
          signal: this.signal,
          headers,
        })
        .then((res) => this.unwrap(res.data));
    } catch (error) {
      /* Logging in again to fix a login is a loop, so it is never retried */
      if (retried || !encrypted || this.reloggingIn) throw error;

      const code = await this.errorCodeOf(error);
      if (!SESSION_ERROR_CODES.includes(code)) throw error;

      this.logger.warn(
        `Session rejected (${code}) — logging in again and retrying once.`,
      );

      this.reloggingIn = true;
      try {
        await this.login();
      } finally {
        this.reloggingIn = false;
      }

      return this.post(path, body, true);
    }
  }

  /** Headers shared by every call once a session exists */
  rawHeaders(merge = {}) {
    return { "x-lang": "en", ...this.authHeaders, ...merge };
  }

  /**
   * Sign a request.
   *
   * `path` is the API pathname WITH the `/api` prefix — the canonical for
   * `/ads/session` reads `/api/ads/session`.
   */
  async signedHeaders(method, path, body) {
    const session = this.session;
    const nonce = this.makeNonce();
    const timestamp = this.serverNow();

    const canonical = [
      method,
      `/api${path}`.replace(/\/\//g, "/"),
      nonce,
      String(timestamp),
      await sha256Hex(body),
    ].join("\n");

    const signature = await hmacHex(session.secret, canonical);
    const xsrfSign = await sha256Hex(
      `${session.xsrf}:${nonce}:${timestamp}`,
    );

    return this.rawHeaders({
      "Content-Type": "application/json",
      "x-enc": "1",
      "x-session": session.id,
      "x-nonce": nonce,
      "x-timestamp": String(timestamp),
      "x-signature": signature,
      "x-xsrf-sign": xsrfSign,
    });
  }

  /** UUID nonce — the drop asks for the exact shape */
  makeNonce() {
    return (
      globalThis.crypto?.randomUUID?.() ||
      "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (token) => {
        const nibble = (Math.random() * 16) | 0;
        return (token === "x" ? nibble : (nibble & 3) | 8).toString(16);
      })
    );
  }

  /** Wrap a JSON body in the AES-256-GCM envelope */
  async encrypt(body) {
    const key = await this.payloadKey();
    const iv = globalThis.crypto.getRandomValues(new Uint8Array(12));
    const ct = await globalThis.crypto.subtle.encrypt(
      { name: "AES-GCM", iv },
      key,
      encoder.encode(JSON.stringify(body)),
    );

    return JSON.stringify({ v: 1, iv: toBase64Url(iv), ct: toBase64Url(ct) });
  }

  /** Derive the payload key for the current session */
  async payloadKey() {
    const { id, secret } = this.session;

    const hkdfKey = await globalThis.crypto.subtle.importKey(
      "raw",
      encoder.encode(secret),
      "HKDF",
      false,
      ["deriveBits"],
    );

    const bits = await globalThis.crypto.subtle.deriveBits(
      {
        name: "HKDF",
        hash: "SHA-256",
        salt: encoder.encode(id),
        info: encoder.encode(CRYPTO_INFO),
      },
      hkdfKey,
      256,
    );

    return globalThis.crypto.subtle.importKey(
      "raw",
      bits,
      { name: "AES-GCM" },
      false,
      ["encrypt", "decrypt"],
    );
  }

  /** Decrypt an encrypted response envelope when present */
  async unwrapEnvelope(data) {
    if (data?.v === 1 && data.iv && data.ct) {
      const key = await this.payloadKey();
      const plaintext = await globalThis.crypto.subtle.decrypt(
        { name: "AES-GCM", iv: fromBase64Url(data.iv) },
        key,
        fromBase64Url(data.ct),
      );
      return JSON.parse(decoder.decode(plaintext));
    }
    return data;
  }

  /**
   * Every response is wrapped `{ok, data}`; errors carry `{ok:false,
   * error:{code,message}}`.
   */
  async unwrap(response) {
    const data = await this.unwrapEnvelope(response);
    if (data?.ok === false) {
      throw new Error(data.error?.message || "Request failed");
    }

    const payload = data?.data ?? data;
    this.syncServerTime(payload);
    return payload;
  }

  /**
   * Track the drop's clock.
   *
   * `x-timestamp` is inside the signature, and the drop rejects one that has
   * drifted too far from its own clock. Every payload that carries a
   * `serverTime` re-bases the offset, exactly as the web app does.
   */
  syncServerTime(payload) {
    const serverTime = payload?.serverTime ?? payload?.profile?.serverTime;
    if (typeof serverTime !== "number") return;
    this.clockOffsetMs = serverTime * 1000 - Date.now();
  }

  /** The drop's clock in seconds, skew included */
  serverNow() {
    return Math.floor((Date.now() + (this.clockOffsetMs || 0)) / 1000);
  }

  /* --------------------------------------------------------------------- */
  /* Auth                                                                   */
  /* --------------------------------------------------------------------- */

  /** The account's device id, minted once and remembered */
  async getOrCreateDeviceId() {
    if (this.deviceId) return this.deviceId;
    this.deviceId = `dev_${this.makeNonce().replace(/-/g, "")}`;
    return this.deviceId;
  }

  /** Get Auth */
  async fetchAuth() {
    return this.login();
  }

  /**
   * Get Auth Headers.
   *
   * The auth payload carries the bearer token either at the top level or on
   * the nested `session`, so both are checked — a miss here is silent, since
   * the farmer still starts and only the API calls after it fail with 401.
   */
  getAuthHeaders(data) {
    const token =
      data?.token ??
      data?.accessToken ??
      data?.session?.token ??
      data?.session?.accessToken;

    return token ? { Authorization: `Bearer ${token}` } : {};
  }

  /**
   * Exchange initData for a session.
   *
   * `configureAuthHeaders` is called inside so its return value (the axios
   * defaults) gets the bearer token even though login happens again per run.
   */
  async login() {
    try {
      const deviceId = await this.getOrCreateDeviceId();

      const session = await this.post("/auth/telegram", {
        initData: this.getInitData(),
        deviceId,
        startParam: this.getStartParam() ?? null,
      });

      this.debugger.log("Session:", session);

      this.session = session?.session;
      this.user = session?.user;
      this._authHeaders = this.getAuthHeaders(session);
      this.configureAuthHeaders(session);

      if (this.isSessionExpired()) {
        throw new Error("Session expired - please re-authorize the drop.");
      }

      return session;
    } catch (error) {
      this.debugger.error(
        "MiningBuddies login failed:",
        error?.message ?? error,
      );
      throw error;
    }
  }

  /**
   * Normalise the session expiry to epoch milliseconds.
   *
   * `expiresAt` can arrive as epoch milliseconds, epoch seconds, or an ISO
   * string. Comparing `Date.now()` (always milliseconds) against a seconds
   * value is true for every timestamp this century, which would reject every
   * freshly minted session, so the unit has to be settled before comparing.
   */
  parseExpiry(value) {
    if (value === null || value === undefined) return null;

    if (typeof value === "number" || /^\d+$/.test(String(value).trim())) {
      const numeric = Number(value);
      if (!Number.isFinite(numeric) || numeric <= 0) return null;

      /* Seconds-vs-milliseconds: any real expiry in ms is well past 1e12. */
      return numeric < 1e12 ? numeric * 1000 : numeric;
    }

    const parsed = Date.parse(value);
    return Number.isNaN(parsed) ? null : parsed;
  }

  /** Whether the current session has lapsed. Unknown expiry counts as live. */
  isSessionExpired() {
    const expiresAt = this.parseExpiry(this.session?.expiresAt);
    return expiresAt !== null && Date.now() > expiresAt;
  }

  /** Get User Details */
  getUserDetails() {
    return this.user;
  }

  /** Get Referral Link */
  async getReferralLink() {
    const payload = await this.get("/referrals").catch(() => null);
    return payload?.link || this.telegramLink;
  }

  /* --------------------------------------------------------------------- */
  /* API wrappers                                                          */
  /* --------------------------------------------------------------------- */

  /** Account state: balance, miners, streak, ads */
  getProfile() {
    return this.get("/profile");
  }

  /** The configured miners and their per-account boons */
  getMiners() {
    return this.get("/miners");
  }

  /** Start a miner */
  startMining(miner) {
    return this.post("/miners/start", { miner });
  }

  /** Claim accrued mining */
  claimMining() {
    return this.post("/miners/claim");
  }

  /** Open an ad session for a miner */
  openMinerAd(miner, fallback = null) {
    return this.post(
      "/miners/ad/session",
      fallback ? { miner, fallback } : { miner },
    );
  }

  /** Complete a miner ad session */
  completeMinerAd(sessionId, miner, verdict = {}) {
    return this.post("/miners/ad/complete", {
      sessionId,
      miner,
      ...verdict,
    });
  }

  /** The categorized task list */
  getTasks(category) {
    return this.get("/tasks", category ? { category } : {});
  }

  /** Claim a task */
  claimTask(taskId) {
    return this.post(`/tasks/${encodeURIComponent(taskId)}/claim`);
  }

  /** Re-check a task whose requirement lives off the drop (e.g. a join) */
  verifyTaskJoin(taskId) {
    return this.get(`/tasks/${encodeURIComponent(taskId)}/verify`);
  }

  /** Claim the all-tasks ad milestone reward */
  claimAdMilestone() {
    return this.post("/tasks/ad-milestone/claim");
  }

  /** Open an ad session for one task slot */
  openTaskAd(taskId, slotIndex, fallback = null) {
    return this.post(
      `/tasks/${encodeURIComponent(taskId)}/ad/session`,
      fallback ? { slotIndex, fallback } : { slotIndex },
    );
  }

  /** Complete a task ad session */
  completeTaskAd(taskId, slotIndex, sessionId, verdict = {}) {
    return this.post(`/tasks/${encodeURIComponent(taskId)}/ad/complete`, {
      sessionId,
      slotIndex,
      ...verdict,
    });
  }

  /** Daily check-in state */
  getStreak() {
    return this.get("/streak");
  }

  /** Claim today's check-in */
  claimStreak() {
    return this.post("/streak/claim");
  }

  /** How many ad slots are ready now */
  getAdSlotStatus() {
    return this.get("/ads/status");
  }

  /** Open a rewarded-ad slot session */
  openAdSlot(purpose, ref = null) {
    return this.post(
      "/ads/session",
      ref ? { purpose, ref } : { purpose },
    );
  }

  /** Complete a rewarded-ad slot session */
  completeAdSlot(sessionId, purpose, ref, verdict = {}) {
    return this.post("/ads/complete", {
      sessionId,
      purpose,
      ref,
      ...verdict,
    });
  }

  /** Referral roster and rules */
  getReferrals() {
    return this.get("/referrals");
  }

  /** The mandatory community roster and whether the account is in each */
  getCommunityStatus() {
    return this.get("/community/status");
  }

  /** Claim a referral milestone */
  claimReferralMilestone(friends) {
    return this.post("/referrals/milestone/claim", { friends });
  }

  /* --------------------------------------------------------------------- */
  /* Ad playback                                                           */
  /*                                                                       */
  /* The ad the drop owes its reward for has to actually exist in the eyes  */
  /* of the network: AdsGram must hear its impression and Monetag its       */
  /* session. The click-required networks are the whole point of the "tap   */
  /* the ad" rule, so the click trackers are what make those count.         */
  /* --------------------------------------------------------------------- */

  /**
   * Run one ad through its provider's real client.
   *
   * @returns {Promise<{provider:string, clicked:boolean, durationMs:number}>}
   */
  async playAd(provider) {
    const client = PROVIDER_CLIENTS[provider.provider];
    const ids = provider.ids || {};

    if (client === "adsgram") {
      const blockId = ids.blockId ?? provider.blockId;
      if (!blockId) throw new Error(`No blockId for AdsGram ad.`);
      const started = Date.now();
      await this.adsgram.watch(blockId);
      return { provider, clicked: true, durationMs: Date.now() - started };
    }

    if (client === "monetag") {
      const zoneId = ids.zoneId;
      if (!zoneId) throw new Error(`No zone id for Monetag ad.`);
      const started = Date.now();
      await this.monetag.watch(zoneId);
      return { provider, clicked: true, durationMs: Date.now() - started };
    }

    /**
     * No network client exists for the smaller providers, so the watch is
     * simulated over the session's minimum — the drop only sees the elapsed
     * time and the click flag.
     */
    const seconds =
      (Number(provider.minWatchSec) || 3) + AD_WATCH_MARGIN_SECONDS;

    const started = Date.now();
    await this.utils.delayForSeconds(seconds, { signal: this.signal });
    return { provider, clicked: true, durationMs: Date.now() - started };
  }

  /**
   * Build the provider list from an ad session: the primary, then the
   * fallbacks the drop configured.
   *
   * `providerId` is an object of network ids (`{blockId}`, `{zoneId}`,
   * `{spotId}`, …), not a scalar, so it is carried through as `ids` and the
   * individual id is picked out per network in `playAd`.
   */
  buildProviders(session) {
    const base = {
      sessionId: session.sessionId,
      fallbackTimeoutMs: session.fallbackTimeoutMs,
    };

    const providers = [
      {
        ...base,
        provider: session.provider,
        blockId: session.blockId,
        ids: session.providerId || null,
        minWatchSec: session.minWatchSec,
        clickRequired: session.clickRequired,
      },
    ];

    const fallbacks =
      Array.isArray(session.fallbacks) && session.fallbacks.length
        ? session.fallbacks
        : session.fallback
          ? [
              {
                provider: session.fallback,
                providerId: session.fallbackId,
                minWatchSec: session.fallbackMinWatchSec,
                clickRequired: session.fallbackClickRequired,
              },
            ]
          : [];

    for (const item of fallbacks) {
      if (!item?.provider) continue;

      const ids = item.providerId || item.ids || null;

      providers.push({
        ...base,
        provider: item.provider,
        ids,
        blockId: (ids || {}).blockId ?? null,
        minWatchSec: item.minWatchSec ?? session.minWatchSec,
        clickRequired:
          typeof item.clickRequired === "boolean"
            ? item.clickRequired
            : false,
      });
    }

    return providers;
  }

  /**
   * Play the best provider, honouring `minWatchSec` for the networks that
   * enforce it and the click rule for those that need it.
   */
  async showAd(session) {
    const providers = this.buildProviders(session);
    let lastError = null;

    for (const provider of providers) {
      if (this.signal.aborted) return { ok: false, reason: "skipped" };

      try {
        const watched = await this.playAd(provider);

        /**
         * AdsGram and Monetag settle server-side: under-watching a session is
         * the one way to be rejected for being too fast. The drop's own check
         * is `durationMs < minWatchSec * 1000`, so the same bar is used here
         * — `AD_WATCH_MARGIN_SECONDS` is padding on the simulated watch, not
         * a multiplier on the threshold.
         */
        const minWatchSec = Number(
          provider.minWatchSec ?? session.minWatchSec ?? 3,
        );

        if (
          MIN_WATCH_PROVIDERS.includes(provider.provider) &&
          (watched.durationMs || 0) < minWatchSec * 1000
        ) {
          lastError = new Error("Ad was watched too fast.");
          continue;
        }

        if (provider.clickRequired && !watched.clicked) {
          lastError = new Error("The ad needs a tap to credit.");
          continue;
        }

        return {
          ok: true,
          provider: provider.provider,
          clicked: Boolean(watched.clicked),
        };
      } catch (error) {
        this.debugger.log(
          `Fallback ${provider.provider} failed:`,
          error.message,
        );
        lastError = error;
      }
    }

    throw lastError || new Error("No ad provider could be played.");
  }

  /**
   * Full rewarded-ad slot watch.
   *
   * The `purpose`/`ref` pair is returned to the server verbatim; the
   * withdraw flow, for example, sends `("withdraw", "withdraw")`.
   */
  async watchAdSlot(purpose = SLOT_PURPOSE, ref = null, slotIndex = null) {
    const session = await this.openAdSlot(purpose, ref);
    this.debugger.log("Ad slot session:", session);

    const verdict = await this.showAd(session);
    if (!verdict?.ok) throw new Error(verdict?.reason || "Ad was not watched.");

    const complete = {
      provider: verdict.provider,
      clicked: verdict.clicked,
    };
    if (Number.isInteger(slotIndex)) complete.slotIndex = slotIndex;

    const result = await this.completeAdSlot(
      session.sessionId,
      purpose,
      ref ?? purpose,
      complete,
    );

    this.debugger.log("Ad slot result:", result);
    return result;
  }

  /** One miner's ad watch */
  async watchMinerAd(miner) {
    const session = await this.openMinerAd(miner);
    this.debugger.log("Miner ad session:", session);

    const verdict = await this.showAd(session);
    if (!verdict?.ok) throw new Error(verdict?.reason || "Ad was not watched.");

    const result = await this.completeMinerAd(
      session.sessionId,
      miner,
      { provider: verdict.provider, clicked: verdict.clicked },
    );

    this.debugger.log("Miner ad result:", result);
    return result;
  }

  /** One task slot's ad watch */
  async watchTaskAd(taskId, slotIndex) {
    const session = await this.openTaskAd(taskId, slotIndex);

    let verdict;
    try {
      verdict = await this.showAd(session);
      if (!verdict?.ok) {
        throw new Error(verdict?.reason || "Ad was not watched.");
      }
    } catch (error) {
      this.logger.warn(
        `Task ad not credited (${taskId} slot ${slotIndex}):`,
        error.message,
      );
      return null;
    }

    const result = await this.completeTaskAd(
      taskId,
      slotIndex,
      session.sessionId,
      { provider: verdict.provider, clicked: verdict.clicked },
    );

    this.debugger.log("Task ad result:", result);
    return result;
  }

  /* --------------------------------------------------------------------- */
  /* Community gate                                                        */
  /*                                                                       */
  /* Mining Buddies is gated behind membership of a handful of Telegram     */
  /* channels. Until every one of them reports `joined`, the web app shows  */
  /* nothing but the join sheet — the mine, the tasks and the chest are all */
  /* behind it. Membership is checked against Telegram itself, so joining   */
  /* for real is the only way through.                                     */
  /* --------------------------------------------------------------------- */

  /**
   * Join every mandatory community that has not been joined yet.
   *
   * `/community/status` answers `{enabled, allJoined, communities:[{chat,
   * username, link, joined, checked}]}`. The status is re-read after the
   * joins so the drop's own view is what gets reported, rather than an
   * assumption that each join landed.
   *
   * @returns {Promise<boolean>} whether the gate is open
   */
  async joinCommunities() {
    const status = await this.getCommunityStatus().catch(() => null);
    this.debugger.log("Community status:", status);

    if (!status) {
      this.logger.warn("Could not read the community gate — continuing.");
      return true;
    }

    if (status.enabled === false || status.allJoined) {
      this.logger.info("Community gate is already satisfied.");
      return true;
    }

    const communities = Array.isArray(status.communities)
      ? status.communities
      : [];
    const pending = communities.filter((community) => !community.joined);

    if (!pending.length) return true;

    /* Without a Telegram client there is nothing that can be joined */
    if (!this.canJoinTelegramLink()) {
      this.logger.warn(
        `${pending.length} mandatory ${
          pending.length === 1 ? "community" : "communities"
        } to join, but no Telegram client is connected — join ${pending
          .map((c) => `@${c.username || c.chat}`)
          .join(", ")} by hand.`,
      );
      return false;
    }

    this.logger.info(
      `Joining ${pending.length} mandatory ${
        pending.length === 1 ? "community" : "communities"
      }...`,
    );

    for (const community of pending) {
      const link = community.link || `https://t.me/${community.username}`;
      const label = community.username || community.chat || link;

      const joined = await this.tryToJoinTelegramLink(link);
      if (joined) this.logger.success(`Joined @${label}.`);
      else this.logger.warn(`Could not join @${label}.`);

      await this.utils.delayForSeconds(COMMUNITY_JOIN_GAP_SECONDS, {
        signal: this.signal,
      });
    }

    /* Telegram is asked again, so the answer is the drop's and not ours */
    const after = await this.getCommunityStatus().catch(() => null);
    this.debugger.log("Community status after joining:", after);

    if (after?.allJoined) {
      this.logger.success("Community gate open.");
      return true;
    }

    const left = (after?.communities ?? []).filter((c) => !c.joined);
    this.logger.warn(
      `Still ${left.length} to join: ${
        left.map((c) => `@${c.username || c.chat}`).join(", ") || "unknown"
      }. The drop will keep the mine locked until then.`,
    );
    return false;
  }

  /* --------------------------------------------------------------------- */
  /* Daily check-in                                                        */
  /* --------------------------------------------------------------------- */

  /**
   * Claim the daily streak chest.
   *
   * The chest carries its own gates, and the drop enforces every one of them:
   *
   *   claimedToday   today's chest is already open
   *   claimable      the chest is open for business at all
   *   nextClaimInSec seconds until it is, when it is not
   *   requiresAd     a rewarded ad has to be watched before the claim
   *   adReady        that ad has already been watched
   *
   * Posting `/streak/claim` before the gate ad answers 409, so the ad runs
   * first, booked under the same `("streak", "streak")` purpose/ref pair the
   * web app's chest card uses.
   */
  async completeDailyCheckIn() {
    let streak = await this.getStreak();
    this.debugger.log("Streak:", streak);

    if (streak?.claimedToday) {
      this.logger.info("Check-in already claimed today.");
      return true;
    }

    if (streak?.claimable === false) {
      const left = Number(streak?.nextClaimInSec) || 0;
      this.logger.info(
        left > 0
          ? `Check-in opens in ${Math.ceil(left / 60)}m.`
          : "Check-in is not open right now.",
      );
      return false;
    }

    if (streak?.requiresAd && !streak?.adReady) {
      this.logger.info("Watching the check-in ad...");
      try {
        await this.watchAdSlot(SLOT_PURPOSE_STREAK, SLOT_PURPOSE_STREAK);
      } catch (error) {
        this.logger.warn(`Check-in ad failed: ${error.message}`);
        return false;
      }

      streak = await this.getStreak().catch(() => streak);
      this.debugger.log("Streak after ad:", streak);

      if (streak?.claimedToday) {
        this.logger.success("Daily check-in claimed.");
        return true;
      }
    }

    let result;
    try {
      result = await this.claimStreak();
    } catch (error) {
      /* The drop answers 409 once the chest is spent, which is not a failure */
      if (error?.response?.status === 409) {
        this.logger.info("Check-in already claimed today.");
        return true;
      }
      throw error;
    }

    this.debugger.log("Check-in result:", result);

    const reward = Number(result?.reward) || 0;
    const day = result?.streak?.day ?? streak?.day;
    this.logger.success(
      `Daily check-in claimed${reward ? ` (+${reward} coins)` : ""}${
        day ? ` — day ${day}` : ""
      }.`,
    );
    return true;
  }

  /* --------------------------------------------------------------------- */
  /* Mining                                                                 */
  /*                                                                       */
  /* A miner publishes its own gates and the drop enforces every one of     */
  /* them server-side:                                                      */
  /*                                                                       */
  /*   unlocked           the account's VIP tier reaches `minVip`           */
  /*   working            a shift is already running, until `endsAt`        */
  /*   todayWorked        shifts done today, capped at `dailyLimit`         */
  /*   watchAds           gate ads watched, of `adsRequired`                */
  /*   canWatchAd         another gate ad may be watched right now          */
  /*   canStart           every gate above is satisfied                     */
  /*                                                                       */
  /* Posting `/miners/start` while `canStart` is false is a 403, so the     */
  /* flags are read rather than guessed.                                    */
  /* --------------------------------------------------------------------- */

  /** Pull one miner's current row out of a `/miners` payload */
  findMiner(payload, key) {
    const list = Array.isArray(payload) ? payload : payload?.miners || [];
    return list.find((item) => (item.key ?? item.id ?? item.name) === key);
  }

  /** Why a miner cannot be started, or null when it can */
  minerBlockedReason(miner) {
    if (miner.comingSoon) return "not released yet";
    if (miner.unlocked === false) return `locked (needs VIP ${miner.minVip})`;
    if (miner.working) {
      const left = Number(miner.remainingSec) || 0;
      return `already working (${Math.ceil(left / 60)}m left)`;
    }
    if (
      Number.isFinite(Number(miner.dailyLimit)) &&
      Number(miner.todayWorked) >= Number(miner.dailyLimit)
    ) {
      return `done for today (${miner.todayWorked}/${miner.dailyLimit} shifts)`;
    }
    return null;
  }

  /** Start or re-arm every miner, watching their gate ads first */
  async manageMiners() {
    const payload = await this.getMiners();
    this.debugger.log("Miners:", payload);

    const list = Array.isArray(payload) ? payload : payload?.miners || [];
    if (!list.length) {
      this.logger.info("No miners configured.");
      return;
    }

    for (const miner of list) {
      if (this.signal.aborted) break;

      let entry = miner;
      const key = entry.key ?? entry.id ?? entry.name;

      const blocked = this.minerBlockedReason(entry);
      if (blocked) {
        this.logger.info(`Skipping ${key}: ${blocked}.`);
        continue;
      }

      /**
       * The gate: `adsRequired` ads have to be credited before the drop will
       * let a shift start. `watchAds` is the running count, and `canWatchAd`
       * is the drop's own answer to whether another one is allowed now.
       */
      const required = Number(entry.adsRequired) || 0;
      let watched = Number(entry.watchAds) || 0;

      while (watched < required && entry.canWatchAd !== false) {
        if (this.signal.aborted) break;

        try {
          const result = await this.watchMinerAd(key);
          watched = Number(result?.watchAds ?? watched + 1);
          this.logger.success(
            `Gate ad ${watched}/${result?.required ?? required} watched for ${key}.`,
          );
        } catch (error) {
          this.logger.warn(`Miner gate ad failed (${key}):`, error.message);
          break;
        }

        if (watched < required) {
          await this.utils.delayForSeconds(AD_COOLDOWN_SECONDS, {
            signal: this.signal,
          });
        }
      }

      /* Re-read the miner so the gate flags reflect the ads just watched */
      entry =
        this.findMiner(await this.getMiners().catch(() => null), key) || entry;

      const stillBlocked = this.minerBlockedReason(entry);
      if (stillBlocked) {
        this.logger.info(`Skipping ${key}: ${stillBlocked}.`);
        continue;
      }

      if (!entry.canStart) {
        const short = Math.max(
          0,
          (Number(entry.adsRequired) || 0) - (Number(entry.watchAds) || 0),
        );
        this.logger.info(
          short
            ? `Skipping ${key}: ${short} more gate ad(s) needed.`
            : `Skipping ${key}: the drop is not accepting a start yet.`,
        );
        continue;
      }

      try {
        const result = await this.startMining(key);
        this.logger.success(`Started miner: ${result?.miner ?? key}`);
      } catch (error) {
        this.logger.warn(`Failed to start ${key}:`, error.message);
      }

      await this.utils.delayForSeconds(3, { signal: this.signal });
    }
  }

  /** Claim whatever mining has accrued */
  async claimMiningRewards() {
    const result = await this.claimMining().catch((error) => {
      this.logger.info("No mining to claim:", error.message.split("\n")[0]);
      return null;
    });

    if (!result) return;

    this.logger.success(
      `Mining claimed (+${result.amount ?? result.reward ?? ""} coins).`,
    );
  }

  /* --------------------------------------------------------------------- */
  /* Tasks                                                                  */
  /*                                                                       */
  /* `/tasks` answers with the whole list in one call, each task carrying   */
  /* its own `status` and a `verification.mode` that says what the drop     */
  /* checks before it credits:                                             */
  /*                                                                       */
  /*   link              open the link, then claim                         */
  /*   telegram_member   join the channel/group, then claim                */
  /*   ad_slots          watch `requiredSlots` ads, each on its own 24h     */
  /*                     cooldown, then claim                              */
  /* --------------------------------------------------------------------- */

  /** Complete every task this account can still earn from */
  async completeTasks() {
    const payload = await this.getTasks();
    this.debugger.log("Tasks:", payload);

    const list = Array.isArray(payload) ? payload : payload?.tasks || [];
    const pending = list.filter(
      (task) =>
        task.enabled !== false && !TASK_DONE_STATUSES.includes(task.status),
    );

    if (!pending.length) {
      this.logger.info(`No tasks to complete (${list.length} already done).`);
      return;
    }

    this.logger.info(`${pending.length} of ${list.length} task(s) pending.`);

    for (const task of pending) {
      if (this.signal.aborted) break;
      await this.completeTask(task);
    }
  }

  /** Meet one task's requirement, then claim it */
  async completeTask(task) {
    const id = task.id ?? task.key;
    const label = task.title || `task ${id}`;
    const mode = task.verification?.mode;

    /* An ad-slot task is only claimable once every slot has been watched */
    if (mode === TASK_MODE_AD_SLOTS) {
      await this.completeTaskAdSlots(task);
      return;
    }

    const link = task.verification?.url || task.link || task.url;

    /* A join task credits only after the account is actually a member */
    if (mode === TASK_MODE_MEMBER || task.verification?.requireJoin) {
      if (link) {
        const joined = await this.tryToJoinTelegramLink(link);
        if (!joined && this.utils.isTelegramChatLink(link)) {
          this.logger.info(`Skipping ${label}: could not join ${link}.`);
          return;
        }
      }

      const check = await this.verifyTaskJoin(id).catch(() => null);
      if (check?.ok === false || check?.joined === false) {
        this.logger.info(`Task not ready yet: ${label}`);
        return;
      }
    } else if (mode === TASK_MODE_LINK && link) {
      await this.tryToJoinTelegramLink(link);
    }

    /* The drop wants the link open for `delaySec` before it will credit */
    await this.utils.delayForSeconds(
      Number(task.verification?.delaySec) || TASK_CLAIM_DELAY_SECONDS,
      { signal: this.signal },
    );

    await this.claimOneTask(id, label);

    await this.utils.delayForSeconds(TASK_GAP_SECONDS, {
      signal: this.signal,
    });
  }

  /** POST a task's claim and report what came back */
  async claimOneTask(id, label) {
    try {
      const result = await this.claimTask(id);
      this.logger.success(
        `Completed task: ${label} (+${result?.reward?.amount ?? result?.reward ?? ""} coins)`,
      );
      return true;
    } catch (error) {
      this.logger.warn(`Task "${label}" failed:`, error.message);
      return false;
    }
  }

  /**
   * Fill an ad-slot task.
   *
   * Each slot is independent and resets 24h after it was watched, so only the
   * slots whose `cooldownLeft` has run out are playable in this run.
   */
  async completeTaskAdSlots(task) {
    const id = task.id ?? task.key;
    const label = task.title || `task ${id}`;

    const required = Number(task.requiredSlots ?? task.goal) || 0;
    const slots = Array.isArray(task.slots) ? task.slots : [];

    const open = slots.filter(
      (slot) => !slot.watchedAt || Number(slot.cooldownLeft) <= 0,
    );

    if (!open.length) {
      this.logger.info(
        `${label}: all ${required} slot(s) on cooldown — nothing to watch.`,
      );
      return;
    }

    let watched = 0;

    for (const slot of open) {
      if (this.signal.aborted) break;

      if (watched > 0) {
        await this.utils.delayForSeconds(AD_COOLDOWN_SECONDS, {
          signal: this.signal,
        });
      }

      const result = await this.watchTaskAd(id, slot.index);
      if (!result) break;

      watched++;
      this.logger.success(
        `${label}: slot ${slot.index + 1}/${required} watched.`,
      );
    }

    if (!watched) return;

    /* The claim only lands once every slot is filled */
    const progress = Number(task.progress) || 0;
    if (progress + watched < required) {
      this.logger.info(
        `${label}: ${progress + watched}/${required} slots watched — claim once the rest come off cooldown.`,
      );
      return;
    }

    await this.utils.delayForSeconds(TASK_CLAIM_DELAY_SECONDS, {
      signal: this.signal,
    });
    await this.claimOneTask(id, label);
  }

  /** Claim the ad milestone once every ad category slot is done */
  async completeTasksAdMilestone() {
    const result = await this.claimAdMilestone().catch((error) => {
      this.logger.debug("Ad milestone not claimable:", error.message);
      return null;
    });

    if (result?.ok) {
      this.logger.success(`Ad milestone claimed (+${result.reward ?? ""}).`);
    }
  }

  /* --------------------------------------------------------------------- */
  /* Ad slots                                                              */
  /*                                                                       */
  /* Ten rewarded ads a day, each one a slot that resets 24h after it was   */
  /* watched. A slot needs an actual ad and a click behind it, or the drop  */
  /* rejects the completion.                                               */
  /* --------------------------------------------------------------------- */

  /** Watch up to a run's worth of daily ad slots */
  async watchAdSlots() {
    let status;
    try {
      status = await this.getAdSlotStatus();
    } catch (error) {
      this.logger.warn("Could not read ad slot status:", error.message);
      return;
    }
    this.debugger.log("Ad slot status:", status);

    /**
     * `slots` is the per-index roster (the same shape the ad tasks carry), so
     * the count of playable slots is the ones off cooldown — reading the
     * array itself as a number would coerce to NaN and silently fall back to
     * the full daily allowance.
     */
    const roster = Array.isArray(status?.slots) ? status.slots : null;
    const available = roster
      ? roster.filter((slot) => !slot.watchedAt || Number(slot.cooldownLeft) <= 0)
          .length
      : Number(status?.available ?? status?.remaining ?? 0);

    if (!Number.isFinite(available) || available <= 0) {
      this.logger.info("No ad slots available right now.");
      return;
    }

    const cap = Math.min(SLOTS_PER_RUN, available);
    let watched = 0;

    for (let index = 0; index < cap; index++) {
      if (this.signal.aborted) break;

      if (index > 0) {
        await this.utils.delayForSeconds(AD_COOLDOWN_SECONDS, {
          signal: this.signal,
        });
      }

      try {
        const result = await this.watchAdSlot(SLOT_PURPOSE, null, index);
        watched++;
        this.logger.success(
          `Ad slot ${index + 1}/${cap} watched (+${result?.reward?.amount ?? result?.reward ?? ""} coins).`,
        );
      } catch (error) {
        this.logger.warn(`Ad slot ${index + 1} failed:`, error.message);
        break;
      }
    }

    this.logger.success(`Watched ${watched} ad slot(s).`);
  }

  /* --------------------------------------------------------------------- */
  /* Referrals                                                            */
  /* --------------------------------------------------------------------- */

  /** Report the referral roster and claim any milestone it earned */
  async manageReferrals() {
    const payload = await this.getReferrals();
    this.debugger.log("Referrals:", payload);

    const total = payload?.total ?? payload?.count ?? 0;
    this.logger.keyValue("Referrals", total, {
      valueStyle: this.logger.c.greenBright,
    });

    for (const milestone of payload?.milestones ?? []) {
      if (milestone.claimed) continue;
      if (total < milestone.required) continue;

      try {
        const result = await this.claimReferralMilestone(milestone.friends ?? total);
        this.logger.success(
          `Referral milestone (+${result?.reward ?? milestone.reward ?? ""}).`,
        );
      } catch (error) {
        this.logger.warn("Referral milestone not claimed:", error.message);
      }
    }
  }

  /* --------------------------------------------------------------------- */
  /* Process                                                               */
  /* --------------------------------------------------------------------- */

  async process() {
    await this.login();

    await this.logUserInfo();
    await this.executeTask("Profile", () => this.refreshProfile());

    /* Everything below is locked until the mandatory channels are joined */
    await this.executeTask("Communities", () => this.joinCommunities());

    await this.executeTask("Daily Check-In", () => this.completeDailyCheckIn());
    await this.executeTask("Mining", () => this.manageMiners());
    await this.executeTask("Mining Claim", () => this.claimMiningRewards());
    await this.executeTask("Ad Slots", () => this.watchAdSlots());
    await this.executeTask("Tasks", () => this.completeTasks());
    await this.executeTask("Ad Milestone", () => this.completeTasksAdMilestone());
    await this.executeTask("Referrals", () => this.manageReferrals());
  }

  /** Load the profile for the account summary */
  async refreshProfile() {
    const payload = await this.getProfile();
    this.profile = payload;
    this.meta = payload;
    this.user = payload?.user ?? payload?.profile ?? this.user;
    return payload;
  }

  /** Log the current account state */
  async logUserInfo() {
    const user = this.user || {};

    this.logger.newline();
    this.logCurrentUser();

    this.logger.keyValue(
      "Balance",
      `${this.formatAmount(user.balance ?? user.coins)} coins`,
      { valueStyle: this.logger.c.greenBright },
    );
    this.logger.keyValue(
      "Total Earned",
      this.formatAmount(user.totalEarned ?? user.lifetimeEarnings),
    );
  }

  /** Balances arrive as floats, and read badly unrounded */
  formatAmount(value) {
    const amount = Number(value);
    return Number.isFinite(amount) ? amount.toFixed(2) : "0.00";
  }
}