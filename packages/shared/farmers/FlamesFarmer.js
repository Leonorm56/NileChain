import AdsGramClient from "../lib/AdsGramClient.js";
import BaseFarmer from "../lib/BaseFarmer.js";

/**
 * Flames Earn
 *
 * Gaming/rewards hub served from flamesearn.site. Auth is the Telegram
 * init data in the `x-init-data` header on every call, plus a per-request
 * WASM proof (`x-claim` + `x-app-platform`) on all mutating calls.
 * The proof is `lottie.wasm`: preimage
 * `{userId}|{action}|{refId}|{floor(now/100)}|{initDataHash[:16]}`.
 *
 * Onboarding requires membership in the group + channel; verification is
 * server-side via GET /api/mandatory-task (no submit endpoint).
 * Ads are Adsgram-gated: generate-token -> show+CLICK ad -> mark-clicked
 * with {adsOffered, adsShown, adsClicked}. The server rejects unclicked
 * views ("Please click the ad to earn"), so headless runs report a click
 * and log whatever the server decides.
 *
 * Actions (from live bundle): task_complete, ads_generate, ads_click,
 * earnmore_token, earnmore_claim, wheel_spin, monetag_claim, tower_claim.
 */

const API_URL = "https://flamesearn.site/api";
const WASM_URL = "https://flamesearn.site/lottie.wasm";

/** Onboarding channels that must be joined before verification passes. */
const REQUIRED_CHANNELS = [
  "https://t.me/FlamesEarnOfficialGroup",
  "https://t.me/FlamesEarnOfficialChannel",
];

/** Stats mirror of a real watched+clicked Adsgram view (see HAR). */
const AD_STATS = { adsOffered: 3, adsShown: 3, adsClicked: 1 };

let wasmExports = null;
let wasmLoading = null;

async function loadWasm() {
  if (wasmExports) return wasmExports;
  if (!wasmLoading) {
    wasmLoading = (async () => {
      const res = await globalThis.fetch(WASM_URL, { cache: "no-store" });
      const buf = await res.arrayBuffer();
      const { instance } = await WebAssembly.instantiate(buf, {
        env: { abort() {}, seed: () => Date.now() },
      });
      wasmExports = instance.exports;
      return wasmExports;
    })().catch((e) => {
      wasmLoading = null;
      throw e;
    });
  }
  return wasmLoading;
}

export default class FlamesFarmer extends BaseFarmer {
  static id = "flames";
  static title = "Flames Earn";
  static emoji = "🔥";
  static host = "flamesearn.site";
  static domains = ["flamesearn.site", "t.me", "api.adsgram.ai"];
  static telegramLink = "https://t.me/FlamesEarnBot";
  static path = "/";
  static referrerMode = "random";
  static singleton = true;
  static rating = 5;
  static cacheAuth = false;
  static apiDelay = 400;
  static interval = "*/10 * * * *";

  /** Auth is the raw init data in `x-init-data`. */
  fetchAuth() {
    return this.getInitData();
  }

  getAuthHeaders(data) {
    return data ? { "x-init-data": data } : {};
  }

  /* --------------------------------------------------------------------- */
  /* Claim proof (lottie.wasm)                                             */
  /* --------------------------------------------------------------------- */

  /** Per-request proof headers for mutating calls. */
  async claimHeaders(action, refId) {
    try {
      const initData = this.getInitData() || "";
      const userId = String(this.getTelegramUser()?.id || "");
      const hash = (new URLSearchParams(initData).get("hash") || "").slice(0, 16);
      if (!userId || !hash) return {};
      const ex = await loadWasm();
      const tick = Math.floor(Date.now() / 100);
      const preimage = `${userId}|${action}|${refId}|${tick}|${hash}`;
      const bytes = new TextEncoder().encode(preimage);
      new Uint8Array(ex.memory.buffer).set(bytes, ex.inputPtr());
      ex.compute(bytes.length);
      const out = new Uint8Array(ex.memory.buffer);
      const ptr = ex.outputPtr();
      let hex = "";
      for (let i = 0; i < 32; i++) hex += out[ptr + i].toString(16).padStart(2, "0");
      return { "x-claim": hex, "x-app-platform": `"${Date.now().toString(36)}"` };
    } catch {
      return {};
    }
  }

  /* --------------------------------------------------------------------- */
  /* Transport                                                             */
  /* --------------------------------------------------------------------- */

