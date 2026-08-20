import BaseFarmer from "../lib/BaseFarmer.js";

/**
 * Makegram
 *
 * A minimal tap-miner: every request carries the Telegram init data in the
 * `X-Init-Data` header, and the state endpoint also doubles as the "login".
 * A run makes sure the required channel/chat are joined, then sweeps the
 * floor (`/api/game/sweep`) — the coin-earning mechanic that replaced plain
 * tapping (the tap endpoint now credits 0 and only feeds the shift quota).
 *
 * The sweep loop mirrors how a person actually plays: short, irregular
 * batches of taps (a few to ~16), natural second-ish pauses with an
 * occasional longer "stepped away" gap, and easing off when the server
 * starts cutting gestures it can't take.
 */

/** Every API call hangs off this one host. */
const API_URL = "https://api.mgrmga.org";

/** Taps a shift holds before it resets (mirrors the page's `hitsPerShift`). */
const HITS_PER_SHIFT = 300;

/** The daily hit-count task's quota, which a full shift exactly satisfies. */
const HITS_TASK_GOAL = 300;

export default class MakegramFarmer extends BaseFarmer {
  static id = "makegram";
  static title = "Makegram";
  static emoji = "⛏️";
  static host = "mgrmga.org";
  static domains = ["mgrmga.org", "api.mgrmga.org"];
  static telegramLink = "https://t.me/MGRMGA_bot?start=ref6627962056";
  static path = "/";
  static referrerMode = "random";
  static singleton = true;
  static rating = 5;
  static cacheAuth = false;
  static interval = "*/10 * * * *";

  /** Get Referral Link (this account's own invite link). */
  getReferralLink() {
    return `https://t.me/MGRMGA_bot?start=ref${this.getUserId()}`;
  }

  /** Auth is the initData echoed in `X-Init-Data` on every request. */
  fetchAuth() {
    return this.getInitData();
  }

  /** Headers the API wants on every call. */
  getAuthHeaders(data) {
    return data
      ? {
          "X-Init-Data": data,
        }
      : {};
  }

  /* --------------------------------------------------------------------- */
  /* Transport                                                             */
  /* --------------------------------------------------------------------- */

  /** Post to an endpoint with the initData header baked in. */
  post(path, payload = {}) {
    return this.api.post(`${API_URL}/${path}`, payload).then((res) => res.data);
  }

  /** The referral id the state endpoint wants — digits only. */
  getRef() {
    const startParam = String(this.getStartParam() || "");
    const digits = startParam.replace(/[^0-9]/g, "");
    return digits || "";
  }

  /* --------------------------------------------------------------------- */
  /* API wrappers                                                          */
  /* --------------------------------------------------------------------- */

  /** Full account state — the single source of truth for a run. */
  getState() {
    return this.post("api/game/state", { ref: this.getRef() });
  }

  /** Credit a batch of taps. `times` are per-tap timestamps (ms). */
  tap(times, batch) {
    return this.post("api/game/tap", {
      times,
      offsets: times.map(() => 0),
      batch,
      dev: this.getDeviceId(),
    });
  }

  /** Sweep the floor with a batch of swipes. */
  sweep(taps) {
    return this.post("api/game/sweep", { taps });
  }

  /** The leaderboard (informational only). */
  getTop() {
    return this.post("api/game/top", {});
  }

  /* --------------------------------------------------------------------- */
  /* Auth                                                                  */
  /* --------------------------------------------------------------------- */

  /** Load the account state and remember it. */
  async login() {
    this.user_data = await this.getState();

    if (!this.user_data?.ok) {
      throw new Error(this.user_data?.msg || "Failed to load account");
    }

    return this.user_data;
  }

  /* --------------------------------------------------------------------- */
  /* Subscription                                                          */
  /*                                                                       */
  /* The drop gates tapping behind joining its channel and chat. The state  */
  /* reports what is still missing under `sub.need`, and `subLinks` gives   */
  /* the joinable handles. A headless run can only satisfy link/chat joins  */
  /* when a Telegram client is attached — otherwise it just logs.           */
  /* --------------------------------------------------------------------- */

  /** Join anything the drop still requires. */
  async ensureSubscribed() {
    const sub = this.user_data?.sub;
    const links = this.user_data?.subLinks || {};

    if (sub?.ok) {
      this.logger.info("Subscription satisfied.");
      return;
    }

    const candidates = [
      { link: links.channel, label: "channel" },
      { link: links.chat, label: "chat" },
    ];

    for (const { link, label } of candidates) {
      if (!link) continue;

      const tme = link.startsWith("@")
        ? `https://t.me/${link.slice(1)}`
        : link;

      if (this.validateTelegramTask(tme)) {
        const joined = await this.tryToJoinTelegramLink(tme);
        if (joined) {
          this.logger.success(`Joined ${label}: ${link}`);
        } else {
          this.logger.warn(`Could not join ${label}: ${link}`);
        }
      } else {
        this.logger.warn(`No client to join ${label}: ${link}`);
      }
    }
  }

