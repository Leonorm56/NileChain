import BaseFarmer from "../lib/BaseFarmer.js";

/**
 * EasyCoin (EasyCoinFarBot)
 *
 * A Cloudflare-Workers game served from ezzgold.easyciin.workers.dev with a
 * second host (ezzcoinapp.easyciin.workers.dev) behind a 3D "isle" mini-game.
 *
 * Auth is the Telegram init data carried in the `authorization` header using
 * the app's own `tma` scheme — taken verbatim from the shipped bundle:
 *
 *   fetch(`/api${n}`, { headers: { authorization: `tma ${initData}`,
 *                                  "x-tg-platform": platform,
 *                                  "x-tg-version": version } })
 *
 * Sending no auth answers `401 {"error":"unauthorized: empty_init_data"}` and a
 * wrong one answers `bad_signature`, so both the scheme and the two x-tg
 * headers are load-bearing: they are the difference between a signed session
 * and a rejected one.
 *
 * Every POST replies with `{ ...result, state: { full account } }`, so one
 * accepted call hands back the whole refreshed snapshot and the cycle just
 * re-applies it. Gold is produced by mines on a ~6h cycle and only leaves the
 * mine once `/mines/collect` sweeps it — that is the claim.
 */

const API_URL = "https://ezzgold.easyciin.workers.dev/api";

/** Client identity the mini-app reports; matches the captured traffic. */
const TG_PLATFORM = "android";
const TG_VERSION = "9.6";

/** Box rarities, cheapest first — keys are spent in this order. */
const BOX_KINDS = ["wooden", "iron", "golden", "diamond", "mythic"];

/**
 * Mine slots an account owns, 0-indexed. The app's own constant is `Wu = 5`
 * (`const m = { h: Fo / 3600, n: ri, slots: Wu }`), and the capture places the
 * first three mines into slots 0, 1 and 2.
 */
const SLOT_CAPACITY = 5;

/** The dig board is a 5x5 grid, so its cells are 0-24. */
const DIG_CELLS = 25;

/** The one task a farmer can satisfy without a human. */
const CHANNEL_TASK = "channel";

/**
 * Tasks the farmer may act on at all.
 *
 * Anything needing a deposit, a wallet, invites, a league place or a level is
 * not something a bot can satisfy, so checking one spends a request on a
 * certain failure — `deposit1` in particular reads as probing for a payment.
 */
const SELF_SERVE_TASKS = new Set([CHANNEL_TASK, "box1", "slots5"]);

/** Safety cap on the computed wait between runs, in seconds. */
const MAX_RUN_GAP_SECONDS = 3600;

/** Extra wait sprinkled onto the computed run time, in seconds. */
const RUN_JITTER_SECONDS = 90;
const MIN_RUN_JITTER_SECONDS = 30;

/** Seconds in a day — the dig, combo and daily boundaries are UTC-aligned. */
const DAY_SECONDS = 86400;

/** Start of the next UTC day: when the dig board and dailies reset. */
function nextUtcMidnight(epochSeconds) {
  return (Math.floor(epochSeconds / DAY_SECONDS) + 1) * DAY_SECONDS;
}

export default class EasyCoinFarmer extends BaseFarmer {
  static id = "easycoin";
  static title = "EasyCoin";
  static emoji = "🪙";
  static host = "ezzgold.easyciin.workers.dev";
  static domains = [
    "ezzgold.easyciin.workers.dev",
    "ezzcoinapp.easyciin.workers.dev",
    "t.me",
  ];
  static telegramLink = "https://t.me/EasyCoinFarBot/app?startapp=g31m4894";
  static path = "/";
  static referrerMode = "random";
  static singleton = true;
  static rating = 5;
  static cacheAuth = false;
  static apiDelay = 400;
  static interval = "*/10 * * * *";

  /**
   * Accounts whose bot has already been started in this process.
   *
   * Telegram offers nothing to read back — the game's `state.bot` is only the
   * bot's username and `profile` carries no "started" flag — so remembering it
   * here is the only cheap way to keep the `StartBot` invoke off a ten-minute
   * schedule. `Runner` extends the farmer class, so this registry is shared
   * across an account's runs, and the key is per account rather than per bot.
   */
  static startedBots = new Set();

  /**
   * Switches for the optional parts of a cycle.
   *
   * Deliberately local to this farmer rather than a new shared abstraction: no
   * other farmer in the repo has config, and inventing one for everybody is a
   * bigger change than this account needs.
   *
   * There is no combo switch. `/api/combo/try` takes three of nine options, the
   * capture only ever shows the wrong-guess path, the try limit is unknown and
   * the reply carries no hint — so there is no strategy to enable and no flag
   * worth half-implementing. Enumerating the space is explicitly not allowed.
   */
  static config = {
    seen: true,
    missions: true,
    achievements: true,
    scratch: true,
    boxes: true,
    daily: true,
    tasks: true,
    dig: true,
    /** "lowest" (first unopened cell) or "random" (any unopened cell). */
    digStrategy: "lowest",
    minDelayMs: 2000,
    maxDelayMs: 8000,
    /** Human-like waits between successive calls inside an action loop. */
    pacing: true,
    /** Read state, log the plan, send nothing. */
    dryRun: false,
  };

  constructor(...args) {
    super(...args);
    // Instance overrides win, so a single account can differ without a
    // subclass and without touching the defaults everyone else runs.
    this.config = { ...this.constructor.config, ...(this.config || {}) };
  }