  get(path, headers = {}) {
    return this.api
      .get(`${API_URL}${path}`, {
        headers: { ...this.getAuthHeaders(this.getInitData()), ...headers },
        signal: this.signal,
      })
      .then((res) => res.data);
  }

  post(path, payload = {}, headers = {}) {
    return this.api
      .post(`${API_URL}${path}`, payload, {
        headers: {
          "Content-Type": "application/json",
          ...this.getAuthHeaders(this.getInitData()),
          ...headers,
        },
        signal: this.signal,
      })
      .then((res) => res.data);
  }

  readError(error) {
    return (
      error?.response?.data?.error ||
      error?.response?.data?.message ||
      error?.message ||
      "Unknown error"
    );
  }

  /* --------------------------------------------------------------------- */
  /* Login                                                                 */
  /* --------------------------------------------------------------------- */

  /** Register/login. `ref` comes from the start param when present. */
  async login() {
    const ref = this.getStartParam() || this.getInitDataUnsafe()?.start_param;
    const result = await this.post("/auth/init", ref ? { ref: String(ref) } : {});
    if (!result?.ok) throw new Error("Login failed: " + (result?.error || "no ok"));
    this.user_data = result.user;
    return this.user_data;
  }

  async getSync() {
    return this.get("/sync").catch(() => null);
  }

  async getTaskList() {
    const res = await this.get("/tasks/list").catch((e) => {
      this.logger.warn("Tasks list failed:", this.readError(e));
      return null;
    });
    return res?.tasks || [];
  }

  /* --------------------------------------------------------------------- */
  /* Logging                                                               */
  /* --------------------------------------------------------------------- */

  async logUserInfo() {
    const sync = await this.getSync();
    const user = sync?.user || this.user_data || {};
    this.logger.newline();
    this.logCurrentUser();
    this.logger.keyValue("Flames", user?.flames ?? user?.balance ?? "-");
    this.logger.keyValue("Role", user?.role ?? "-");
    this.logger.newline();
  }

  /* --------------------------------------------------------------------- */
  /* Mandatory onboarding                                                  */
  /* --------------------------------------------------------------------- */

  /** Join group+channel if possible, then recheck server-side verification. */
  async ensureMandatory() {
    const check = await this.get("/mandatory-task").catch(() => null);
    if (check?.verified) {
      this.logger.success("Mandatory task verified.");
      return check;
    }
    for (const link of REQUIRED_CHANNELS) {
      if (this.signal?.aborted) break;
      if (this.validateTelegramTask(link)) {
        await this.tryToJoinTelegramLink(link);
      }
    }
    const recheck = await this.get("/mandatory-task").catch(() => null);
    if (recheck?.verified) this.logger.success("Mandatory task verified after join.");
    else this.logger.warn("Mandatory task not verified yet — join @FlamesEarnOfficialGroup + @FlamesEarnOfficialChannel.");
    return recheck;
  }

  /* --------------------------------------------------------------------- */
  /* Tasks                                                                 */
  /* --------------------------------------------------------------------- */

  async completeTasks() {
    const tasks = await this.getTaskList();
    if (!tasks.length) {
      this.logger.info("No tasks returned.");
      return;
    }
    this._doneTaskIds = new Set();
    const pending = tasks.filter((t) => !t.completed && !t.claimed);
    this.logger.info(`Tasks: ${pending.length}/${tasks.length} left.`);
    for (const task of pending) {
      if (this.signal?.aborted) break;
      const id = task.id;
      const label = task.title || task.name || `task ${id}`;
      if (task.viewProgress?.isLocked) {
        this.logger.info(`Skipped locked task: ${label}`);
        continue;
      }
      const link = task.action_url || task.url || task.href || "";
      if (link && this.validateTelegramTask(link)) {
        await this.tryToJoinTelegramLink(link);
      }
      try {
        const claim = await this.claimHeaders("task_complete", String(id));
        const result = await this.post("/tasks/complete", { taskId: id }, claim);
        if (result?.ok) {
          this.logger.success(`Completed task: ${label}`);
          this._doneTaskIds.add(id);
        } else this.logger.info(`Task not credited: ${label} - ${result?.error || "no ok"}`);
      } catch (e) {
        const msg = this.readError(e);
        // Ad-gated tasks must go through an ad provider flow instead.
        if (/use_ad_flow/i.test(msg)) {
          this.logger.info(`Task "${label}" needs ad flow — running providers.`);
          if (await this.watchTaskAds(id, label)) this._doneTaskIds.add(id);
        } else if (/already_completed/i.test(msg)) {
          this.logger.info(`Already done: ${label}`);
          this._doneTaskIds.add(id);
        } else {
          this.logger.warn(`Task "${label}" failed:`, msg);
        }
      }
    }
  }