  /* --------------------------------------------------------------------- */
  /* Tapping                                                               */
  /*                                                                       */
  /* Each tap credits `perHit` coins server-side. The page collects taps in */
  /* batches of a few timestamps per request; a shift is `hitsPerShift`     */
  /* taps. The daily hit task's quota matches one full shift.               */
  /* --------------------------------------------------------------------- */

  /** A stable per-account device id, matching the page's random 12-char ids. */
  getDeviceId() {
    if (!this.deviceId) {
      const alphabet =
        "abcdefghijklmnopqrstuvwxyz0123456789";
      let id = "";
      const rng = this.getUserRandomGenerator();
      for (let i = 0; i < 12; i++) {
        id += alphabet[Math.floor(rng() * alphabet.length)];
      }
      this.deviceId = id;
    }
    return this.deviceId;
  }

  /**
   * Tap until the shift quota is spent.
   *
   * Sends small batches (3 taps each) like the page does, pausing a few
   * seconds between requests so it looks like a person who keeps checking in.
   */
  async tapUntilShiftDone() {
    const state = this.user_data;
    const perHit = Number(state?.perHit) || 20;
    const shiftQuota = Number(state?.hitsPerShift) || HITS_PER_SHIFT;
    const hits = Number(state?.hits) || 0;

    let batchIndex = 1;
    let shiftHits = hits;

    while (shiftHits < shiftQuota && !this.signal?.aborted) {
      const remaining = shiftQuota - shiftHits;
      const count = Math.min(3, remaining);

      const now = Date.now();
      const times = Array.from({ length: count }, (_, i) => now + i * 60);

      const result = await this.tap(times, `b${batchIndex}`).catch((error) => {
        this.logger.warn(
          "Tap not credited:",
          error.response?.data?.error || error.message,
        );
        return null;
      });

      if (!result?.ok) break;

      const credited = Number(result.credited) || 0;
      shiftHits += credited;

      this.debugger.log("Tap result:", result);

      if (result?.shift) {
        this.logger.success("Shift completed!");
        break;
      }

      await this.utils.delayForSeconds(
        2 + Math.floor(this.getUserRandomGenerator()() * 3),
        { signal: this.signal },
      );

      batchIndex++;
    }

    const gained = shiftHits - hits;
    this.logger.success(
      `Tapped ${gained} hit(s) (+${gained * perHit} coins) - ${shiftHits}/${shiftQuota} this shift.`,
    );

    this.user_data = await this.getState().catch(() => this.user_data);
  }

  /* --------------------------------------------------------------------- */
  /* Sweeping                                                              */
  /*                                                                       */
  /* The floor accumulates coins over time (черезМин..черезМакс respawn),   */
  /* and each swipe has a chance to dig one out. Sending a batch earns a    */
  /* coin every few taps; swipes the server can't take are cut (срезано).   */
  /*                                                                       */
  /* The pacing is deliberately human: most batches are a handful of taps   */
  /* (2-7), occasionally a genuine burst (~14-16), and requests pause a     */
  /* second or two apart with a rare longer gap, exactly what the capture   */
  /* shows. After a coin lands we let the floor breathe before sweeping     */
  /* again, and we ease off whenever the server reports cut swipes.         */
  /* --------------------------------------------------------------------- */

  /** Run sweep target bounds — fresh per run, so sweeping always happens. */
  static SWEEP_TARGET_MIN = 50;
  static SWEEP_TARGET_MAX = 100;

  /** A fresh sweep target within the bounds, humanlike per run. */
  sweepTarget() {
    const rng = this.getUserRandomGenerator();
    return (
      MakegramFarmer.SWEEP_TARGET_MIN +
      Math.floor(
        rng() *
          (MakegramFarmer.SWEEP_TARGET_MAX -
            MakegramFarmer.SWEEP_TARGET_MIN +
            1),
      )
    );
  }

  /** One humanlike sweep batch size, weighted toward short bursts. */
  randomSweepTaps() {
    const rng = this.getUserRandomGenerator();
    const roll = rng();
    // ~60% short bursts of a handful of swipes
    if (roll < 0.6) return 2 + Math.floor(rng() * 6);
    // ~30% mid batches
    if (roll < 0.9) return 6 + Math.floor(rng() * 4);
    // ~10% enthusiastic flurry, like the 14-16s in the capture
    return 12 + Math.floor(rng() * 5);
  }

  /** Humanlike inter-request pause: a second or two, rarely much longer. */
  async humanSweepPause() {
    const rng = this.getUserRandomGenerator();
    const seconds = rng() < 0.08 ? 8 + rng() * 7 : 1.2 + rng() * 2.5;
    await this.utils.delayForSeconds(seconds, { signal: this.signal });
  }

