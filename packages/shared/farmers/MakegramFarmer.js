import BaseFarmer from "../lib/BaseFarmer.js";

/**
 * Makegram — mgrmga.org (season 2)
 *
 * Full farmer for https://api.mgrmga.org/s2/*
 * HAR: update.har (372, manual) + update2.har (212, NileCloud auto)
 * Auth: X-Init-Data (query_id + user + auth_date + signature + hash) + origin https://mgrmga.org
 * s2/state + s2/collect are base64-encoded JSON (Russian keys: баланс, склад, инструменты, вылазки, мойЛот, сезон)
 */

const API_URL = "https://api.mgrmga.org";
const HITS_PER_SHIFT = 300;
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

  getReferralLink() {
    return `https://t.me/MGRMGA_bot?start=ref${this.getUserId()}`;
  }

  fetchAuth() {
    return this.getInitData();
  }

  getAuthHeaders(data) {
    return data ? { "X-Init-Data": data } : {};
  }

  /* --------------------------------------------------------------------- */
  /* Transport                                                             */
  /* --------------------------------------------------------------------- */

  post(path, payload = {}) {
    return this.api.post(`${API_URL}/${path}`, payload).then((res) => res.data);
  }

  get(path, params = {}, config = {}) {
    return this.api.get(`${API_URL}/${path}`, { params, ...config }).then((res) => res.data);
  }

  getRef() {
    const startParam = String(this.getStartParam() || "");
    const digits = startParam.replace(/[^0-9]/g, "");
    return digits || "";
  }

  /* --------------------------------------------------------------------- */
  /* API wrappers — legacy api/game/*                                      */
  /* --------------------------------------------------------------------- */

  getState() {
    return this.post("api/game/state", { ref: this.getRef() });
  }

  tap(times, batch) {
    return this.post("api/game/tap", {
      times,
      offsets: times.map(() => 0),
      batch,
      dev: this.getDeviceId(),
    });
  }

  claim() {
    return this.post("api/game/claim", {});
  }

  raketa(state) {
    return this.post("api/game/raketa", { состояние: state });
  }

  getTop() {
    return this.post("api/game/top", {});
  }

  /* --------------------------------------------------------------------- */
  /* API wrappers — s2/* (mgrmga season 2, HAR-verified)                    */
  /* --------------------------------------------------------------------- */

  // Base64 decode for s2/state + s2/collect
  decodeS2Response(data) {
    // Some s2 endpoints return base64 string as `data` or `text`
    // If data is already an object with ok, return as-is. If it's a base64 string, decode.
    if (typeof data === "string") {
      try {
        const json = Buffer.from(data, "base64").toString("utf8");
        return JSON.parse(json);
      } catch (_) {
        return data;
      }
    }
    if (data && typeof data === "object" && typeof data.text === "string" && data.encoding === "base64") {
      try {
        return JSON.parse(Buffer.from(data.text, "base64").toString("utf8"));
      } catch (_) {
        return data;
      }
    }
    return data;
  }

  async getS2State() {
    try {
      const res = await this.api.get(`${API_URL}/s2/state`, { responseType: "text" }).then((r) => r.data);
      // Try base64 decode if response is base64 string
      if (typeof res === "string" && res.length > 100) {
        try {
          const decoded = JSON.parse(Buffer.from(res, "base64").toString("utf8"));
          if (decoded && decoded.ok !== undefined) return decoded;
        } catch (_) {}
      }
      if (res && res.ok !== undefined) return res;
      return res;
    } catch (e) {
      // Fallback to JSON parsing via post-like handling
      const data = e.response?.data;
      if (typeof data === "string") {
        try { return JSON.parse(Buffer.from(data, "base64").toString("utf8")); } catch (_) {}
      }
      throw e;
    }
  }

  async getS2Flag() {
    return this.post("s2/flag", {});
  }

  async getS2Contracts() {
    return this.post("s2/contracts", {});
  }

  async getS2Market(товар) {
    return this.api.get(`${API_URL}/s2/market`, { params: { товар } }).then((res) => res.data);
  }

  async sellMarket(товар, кол, цена) {
    return this.post("s2/market/sell", { товар, кол, цена });
  }

  async buyMarket(лот) {
    return this.post("s2/market/buy", { лот });
  }

  async cancelMarket(лот) {
    return this.post("s2/market/cancel", { лот });
  }

  async startExpedition(инструмент, часов, точка = "ближняя") {
    return this.post("s2/start", { инструмент: String(инструмент), часов, точка });
  }

  async collectExpedition(вылазка) {
    const res = await this.api.post(`${API_URL}/s2/collect`, { вылазка }, { responseType: "text" }).then((r) => r.data).catch((e) => { throw e; });
    if (typeof res === "string" && res.length > 50) {
      try { return JSON.parse(Buffer.from(res, "base64").toString("utf8")); } catch (_) { return res; }
    }
    return res;
  }

  async repairTool(предмет, hp) {
    return this.post("s2/repair", { предмет: String(предмет), hp });
  }

  async getS2Tasks() {
    return this.api.get(`${API_URL}/s2/tasks`).then((res) => res.data);
  }

  async openTask(код) {
    return this.post("s2/tasks/open", { код });
  }

  async claimTask(код) {
    return this.post("s2/tasks/claim", { код });
  }

  async openChest(повод = "новичок") {
    return this.post("s2/chest", { повод });
  }

  /* --------------------------------------------------------------------- */
  /* Auth                                                                  */
  /* --------------------------------------------------------------------- */

  async login() {
    this.user_data = await this.getState();
    if (!this.user_data?.ok) throw new Error(this.user_data?.msg || "Failed to load account");
    // Also warm s2 state for season-2 fields (balance, склад, инструменты)
    this.s2_state = await this.getS2State().catch(() => null);
    if (this.s2_state?.ok) {
      this.logger.info(`S2 balance: ${this.s2_state.баланс} | склад руда:${this.s2_state.склад?.руда} брёвна:${this.s2_state.склад?.брёвна} еда:${this.s2_state.склад?.еда}`);
    }
    return this.user_data;
  }

  /* --------------------------------------------------------------------- */
  /* Subscription                                                          */
  /* --------------------------------------------------------------------- */

  async ensureSubscribed() {
    const sub = this.user_data?.sub;
    const links = this.user_data?.subLinks || {};
    if (sub?.ok) { this.logger.info("Subscription satisfied."); return; }
    const candidates = [
      { link: links.channel, label: "channel" },
      { link: links.chat, label: "chat" },
    ];
    for (const { link, label } of candidates) {
      if (!link) continue;
      const tme = link.startsWith("@") ? `https://t.me/${link.slice(1)}` : link;
      if (this.validateTelegramTask(tme)) {
        const joined = await this.tryToJoinTelegramLink(tme);
        if (joined) this.logger.success(`Joined ${label}: ${link}`);
        else this.logger.warn(`Could not join ${label}: ${link}`);
      } else this.logger.warn(`No client to join ${label}: ${link}`);
    }
  }

  /* --------------------------------------------------------------------- */
  /* Tapping                                                               */
  /* --------------------------------------------------------------------- */

  getDeviceId() {
    if (!this.deviceId) {
      const alphabet = "abcdefghijklmnopqrstuvwxyz0123456789";
      let id = "";
      const rng = this.getUserRandomGenerator();
      for (let i = 0; i < 12; i++) id += alphabet[Math.floor(rng() * alphabet.length)];
      this.deviceId = id;
    }
    return this.deviceId;
  }

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
        this.logger.warn("Tap not credited:", error.response?.data?.error || error.message);
        return null;
      });
      if (!result?.ok) break;
      const credited = Number(result.credited) || 0;
      shiftHits += credited;
      this.debugger.log("Tap result:", result);
      if (result?.shift) { this.logger.success("Shift completed!"); break; }
      await this.utils.delayForSeconds(2 + Math.floor(this.getUserRandomGenerator()() * 3), { signal: this.signal });
      batchIndex++;
    }
    const gained = shiftHits - hits;
    this.logger.success(`Tapped ${gained} hit(s) (+${gained * perHit} coins) - ${shiftHits}/${shiftQuota} this shift.`);
    this.user_data = await this.getState().catch(() => this.user_data);
  }

  /* --------------------------------------------------------------------- */
  /* S2: Chest, Tasks, Collect, Repair, Start                            */
  /* --------------------------------------------------------------------- */

  async openChestIfNeeded() {
    const s2 = this.s2_state || await this.getS2State().catch(() => null);
    if (!s2?.ok) { this.logger.warn("S2 state unavailable for chest check."); return; }
    if (s2.игрок?.сундукОткрыт) { this.logger.info("Chest already opened."); return; }
    const res = await this.openChest("новичок").catch((e) => {
      if (e.response?.status === 400) { this.logger.info("Chest already claimed (400)."); return null; }
      this.logger.warn("Chest open failed:", e.response?.data?.error || e.message);
      return null;
    });
    if (res?.ok) this.logger.success("Opened novice chest!");
    this.s2_state = await this.getS2State().catch(() => this.s2_state);
  }

  async handleTasks() {
    const tasksRes = await this.getS2Tasks().catch((e) => {
      this.logger.warn("Get tasks failed:", e.response?.data?.error || e.message);
      return null;
    });
    if (!tasksRes?.ok || !Array.isArray(tasksRes.задачи)) {
      this.logger.info("No tasks available.");
      return;
    }
    for (const task of tasksRes.задачи) {
      if (this.signal?.aborted) break;
      // tasks have fields like код, done, claimed etc. (HAR: danjo-youtube, cryptogames_uz)
      const code = task.код || task.id || task.code;
      if (!code) continue;
      if (task.claimed || task.получен) continue;
      // Try to open if not open
      if (!task.opened && !task.открыт) {
        await this.openTask(code).catch(() => null);
        await this.utils.delayForSeconds(2, { signal: this.signal });
      }
      const claim = await this.claimTask(code).catch((e) => {
        // 400 = not ready or already claimed — soft fail
        this.logger.info(`Task ${code} claim: ${e.response?.status === 400 ? "not ready" : e.message}`);
        return null;
      });
      if (claim?.ok) this.logger.success(`Claimed task ${code}: +${claim.награда || "?"} reward`);
      await this.utils.delayForSeconds(2, { signal: this.signal });
    }
  }

  async collectExpeditions() {
    const s2 = this.s2_state || await this.getS2State().catch(() => null);
    if (!s2?.ok || !Array.isArray(s2.вылазки)) return;
    const ready = s2.вылазки.filter((v) => v.готово);
    if (ready.length === 0) { this.logger.info("No expeditions ready to collect."); return; }
    for (const exp of ready) {
      if (this.signal?.aborted) break;
      const res = await this.collectExpedition(exp.id).catch((e) => {
        this.logger.warn(`Collect ${exp.id} failed:`, e.response?.data?.error || e.message);
        return null;
      });
      if (res?.ok) {
        this.logger.success(`Collected ${exp.id}: ${res.ресурс} +${res.добыто} (еда bonus)`);
        this.s2_state = res.состояние || await this.getS2State().catch(() => this.s2_state);
      }
      await this.utils.delayForSeconds(2, { signal: this.signal });
    }
  }

  async repairTools() {
    const s2 = this.s2_state || await this.getS2State().catch(() => null);
    if (!s2?.ok || !Array.isArray(s2.инструменты)) return;
    for (const tool of s2.инструменты) {
      if (this.signal?.aborted) break;
      if (tool.hp >= 40) continue;
      // HAR: repair with hp = hp_макс - hp (e.g., 17 for 23→40, 4 for 36→40) update2.har:1668
      const need = (tool.hp_макс || 40) - tool.hp;
      if (need <= 0) continue;
      this.logger.info(`Repairing ${tool.тип} ${tool.id} hp ${tool.hp}→${tool.hp_макс} (need ${need})`);
      const res = await this.repairTool(tool.id, need).catch((e) => {
        this.logger.warn(`Repair ${tool.id} failed:`, e.response?.data?.error || e.message);
        return null;
      });
      if (res?.ok || res === null || res === undefined) {
        // 200 empty is success — refresh state to see new hp and склад扣除
        this.s2_state = await this.getS2State().catch(() => this.s2_state);
        // руда/брёвна consumed — log new склад
        if (this.s2_state?.склад) this.logger.info(`After repair склад руда:${this.s2_state.склад.руда} брёвна:${this.s2_state.склад.брёвна}`);
      }
      await this.utils.delayForSeconds(2, { signal: this.signal });
    }
  }

  async startExpeditions() {
    const s2 = this.s2_state || await this.getS2State().catch(() => null);
    if (!s2?.ok || !Array.isArray(s2.инструменты)) return;
    const idle = s2.инструменты.filter((t) => !t.занят_до || t.занят_до === 0 || t.занят_до < Date.now());
    if (idle.length === 0) { this.logger.info("All tools busy, skip start."); return; }
    // Check food for cost (еда 15→6 after start in update2.har) — ensure enough еда
    const food = Number(s2.склад?.еда || 0);
    if (food < 6) { this.logger.info(`Not enough food (${food}) to start expedition, skip.`); return; }
    for (const tool of idle) {
      if (this.signal?.aborted) break;
      if (tool.hp <= 5) { this.logger.info(`Skip start ${tool.id} low hp ${tool.hp}`); continue; }
      const res = await this.startExpedition(tool.id, 4, "ближняя").catch((e) => {
        if (e.response?.status === 400) { this.logger.info(`Start ${tool.id} busy (400), skip.`); return null; }
        this.logger.warn(`Start ${tool.id} failed:`, e.response?.data?.error || e.message);
        return null;
      });
      if (res?.ok !== false) {
        this.logger.success(`Started expedition with ${tool.тип} ${tool.id} 4ч ближняя`);
        this.s2_state = await this.getS2State().catch(() => this.s2_state);
      }
      await this.utils.delayForSeconds(3, { signal: this.signal });
      // Only start one per cycle to avoid duplicate 400 (HAR shows duplicate start 400)
      break;
    }
  }

  /* --------------------------------------------------------------------- */
  /* S2: Market — sell after repair, ore quarter 10% less, logs 3215 1-5, food skip, ≤10 pending */
  /* --------------------------------------------------------------------- */

  async handleMarket() {
    const s2 = this.s2_state || await this.getS2State().catch(() => null);
    if (!s2?.ok) return;
    const склад = s2.склад || {};
    let pending = Array.isArray(s2.мойЛот) ? s2.мойЛот.length : 0;
    if (pending >= 10) { this.logger.info(`Market: ${pending} pending sales (max 10), skip sell.`); return; }

    // Food never sold
    // Logs fixed 3215, 1-5 per order — HAR logs 3215 near lowestAsk 3214
    const logs = Number(склад.брёвна || 0);
    if (logs > 0 && pending < 10) {
      let remaining = logs;
      while (remaining > 0 && pending < 10 && !this.signal?.aborted) {
        const кол = Math.min(1 + Math.floor(Math.random() * 5), remaining); // 1-5
        const res = await this.sellMarket("брёвна", кол, 3215).catch((e) => {
          if (e.response?.status === 400) this.logger.info(`Sell logs ${кол}×3215 rejected (400 corridor).`);
          else this.logger.warn(`Sell logs failed:`, e.message);
          return null;
        });
        if (res?.ok) {
          this.logger.success(`Listed logs ${кол}×3215 (pending ${pending + 1}/10)`);
          pending++;
          this.s2_state = await this.getS2State().catch(() => this.s2_state);
          pending = Array.isArray(this.s2_state?.мойЛот) ? this.s2_state.мойЛот.length : pending;
        } else break; // stop on 400
        remaining -= кол;
        if (remaining <= 0) break;
        await this.utils.delayForSeconds(2, { signal: this.signal });
        // Only one batch of logs per cycle (avoid spamming 10 lots at once) — match HAR single sell per cycle
        break;
      }
    }

    // Ore: quarter of what we own at 10% less than median, batches of 5
    // Need market median to compute 10% less. Fetch market for руда to get коридор.
    const oreTotal = Number(склад.руда || 0);
    if (oreTotal > 0 && pending < 10) {
      let oreMarket = null;
      try { oreMarket = await this.getS2Market("руда"); } catch (_) {}
      const median = Number(oreMarket?.коридор?.медиана || 1400);
      const мин = Number(oreMarket?.коридор?.мин || 840);
      const макс = Number(oreMarket?.коридор?.макс || 1960);
      let price = Math.floor(median * 0.9); // 10% less
      price = Math.max(мин, Math.min(макс, price));
      // Ensure ≥ lowestAsk+4 if lots exist
      if (Array.isArray(oreMarket?.лоты) && oreMarket.лоты.length > 0) {
        const lowestAsk = Math.min(...oreMarket.лоты.map((l) => Number(l.цена) || Infinity));
        if (lowestAsk !== Infinity && price < lowestAsk + 4) price = lowestAsk + 4;
      }
      const quarter = Math.floor(oreTotal / 4);
      if (quarter > 0) {
        let remaining = quarter;
        while (remaining > 0 && pending < 10 && !this.signal?.aborted) {
          const кол = Math.min(5, remaining);
          const res = await this.sellMarket("руда", кол, price).catch((e) => {
            if (e.response?.status === 400) this.logger.info(`Sell ore ${кол}×${price} rejected (400).`);
            else this.logger.warn(`Sell ore failed:`, e.message);
            return null;
          });
          if (res?.ok) {
            this.logger.success(`Listed ore ${кол}×${price} (quarter ${quarter}/${oreTotal}, pending ${pending + 1}/10)`);
            pending++;
            this.s2_state = await this.getS2State().catch(() => this.s2_state);
            pending = Array.isArray(this.s2_state?.мойЛот) ? this.s2_state.мойЛот.length : pending;
          } else break;
          remaining -= кол;
          await this.utils.delayForSeconds(2, { signal: this.signal });
          break; // one batch per cycle
        }
      }
    }

    // Other goods (слитки, доски, пайки) — not specified, skip unless surplus
  }

  /* --------------------------------------------------------------------- */
  /* Process                                                               */
  /* --------------------------------------------------------------------- */

  async claimRewards() {
    const claimResult = await this.claim().catch((e) => {
      this.logger.warn("Claim failed:", e.response?.data?.error || e.message);
      return null;
    });
    if (claimResult?.ok) {
      const earned = Number(claimResult.начислено) || 0;
      if (earned > 0) this.logger.success(`Claimed ${earned} coins from mining reward.`);
      else this.logger.info(`Mining claim: ${claimResult.состояние?.причина || "not ready"}.`);
    }
    const rocketResult = await this.raketa(true).catch((e) => {
      this.logger.warn("Raketa failed:", e.response?.data?.error || e.message);
      return null;
    });
    if (rocketResult?.ok) {
      if (rocketResult.сделано) this.logger.success(`Raketa claimed! +${rocketResult.награда} coins.`);
      else if (rocketResult.получил) this.logger.info(`Raketa already claimed.`);
      else this.logger.info(`Raketa not claimable (need level ${rocketResult.уровеньЗа}).`);
    }
  }

  async process() {
    await this.login();
    await this.logUserInfo();
    await this.executeTask("Subscription", () => this.ensureSubscribed());
    await this.executeTask("Chest", () => this.openChestIfNeeded());
    await this.executeTask("Tasks", () => this.handleTasks());
    await this.executeTask("Collect", () => this.collectExpeditions());
    await this.executeTask("Repair", () => this.repairTools());
    await this.executeTask("Market", () => this.handleMarket());
    await this.executeTask("Expedition", () => this.startExpeditions());
    await this.executeTask("Claim", () => this.claimRewards());
    await this.executeTask("Tapping", () => this.tapUntilShiftDone());
  }

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
    if (task && task.ready && !task.claimed) this.logger.info("Hit task ready to claim (300 hits).");
    // S2 info if available
    if (this.s2_state?.ok) {
      this.logger.keyValue("S2 Balance", this.s2_state.баланс);
      this.logger.keyValue("S2 Cold", this.s2_state.холодные);
      this.logger.keyValue("Warehouse", `руда:${this.s2_state.склад?.руда} брёвна:${this.s2_state.склад?.брёвна} еда:${this.s2_state.склад?.еда}`);
      this.logger.keyValue("Tools", (this.s2_state.инструменты || []).map((t) => `${t.тип} ${t.hp}/${t.hp_макс}${t.занят_до ? " busy" : ""}`).join(", "));
      this.logger.keyValue("Pending Lots", `${(this.s2_state.мойЛот || []).length}/10`);
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
          { id: "tap", icon: "refresh", title: "Tap Now", action: this.tapUntilShiftDone.bind(this), dispatch: false },
        ],
      },
      {
        name: "Season 2",
        list: [
          { id: "chest", icon: "gift", title: "Open Chest", action: this.openChestIfNeeded.bind(this), dispatch: false },
          { id: "tasks", icon: "tasks", title: "Complete Tasks", action: this.handleTasks.bind(this), dispatch: false },
          { id: "collect", icon: "download", title: "Collect Expeditions", action: this.collectExpeditions.bind(this), dispatch: false },
          { id: "repair", icon: "wrench", title: "Repair Tools", action: this.repairTools.bind(this), dispatch: false },
          { id: "market", icon: "shop", title: "Market Sell", action: this.handleMarket.bind(this), dispatch: false },
          { id: "start", icon: "play", title: "Start Expedition", action: this.startExpeditions.bind(this), dispatch: false },
        ],
      },
    ];
  }
}