  /**
   * Get Referral Link
   *
   * The account's own invite link comes back on `/state` as
   * `profile.referralLink` (`https://t.me/EasyCoinFarBot/app?startapp=<code>`).
   * Runner.updatePrimaryFarmerLink calls this once per account and logs a hard
   * error for anything thrown, so it must always answer — hence the fallbacks.
   */
  getReferralLink() {
    const link = this.user_data?.profile?.referralLink;
    if (link) return link;

    const code = this.user_data?.profile?.referralCode;
    if (code) {
      const base = this.constructor.telegramLink.split("?")[0];
      return `${base}?startapp=${code}`;
    }

    return this.constructor.telegramLink;
  }

  /** Auth is the raw Telegram init data, echoed under the `tma` scheme. */
  fetchAuth() {
    return this.getInitData();
  }

  /** Headers the API wants on every call. */
  getAuthHeaders(data) {
    // Never send `authorization: "tma "`: with no init data the API answers
    // "empty_init_data" either way, and an empty scheme hides the real cause.
    if (!data) return {};
    return {
      authorization: `tma ${data}`,
      "x-tg-platform": TG_PLATFORM,
      "x-tg-version": TG_VERSION,
    };
  }

  /* --------------------------------------------------------------------- */
  /* Transport                                                             */
  /* --------------------------------------------------------------------- */

  get(path) {
    return this.api
      .get(`${API_URL}${path}`, { signal: this.signal })
      .then((res) => res.data);
  }

  post(path, payload = {}) {
    return this.api
      .post(`${API_URL}${path}`, payload, { signal: this.signal })
      .then((res) => res.data);
  }

  readError(error) {
    return error?.response?.data?.error || error?.message || "Unknown error";
  }

  /** A short "why" for a failed call: HTTP status when there was one. */
  describeError(error) {
    const status = error?.response?.status;
    const reason = this.readError(error);
    return [status ?? error?.code ?? "no-response", reason].filter(Boolean).join(" ");
  }

  /**
   * Apply a reply to the stored snapshot.
   *
   * Successful POSTs answer with `{ ...action fields..., state: {...} }`, so the
   * full `state` wins when present; the bare object is accepted too for calls
   * that only echo the account. Anything without an account shape is ignored —
   * `{ok:true}` replies must not wipe the snapshot.
   */
  applyState(result) {
    const next =
      result?.state && typeof result.state === "object" ? result.state : result;

    if (next && (next.profile || next.balances || next.mines)) {
      this.user_data = { ...this.user_data, ...next };
    }
    return this.user_data;
  }

  /**
   * Whether a timestamp has passed. The payload carries `now` in epoch
   * seconds, but a field could arrive in milliseconds — both are handled so a
   * unit mix-up reads as "not ready yet" instead of "ready in 1970".
   * `0` / missing means "ready now".
   */
  isReady(timestamp) {
    const ts = Number(timestamp);
    if (!Number.isFinite(ts) || ts <= 0) return true;
    return (ts > 1e12 ? ts : ts * 1000) <= Date.now();
  }

  /**
   * Human-shaped wait between two calls.
   *
   * The observed sessions sat 3–15s apart; the config window (2–8s) is the bot's
   * version of that. `precised: true` matters: the shared `delay()` otherwise
   * adds its own 0–50% stretch, which would push a 2–8s window out to 2–12s and
   * make the configured bound a lie.
   */
  async pace() {
    if (!this.config.pacing) return;

    const min = Math.max(0, Number(this.config.minDelayMs) || 0);
    const max = Math.max(min, Number(this.config.maxDelayMs) || min);
    const wait = min + Math.floor(Math.random() * (max - min + 1));

    await this.utils.delay(wait, { precised: true, signal: this.signal });
  }

  /**
   * What an accepted call changed, taken from the state it returned.
   *
   * Every POST answers with the refreshed account, so the truth about a reward
   * is the diff, not the action's own `reward` echo. Absent sides read as zero
   * so a field the server stopped sending cannot fake a huge gain.
   */
  balanceDelta(before, after = this.user_data) {
    const read = (snapshot, path) =>
      path.reduce((node, key) => node?.[key], snapshot);
    const number = (value) => (Number.isFinite(Number(value)) ? Number(value) : 0);

    const lines = [
      ["gold", ["balances", "gold"], false],
      ["xp", ["meta", "level", "xp"], false],
      ["gem", ["balances", "gems"], true],
      ["ticket", ["balances", "tickets"], true],
      ["slot token", ["balances", "slotTokens"], true],
      ["spin", ["balances", "spins"], true],
      ["scratch card", ["balances", "scratchCards"], true],
      ...BOX_KINDS.map((kind) => [`${kind} key`, ["balances", "keys", kind], true]),
    ];

    const parts = [];
    for (const [label, path, plural] of lines) {
      const diff = number(read(after, path)) - number(read(before, path));
      if (diff === 0) continue;
      const word =
        Math.abs(diff) === 1 || !plural ? label : `${label}s`;
      parts.push(`${diff > 0 ? "+" : ""}${diff} ${word}`);
    }

    return parts.length ? ` (${parts.join(", ")})` : "";
  }

  /** Apply a reply and hand back the delta it produced, ready to log. */
  applyAndReport(result) {
    const before = this.user_data;
    this.applyState(result);
    return this.balanceDelta(before);
  }