  /**
   * Sweep the floor until the run target is met or the piles run dry.
   *
   * The server reports how many swipes it took (засчитано), how many it cut
   * (срезано), coins gained this batch (gained) and how full the floor is
   * (`пусто` when there is nothing left to sweep). Daily progress is reported
   * in `сегодня`. The run target (50-100 coins) is per run — fresh each time —
   * so sweeping always happens instead of being gated behind the daily counter.
   * Once the run haul reaches the target, sweeping stops and the run moves on
   * to tapping — sweeping is the big earner, so it runs first and tapping after.
   */
  async sweepFloor() {
    const state = this.user_data;
    const today = Number(state?.dayCoins) || 0;
    const target = this.sweepTarget();

    this.logger.newline();
    this.logger.info(
      `Sweeping the floor (${target} coin(s) this run, ${today} today)...`,
    );

    let swept = 0;
    let gained = 0;
    let empty = 0;

    while (!this.signal?.aborted && gained < target) {
      const taps = this.randomSweepTaps();

      const result = await this.sweep(taps).catch((error) => {
        this.logger.warn(
          "Sweep not credited:",
          error.response?.data?.error || error.message,
        );
        return null;
      });

      if (!result?.ok) break;

      const counted = Number(result.засчитано) || 0;
      const cut = Number(result.срезано) || 0;
      const batchGained = Number(result.gained) || 0;
      const floorEmpty = result.пусто === true || result.уборка?.пусто === true;

      swept += counted;
      gained += batchGained;

      this.debugger.log("Sweep result:", result);

      if (batchGained > 0) {
        empty = 0;
        this.logger.success(
          `Sweep: +${batchGained} coin(s) (${counted} swipes, ${cut} cut) — ${gained}/${target} this run.`,
        );
      } else {
        empty++;
        this.logger.log(`Sweep: no coin yet (${counted} swipes, ${cut} cut).`);
      }

      // Run target reached — leave the floor, move on to tapping.
      if (gained >= target) {
        this.logger.success(
          `Run sweep target met (${today} today). Moving on to tapping.`,
        );
        break;
      }

      // The floor is clean — respawn takes a few minutes, nothing to do now.
      if (floorEmpty) {
        this.logger.info(
          "Floor is clean; new dirt will spawn in a few minutes.",
        );
        break;
      }

      // The server keeps cutting swipes — take it as a sign to ease off.
      if (cut >= counted && counted > 0) {
        this.logger.log("Easing off — the floor can't take that many swipes.");
        break;
      }

      // A natural stop after a session of sweeping, like a human moving on.
      if (empty >= 3) {
        this.logger.info("No coins dropping — leaving the floor for now.");
        break;
      }

      await this.humanSweepPause();
    }

    if (gained > 0) {
      this.logger.success(
        `Swept ${swept} swipe(s) for +${gained} coin(s).`,
      );
      this.user_data = await this.getState().catch(() => this.user_data);
    } else {
      this.logger.info("No coins from sweeping this round.");
    }
  }

  /* --------------------------------------------------------------------- */
  /* Process                                                               */
  /* --------------------------------------------------------------------- */

  async process() {
    await this.login();

    await this.logUserInfo();
    await this.executeTask("Subscription", () => this.ensureSubscribed());
    await this.executeTask("Sweeping", () => this.sweepFloor());
    await this.executeTask("Tapping", () => this.tapUntilShiftDone());
  }

  /** Log the current account state. */
  async logUserInfo() {
    const user = this.user_data;

    this.logger.newline();
    this.logCurrentUser();

    this.logger.keyValue("Balance", user.coins);
    this.logger.keyValue("Mined", user.mined);
    this.logger.keyValue("Per Hit", user.perHit);
    this.logger.keyValue("Pick", user.pick);
    this.logger.keyValue("Hits", `${user.hits}/${user.hitsPerShift ?? HITS_PER_SHIFT}`);
    this.logger.keyValue("Today", `${user.dayCoins ?? 0} coin(s)`);

    const task = (user.tasks || []).find((t) => t.id === "hits");
    if (task && task.ready && !task.claimed) {
      this.logger.info("Hit task ready to claim (300 hits).");
    }

    this.logger.newline();
  }

  /* --------------------------------------------------------------------- */
  /* Tools                                                                 */
  /* --------------------------------------------------------------------- */

  createTools() {
    return [
      {
        name: "Mining",
        list: [
          {
            id: "sweep",
            icon: "goforward",
            title: "Sweep Floor",
            action: this.sweepFloor.bind(this),
            dispatch: false,
          },
          {
            id: "tap",
            icon: "refresh",
            title: "Tap Now",
            action: this.tapUntilShiftDone.bind(this),
            dispatch: false,
          },
        ],
      },
    ];
  }
}