  /* --------------------------------------------------------------------- */
  /* Ads (click-gated, 4 providers)                                        */
  /* --------------------------------------------------------------------- */

  /** Poll token-status a few times (server-side ad verification). */
  async pollTokenStatus(token, tries = 3) {
    for (let i = 0; i < tries; i++) {
      if (this.signal?.aborted) break;
      await this.utils.delayForSeconds(5, { signal: this.signal });
      const res = await this.get(`/ads/token-status?token=${encodeURIComponent(token)}`).catch(() => null);
      if (res?.ready || res?.ok) return res;
    }
    return null;
  }

  /** Provider 1: Adsgram — generate -> poll -> mark-clicked with stats. */
  async adsgramFlow(taskId) {
    const claim = await this.claimHeaders("ads_generate", String(taskId));
    const gen = await this.post("/ads/generate-token", { taskId }, claim);
    if (!gen?.ok || !gen?.token) throw new Error(gen?.error || "No ad token");
    await this.pollTokenStatus(gen.token);
    // NOTE: no headless ad render — report the click the server requires
    // (NO_CLICK otherwise) and let the server decide.
    const claimClick = await this.claimHeaders("ads_click", gen.token);
    const result = await this.post(
      "/ads/mark-clicked",
      { token: gen.token, ...AD_STATS },
      { xyz: "10", ...claimClick },
    );
    if (!result?.ok) throw new Error(result?.error || "not credited");
    this.logger.success(
      `Adsgram credited${result.reward ? ` (+${result.reward})` : ""}. Balance: ${result.newBalance ?? "-"}`,
    );
    return true;
  }

  /** Provider 2: Adexium — generate -> mark-clicked with bare {token}. */
  async adexiumFlow(taskId) {
    const claim = await this.claimHeaders("ads_generate", String(taskId));
    const gen = await this.post("/ads/adexium/generate-token", { taskId }, claim);
    if (!gen?.ok || !gen?.token) throw new Error(gen?.error || "No adexium token");
    const claimClick = await this.claimHeaders("ads_click", gen.token);
    const result = await this.post("/ads/adexium/mark-clicked", { token: gen.token }, claimClick);
    if (!result?.ok) throw new Error(result?.error || "not credited");
    this.logger.success(
      `Adexium credited${result.reward ? ` (+${result.reward})` : ""}. Balance: ${result.newBalance ?? "-"}`,
    );
    return true;
  }

  /** Provider 3: Tower — claim loop, retries on no_postback (~15s app-side). */
  async towerFlow(taskId, tries = 3) {
    for (let i = 0; i < tries; i++) {
      if (this.signal?.aborted) break;
      if (i > 0) await this.utils.delayForSeconds(5, { signal: this.signal });
      const claim = await this.claimHeaders("tower_claim", String(taskId));
      const result = await this.post("/ads/tower/claim", { taskId }, claim).catch((e) => ({ error: this.readError(e) }));
      if (result?.ok) {
        this.logger.success(
          `Tower credited${result.reward ? ` (+${result.reward})` : ""}. Balance: ${result.newBalance ?? "-"}`,
        );
        return true;
      }
      if (result?.error !== "no_postback") throw new Error(result?.error || "not credited");
    }
    throw new Error("no_postback");
  }

  /** Provider 4: Monetag — single claim (app shows show_11491740 first). */
  async monetagFlow(taskId) {
    const claim = await this.claimHeaders("monetag_claim", String(taskId));
    const result = await this.post("/ads/monetag/claim", { taskId }, claim);
    if (!result?.ok) throw new Error(result?.error || "not credited");
    this.logger.success(
      `Monetag credited${result.reward ? ` (+${result.reward})` : ""}.`,
    );
    return true;
  }

  /** Run all providers for one task until one credits. */
  async watchTaskAds(taskId, label = `task ${taskId}`) {
    const providers = [
      ["Adsgram", () => this.adsgramFlow(taskId)],
      ["Adexium", () => this.adexiumFlow(taskId)],
      ["Tower", () => this.towerFlow(taskId)],
      ["Monetag", () => this.monetagFlow(taskId)],
    ];
    for (const [name, run] of providers) {
      if (this.signal?.aborted) break;
      try {
        await run();
        return true;
      } catch (e) {
        this.logger.info(`${name} for "${label}": ${this.readError(e)}`);
      }
    }
    this.logger.warn(`No provider credited "${label}".`);
    return false;
  }