  /**
   * When this account should next be run, as an epoch-ms timestamp.
   *
   * The nearest of every gate the state exposes — mine cycles via `nextIn`, the
   * chest cooldown, the ladder's free step — and the next UTC midnight, because
   * the dig board and the dailies all reset there. Gates already in the past
   * are skipped: a ready-now gate is why this run is happening, not a reason to
   * schedule in the past. The result is clamped to a one-hour ceiling so a
   * wildly wrong field can never silence an account for a day, and bumped by
   * 30–120s of jitter so a fleet does not arrive in one wave.
   *
   * Nothing in the framework consumes this yet — `Runner` runs on cron — so it
   * is logged for operators and left for whoever wires a real scheduler.
   */
  computeNextRunAt(now = Date.now()) {
    const state = this.user_data || {};
    const nowSeconds = Math.floor(now / 1000);
    const gates = [nextUtcMidnight(nowSeconds)];

    for (const mine of Array.isArray(state.mines) ? state.mines : []) {
      const nextIn = Number(mine?.nextIn);
      if (Number.isFinite(nextIn) && nextIn > 0) gates.push(nowSeconds + nextIn);
    }

    const chestReadyAt = Number(state.meta?.chest?.readyAt);
    if (Number.isFinite(chestReadyAt) && chestReadyAt > 0) gates.push(chestReadyAt);

    const ladderReadyAt = Number(state.ladder?.freeReadyAt);
    if (Number.isFinite(ladderReadyAt) && ladderReadyAt > 0) gates.push(ladderReadyAt);

    const nextSeconds = Math.min(
      Math.max(Math.min(...gates), nowSeconds + 1),
      nowSeconds + MAX_RUN_GAP_SECONDS,
    );
    const jitter =
      MIN_RUN_JITTER_SECONDS + Math.floor(Math.random() * (RUN_JITTER_SECONDS + 1));

    return (nextSeconds + jitter) * 1000;
  }

  /* --------------------------------------------------------------------- */
  /* Login                                                                 */
  /* --------------------------------------------------------------------- */

  /** Pull the account snapshot; a session the API rejects fails the cycle. */
  async login() {
    const state = await this.get("/state");
    if (!state?.profile) throw new Error("Failed to load account");
    this.user_data = state;
    return this.user_data;
  }

  /** Log the current account state. */
  async logUserInfo() {
    const state = this.user_data || {};
    const balances = state.balances || {};
    const keys = balances.keys || {};

    this.logger.newline();

    // `logCurrentUser` reads the Telegram identity out of init data and throws
    // when there is none. A session can be perfectly healthy while the webapp
    // payload is missing, and the whole cycle must not die on a log line.
    if (this.getTelegramUser()) {
      this.logCurrentUser();
    } else {
      this.logger.keyValue(
        "User",
        `(no telegram identity) (${state.profile?.tgId ?? "?"})`,
      );
    }

    this.logger.keyValue("Gold", balances.gold ?? 0);
    this.logger.keyValue("Gram", balances.gramNano ?? 0);
    this.logger.keyValue("Gems", balances.gems ?? 0);
    this.logger.keyValue(
      "Tickets",
      `${balances.tickets ?? 0} tickets, ${balances.slotTokens ?? 0} slots, ${balances.spins ?? 0} spins`,
    );

    const heldKeys = Object.entries(keys)
      .filter(([, count]) => Number(count) > 0)
      .map(([kind, count]) => `${kind} ×${count}`)
      .join(", ");
    this.logger.keyValue("Keys", heldKeys || "none");

    const mines = Array.isArray(state.mines) ? state.mines : [];
    const pending = mines.reduce((sum, mine) => sum + (Number(mine.pending) || 0), 0);
    this.logger.keyValue(
      "Mines",
      `${mines.length} · production ${state.production ?? 0} · pending ${pending}`,
    );

    const dig = state.dig || {};
    const dugCount = this.dugCells(dig).length;
    const digTickets = Number(dig.tickets) || 0;
    this.logger.keyValue(
      "Dig",
      `${dugCount} cells dug · ${digTickets} ticket${digTickets === 1 ? "" : "s"}${dig.done ? " · done" : ""}`,
    );
    this.logger.keyValue(
      "Slots",
      `${balances.slotTokens ?? 0} tokens · ${balances.spins ?? 0} spins`,
    );

    this.logger.keyValue("Rank", state.rank ?? "?");

    this.logger.newline();
  }

  /* --------------------------------------------------------------------- */
  /* Cycle helpers                                                         */
  /* --------------------------------------------------------------------- */

  /**
   * Run one step of the cycle and keep going when it fails.
   *
   * `BaseFarmer.executeTask` logs and rethrows, so a single 429 from any one
   * endpoint would otherwise end the account's whole run — the streak read
   * used to do exactly that on Rignite and cost the account its collect. One
   * failing action is worth far less than the rest of the cycle.
   */
  async runTask(name, callback) {
    try {
      return await this.executeTask(name, callback);
    } catch (error) {
      this.logger.warn(`Task failed: ${name} — ${this.describeError(error)}`);
      return null;
    }
  }

  /**
   * The claim: sweep the gold every mine has accrued.
   *
   * Mines produce on a cycle (`yieldPerCycle`) and the gold sits in `pending`
   * until this call — an account that never calls it accrues nothing it can
   * spend, which is why a mine with nothing pending is never asked twice.
   */
  async collectMinedGold() {
    const mines = Array.isArray(this.user_data?.mines) ? this.user_data.mines : [];
    const waiting = mines.filter((mine) => (Number(mine.pending) || 0) > 0);

    if (waiting.length === 0) {
      this.logger.info("No mined gold waiting to be collected.");
      return null;
    }

    try {
      const result = await this.post("/mines/collect");
      const delta = this.applyAndReport(result);
      const collected =
        Number(result?.collected ?? result?.gold ?? result?.total) || 0;
      this.logger.success(
        `Collected mined gold from ${waiting.length} mine(s)${collected ? `: +${collected}` : ""}${delta}.`,
      );
      return result;
    } catch (error) {
      this.logger.warn("Mined gold collection failed:", this.readError(error));
      return null;
    }
  }

