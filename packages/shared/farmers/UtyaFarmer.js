import BaseFarmer from "../lib/BaseFarmer.js";

/**
 * Utya Faucet
 *
 * A TON egg-cracking faucet served from utyamaster.duckdns.org. Auth is the
 * Telegram init data sent in the request *body* (`{ initData }`), not a
 * header. Some responses come back base64-encoded, so every response is run
 * through a decoder that handles both plain and encoded JSON.
 *
 * A run ensures channel membership (@utyafaucet — required to crack eggs),
 * claims the daily streak, then cracks every available egg.
 */

const API_URL = "https://utyamaster.duckdns.org";

/** The channel the account must be a member of before cracking eggs. */
const REQUIRED_CHANNEL = "https://t.me/utyafaucet";

export default class UtyaFarmer extends BaseFarmer {
  static id = "utya";
  static title = "Utya";
  static emoji = "🦆";
  static host = "utyamaster.duckdns.org";
  static domains = ["utyamaster.duckdns.org"];
  static telegramLink = "https://t.me/utyafaucet_bot";
  static path = "/";
  static referrerMode = "random";
  static singleton = true;
  static rating = 5;
  static cacheAuth = false;
  static apiDelay = 400;
  static interval = "*/10 * * * *";

  /** Auth is carried in the body, so headers are empty. */
  fetchAuth() {
    return this.getInitData();
  }

  getAuthHeaders() {
    return {};
  }

  /* --------------------------------------------------------------------- */
  /* Referral                                                              */
  /* --------------------------------------------------------------------- */

  /**
   * Get Referral Link
   *
   * The faucet issues every account its own invite link and `/api/me` returns
   * it verbatim as `${telegramLink}?start=ref_<userId>` — checked against the
   * live API for five accounts — so the same link can be built without a
   * round trip. `Runner.updatePrimaryFarmerLink` calls this once per account
   * and logs a hard error for anything thrown, so it must always answer.
   */
  getReferralLink() {
    return `${this.telegramLink}?start=ref_${this.getUserId()}`;
  }

  /* --------------------------------------------------------------------- */
  /* Transport                                                             */
  /* --------------------------------------------------------------------- */

  post(path, payload = {}) {
    return this.api
      .post(`${API_URL}${path}`, { initData: this.getInitData(), ...payload }, {
        signal: this.signal,
      })
      .then((res) => this.parseBody(res.data));
  }

  get(path) {
    return this.api
      .get(`${API_URL}${path}`, { signal: this.signal })
      .then((res) => this.parseBody(res.data));
  }

  /** The server returns either plain JSON or base64-encoded JSON. */
  parseBody(data) {
    if (typeof data !== "string") return data;
    try {
      return JSON.parse(data);
    } catch {
      try {
        return JSON.parse(this.decodeBase64(data));
      } catch {
        return { raw: data };
      }
    }
  }