  /** One ad cycle for a task (legacy single-provider entry). */
  async watchOneAd(taskId) {
    return this.watchTaskAds(taskId);
  }

  async watchAds() {
    const tasks = await this.getTaskList();
    const finished = this._doneTaskIds || new Set();
    const adTasks = tasks.filter(
      (t) =>
        !t.completed &&
        !t.claimed &&
        !finished.has(t.id) &&
        (t.type === "ads" || t.taskType === "ads" || /watch.*ad|click.*earn/i.test(t.title || "")),
    );
    const queue = adTasks.length ? adTasks : [{ id: 1, title: "ads" }];
    let done = 0;
    for (const task of queue) {
      if (this.signal?.aborted) break;
      // NOTE: no locked-skip here — locked ad tasks credited before via providers.
      try {
        if (await this.watchTaskAds(task.id, task.title || `task ${task.id}`)) done++;
      } catch (e) {
        const msg = this.readError(e);
        this.logger.warn(`Ad task ${task.id} failed:`, msg);
        if (/no ads|limit/i.test(msg)) break;
      }
    }
    if (!done) this.logger.info("No ads credited.");
    return done;
  }

  /* --------------------------------------------------------------------- */
  /* Adsgram-direct batch (ladder rungs 2-9): real /adv -> events -> claim */
  /* --------------------------------------------------------------------- */

  /** Tracker URL by event name from a banner payload. */
  bannerTracker(banner, name) {
    const trackings = banner?.trackings || [];
    return trackings.find((t) => t?.name === name)?.value || "";
  }

  /**
   * Play one real Adsgram batch (block 42284) the way the SDK would:
   * render+show each banner, click inside every shown ad, then reward.
   * Returns {shown, clicked} for the claim — no firing, no claim.
   */
  async playAdsgramBatch(blockId = "42284") {
    // Attempt 1 uses the publisher domain (matches the header rules when
    // active); on "Wrong referer" retry with the extension's own origin,
    // which is what the live app traffic carries.
    try {
      return await this.playAdsgramBatchWith(blockId);
    } catch (e) {
      if (!/wrong referer/i.test(this.readError(e))) throw e;
      let extOrigin = "";
      try {
        const id = globalThis.chrome?.runtime?.id;
        if (id) extOrigin = `chrome-extension://${id}`;
      } catch {}
      if (!extOrigin) throw e;
      this.logger.info("Ladder batch: retrying with extension origin.");
      return await this.playAdsgramBatchWith(blockId, extOrigin);
    }
  }

  /**
   * Adsgram rejects calls without the publisher Referer ("Wrong referer").
   * The dashboard refreshes header rules on mount, but background runs can
   * go out with stale ones — so ensure coverage here, once per run.
   */
  async ensureAdsgramHeaders() {
    if (this._adsgramHeadersEnsured) return;
    this._adsgramHeadersEnsured = true;
    try {
      const dnr = globalThis.chrome?.declarativeNetRequest;
      if (!dnr?.getDynamicRules) return;
      const rules = await dnr.getDynamicRules().catch(() => []);
      const covered = rules.some((r) =>
        (r.condition?.requestDomains || []).includes("api.adsgram.ai"),
      );
      if (covered) return;
      await dnr.updateDynamicRules({
        addRules: [
          {
            id: 9501,
            priority: 1,
            action: {
              type: "modifyHeaders",
              requestHeaders: [
                { header: "origin", operation: "set", value: "https://flamesearn.site" },
                { header: "referer", operation: "set", value: "https://flamesearn.site/" },
              ],
            },
            condition: {
              requestDomains: ["api.adsgram.ai"],
              resourceTypes: ["xmlhttprequest", "other"],
            },
          },
        ],
      });
      this.logger.info("Ladder batch: installed referer rule for api.adsgram.ai.");
    } catch (e) {
      this.logger.info(`Ladder batch: referer rule not installed (${this.readError(e)}).`);
    }
  }