  /**
   * Spend every key on a box. Each box opens into a new mine, so keys are the
   * fleet's production growth — holding them changes nothing.
   *
   * `pay: "key"` is load-bearing. `/box/open` takes `{ box, pay }` and **bills
   * GRAM when `pay` is absent**, so the previous `{ box }` call answered
   * `no_gram` for every wooden key the account owned and no key was ever spent.
   * The mini-app's own chooser is `balances.keys[box] > 0 ? openBox(box,
   * "key") : shop`, so a held key is always the intended payment — the shop
   * (`/shop/buy`, GRAM) is deliberately not a path this farmer takes.
   */
  async openBoxes() {
    if (!this.config.boxes) return null;

    for (const box of BOX_KINDS) {
      let left = Number(this.user_data?.balances?.keys?.[box]) || 0;

      while (left > 0 && !this.signal?.aborted) {
        try {
          const result = await this.post("/box/open", { box, pay: "key" });
          const delta = this.applyAndReport(result);
          if (delta) this.logger.success(`Opened a ${box} box${delta}`);
        } catch (error) {
          this.logger.warn(`Box open (${box}) failed:`, this.readError(error));
          break;
        }

        const after = Number(this.user_data?.balances?.keys?.[box]) || 0;
        // If the balance never moved the server is not spending keys, so stop
        // rather than spin on the same request for the rest of the cycle.
        if (after >= left) break;
        left = after;
        await this.pace();
      }
    }
  }

  /**
   * Whether the account has actually put this mine in a slot.
   *
   * Only a non-negative integer index counts. A box reports its new mine with
   * `slot: null`, so anything else — `-1`, a string, a field that moved — has
   * to read as unplaced too, or the mine sits outside every slot and produces
   * nothing while the farmer believes it is done.
   */
  isSlotted(mine) {
    if (mine?.slot === null || mine?.slot === undefined) return false;
    const slot = Number(mine.slot);
    return Number.isInteger(slot) && slot >= 0;
  }

  /**
   * Give every slotless mine a slot. A box mints its mine with `slot: null`,
   * and a mine outside a slot produces nothing — so this is what turns an
   * opened box into actual production. The captured flow is exactly this:
   * `POST /mines/slot {id, slot}` into the lowest free slot.
   *
   * The search stops at `SLOT_CAPACITY`: a sixth slot cannot exist, so asking
   * for it is a call that can only fail — and it would fail on every cycle.
   *
   * Strategy: always fill slots with the highest-yield mines. Sort orphaned
   * mines by yieldPerCycle (descending) and place the best ones first. If
   * all 6 slots fill up, the lowest-yield mine(s) stay unplaced.
   */
  async placeUnassignedMines() {
    const mines = Array.isArray(this.user_data?.mines) ? this.user_data.mines : [];
    const taken = new Set(
      mines.filter((mine) => this.isSlotted(mine)).map((mine) => Number(mine.slot)),
    );
    // Get all unassigned mines, sort by yieldPerCycle (best first)
    const orphaned = mines
      .filter((mine) => !this.isSlotted(mine))
      .sort((a, b) => Number(b.yieldPerCycle || 0) - Number(a.yieldPerCycle || 0));

    // If we have more orphaned mines than free slots, the lowest-yield ones
    // will remain unplaced after we fill all 6 slots.
    const freeSlots = SLOT_CAPACITY - taken.size;
    if (freeSlots <= 0) {
      if (orphaned.length > 0) {
        this.logger.info(
          `All ${SLOT_CAPACITY} mine slots are full — ${orphaned.length} mine(s) left unplaced (lowest yield).`,
        );
      } else {
        this.logger.info("All mines are already in slots.");
      }
      return;
    }

    this.logger.info(
      `Placing ${Math.min(orphaned.length, freeSlots)} of ${orphaned.length} orphaned mine(s) into ${freeSlots} free slot(s) (best yield first).`,
    );

    let placed = 0;
    for (const mine of orphaned) {
      if (this.signal?.aborted) break;
      if (placed >= freeSlots) break;

      let slot = 0;
      while (slot < SLOT_CAPACITY && taken.has(slot)) slot++;

      try {
        const result = await this.post("/mines/slot", { id: mine.id, slot });
        this.applyState(result);
        taken.add(slot);
        placed++;
        this.logger.success(
          `Placed ${mine.mineId || mine.id} (yield ${mine.yieldPerCycle}/cycle) in slot ${slot}.`,
        );
      } catch (error) {
        this.logger.warn(`Placing mine ${mine.id} failed:`, this.readError(error));
        break;
      }
    }
  }

  /** Claim every daily objective that is complete but unclaimed. */
  async claimDailyObjectives() {
    if (!this.config.daily) return null;

    const daily = Array.isArray(this.user_data?.daily) ? this.user_data.daily : [];

    for (const entry of daily) {
      if (this.signal?.aborted) break;
      if (entry?.claimed) continue;

      const need = Number(entry.need) || 0;
      const progress = Number(entry.progress) || 0;
      if (need > 0 && progress < need) continue;

      try {
        const result = await this.post("/daily/claim", { id: entry.id });
        const delta = this.applyAndReport(result);
        this.logger.success(`Daily objective "${entry.id}" claimed${delta}.`);
      } catch (error) {
        this.logger.info(
          `Daily objective "${entry.id}" not claimable: ${this.readError(error)}`,
        );
      }
    }
  }