  decodeBase64(b64) {
    const binary = atob(b64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return new TextDecoder().decode(bytes);
  }

  readError(error) {
    return error?.response?.data?.error || error?.message || "Unknown error";
  }

  /* --------------------------------------------------------------------- */
  /* Login                                                                 */
  /* --------------------------------------------------------------------- */

  async login() {
    const result = await this.post("/api/me");
    if (!result?.ok) throw new Error("Login failed");
    this.user_data = result;
    return this.user_data;
  }

  /* --------------------------------------------------------------------- */
  /* Channel membership                                                    */
  /* --------------------------------------------------------------------- */

  /** Join @utyafaucet if possible, then recheck membership server-side. */
  async ensureMembership() {
    if (this.canJoinTelegramLink(REQUIRED_CHANNEL)) {
      await this.tryToJoinTelegramLink(REQUIRED_CHANNEL);
    }
    const check = await this.post("/api/membership/recheck");
    if (check?.channel) {
      this.logger.success("@utyafaucet membership confirmed.");
    } else {
      this.logger.warn("@utyafaucet membership not confirmed yet.");
    }
    return check;
  }

  /* --------------------------------------------------------------------- */
  /* Logging                                                               */
  /* --------------------------------------------------------------------- */

  async logUserInfo() {
    const u = this.user_data || {};
    const user = u.user || {};
    const egg = u.egg || {};
    const streak = u.streak || {};
    const level = u.level || {};

    this.logger.newline();
    this.logUserInfoBase();
    this.logger.keyValue("Accrued UTYA", u.accruedUnits ?? "0");
    this.logger.keyValue("Level", `${level.level ?? 1} (${(u.tier?.name) || "—"})`);
    this.logger.keyValue("Eggs Cracked", u.eggsCracked ?? 0);
    this.logger.keyValue(
      "Cracks Left",
      `${egg.cracksLeft ?? 0}/${egg.cracksPerDay ?? 0}`,
    );
    this.logger.keyValue(
      "Streak",
      streak.canClaim ? "Available" : `Day ${streak.count ?? 0} claimed`,
      { valueStyle: streak.canClaim ? this.logger.c.greenBright : undefined },
    );
    this.logger.newline();
  }

  /** BaseFarmer.logCurrentUser logs the Telegram user; wrap it for brevity. */
  logUserInfoBase() {
    this.logCurrentUser();
  }

  /* --------------------------------------------------------------------- */
  /* Streak                                                                */
  /* --------------------------------------------------------------------- */

  /** Claim the daily streak reward when available. */
  async claimStreak() {
    const streak = this.user_data?.streak;
    if (streak && streak.canClaim) {
      const result = await this.post("/api/streak/claim");
      if (result?.ok) {
        this.user_data = Object.assign(this.user_data, result);
        this.logger.success(
          `Streak claimed (day ${result.day ?? 1}): ${result.rewardType ?? "utya"} +${result.reward ?? "0"}`,
        );
      } else {
        this.logger.info("Streak not credited: " + (result?.error || "unknown"));
      }
    } else {
      this.logger.info("Daily streak already claimed.");
    }
  }

  /* --------------------------------------------------------------------- */
  /* Eggs                                                                  */
  /* --------------------------------------------------------------------- */

  /** Crack every available egg for today. */
  async crackEggs() {
    const egg = this.user_data?.egg || {};
    let left = Number(egg.cracksLeft) || 0;

    if (left <= 0) {
      this.logger.info("No egg cracks left today.");
      return;
    }

    while (left > 0) {
      if (this.signal?.aborted) break;
      const result = await this.post("/api/egg/crack", { count: 1 });
      if (result?.ok) {
        const hatched = result.hatched?.name ? ` — ${result.hatched.name}` : "";
        this.logger.success(`Egg cracked: +${result.reward ?? 0} UTYA${hatched}`);
        this.user_data = Object.assign(this.user_data, result);
        left -= 1;
      } else {
        this.logger.warn(
          "Egg crack failed:" + (result?.error || "unknown"),
        );
        break;
      }
    }

    if (left > 0) this.logger.info(`Eggs left: ${left}.`);
  }

  /* --------------------------------------------------------------------- */
  /* Quests                                                                */
  /* --------------------------------------------------------------------- */

  /** Claim every completed daily quest that hasn't been claimed yet. */
  async completeQuests() {
    const quests = this.user_data?.quests || [];
    const pending = quests.filter((q) => q.complete && !q.claimed);

    if (pending.length === 0) {
      this.logger.info("No claimable quests.");
      return;
    }

    this.logger.info(`Claimable quests: ${pending.length}.`);
    for (const q of pending) {
      if (this.signal?.aborted) break;
      try {
        const result = await this.post("/api/quest/claim", { questId: q.id });
        if (result?.ok) {
          q.claimed = true;
          this.logger.success(
            `Quest done: ${q.title} (+${result.rewardHuman ?? q.rewardHuman} ${result.rewardType ?? q.rewardType})`,
          );
        } else {
          this.logger.warn(
            `Quest not credited: ${q.title} — ${result?.error || "unknown"}`,
          );
        }
      } catch (error) {
        this.logger.warn(`Quest "${q.title}" failed:`, this.readError(error));
      }
    }
  }

  /* --------------------------------------------------------------------- */
  /* Process                                                               */
  /* --------------------------------------------------------------------- */

  async process() {
    await this.login();
    await this.logUserInfo();

    await this.executeTask("Channel Membership", () => this.ensureMembership());
    await this.executeTask("Streak", () => this.claimStreak());
    await this.executeTask("Eggs", () => this.crackEggs());
    await this.executeTask("Quests", () => this.completeQuests());
  }
}