  async playAdsgramBatchWith(blockId, topDomain) {
    await this.ensureAdsgramHeaders();
    const client = new AdsGramClient(this, topDomain ? { topDomain } : {});
    const payload = await client.requestBanner(blockId);
    const items = payload?.banners || [];
    if (!items.length) {
      this.logger.info("Ladder batch: no ads offered.");
      return { shown: 0, clicked: 0, noAd: true };
    }
    let shown = 0;
    let clicked = 0;
    for (const item of items) {
      if (this.signal?.aborted) break;
      const banner = item?.banner || item;
      const names = (banner?.trackings || []).map((t) => t?.name).filter(Boolean);
      this.logger.info(`Ladder batch: banner trackers: ${names.join(",") || "none"}.`);
      const fire = async (url) => {
        if (!url) return false;
        await client.fireTracker(url);
        return true;
      };
      await fire(this.bannerTracker(banner, "render"));
      if (!(await fire(this.bannerTracker(banner, "show")))) continue;
      shown++;
      // Dwell like a viewer before tapping inside the ad.
      await this.utils.delayForSeconds(6 + Math.random() * 6, { signal: this.signal });
      const clickUrl =
        this.bannerTracker(banner, "click") || this.bannerTracker(banner, "Click");
      if (await fire(clickUrl)) clicked++;
      await this.utils.delayForSeconds(2, { signal: this.signal });
    }
    // Complete the views.
    for (const item of items) {
      const banner = item?.banner || item;
      await client.fireTracker(
        this.bannerTracker(banner, "reward") || this.bannerTracker(banner, "skip"),
      );
    }
    this.logger.info(`Ladder batch: shown=${shown}, clicked=${clicked}.`);
    return { shown, clicked };
  }

  /** Claim one ladder rung. Rungs 0-1 are Monetag, 2-9 are Adsgram batches. */
  async claimLadderRung(step) {
    if (step <= 1) {
      const res = await this.claimLadderMonetag(step);
      if (res.done || res.stop || typeof res.next === "number") return res;
    }
    return this.claimLadderBatch(step);
  }

  /** Claim one rung with real batch counts; one replay on "retry". */
  async claimLadderBatch(step, attempts = 2) {
    for (let i = 0; i < attempts; i++) {
      if (this.signal?.aborted) break;
      let batch;
      try {
        batch = await this.playAdsgramBatch("42284");
      } catch (e) {
        this.logger.warn(`Ladder rung ${step}: batch failed: ${this.readError(e)}`);
        return { done: false, stop: /penalty|cooldown/i.test(this.readError(e)) };
      }
      if (batch.noAd || !batch.shown) return { done: false, stop: true };
      if (!batch.clicked) {
        this.logger.warn(`Ladder rung ${step}: batch had no click tracker — not claiming blind.`);
        return { done: false, stop: true };
      }
      try {
        const claim = await this.claimHeaders("earnmore_claim", String(step));
        const result = await this.post(
          "/earn-more/claim",
          { step, adsShown: batch.shown, adsClicked: batch.clicked },
          { xyz: "10", ...claim },
        );
        if (result?.ok) {
          this.logger.success(`Ladder rung ${step} claimed (+${result.reward ?? "?"}). Balance: ${result.newBalance ?? "-"}`);
          return { done: true, next: typeof result.step === "number" ? result.step : step + 1 };
        }
        const err = result?.error || "not credited";
        if (/wrong_step/i.test(err) && typeof result.step === "number") {
          this.logger.info(`Ladder rung ${step}: wrong_step, server says step ${result.step}.`);
          return { done: false, next: result.step };
        }
        if (/penalty|cooldown|invalid_step/i.test(err)) {
          this.logger.warn(`Ladder stopped: ${err}`);
          return { done: false, stop: true };
        }
        // "retry" (click inside all ads) or anything else: replay the batch once.
        this.logger.info(`Ladder rung ${step}: ${err} — replaying batch.`);
      } catch (e) {
        const msg = this.readError(e);
        if (/penalty|cooldown|invalid_step/i.test(msg)) {
          this.logger.warn(`Ladder stopped: ${msg}`);
          return { done: false, stop: true };
        }
        this.logger.info(`Ladder rung ${step}: ${msg} — replaying batch.`);
      }
    }
    return { done: false, stop: true };
  }