  /** Claim the daily login bonus while the streak says it is claimable. */
  async claimBonus() {
    if (this.user_data?.streak?.claimable !== true) {
      this.logger.info("Daily bonus already claimed.");
      return null;
    }

    try {
      const result = await this.post("/bonus/claim");
      const delta = this.applyAndReport(result);
      const reward = result?.reward || {};
      const detail = Object.entries(reward)
        .filter(([, value]) => Number(value) > 0)
        .map(([kind, value]) => `${value} ${kind}`)
        .join(", ");
      this.logger.success(`Daily bonus claimed${detail ? `: ${detail}` : ""}${delta}.`);
      return result;
    } catch (error) {
      this.logger.info(`Daily bonus not claimable: ${this.readError(error)}`);
      return null;
    }
  }

  /** Take the ladder's free step once its cooldown has elapsed. */
  async claimLadder() {
    const ladder = this.user_data?.ladder;
    if (!ladder) return null;

    if (!this.isReady(ladder.freeReadyAt)) {
      this.logger.info("Ladder free step not ready yet.");
      return null;
    }

    try {
      const result = await this.post("/ladder/claim");
      const delta = this.applyAndReport(result);
      this.logger.success(
        `Ladder step claimed → step ${result?.step ?? "?"}${delta}.`,
      );
      return result;
    } catch (error) {
      this.logger.info(`Ladder step not claimable: ${this.readError(error)}`);
      return null;
    }
  }

  /** Spin the wheel while it still holds free spins today. */
  async spinWheel() {
    const wheel = this.user_data?.wheel || {};
    const free = (Number(wheel.freeToday) || 0) + (Number(wheel.spins) || 0);

    if (free <= 0) {
      this.logger.info("No free wheel spins left today.");
      return null;
    }

    try {
      const result = await this.post("/wheel/spin");
      const delta = this.applyAndReport(result);
      const prize = result?.prize || {};
      const gold = Number(result?.gold) || 0;
      this.logger.success(
        `Wheel spun (sector ${result?.sector ?? "?"})${gold ? `: +${gold} gold` : prize.kind ? `: ${prize.kind}` : ""}${delta}.`,
      );
      return result;
    } catch (error) {
      this.logger.info(`Wheel spin refused: ${this.readError(error)}`);
      return null;
    }
  }

  /**
   * Open the chest once its own cooldown has elapsed.
   *
   * The gate is `meta.chest.readyAt`. This once read `balances.tickets`, which
   * is the dig's currency — so any account that had spent its dig tickets
   * silently skipped the chest, and the 4h chest is free gems and slot tokens.
   */
  async claimChest() {
    const chest = this.user_data?.meta?.chest || {};

    if (!this.isReady(chest.readyAt)) {
      this.logger.info("Chest still on cooldown.");
      return null;
    }

    try {
      const result = await this.post("/chest/claim");
      const delta = this.applyAndReport(result);
      const reward = result?.reward || {};
      const detail = Object.entries(reward)
        .filter(([, value]) => Number(value) > 0)
        .map(([kind, value]) => `${value} ${kind}`)
        .join(", ");
      this.logger.success(`Chest opened${detail ? `: ${detail}` : ""}${delta}.`);
      return result;
    } catch (error) {
      this.logger.info(`Chest not openable: ${this.readError(error)}`);
      return null;
    }
  }

  /** Spins left across the slot currencies the balance exposes. */
  slotSpinsLeft() {
    const balances = this.user_data?.balances || {};
    const wheel = this.user_data?.wheel || {};
    return (
      (Number(balances.slotTokens) || 0) +
      (Number(balances.spins) || 0) +
      (Number(wheel.spins) || 0)
    );
  }

  /**
   * Spend every slot token, not just one.
   *
   * Tokens are the free-play currency and the capture shows six to ten spins in
   * a session, so a single spin per cycle leaves the rest unspent. The loop
   * stops the moment the server does not deduct one, so a stale field cannot
   * spin forever.
   */
  async spinSlots() {
    let left = this.slotSpinsLeft();
    if (left <= 0) {
      this.logger.info("No slot spins available.");
      return null;
    }

    let last = null;

    while (left > 0 && !this.signal?.aborted) {
      try {
        const result = await this.post("/slots/spin");
        const delta = this.applyAndReport(result);
        last = result;
        const prize = result?.prize || {};
        this.logger.success(
          `Slots spun: ${result?.reels?.join(" | ") || "?"}${prize.kind ? ` → ${prize.kind}` : ""}${delta}.`,
        );
      } catch (error) {
        this.logger.info(`Slot spin refused: ${this.readError(error)}`);
        break;
      }

      const after = this.slotSpinsLeft();
      if (after >= left) break;
      left = after;
      await this.pace();
    }

    return last;
  }

  /**
   * Cell indices the board already holds, read from the `opened` map.
   *
   * `dig.opened` is an **object keyed by cell index**
   * (`{"0": {kind:"rock"}, "12": {...}}`), not a count. `Number()` of it is
   * `NaN`, so the old code fell back to cell `0` and the API answered `opened`
   * on every single cycle — the board never advanced.
   */
  dugCells(dig = this.user_data?.dig || {}) {
    const opened = dig.opened;
    if (!opened || typeof opened !== "object") return [];

    return Object.keys(opened)
      .map((cell) => Number(cell))
      .filter((cell) => Number.isFinite(cell));
  }

  /**
   * A cell index the board has not dug yet, or `null` when the grid is full.
   *
   * Bounded by `DIG_CELLS`: without the bound a fully dug board happily asked
   * for cell 25, which does not exist.
   */
  nextDigCell(dig) {
    const dug = new Set(this.dugCells(dig));
    const free = [];

    for (let cell = 0; cell < DIG_CELLS; cell++) {
      if (!dug.has(cell)) free.push(cell);
    }

    if (free.length === 0) return null;

    return this.config.digStrategy === "random"
      ? free[Math.floor(Math.random() * free.length)]
      : free[0];
  }

