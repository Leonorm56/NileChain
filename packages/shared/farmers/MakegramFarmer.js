import BaseFarmer from "../lib/BaseFarmer.js";

/**
 * Makegram Season 2 — mgrmga.org/s2-2026
 *
 * Full farmer for https://api.mgrmga.org/s2/*
 * HAR: update.har (372), update2.har (212), ldjoeafklccnbigohkogkcelpkgaoaii.har (9)
 * Auth: X-Init-Data header (query_id + user + auth_date + signature + hash) + Origin https://mgrmga.org
 * State endpoint returns base64 or plain JSON (handled with tryDecode).
 *
 * API flow per cycle (HAR-verified):
 *   state → flag → contracts → [collect → repair → start → market] → flag → contracts → ...
 *
 * Key findings from HAR:
 *   - Webview: https://mgrmga.org/s2-2026/index.html
 *   - Start expedition costs 8 food (топливо: 8)
 *   - Contracts: 2/day limit, витрина (available) + мои (active)
 *   - Market corridors: ore (медиана:1400, мин:840, макс:1960), logs (медиана:4088, мин:2452, макс:5724)
 *   - flag = heartbeat ping (returns {ok, флаг, сетка: 16})
 *   - repair returns empty 200 (no body)
 *   - collect returns {ok, ресурс, добыто, состояние}
 *   - sell 400 = corridor/dump protection
 */

const API_URL = "https://api.mgrmga.org";
const START_FOOD_COST = 8;

export default class MakegramFarmer extends BaseFarmer {
  static id = "makegram";
  static title = "Makegram";
  static emoji = "⛏️";
  static host = "mgrmga.org";
  static domains = ["mgrmga.org", "api.mgrmga.org"];
  static telegramLink = "https://t.me/MGRMGA_bot?start=ref6627962056";
  static path = "/s2-2026/index.html";
  static referrerMode = "random";
  static singleton = true;
  static rating = 5;
  static cacheAuth = false;
  static interval = "*/10 * * * *";