  /** Variant 1: monetag rung — token first, then claim with it. */
  async claimLadderMonetag(step) {
    try {
      const tokenClaim = await this.claimHeaders("earnmore_token", String(step));
      const tokenRes = await this.post("/earn-more/monetag-token", { step }, tokenClaim);
      this.logger.info(`Ladder rung ${step} (monetag): token -> ${tokenRes?.token ? "yes" : tokenRes?.error || "empty"}.`);
      const token = tokenRes?.token;
      if (!token) {
        this.logger.info(`Ladder rung ${step} (monetag): no token, trying batch.`);
      }
      if (token) {
        const claim = await this.claimHeaders("earnmore_claim", String(step));
        const result = await this.post("/earn-more/claim", { step, token }, { xyz: "10", ...claim });
        if (result?.ok) {
          this.logger.success(`Ladder rung ${step} claimed (+${result.reward ?? "?"}). Balance: ${result.newBalance ?? "-"}`);
          return { done: true, next: typeof result.step === "number" ? result.step : step + 1 };
        }
        if (/wrong_step/i.test(result?.error || "") && typeof result.step === "number") {
          this.logger.info(`Ladder rung ${step} (monetag): wrong_step, server says step ${result.step}.`);
          return { done: false, next: result.step };
        }
        if (/penalty|cooldown/i.test(result?.error || "")) {
          this.logger.warn(`Ladder stopped: ${result?.error}`);
          return { done: false, stop: true };
        }
        this.logger.info(`Ladder rung ${step} (monetag): ${result?.error || "not credited"}`);
      }
    } catch (e) {
      const msg = this.readError(e);
      if (/wrong_step/i.test(msg)) {
        this.logger.info(`Ladder rung ${step} (monetag): wrong_step — re-reading status.`);
        const fresh = await this.get("/earn-more/status").catch(() => null);
        if (fresh && typeof fresh.step === "number" && fresh.step !== step) {
          return { done: false, next: fresh.step };
        }
        return { done: false, stop: true };
      }
      if (/invalid_step/i.test(msg)) {
        // Not a monetag rung — fall through to the adsgram batch below.
        this.logger.info(`Ladder rung ${step} (monetag): invalid_step — trying batch.`);
      } else if (/penalty|cooldown/i.test(msg)) {
        this.logger.warn(`Ladder stopped: ${msg}`);
        return { done: false, stop: true };
      }
      this.logger.info(`Ladder rung ${step} (monetag): ${msg}`);
      return { done: false, stop: /penalty|cooldown|invalid_step/i.test(msg) };
    }
  }

  async earnLadder(maxRungs = 10) {
    const status = await this.get("/earn-more/status").catch((e) => {
      this.logger.warn("Ladder status failed:", this.readError(e));
      return null;
    });
    if (!status?.ok && status?.step == null) {
      this.logger.info("No ladder available.");
      return;
    }
    const now = Date.now();
    for (const key of ["cooldownUntil", "penaltyUntil"]) {
      if (status[key] && new Date(status[key]).getTime() > now) {
        this.logger.info(`Ladder paused (${key} until ${status[key]}).`);
        return;
      }
    }
    let step = Number(status.step ?? 0);
    this.logger.info(`Ladder at rung ${step}.`);
    let claimed = 0;
    for (let i = 0; i < maxRungs; i++) {
      if (this.signal?.aborted) break;
      const res = await this.claimLadderRung(step);
      if (res.done) {
        claimed++;
        step = res.next;
        continue;
      }
      if (res.stop) break;
      if (typeof res.next === "number" && res.next !== step) {
        step = res.next;
        continue;
      }
      break;
    }
    if (!claimed) this.logger.info("No ladder rungs claimed.");
  }

  /* --------------------------------------------------------------------- */
  /* Process                                                               */
  /* --------------------------------------------------------------------- */

  async process() {
    await this.login();
    await this.logUserInfo();
    await this.executeTask("Mandatory", () => this.ensureMandatory());
    await this.executeTask("Tasks", () => this.completeTasks());
    await this.executeTask("Ads", () => this.watchAds());
    await this.executeTask("Ladder", () => this.earnLadder());
  }

  /* --------------------------------------------------------------------- */
  /* Tools                                                                 */
  /* --------------------------------------------------------------------- */

  createTools() {
    return [
      {
        name: "Tasks",
        list: [
          {
            id: "complete-tasks",
            icon: "check",
            title: "Complete Tasks",
            action: this.completeTasks.bind(this),
            dispatch: false,
          },
          {
            id: "check-mandatory",
            icon: "shield",
            title: "Check Mandatory",
            action: this.ensureMandatory.bind(this),
            dispatch: false,
          },
        ],
      },
      {
        name: "Ads",
        list: [
          {
            id: "watch-ads",
            icon: "play",
            title: "Watch Ads",
            action: this.watchAds.bind(this),
            dispatch: false,
          },
          {
            id: "earn-ladder",
            icon: "star",
            title: "Earn Ladder",
            action: this.earnLadder.bind(this),
            dispatch: false,
          },
        ],
      },
    ];
  }
}