  /** Dig the next unopened cell while the board and its own tickets allow it. */
  async digCells() {
    if (!this.config.dig) return null;

    const dig = this.user_data?.dig || {};

    if (dig.done === true) {
      this.logger.info("Dig board finished for today.");
      return null;
    }

    // The dig keeps its own daily allowance in `dig.tickets`; `balances.tickets`
    // pays for chests and says nothing about the board. An absent field is read
    // as unknown rather than empty, so schema drift costs one refused call
    // instead of silently never digging again.
    const tickets = dig.tickets === undefined ? null : Number(dig.tickets) || 0;
    if (tickets !== null && tickets <= 0) {
      this.logger.info("Dig has no tickets left.");
      return null;
    }

    let dug = 0;
    let lastResult = null;

    // Use all available tickets
    while (true) {
      if (this.signal?.aborted) break;

      const digState = this.user_data?.dig || {};
      if (digState.done === true) {
        this.logger.info("Dig board finished for today.");
        break;
      }

      const currentTickets = digState.tickets === undefined ? null : Number(digState.tickets) || 0;
      if (currentTickets !== null && currentTickets <= 0) {
        this.logger.info("Dig has no tickets left.");
        break;
      }

      const cell = this.nextDigCell(digState);
      if (cell === null) {
        this.logger.info("Every cell on the board is already dug.");
        break;
      }

      try {
        const result = await this.post("/dig/open", { cell });
        this.applyState(result);
        const loot = result?.loot || {};
        this.logger.success(`Dug cell ${result?.cell ?? cell}: ${loot.kind || "loot"}.`);
        lastResult = result;
        dug++;
      } catch (error) {
        this.logger.info(`Dig refused: ${this.readError(error)}`);
        break;
      }

      // Small pace between digs
      await this.pace();
    }

    if (dug > 0) {
      this.logger.success(`Dug ${dug} cell(s) this cycle.`);
    }

    return lastResult;
  }

  /** Verify every task that is ready, unfinished, and actually ours to finish. */
  async checkTasks() {
    if (!this.config.tasks) return null;

    const tasks = Array.isArray(this.user_data?.tasks) ? this.user_data.tasks : [];

    for (const task of tasks) {
      if (this.signal?.aborted) break;
      if (task?.done) continue;
      if (task?.ready !== true) continue;
      if (!SELF_SERVE_TASKS.has(task.id)) continue;

      try {
        const result = await this.post("/tasks/check", { id: task.id });
        this.applyState(result);
        this.logger.success(`Task "${task.id}" verified.`);
      } catch (error) {
        this.logger.info(
          `Task "${task.id}" not verifiable: ${this.readError(error)}`,
        );
      }
    }
  }

  /* --------------------------------------------------------------------- */
  /* Free-play extras                                                      */
  /* --------------------------------------------------------------------- */

  /** Claim any ready achievements (boxes, gems, league, etc.). */
  async claimAchievements() {
    if (!this.config.achievements) return null;

    const achievements = this.user_data?.achievements?.achievements;
    if (!Array.isArray(achievements)) return null;

    for (const ach of achievements) {
      if (this.signal?.aborted) break;
      if (ach?.claimed) continue;
      if (!ach?.claimable) continue;

      try {
        const result = await this.post("/achievements/claim", { id: ach.id });
        const delta = this.applyAndReport(result);
        const reward = result?.reward || {};
        const detail = Object.entries(reward)
          .filter(([, value]) => Number(value) > 0)
          .map(([kind, value]) => `${value} ${kind}`)
          .join(", ");
        this.logger.success(`Achievement "${ach.id}" claimed: ${detail}${delta}.`);
      } catch (error) {
        this.logger.info(`Achievement "${ach.id}" not claimable: ${this.readError(error)}`);
      }
    }
  }

  /** Acknowledge the intro so the game stops treating the account as new. */
  async acknowledgeSeen() {
    if (!this.config.seen) return null;

    const seen = Array.isArray(this.user_data?.seen) ? this.user_data.seen : [];
    if (seen.includes("intro")) {
      this.logger.info("Intro already acknowledged.");
      return null;
    }

    try {
      const result = await this.post("/seen", { key: "intro" });
      this.applyState(result);
      this.logger.success("Acknowledged the intro.");
      return result;
    } catch (error) {
      this.logger.warn("Acknowledging the intro failed:", this.readError(error));
      return null;
    }
  }

  /**
   * Claim every mission whose target is met.
   *
   * The missions *bonus* has a flag in state (`bonusClaimable`) but its
   * endpoint was never captured, so it is deliberately not claimed here.
   */
  async claimMissions() {
    if (!this.config.missions) return null;

    const missions = this.user_data?.meta?.missions?.missions;
    if (!Array.isArray(missions)) return null;

    for (const mission of missions) {
      if (this.signal?.aborted) break;
      if (mission?.claimed) continue;

      const target = Number(mission.target) || 0;
      const progress = Number(mission.progress) || 0;
      if (target > 0 && progress < target) continue;

      try {
        const result = await this.post("/missions/claim", { id: mission.id });
        const delta = this.applyAndReport(result);
        this.logger.success(`Mission "${mission.id}" claimed${delta}.`);
      } catch (error) {
        this.logger.info(
          `Mission "${mission.id}" not claimable: ${this.readError(error)}`,
        );
      }
    }
  }