  /* --------------------------------------------------------------------- */
  /* Auth                                                                  */
  /* --------------------------------------------------------------------- */

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
    return this.api.post(`${API_URL}/${path}`, payload).then((r) => r.data);
  }

  get(path, params = {}, config = {}) {
    return this.api
      .get(`${API_URL}/${path}`, { params, ...config })
      .then((r) => r.data);
  }

  /**
   * Try to decode base64-encoded JSON responses (common in s2 endpoints).
   */
  tryDecode(data) {
    if (!data) return data;
    if (typeof data === "object" && data.ok !== undefined) return data;
    if (typeof data === "string" && data.length > 50) {
      try {
        const decoded = JSON.parse(
          Buffer.from(data, "base64").toString("utf8"),
        );
        if (decoded && typeof decoded === "object") return decoded;
      } catch (_) {}
      try {
        return JSON.parse(data);
      } catch (_) {}
    }
    return data;
  }

  /** GET with automatic base64 decode for s2 endpoints */
  async apiGet(path, params = {}) {
    try {
      const res = await this.api
        .get(`${API_URL}/${path}`, { params, responseType: "text" })
        .then((r) => r.data);
      return this.tryDecode(res);
    } catch (e) {
      const body = e.response?.data
        ? JSON.stringify(e.response.data).slice(0, 400)
        : e.message;
      this.logger.warn(
        `${path} failed [${e.response?.status || "no-status"}]: ${body}`,
      );
      throw e;
    }
  }

  /** POST with automatic base64 decode for s2 endpoints */
  async apiPost(path, payload = {}) {
    try {
      const res = await this.api
        .post(`${API_URL}/${path}`, payload, { responseType: "text" })
        .then((r) => r.data);
      return this.tryDecode(res);
    } catch (e) {
      const body = e.response?.data
        ? JSON.stringify(e.response.data).slice(0, 300)
        : e.message;
      this.logger.warn(
        `${path} failed [${e.response?.status || "no-status"}]: ${body}`,
      );
      throw e;
    }
  }

  /* --------------------------------------------------------------------- */
  /* S2 API — HAR-verified endpoints                                        */
  /* --------------------------------------------------------------------- */

  async getState() {
    return this.apiGet("s2/state");
  }

  async flag() {
    return this.post("s2/flag", {});
  }

  async getContracts() {
    return this.post("s2/contracts", {});
  }

  async getMarket(товар) {
    return this.get("s2/market", { товар });
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
    return this.post("s2/start", {
      инструмент: String(инструмент),
      часов,
      точка,
    });
  }

  async collectExpedition(вылазка) {
    const res = await this.api
      .post(`${API_URL}/s2/collect`, { вылазка }, { responseType: "text" })
      .then((r) => r.data)
      .catch((e) => {
        throw e;
      });
    return this.tryDecode(res);
  }

  async repairTool(предмет, hp) {
    return this.post("s2/repair", { предмет: String(предмет), hp });
  }

  async getTasks() {
    return this.apiGet("s2/tasks");
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

  async getVillageGifts() {
    return this.get("s2/village/gifts");
  }

  /* --------------------------------------------------------------------- */
  /* Login — fetch state, flag, contracts                                  */
  /* --------------------------------------------------------------------- */

  async login() {
    // 1. Get state
    this.s2_state = await this.getState().catch((e) => {
      const status = e.response?.status || "no-status";
      this.logger.warn(`S2 state failed [${status}]`);
      if (status === 401 || status === 403)
        this.logger.warn("X-Init-Data expired — will refresh next run");
      return null;
    });
    if (!this.s2_state?.ok)
      throw new Error("S2 state failed — check X-Init-Data / proxy");

    // 2. Flag heartbeat (always called after state in HAR)
    await this.flag().catch(() => {});

    // 3. Contracts (always called after flag in HAR)
    this.s2_contracts = await this.getContracts().catch(() => null);

    this.user_data = { ok: true, coins: this.s2_state.баланс, ...this.s2_state };
    return this.user_data;
  }

  /* --------------------------------------------------------------------- */
  /* Chest                                                                 */
  /* --------------------------------------------------------------------- */

  async openChestIfNeeded() {
    const s2 = this.s2_state;
    if (!s2?.ok || s2.игрок?.сундукОткрыт) {
      this.logger.info("Chest: already opened or no state.");
      return;
    }
    for (let i = 0; i < 2; i++) {
      if (this.signal?.aborted) break;
      const res = await this.openChest("новичок").catch((e) => {
        if (e.response?.status === 400) {
          this.logger.info(`Chest ${i + 1}/2 already claimed (400).`);
          return { already: true };
        }
        this.logger.warn(
          "Chest open failed:",
          e.response?.data?.error || e.message,
        );
        return null;
      });
      if (res?.already) break;
      if (res?.ok) this.logger.success(`Opened chest ${i + 1}/2!`);
      else if (!res) break;
      await this.utils.delayForSeconds(1, { signal: this.signal });
    }
    this.s2_state = await this.getState().catch(() => this.s2_state);
    await this.flag().catch(() => {});
  }

  /* --------------------------------------------------------------------- */
  /* Tasks — open then claim with delay (HAR-verified flow)                */
  /* --------------------------------------------------------------------- */

  async handleTasks() {
    const tasksRes = await this.getTasks().catch((e) => {
      this.logger.warn(
        "Get tasks failed:",
        e.response?.data?.error || e.message,
      );
      return null;
    });
    if (!tasksRes?.ok || !Array.isArray(tasksRes.задачи)) {
      this.logger.info("No tasks available.");
      return;
    }
    for (const task of tasksRes.задачи) {
      if (this.signal?.aborted) break;
      const code = task.код || task.id || task.code;
      if (!code) continue;
      if (task.claimed || task.получен) continue;

      // Open first if not opened
      if (!task.opened && !task.открыт) {
        await this.openTask(code).catch(() => null);
        await this.utils.delayForSeconds(2, { signal: this.signal });
      }

      // Claim — if 400, wait and retry once (HAR: toxic_x got 400 then 200)
      const claim = await this.claimTask(code).catch((e) => {
        if (e.response?.status === 400) return { notReady: true };
        this.logger.warn(`Task ${code} claim error:`, e.message);
        return null;
      });
      if (claim?.notReady) {
        // Wait and retry once (some tasks need time after open)
        await this.utils.delayForSeconds(5, { signal: this.signal });
        const retry = await this.claimTask(code).catch(() => null);
        if (retry?.ok)
          this.logger.success(
            `Claimed task ${code}: +${retry.награда || "?"} reward`,
          );
      } else if (claim?.ok) {
        this.logger.success(
          `Claimed task ${code}: +${claim.награда || "?"} reward`,
        );
      }
      await this.utils.delayForSeconds(2, { signal: this.signal });
    }
  }

  /* --------------------------------------------------------------------- */
  /* Village Gifts                                                         */
  /* --------------------------------------------------------------------- */

  async handleVillageGifts() {
    const res = await this.getVillageGifts().catch((e) => {
      this.logger.warn(
        "Village gifts failed:",
        e.response?.data?.error || e.message,
      );
      return null;
    });
    if (!res?.ok) {
      this.logger.info("Village gifts: no data.");
      return;
    }
    const gifts = Array.isArray(res.подарки) ? res.подарки : [];
    if (gifts.length === 0) {
      this.logger.info("Village gifts: none pending.");
      return;
    }
    this.logger.info(
      `Village gifts: ${gifts.length} pending (min ${res.минимум}, limit ${res.лимитСуток})`,
    );
    for (const gift of gifts) {
      this.logger.info(`  Gift: ${JSON.stringify(gift).slice(0, 150)}`);
    }
  }

  /* --------------------------------------------------------------------- */
  /* Collect — gather finished expeditions                                 */
  /* --------------------------------------------------------------------- */

  async collectExpeditions() {
    const s2 = this.s2_state;
    if (!s2?.ok || !Array.isArray(s2.вылазки)) return;
    const ready = s2.вылазки.filter((v) => v.готово);
    if (ready.length === 0) {
      this.logger.info("No expeditions ready to collect.");
      return;
    }
    for (const exp of ready) {
      if (this.signal?.aborted) break;
      const res = await this.collectExpedition(exp.id).catch((e) => {
        this.logger.warn(
          `Collect ${exp.id} failed:`,
          e.response?.data?.error || e.message,
        );
        return null;
      });
      if (res?.ok) {
        this.logger.success(
          `Collected ${exp.id}: ${res.ресурс} +${res.добыто}`,
        );
        if (res.состояние?.ok) {
          this.s2_state = res.состояние;
          await this.flag().catch(() => {});
        } else {
          this.s2_state = await this.getState().catch(() => this.s2_state);
          await this.flag().catch(() => {});
        }
      }
      await this.utils.delayForSeconds(2, { signal: this.signal });
    }
  }

  /* --------------------------------------------------------------------- */
  /* Repair — fix tools below 40 hp (HAR: repair uses hp_макс - hp)       */
  /* --------------------------------------------------------------------- */

  async repairTools() {
    const s2 = this.s2_state;
    if (!s2?.ok || !Array.isArray(s2.инструменты)) return;
    for (const tool of s2.инструменты) {
      if (this.signal?.aborted) break;
      const need = (tool.hp_макс || 40) - tool.hp;
      if (need <= 0) continue;
      this.logger.info(
        `Repairing ${tool.тип} ${tool.id} hp ${tool.hp}→${tool.hp_макс} (need ${need})`,
      );
      await this.repairTool(tool.id, need).catch((e) => {
        this.logger.warn(
          `Repair ${tool.id} failed:`,
          e.response?.data?.error || e.message,
        );
      });
      // Refresh state after repair (resources consumed)
      this.s2_state = await this.getState().catch(() => this.s2_state);
      await this.flag().catch(() => {});
      const sklad = this.s2_state?.склад;
      if (sklad)
        this.logger.info(
          `After repair: руда:${sklad.руда} брёвна:${sklad.брёвна} еда:${sklad.еда}`,
        );
      await this.utils.delayForSeconds(2, { signal: this.signal });
    }
  }

  /* --------------------------------------------------------------------- */
  /* Start — send idle tools on expeditions (8 food each, 4h near)        */
  /* --------------------------------------------------------------------- */

  async startExpeditions() {
    const s2 = this.s2_state;
    if (!s2?.ok || !Array.isArray(s2.инструменты)) {
      this.logger.warn("Start: no state or tools, skip.");
      return;
    }

    const idle = s2.инструменты.filter(
      (t) =>
        !t.занят_до || t.занят_до === 0 || t.занят_до < Date.now(),
    );
    if (idle.length === 0) {
      this.logger.info("All tools busy, skip start.");
      return;
    }

    const food = Number(s2.склад?.еда || 0);
    this.logger.info(
      `Start check: ${idle.length} idle tools, food: ${food} (need ${START_FOOD_COST} each)`,
    );
    if (food < START_FOOD_COST) {
      this.logger.info(
        `Not enough food (${food}) to start (need ${START_FOOD_COST}), skip.`,
      );
      return;
    }

    for (const tool of idle) {
      if (this.signal?.aborted) break;
      if (tool.hp <= 2) {
        this.logger.info(`Skip start ${tool.id}: hp too low (${tool.hp})`);
        continue;
      }

      // Re-check food before each start
      const curFood = Number(this.s2_state?.склад?.еда ?? 0);
      if (curFood < START_FOOD_COST) {
        this.logger.info(
          `Not enough food (${curFood}) for next tool, stop.`,
        );
        break;
      }

      this.logger.info(
        `Starting ${tool.тип} ${tool.id} (hp ${tool.hp}/${tool.hp_макс}, food ${curFood})...`,
      );
      const res = await this.startExpedition(tool.id, 4, "ближняя").catch(
        (e) => {
          if (e.response?.status === 400) {
            this.logger.info(`Start ${tool.id} busy (400)`);
            return null;
          }
          this.logger.warn(`Start ${tool.id} failed:`, e.message);
          return null;
        },
      );

      if (res?.ok !== false && res !== null) {
        const fuel = res?.топливо || START_FOOD_COST;
        this.logger.success(
          `Started ${tool.тип} ${tool.id} 4h (fuel: ${fuel})`,
        );
        // Update state
        if (res.состояние?.ok) {
          this.s2_state = res.состояние;
        } else {
          this.s2_state = await this.getState().catch(() => this.s2_state);
        }
        await this.flag().catch(() => {});
      }
      await this.utils.delayForSeconds(3, { signal: this.signal });
    }
  }

  /* --------------------------------------------------------------------- */
  /* Market — tiered sell logic per sellLOGIC.txt                          */
  /*
   * Ore:  1×1950, 2×(1850–1900), 3×(1700–1800)
   * Logs: 1×2100, 2×(1990–2000), 3×(1850–1890)
   * Food: 1×3800, 2×3500, 3×3000  (accounts with bow ONLY)
   * Total 6 orders per cycle (3 ore + 3 logs), or fewer.
   * Skip selling entirely if any pending orders remain.
   */

  /** Check if account has a bow tool (food only sold with bows) */
  hasBow() {
    const tools = this.s2_state?.инструменты || [];
    return tools.some(
      (t) => t.тип === "лук" || t.тип?.toLowerCase()?.includes("bow"),
    );
  }

  /** Random integer in [min, max] inclusive */
  randInt(min, max) {
    return Math.floor(Math.random() * (max - min + 1)) + min;
  }

  /**
   * Sell a single item at a fixed price.
   * Returns true if the lot was placed, false otherwise.
   */
  async sellOne(товар, кол, цена, pendingRef) {
    if (pendingRef.value >= 10) {
      this.logger.info("Market: 10 pending lots (max), stop selling.");
      return false;
    }
    const res = await this.sellMarket(товар, кол, цена).catch((e) => {
      if (e.response?.status === 400) {
        this.logger.info(`Sell ${товар} ${кол}×${цена} rejected (400 corridor).`);
      } else {
        this.logger.warn(`Sell ${товар} ${кол}×${цена} failed:`, e.message);
      }
      return null;
    });
    if (res?.ok) {
      this.logger.success(`Listed ${товар} ${кол}×${цена}`);
      pendingRef.value++;
      // Refresh state to get updated lot count
      this.s2_state = await this.getState().catch(() => this.s2_state);
      await this.flag().catch(() => {});
      pendingRef.value = Array.isArray(this.s2_state?.мойЛот)
        ? this.s2_state.мойЛот.length
        : pendingRef.value;
      return true;
    }
    return false;
  }

  /**
   * Execute up to 3 sell orders for a resource (max 3 per resource).
   * tiers: [{ minPrice, maxPrice, label }, ...]
   */
  async sellTiered(товар, have, tiers, pendingRef) {
    if (have <= 0) {
      this.logger.info(`Market: no ${товар} to sell.`);
      return;
    }
    let placed = 0;
    for (const tier of tiers) {
      if (this.signal?.aborted) break;
      if (pendingRef.value >= 10) break;
      if (placed >= 3) break;
      const цена = this.randInt(tier.minPrice, tier.maxPrice);
      this.logger.info(
        `Selling ${товар} 1×${цена} (${tier.label || "tier"})`,
      );
      const ok = await this.sellOne(товар, 1, цена, pendingRef);
      if (ok) placed++;
      await this.utils.delayForSeconds(2, { signal: this.signal });
    }
    this.logger.info(`Market: ${товар} — placed ${placed}/3 orders.`);
  }

  async handleMarket() {
    const s2 = this.s2_state;
    if (!s2?.ok) {
      this.logger.warn("Market: no state, skip.");
      return;
    }

    const склад = s2.склад || {};
    let pending = Array.isArray(s2.мойЛот) ? s2.мойЛот.length : 0;
    this.logger.info(
      `Market: руда:${склад.руда || 0} брёвна:${склад.брёвна || 0} еда:${склад.еда || 0} | lots ${pending}/10`,
    );
    if (pending >= 10) {
      this.logger.info("Market: 10 pending lots (max), skip.");
      return;
    }

    const pendingRef = { value: pending };

    // --- ORE: up to 3 orders (1 each) ---
    const ore = Number(склад.руда || 0);
    if (ore > 0) {
      await this.sellTiered("руда", ore, [
        { minPrice: 1950, maxPrice: 1950, label: "tier 1: 1950" },
        { minPrice: 1850, maxPrice: 1900, label: "tier 2: 1850–1900" },
        { minPrice: 1700, maxPrice: 1800, label: "tier 3: 1700–1800" },
      ], pendingRef);
    } else {
      this.logger.info("Market: no ore to sell.");
    }

    // --- LOGS: up to 3 orders (1 each) ---
    const logs = Number(склад.брёвна || 0);
    if (logs > 0 && pendingRef.value < 10) {
      await this.sellTiered("брёвна", logs, [
        { minPrice: 2100, maxPrice: 2100, label: "tier 1: 2100" },
        { minPrice: 1990, maxPrice: 2000, label: "tier 2: 1990–2000" },
        { minPrice: 1850, maxPrice: 1890, label: "tier 3: 1850–1890" },
      ], pendingRef);
    } else if (logs === 0) {
      this.logger.info("Market: no logs to sell.");
    }

    // --- FOOD: up to 3 orders (1 each, bow accounts ONLY) ---
    if (pendingRef.value < 10 && this.hasBow()) {
      const food = Number(склад.еда || 0);
      if (food > 0) {
        await this.sellTiered("еда", food, [
          { minPrice: 3800, maxPrice: 3800, label: "tier 1: 3800" },
          { minPrice: 3500, maxPrice: 3500, label: "tier 2: 3500" },
          { minPrice: 3000, maxPrice: 3000, label: "tier 3: 3000" },
        ], pendingRef);
      } else {
        this.logger.info("Market: no food to sell.");
      }
    } else if (!this.hasBow()) {
      this.logger.info("Market: no bow — food not sold.");
    }
  }

  /* --------------------------------------------------------------------- */
  /* Contracts — accept available ones (2/day limit)                       */
  /* --------------------------------------------------------------------- */

  async handleContracts() {
    const contracts = this.s2_contracts;
    if (!contracts?.ok) {
      this.logger.info("Contracts: no data.");
      return;
    }

    const available = contracts.витрина || [];
    const active = contracts.мои || [];
    const takenToday = contracts.взятоЗаСутки || 0;
    const dailyLimit = contracts.вСутки || 2;

    this.logger.info(
      `Contracts: ${active.length} active, ${takenToday}/${dailyLimit} taken today, ${available.length} available`,
    );

    if (active.length > 0) {
      this.logger.info(
        `Active contracts: ${active.map((c) => `${c.товар}×${c.кол} (${c.ступень})`).join(", ")}`,
      );
    }

    // Complete active contracts that have enough warehouse
    for (const c of active) {
      if (this.signal?.aborted) break;
      const склад = this.s2_state?.склад || this.s2_state?.состояние?.склад || {};
      const have = Number(склад[c.товар] || 0);
      if (have >= c.кол) {
        this.logger.info(`Completing contract: ${c.товар}×${c.кол}...`);
        const res = await this.post("s2/contracts/hand", {
          контракт: c.номер,
        }).catch((e) => {
          this.logger.warn(`Contract complete failed:`, e.message);
          return null;
        });
        if (res?.ok) {
          this.logger.success(`Completed contract ${c.номер}: +${c.награда} reward`);
          this.s2_state = await this.getState().catch(() => this.s2_state);
          await this.flag().catch(() => {});
          this.s2_contracts = await this.getContracts().catch(() => null);
        }
        await this.utils.delayForSeconds(2, { signal: this.signal });
      }
    }

    if (takenToday >= dailyLimit) {
      this.logger.info("Contracts: daily limit reached, skip.");
      return;
    }

    if (available.length === 0) {
      this.logger.info("Contracts: none available.");
      return;
    }

    // Accept best value contract (highest reward per hour, if we have resources)
    const склад = this.s2_state?.склад || {};
    const sorted = available
      .map((c) => ({
        ...c,
        valuePerHour: c.награда / c.часов,
      }))
      .sort((a, b) => b.valuePerHour - a.valuePerHour);

    for (const contract of sorted) {
      if (this.signal?.aborted) break;
      if (takenToday >= dailyLimit) break;

      const have = Number(склад[contract.товар] || 0);
      if (have < contract.кол) {
        this.logger.info(
          `Contract ${contract.номер}: ${contract.товар}×${contract.кол} — need ${contract.кол - have} more (have ${have}), skip.`,
        );
        continue;
      }

      this.logger.info(
        `Accepting contract ${contract.номер}: ${contract.товар}×${contract.кол} for ${contract.награда} (${contract.ступень}, ${contract.valuePerHour.toFixed(0)}/h)...`,
      );
      const res = await this.post("s2/contracts/take", {
        номер: contract.номер,
      }).catch((e) => {
        if (e.response?.status === 400)
          this.logger.info(`Contract ${contract.номер} accept rejected (400).`);
        else
          this.logger.warn(
            `Contract accept failed:`,
            e.response?.data?.error || e.message,
          );
        return null;
      });

      if (res?.ok) {
        this.logger.success(
          `Accepted contract ${contract.номер}: ${contract.товар}×${contract.кол} → ${contract.награда}`,
        );
        this.s2_state = await this.getState().catch(() => this.s2_state);
        await this.flag().catch(() => {});
        this.s2_contracts = await this.getContracts().catch(() => null);
      }
      await this.utils.delayForSeconds(2, { signal: this.signal });
    }
  }

  /* --------------------------------------------------------------------- */
  /* Cancel old/stale market lots                                          */
  /* --------------------------------------------------------------------- */

  async cancelStaleLots() {
    const s2 = this.s2_state;
    if (!s2?.ok || !Array.isArray(s2.мойЛот)) return;
    const staleThreshold = Date.now() - 3600_000; // older than 1 hour
    const stale = s2.мойЛот.filter((lot) => lot.created < staleThreshold);
    if (stale.length === 0) return;

    this.logger.info(`Cancelling ${stale.length} stale market lots...`);
    for (const lot of stale) {
      if (this.signal?.aborted) break;
      await this.cancelMarket(lot.id).catch(() => {});
      await this.utils.delayForSeconds(1, { signal: this.signal });
    }
    this.s2_state = await this.getState().catch(() => this.s2_state);
    await this.flag().catch(() => {});
  }

  /* --------------------------------------------------------------------- */
  /* Process — main farming loop                                          */
  /* --------------------------------------------------------------------- */

  async process() {
    // 1. Login (state + flag + contracts)
    await this.login();
    await this.logUserInfo();

    // 2. Chest
    await this.executeTask("Chest", () => this.openChestIfNeeded());

    // 3. Tasks
    await this.executeTask("Tasks", () => this.handleTasks());

    // 4. Village Gifts
    await this.executeTask("Village Gifts", () => this.handleVillageGifts());

    // 5. Contracts
    await this.executeTask("Contracts", () => this.handleContracts());

    // 6. Collect finished expeditions
    await this.executeTask("Collect", () => this.collectExpeditions());

    // 7. Repair damaged tools
    await this.executeTask("Repair", () => this.repairTools());

    // 8. Market — sell resources
    await this.executeTask("Market", () => this.handleMarket());

    // 9. Cancel stale lots
    await this.executeTask("Cancel Lots", () => this.cancelStaleLots());

    // 10. Start new expeditions (must be last — needs food/resources)
    await this.executeTask("Start Expedition", () => this.startExpeditions());

    // 11. Final flag + contracts refresh
    await this.flag().catch(() => {});
    this.s2_contracts = await this.getContracts().catch(() => null);
  }

  /* --------------------------------------------------------------------- */
  /* Logging                                                               */
  /* --------------------------------------------------------------------- */

  async logUserInfo() {
    this.logger.newline();
    this.logCurrentUser();
    if (this.s2_state?.ok) {
      const s = this.s2_state;
      this.logger.keyValue("Balance", `${s.баланс} (cold: ${s.холодные})`);
      this.logger.keyValue(
        "Warehouse",
        `ore:${s.склад?.руда || 0} logs:${s.склад?.брёвна || 0} food:${s.склад?.еда || 0}`,
      );
      this.logger.keyValue(
        "Tools",
        (s.инструменты || [])
          .map(
            (t) =>
              `${t.тип} ${t.id} hp:${t.hp}/${t.hp_макс}${t.занят_до ? ` busy→${new Date(t.занят_до).toLocaleTimeString()}` : " idle"}`,
          )
          .join(", "),
      );
      this.logger.keyValue(
        "Expeditions",
        (s.вылазки || []).length > 0
          ? (s.вылазки || [])
              .map(
                (v) =>
                  `${v.зона}/${v.точка} tool:${v.инструмент} ${v.часов}h ${v.готово ? "READY" : `${Math.ceil((v.осталось || 0) / 3600000)}h left`}`,
              )
              .join(", ")
          : "none",
      );
      this.logger.keyValue(
        "Market Lots",
        `${(s.мойЛот || []).length}/10`,
      );
      this.logger.keyValue(
        "Season",
        `${s.сезон?.эмодзи || ""} ${s.сезон?.имя || "?"} day ${s.сезон?.деньСезона || "?"}/${s.сезон?.дней || "?"}`,
      );
      if (this.s2_contracts?.ok) {
        this.logger.keyValue(
          "Contracts",
          `${(this.s2_contracts.мои || []).length} active, ${(this.s2_contracts.взятоЗаСутки || 0)}/${this.s2_contracts.вСутки || 2} today`,
        );
      }
    } else {
      this.logger.keyValue("Balance", this.user_data?.coins ?? "—");
    }
    this.logger.newline();
  }

  /* --------------------------------------------------------------------- */
  /* Tools                                                                 */
  /* --------------------------------------------------------------------- */

  createTools() {
    const baseList = [
      {
        id: "chest",
        icon: "gift",
        title: "Open Chest",
        action: this.openChestIfNeeded.bind(this),
        dispatch: false,
      },
      {
        id: "tasks",
        icon: "tasks",
        title: "Complete Tasks",
        action: this.handleTasks.bind(this),
        dispatch: false,
      },
      {
        id: "village",
        icon: "village",
        title: "Village Gifts",
        action: this.handleVillageGifts.bind(this),
        dispatch: false,
      },
      {
        id: "contracts",
        icon: "tasks",
        title: "Accept Contracts",
        action: this.handleContracts.bind(this),
        dispatch: false,
      },
      {
        id: "collect",
        icon: "download",
        title: "Collect Expeditions",
        action: this.collectExpeditions.bind(this),
        dispatch: false,
      },
      {
        id: "repair",
        icon: "wrench",
        title: "Repair Tools",
        action: this.repairTools.bind(this),
        dispatch: false,
      },
      {
        id: "market",
        icon: "shop",
        title: "Market Sell",
        action: this.handleMarket.bind(this),
        dispatch: false,
      },
      {
        id: "start",
        icon: "play",
        title: "Start Expedition",
        action: this.startExpeditions.bind(this),
        dispatch: false,
      },
    ];

    // Per-tool start buttons for idle tools
    const tools = this.s2_state?.инструменты || [];
    const perTool = tools
      .filter(
        (t) =>
          !t.занят_до || t.занят_до === 0 || t.занят_до < Date.now(),
      )
      .slice(0, 4)
      .map((tool) => ({
        id: `start-${tool.id}`,
        icon: "play",
        title: `Start ${tool.тип} ${tool.id} (hp ${tool.hp}/${tool.hp_макс})`,
        action: async () => {
          const res = await this.startExpedition(tool.id, 4, "ближняя").catch(
            (e) => {
              if (e.response?.status === 400)
                this.logger.info(`Start ${tool.id} busy (400)`);
              else this.logger.warn(`Start ${tool.id} failed:`, e.message);
              return null;
            },
          );
          if (res?.ok !== false && res !== null)
            this.logger.success(`Started ${tool.тип} ${tool.id}`);
        },
        dispatch: false,
      }));

    if (perTool.length > 0) {
      return [
        { name: "Season 2", list: baseList },
        { name: "Tools — Start & Claim", list: perTool },
      ];
    }
    return [{ name: "Season 2", list: baseList }];
  }
}
