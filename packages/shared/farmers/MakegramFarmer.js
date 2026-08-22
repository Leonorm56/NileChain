import BaseFarmer from "../lib/BaseFarmer.js";

/**
 * Makegram
 *
 * A minimal tap-miner: every request carries the Telegram init data in the
 * `X-Init-Data` header, and the state endpoint also doubles as the "login".
 * A run makes sure the required channel/chat are joined, claims the periodic
 * mining reward and rocket bonus, then taps until the shift quota is spent.
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

  /** Claim the periodic mining reward (available every ~6 hours). */
  claim() {
    return this.post("api/game/claim", {});
  }

  /** Activate the rocket bonus (raketa). */
  raketa(state) {
    return this.post("api/game/raketa", {состояние: state});
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
  /* Process                                                               */
  /* --------------------------------------------------------------------- */

  /**
   * Claim the periodic mining reward and try the rocket bonus.
   * The claim endpoint credits coins every ~6 hours; the raketa endpoint
   * activates a bonus that rewards coins if the account qualifies.
   */
  async claimRewards() {
    // Claim periodic mining reward
    const claimResult = await this.claim().catch((e) => {
      this.logger.warn("Claim failed:", e.response?.data?.error || e.message);
      return null;
    });

    if (claimResult?.ok) {
      const earned = Number(claimResult.начислено) || 0;
      if (earned > 0) {
        this.logger.success(`Claimed ${earned} coins from mining reward.`);
      } else {
        const reason = claimResult.состояние?.причина || "not ready";
        this.logger.info(`Mining claim: ${reason}.`);
      }
    }

    // Try rocket bonus
    const rocketResult = await this.raketa(true).catch((e) => {
      this.logger.warn("Raketa failed:", e.response?.data?.error || e.message);
      return null;
    });

    if (rocketResult?.ok) {
      if (rocketResult.сделано) {
        this.logger.success(`Raketa claimed! +${rocketResult.награда} coins.`);
      } else if (rocketResult.получил) {
        this.logger.info(`Raketa already claimed.`);
      } else {
        this.logger.info(`Raketa not claimable (need level ${rocketResult.уровеньЗа}).`);
      }
    }
  }

  async process() {
    await this.login();

    await this.logUserInfo();
    await this.executeTask("Subscription", () => this.ensureSubscribed());
    await this.executeTask("Claim", () => this.claimRewards());
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