  /** Play scratch cards until the balance stops moving. */
  async playScratchCards() {
    if (!this.config.scratch) return null;

    let left = Number(this.user_data?.balances?.scratchCards) || 0;
    if (left <= 0) {
      this.logger.info("No scratch cards to play.");
      return null;
    }

    let last = null;

    while (left > 0 && !this.signal?.aborted) {
      try {
        const result = await this.post("/scratch/play");
        const delta = this.applyAndReport(result);
        last = result;
        this.logger.success(
          `Scratched a card: ${result?.win ? "a win" : "no win"}${delta}.`,
        );
      } catch (error) {
        this.logger.info(`Scratch play refused: ${this.readError(error)}`);
        break;
      }

      const after = Number(this.user_data?.balances?.scratchCards) || 0;
      // Stop when the server did not spend a card, or a stale field loops.
      if (after >= left) break;
      left = after;
      await this.pace();
    }

    return last;
  }

  /**
   * Nudge the daily objectives the client is expected to report itself.
   *
   * `shop` is the captured one: opening the shop bumps it. `share` looks like
   * the same idea but was never captured, so it is left alone rather than
   * guessed at — an unverified call is exactly what the rules forbid.
   */
  async bumpDailyObjectives() {
    if (!this.config.daily) return null;

    const daily = Array.isArray(this.user_data?.daily) ? this.user_data.daily : [];
    const shop = daily.find((entry) => entry?.id === "shop");

    if (!shop || shop.claimed) return null;

    const need = Number(shop.need) || 0;
    const progress = Number(shop.progress) || 0;
    if (need > 0 && progress >= need) return null;

    try {
      const result = await this.post("/daily/bump", { id: "shop" });
      this.applyState(result);
      this.logger.success('Daily objective "shop" bumped.');
      return result;
    } catch (error) {
      this.logger.info(`Daily bump refused: ${this.readError(error)}`);
      return null;
    }
  }

  /**
   * Start the timer on the channel task.
   *
   * The check is server-side verified (~3.5s), so the account has to have
   * actually joined. Joining is `Runner`'s job through the Telegram client;
   * this only starts the countdown, and a later cycle checks it once `ready`.
   */
  async openTasks() {
    if (!this.config.tasks) return null;

    const tasks = Array.isArray(this.user_data?.tasks) ? this.user_data.tasks : [];
    const channel = tasks.find((task) => task?.id === CHANNEL_TASK);

    if (!channel || channel.done || channel.ready) return null;
    // A running countdown must not be restarted — that only pushes the check
    // further away on every cycle.
    if (Number(channel.openedAt) > 0) return null;

    try {
      const result = await this.post("/tasks/open", { id: CHANNEL_TASK });
      this.applyState(result);
      this.logger.success(`Opened task "${CHANNEL_TASK}" — its timer is running.`);
      return result;
    } catch (error) {
      this.logger.info(
        `Opening task "${CHANNEL_TASK}" refused: ${this.readError(error)}`,
      );
      return null;
    }
  }

  /* --------------------------------------------------------------------- */
  /* Process                                                               */
  /* --------------------------------------------------------------------- */

  /**
   * Names of the actions whose gates are open right now.
   *
   * Mirrors `process()` one-to-one, decided from the same state the actions
   * themselves read, so a dry run shows exactly what a live run would attempt
   * instead of a rough paraphrase of it.
   */
  planActions() {
    const state = this.user_data || {};
    const balances = state.balances || {};
    const mines = Array.isArray(state.mines) ? state.mines : [];
    const daily = Array.isArray(state.daily) ? state.daily : [];
    const tasks = Array.isArray(state.tasks) ? state.tasks : [];
    const missions = state.meta?.missions?.missions;
    const plan = [];

    const complete = (entry, have, want) =>
      !entry?.claimed &&
      ((Number(want) || 0) === 0 || (Number(have) || 0) >= (Number(want) || 0));

    if (
      this.canJoinTelegramLink() &&
      !this.constructor.startedBots.has(this.getStartKey())
    ) {
      plan.push("Start Bot");
    }

    if (!(state.seen || []).includes("intro")) plan.push("Intro");
    if (mines.some((mine) => (Number(mine?.pending) || 0) > 0)) {
      plan.push("Collect");
    }
    if (
      this.config.boxes &&
      BOX_KINDS.some((kind) => (Number(balances.keys?.[kind]) || 0) > 0)
    ) {
      plan.push("Open Boxes");
    }
    if (mines.some((mine) => !this.isSlotted(mine))) plan.push("Place Mines");

    const shop = daily.find((entry) => entry?.id === "shop");
    if (
      this.config.daily &&
      shop &&
      !shop.claimed &&
      (Number(shop.progress) || 0) < (Number(shop.need) || 0)
    ) {
      plan.push("Daily Bump");
    }
    if (
      this.config.daily &&
      daily.some((entry) => complete(entry, entry?.progress, entry?.need))
    ) {
      plan.push("Daily Objectives");
    }
    if (state.streak?.claimable === true) plan.push("Daily Bonus");
    if (state.ladder && this.isReady(state.ladder.freeReadyAt)) {
      plan.push("Ladder");
    }
    if (
      (Number(state.wheel?.freeToday) || 0) + (Number(state.wheel?.spins) || 0) > 0
    ) {
      plan.push("Wheel");
    }
    if (this.isReady(state.meta?.chest?.readyAt)) plan.push("Chest");
    if (this.slotSpinsLeft() > 0) plan.push("Slots");
    if ((Number(balances.scratchCards) || 0) > 0) plan.push("Scratch");

    if (this.config.dig) {
      const dig = state.dig || {};
      const tickets =
        dig.tickets === undefined ? null : Number(dig.tickets) || 0;
      if (
        dig.done !== true &&
        (tickets === null || tickets > 0) &&
        this.nextDigCell(dig) !== null
      ) {
        plan.push("Dig");
      }
    }

    if (
      this.config.missions &&
      Array.isArray(missions) &&
      missions.some((mission) =>
        complete(mission, mission?.progress, mission?.target),
      )
    ) {
      plan.push("Missions");
    }

    const channel = tasks.find((task) => task?.id === CHANNEL_TASK);
    if (
      this.config.tasks &&
      channel &&
      !channel.done &&
      !channel.ready &&
      !(Number(channel.openedAt) > 0)
    ) {
      plan.push("Open Tasks");
    }
    if (
      this.config.tasks &&
      tasks.some(
        (task) =>
          !task?.done && task?.ready === true && SELF_SERVE_TASKS.has(task.id),
      )
    ) {
      plan.push("Tasks");
    }

    return plan;
  }

  /**
   * Drop the inter-task delays `BaseFarmer.executeTask` adds: accounts are
   * already staggered by Runner.js, so ten 5-second buffers inside one cycle
   * only push the fleet past its cron window.
   */
  async executeTask(task, callback, allowInQuickRun = true) {
    this.currentTaskStartedAt = new Date();
    this.currentTask = task;

    this.logger.newline();

    if (this.signal?.aborted) {
      this.logger.warn(`✖ Task aborted: ${task}`);
      return;
    }

    if (this.quickRun && !allowInQuickRun) {
      this.logger.log(`⚡ Skipping in quick run: ${task}`);
      return;
    }

    try {
      this.logger.log(`⚙ Executing task: ${task}`);
      const result = await callback();
      this.logger.log(`✔ Completed task: ${task}`);
      await this.pace();
      return result;
    } catch (error) {
      this.logger.log(`✖ Error executing task: ${task}\n   ${error.message}`);
      throw error;
    }
  }

  /* --------------------------------------------------------------------- */
  /* Bot start                                                             */
  /* --------------------------------------------------------------------- */

  /**
   * Account identity for the once-per-account START guard, most reliable
   * first. The bot username is the last resort and would be shared by every
   * account, so it is only reached when the account is unknown entirely.
   */
  getStartKey() {
    return String(
      this.getUserId() ??
        this.user_data?.profile?.tgId ??
        this.getInitData() ??
        this.entity,
    );
  }

  /**
   * Press START for the bot, the way the chat's button does.
   *
   * Nothing in the API flow ever starts the bot: the farmer reaches the game
   * with an `initData` minted from the webview, so an account can farm forever
   * while its bot chat still shows the START button and the bot is never able
   * to message it. `Api.messages.StartBot` is exactly what pressing START
   * sends, and going through the class link keeps `startParam` on it — the
   * link parses to `{ entity: "EasyCoinFarBot", startParam: "g31m4894" }`.
   *
   * `shouldWaitForReply: false` skips the reply wait the chat flow pays for,
   * matching how the extension starts its own bot in `useTelegramUser`.
   */
  async startOwnBot() {
    const link = this.constructor.telegramLink;

    if (!this.canJoinTelegramLink(link)) {
      this.logger.info("No Telegram client — cannot press START for the bot.");
      return false;
    }

    const key = this.getStartKey();
    if (this.constructor.startedBots.has(key)) {
      this.logger.info("Bot already started this run.");
      return false;
    }

    try {
      await this.client.startBotFromLink({
        link,
        startOptions: { shouldWaitForReply: false },
      });
      this.constructor.startedBots.add(key);
      this.logger.success("Pressed START for the bot.");
      return true;
    } catch (error) {
      this.logger.warn("Starting the bot failed:", error.message);
      return false;
    }
  }

  async process() {
    const session = await this.runTask("Login", () => this.login());
    if (!session) {
      this.logger.warn("Login failed — skipping cycle.");
      return;
    }

    await this.logUserInfo();

    if (this.config.dryRun) {
      const plan = this.planActions();
      this.logger.info(`Dry run: ${plan.length} action(s) planned, nothing sent.`);
      for (const name of plan) this.logger.info(`Would run: ${name}`);
      this.logger.info(
        `Next run: ${new Date(this.computeNextRunAt()).toISOString()}`,
      );
      return;
    }

    // After login, not before: the guard key identifies the account, and the
    // account's own state is what names it when init data is not to hand.
    await this.runTask("Start Bot", () => this.startOwnBot());

    await this.runTask("Intro", () => this.acknowledgeSeen());

    // The claim first: everything after it spends what it collects.
    await this.runTask("Collect", () => this.collectMinedGold());
    await this.runTask("Open Boxes", () => this.openBoxes());
    await this.runTask("Place Mines", () => this.placeUnassignedMines());
    // Bump before claiming, or the shop objective can never be complete.
    await this.runTask("Daily Bump", () => this.bumpDailyObjectives());
    await this.runTask("Daily Objectives", () => this.claimDailyObjectives());
    await this.runTask("Daily Bonus", () => this.claimBonus());
    await this.runTask("Ladder", () => this.claimLadder());
    await this.runTask("Wheel", () => this.spinWheel());
    await this.runTask("Chest", () => this.claimChest());
    await this.runTask("Slots", () => this.spinSlots());
    await this.runTask("Scratch", () => this.playScratchCards());
    await this.runTask("Dig", () => this.digCells());
    await this.runTask("Missions", () => this.claimMissions());
    await this.runTask("Achievements", () => this.claimAchievements());
    await this.runTask("Open Tasks", () => this.openTasks());
    await this.runTask("Tasks", () => this.checkTasks());

    this.logger.info(
      `Next run: ${new Date(this.computeNextRunAt()).toISOString()} (computed; Runner runs on cron).`,
    );
  }
}
