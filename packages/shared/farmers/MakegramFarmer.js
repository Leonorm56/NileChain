import BaseFarmer from "../lib/BaseFarmer.js";

/**
 * Makegram Season 2 — mgrmga.org/s2-2026
 *
 * Full farmer for https://api.mgrmga.org/s2/*
 * Auth: X-Init-Data header + Origin https://mgrmga.org
 *
 * API flow per cycle:
 *   state → flag → [chest → tasks → village → collect → repair → market → start] → flag
 *
 * Key findings from HAR:
 *   - Webview: https://mgrmga.org/s2-2026/index.html
 *   - Start expedition costs 8 food
 *   - flag = heartbeat ping
 *   - repair returns empty 200
 *   - collect returns {ok, ресурс, добыто, состояние}
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
  /* S2 API endpoints                                                      */
  /* --------------------------------------------------------------------- */

  async getState() {
    return this.apiGet("s2/state");
  }

  async flag() {
    return this.post("s2/flag", {});
  }

  async getMarket(item) {
    return this.get("s2/market", { товар: item });
  }

  async sellMarket(item, qty, price) {
    return this.post("s2/market/sell", { товар: item, кол: qty, цена: price });
  }

  async buyMarket(lot) {
    return this.post("s2/market/buy", { лот: lot });
  }

  async startExpedition(tool, hours, point = "ближняя") {
    return this.post("s2/start", {
      инструмент: String(tool),
      часов: hours,
      точка: point,
    });
  }

  async collectExpedition(expedition) {
    const res = await this.api
      .post(`${API_URL}/s2/collect`, { вылазка: expedition }, { responseType: "text" })
      .then((r) => r.data)
      .catch((e) => {
        throw e;
      });
    return this.tryDecode(res);
  }

  async repairTool(item, hp) {
    return this.post("s2/repair", { предмет: String(item), hp });
  }

  async getTasks() {
    return this.apiGet("s2/tasks");
  }

  async openTask(code) {
    return this.post("s2/tasks/open", { код: code });
  }

  async claimTask(code) {
    return this.post("s2/tasks/claim", { код: code });
  }

  async openChest(reason = "новичок") {
    return this.post("s2/chest", { повод: reason });
  }

  async getVillageGifts() {
    return this.get("s2/village/gifts");
  }

  /* --------------------------------------------------------------------- */
  /* Login — fetch state + flag                                            */
  /* --------------------------------------------------------------------- */

  async login() {
    this.s2_state = await this.getState().catch((e) => {
      const status = e.response?.status || "no-status";
      this.logger.warn(`S2 state failed [${status}]`);
      if (status === 401 || status === 403)
        this.logger.warn("X-Init-Data expired — will refresh next run");
      return null;
    });
    if (!this.s2_state?.ok)
      throw new Error("S2 state failed — check X-Init-Data / proxy");

    await this.flag().catch(() => {});

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
      await this.utils.delayForSeconds(0.5, { signal: this.signal });
    }
    this.s2_state = await this.getState().catch(() => this.s2_state);
    await this.flag().catch(() => {});
  }

  /* --------------------------------------------------------------------- */
  /* Tasks                                                                 */
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

      if (!task.opened && !task.открыт) {
        await this.openTask(code).catch(() => null);
        await this.utils.delayForSeconds(1, { signal: this.signal });
      }

      const claim = await this.claimTask(code).catch((e) => {
        if (e.response?.status === 400) return { notReady: true };
        this.logger.warn(`Task ${code} claim error:`, e.message);
        return null;
      });
      if (claim?.notReady) {
        await this.utils.delayForSeconds(2, { signal: this.signal });
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
      await this.utils.delayForSeconds(1, { signal: this.signal });
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
      await this.utils.delayForSeconds(1, { signal: this.signal });
    }
  }

  /* --------------------------------------------------------------------- */
  /* MINAZUKI — smart repair: buy materials if needed, then repair        */
  /*                                                                       */
  /* Runs after Collect. Tries repair, if missing materials → buys from    */
  /* market (multiple cheapest lots), then retries. Max 100k spend total.  */
  /* --------------------------------------------------------------------- */

  /**
   * Buy cheapest lots of an item from market, trying multiple slots.
   * Returns { spent, bought }.
   */
  async buyCheapestLots(item, needed, maxSpend, label) {
    let spent = 0;
    let bought = 0;
    const maxAttempts = 10;

    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      if (this.signal?.aborted) break;
      if (bought >= needed) break;
      if (spent >= maxSpend) {
        this.logger.info(`${label}: reached ${maxSpend} coin spend limit.`);
        break;
      }

      // Fetch fresh market each time
      const market = await this.getMarket(item).catch((e) => {
        this.logger.warn(`${label}: market fetch ${item} failed:`, e.message);
        return null;
      });
      if (!market?.ok || !Array.isArray(market.лоты)) break;

      // Cheapest lots first, skip own
      const lots = market.лоты
        .filter((l) => !l.свой)
        .sort((a, b) => a.цена - b.цена);

      if (lots.length === 0) break;

      // Try up to 10 cheapest lots per fetch
      let boughtThisRound = false;
      for (const lot of lots.slice(0, 10)) {
        if (bought >= needed) break;
        if (spent >= maxSpend) break;

        const lotCost = lot.цена * lot.кол;
        if (spent + lotCost > maxSpend) {
          this.logger.info(`${label}: lot ${lot.id} costs ${lotCost} (would exceed limit), skip.`);
          continue;
        }

        this.logger.info(
          `${label}: buying lot ${lot.id} — ${lot.кол} × ${lot.цена} = ${lotCost} (from ${lot.ник})`,
        );
        const res = await this.buyMarket(lot.id).catch((e) => {
          this.logger.warn(`${label}: buy lot ${lot.id} failed:`, e.message);
          return null;
        });
        if (res?.ok) {
          bought += lot.кол;
          spent += lotCost;
          boughtThisRound = true;
          this.logger.success(`${label}: bought ${lot.кол} ${item} (+${lot.кол}, total: ${bought}/${needed})`);
          if (res.состояние?.ok) this.s2_state = res.состояние;
          else this.s2_state = await this.getState().catch(() => this.s2_state);
          await this.flag().catch(() => {});
        }
        await this.utils.delayForSeconds(0.5, { signal: this.signal });
      }

      // If no lot was successfully bought this round, stop
      if (!boughtThisRound) break;
      await this.utils.delayForSeconds(0.5, { signal: this.signal });
    }

    return { spent, bought };
  }

  /** Parse repair cost from error response "цена" field */
  parseRepairCost(errorResponse) {
    if (!errorResponse) return null;
    // Try direct error response
    const cost = errorResponse.цена || errorResponse.price;
    if (cost && typeof cost === "object") return cost;
    return null;
  }

  async minazuki() {
    const s2 = this.s2_state;
    if (!s2?.ok || !Array.isArray(s2.инструменты)) {
      this.logger.info("MINAZUKI: no state or tools, skip.");
      return;
    }

    const MAX_HEAL_SPEND = 100000;
    let totalSpent = 0;
    let repaired = 0;
    const wh = s2.склад || {};

    this.logger.info(
      `MINAZUKI: ore:${wh.руда || 0} logs:${wh.брёвна || 0} food:${wh.еда || 0}`,
    );

    for (const tool of s2.инструменты) {
      if (this.signal?.aborted) break;
      if (totalSpent >= MAX_HEAL_SPEND) {
        this.logger.info(`MINAZUKI: reached ${MAX_HEAL_SPEND} coin limit, stop.`);
        break;
      }

      const hpMax = tool.hp_макс || 40;
      const need = hpMax - tool.hp;
      if (need <= 0) {
        this.logger.info(`MINAZUKI: ${tool.тип} ${tool.id} hp ${tool.hp}/${hpMax} — full, skip.`);
        continue;
      }

      this.logger.info(
        `MINAZUKI: repairing ${tool.тип} ${tool.id} hp ${tool.hp}→${hpMax} (need ${need} hp)...`,
      );

      // Try repair
      let res = await this.repairTool(tool.id, need).catch((e) => {
        // Return error data so we can parse it
        const errData = e.response?.data || {};
        return { ok: false, error: e.message, _raw: errData };
      });

      if (res?.ok) {
        this.logger.success(`MINAZUKI: ${tool.тип} ${tool.id} repaired! (+${need} hp)`);
        if (res.состояние?.ok) this.s2_state = res.состояние;
        else this.s2_state = await this.getState().catch(() => this.s2_state);
        await this.flag().catch(() => {});
        repaired++;
        await this.utils.delayForSeconds(1, { signal: this.signal });
        continue;
      }

      // Check if it's a "not enough materials" error
      const errorStr = res?.error || res?._raw?.error || "";
      const costData = this.parseRepairCost(res?._raw || res);

      if (!costData) {
        // Unknown error (e.g. "выше максимума")
        this.logger.info(`MINAZUKI: ${tool.тип} ${tool.id} — ${errorStr || "unknown error"}, skip.`);
        await this.utils.delayForSeconds(0.5, { signal: this.signal });
        continue;
      }

      // We have cost data — need to buy materials
      this.logger.info(
        `MINAZUKI: ${tool.тип} ${tool.id} needs materials: ${JSON.stringify(costData)}`,
      );

      // Check what we have vs what we need
      const s2Now = this.s2_state || s2;
      const whNow = s2Now.склад || {};
      const budgetLeft = MAX_HEAL_SPEND - totalSpent;

      // Buy each missing material
      for (const [mat, qty] of Object.entries(costData)) {
        if (this.signal?.aborted) break;
        if (totalSpent >= MAX_HEAL_SPEND) break;

        const have = Number(whNow[mat] || 0);
        if (have >= qty) {
          this.logger.info(`MINAZUKI: ${mat} have ${have} >= need ${qty} ✓`);
          continue;
        }

        const deficit = qty - have;
        const perItemBudget = Math.floor((budgetLeft - totalSpent) / 2); // split remaining budget
        this.logger.info(`MINAZUKI: buying ${deficit} ${mat} (have ${have}, need ${qty})`);

        const { spent: matSpent, bought: matBought } = await this.buyCheapestLots(
          mat,
          deficit,
          perItemBudget,
          `MINAZUKI ${mat}`,
        );
        totalSpent += matSpent;

        if (matBought < deficit) {
          this.logger.warn(
            `MINAZUKI: could only buy ${matBought}/${deficit} ${mat} (spent ${matSpent})`,
          );
        }
      }

      // Retry repair after buying materials
      this.logger.info(`MINAZUKI: retrying repair ${tool.тип} ${tool.id}...`);
      res = await this.repairTool(tool.id, need).catch((e) => {
        return { ok: false, error: e.response?.data?.error || e.message };
      });

      if (res?.ok) {
        this.logger.success(`MINAZUKI: ${tool.тип} ${tool.id} repaired after buying materials!`);
        if (res.состояние?.ok) this.s2_state = res.состояние;
        else this.s2_state = await this.getState().catch(() => this.s2_state);
        await this.flag().catch(() => {});
        repaired++;
      } else {
        this.logger.warn(
          `MINAZUKI: ${tool.тип} ${tool.id} repair still failed: ${res?.error || "unknown"}`,
        );
      }
      await this.utils.delayForSeconds(1, { signal: this.signal });
    }

    this.logger.info(
      `MINAZUKI done: ${repaired} repaired, spent ${totalSpent}/${MAX_HEAL_SPEND} coins`,
    );
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
    const totalFoodNeeded = idle.reduce((sum, t) => sum + this.foodCostForTool(t), 0);
    const minFoodNeeded = Math.min(...idle.map((t) => this.foodCostForTool(t)));
    this.logger.info(
      `Start check: ${idle.length} idle tools, food: ${food} (need ${totalFoodNeeded} total, min ${minFoodNeeded})`,
    );
    // Don't return early — check each tool individually in the loop

    for (const tool of idle) {
      if (this.signal?.aborted) break;
      if (tool.hp <= 2) {
        this.logger.info(`Skip start ${tool.id}: hp too low (${tool.hp})`);
        continue;
      }

      const curFood = Number(this.s2_state?.склад?.еда ?? 0);
      const toolFood = this.foodCostForTool(tool);
      if (curFood < toolFood) {
        this.logger.info(
          `Not enough food (${curFood}) for ${tool.тип} ${tool.id} (need ${toolFood}), skip tool.`,
        );
        continue;
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
        if (res.состояние?.ok) {
          this.s2_state = res.состояние;
        } else {
          this.s2_state = await this.getState().catch(() => this.s2_state);
        }
        await this.flag().catch(() => {});
      }
      await this.utils.delayForSeconds(1, { signal: this.signal });
    }
  }

  /* --------------------------------------------------------------------- */
  /* ARISE — buy food from market and restart farming                     */
  /*                                                                       */
  /* Runs LAST. If idle tools need food to start, buy the cheapest food    */
  /* lots from the market. Axe needs 9 food, pickaxe needs 8 food.         */
  /* Smart buying: only buys the exact amount needed.                      */
  /* --------------------------------------------------------------------- */

  /** Food cost per tool type */
  foodCostForTool(tool) {
    if (tool.тип === "топор" || tool.тип?.toLowerCase()?.includes("axe"))
      return 9;
    return 8; // pickaxe (кирка) default
  }

  async arise() {
    const s2 = this.s2_state;
    if (!s2?.ok || !Array.isArray(s2.инструменты)) {
      this.logger.info("ARISE: no state or tools, skip.");
      return;
    }

    // Find idle tools that can start
    const idle = s2.инструменты.filter(
      (t) =>
        (!t.занят_до || t.занят_до === 0 || t.занят_до < Date.now()) &&
        t.hp > 2,
    );
    if (idle.length === 0) {
      this.logger.info("ARISE: all tools busy or hp too low, skip.");
      return;
    }

    const foodHave = Number(s2.склад?.еда || 0);
    const maxSpend = 100000;

    // Check if we already have enough for at least one tool
    const minFoodNeeded = Math.min(...idle.map((t) => this.foodCostForTool(t)));
    if (foodHave >= minFoodNeeded) {
      this.logger.info(`ARISE: food ${foodHave} >= min needed ${minFoodNeeded}, trying start.`);
      await this.startExpeditions();
      return;
    }

    // Need to buy — target 16 but must have at least minFoodNeeded
    const FOOD_TARGET = 16;
    const needed = Math.max(FOOD_TARGET - foodHave, minFoodNeeded - foodHave);

    this.logger.info(
      `ARISE: have ${foodHave} food, need ${needed} more (min for any tool: ${minFoodNeeded}, max ${maxSpend} coins)`,
    );

    // Buy from multiple cheapest lots (tries up to 3 lots per market fetch)
    const { spent, bought } = await this.buyCheapestLots(
      "еда",
      needed,
      maxSpend,
      "ARISE",
    );

    const finalFood = Number(this.s2_state?.склад?.еда || 0);
    this.logger.info(
      `ARISE: bought ${bought} food, spent ${spent} coins, food now: ${finalFood}`,
    );

    // MUST start expeditions — even if we didn't reach target, we might have enough for one tool
    await this.startExpeditions();
  }

  /* --------------------------------------------------------------------- */
  /* Market — adaptive pricing with cancel & replace                      */
  /*                                                                       */
  /* Checks current corridor, cancels orders outside it, places new ones    */
  /* at current prices. Max 3 orders per resource.                         */
  /* --------------------------------------------------------------------- */

  randInt(min, max) {
    return Math.floor(Math.random() * (max - min + 1)) + min;
  }

  /** Count pending lots for a specific resource */
  pendingForResource(item) {
    const lots = this.s2_state?.мойЛот || [];
    return lots.filter((l) => l.товар === item).length;
  }

  /** Cancel a market lot — returns resources to warehouse */
  async cancelLot(lotId) {
    const res = await this.post("s2/market/cancel", { лот: lotId }).catch((e) => {
      this.logger.warn(`Cancel lot ${lotId} failed:`, e.message);
      return null;
    });
    if (res?.ok) {
      const returned = res.вернулось ? Object.entries(res.вернулось).map(([k,v]) => `${k}+${v}`).join(', ') : '?';
      this.logger.info(`Cancelled lot ${lotId} (returned: ${returned})`);
      // Use state from response (saves API call)
      if (res.состояние?.ok) this.s2_state = res.состояние;
    }
    return res;
  }

  /** Sell one lot, returns true on success */
  async sellOne(item, qty, price, pendingRef, maxQty) {
    if (pendingRef.value >= 10) {
      this.logger.info("Market: 10 pending lots (max), stop selling.");
      return false;
    }
    // Cap qty to maxQty if specified
    const finalQty = maxQty != null ? Math.min(qty, Math.max(0, maxQty)) : qty;
    if (finalQty <= 0) return false;
    const res = await this.sellMarket(item, finalQty, price).catch((e) => {
      if (e.response?.status === 400) {
        this.logger.info(`Sell ${item} ${finalQty}×${price} rejected (400 corridor).`);
      } else {
        this.logger.warn(`Sell ${item} ${finalQty}×${price} failed:`, e.message);
      }
      return null;
    });
    if (res?.ok) {
      this.logger.success(`Listed ${item} ${finalQty}×${price}`);
      pendingRef.value++;
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
   * Fetch market, cancel stale orders, place new ones at current prices.
   * Uses the cheapest lot (first) and most expensive lot (last) as price bounds.
   */
  async handleResourceMarket(item, warehouseQty, pendingRef) {
    // 1. Fetch current market
    const market = await this.getMarket(item).catch((e) => {
      this.logger.warn(`Market fetch ${item} failed:`, e.message);
      return null;
    });
    if (!market?.ok || !Array.isArray(market.лоты)) {
      this.logger.info(`Market: no data for ${item}.`);
      return;
    }

    const lots = market.лоты.filter((l) => !l.свой).sort((a, b) => a.цена - b.цена);
    if (lots.length === 0) {
      this.logger.info(`Market: no lots for ${item}.`);
      return;
    }

    // Price bounds = cheapest lot and most expensive lot
    const cheapest = Number(lots[0].цена);
    const mostExpensive = Number(lots[lots.length - 1].цена);
    this.logger.info(`Market ${item}: cheapest=${cheapest} mostExpensive=${mostExpensive} (${lots.length} lots)`);

    // 2. Cancel our pending lots that are outside current price range
    const myLots = (this.s2_state?.мойЛот || []).filter((l) => l.товар === item);
    let cancelled = 0;
    for (const lot of myLots) {
      if (this.signal?.aborted) break;
      const lotPrice = Number(lot.цена);
      if (lotPrice < cheapest || lotPrice > mostExpensive) {
        this.logger.info(`Cancelling ${item} lot ${lot.id} at ${lotPrice} (outside range ${cheapest}–${mostExpensive})`);
        await this.cancelLot(lot.id);
        cancelled++;
        await this.utils.delayForSeconds(0.5, { signal: this.signal });
      }
    }
    if (cancelled > 0) {
      await this.flag().catch(() => {});
    }

    // 3. Count remaining pending for this resource
    const currentPending = this.pendingForResource(item);
    if (currentPending >= 3) {
      this.logger.info(`Market: ${item} already has ${currentPending}/3 pending orders, skip.`);
      return;
    }
    if (warehouseQty <= 0) {
      this.logger.info(`Market: no ${item} to sell.`);
      return;
    }

    // 4. Place up to 3 orders at medium and low prices
    const slotsLeft = 3 - currentPending;
    const range = mostExpensive - cheapest;
    const midPrice = this.randInt(cheapest + Math.floor(range * 0.3), cheapest + Math.floor(range * 0.6));
    const tiers = [
      { qty: 1, price: midPrice, label: `1× medium (${midPrice})` },
      { qty: 2, price: cheapest, label: `2× low (${cheapest})` },
      { qty: 3, price: cheapest, label: `3× low (${cheapest})` },
    ];

    let placed = 0;
    for (const tier of tiers) {
      if (this.signal?.aborted) break;
      if (pendingRef.value >= 10) break;
      if (placed >= slotsLeft) break;
      const price = tier.price;
      this.logger.info(`Selling ${item} ${tier.qty}×${price} (${tier.label})`);
      const ok = await this.sellOne(item, tier.qty, price, pendingRef, warehouseQty);
      if (ok) {
        placed++;
        warehouseQty = Math.max(0, warehouseQty - tier.qty);
      }
      await this.utils.delayForSeconds(1, { signal: this.signal });
    }
    this.logger.info(`Market: ${item} — ${cancelled} cancelled, ${placed} placed (${currentPending + placed}/3 pending).`);
  }

  async handleMarket() {
    const s2 = this.s2_state;
    if (!s2?.ok) {
      this.logger.warn("Market: no state, skip.");
      return;
    }

    const wh = s2.склад || {};
    let pending = Array.isArray(s2.мойЛот) ? s2.мойЛот.length : 0;
    const orePending = this.pendingForResource("руда");
    const logsPending = this.pendingForResource("брёвна");
    const foodPending = this.pendingForResource("еда");
    this.logger.info(
      `Market: ore:${wh.руда || 0}(${orePending}/3) logs:${wh.брёвна || 0}(${logsPending}/3) food:${wh.еда || 0}(${foodPending}/3) | total lots ${pending}/10`,
    );
    if (pending >= 10) {
      this.logger.info("Market: 10 pending lots (max), skip.");
      return;
    }

    const pendingRef = { value: pending };

    // --- ORE ---
    await this.handleResourceMarket("руда", Number(wh.руда || 0), pendingRef);

    // --- LOGS ---
    if (pendingRef.value < 10) {
      await this.handleResourceMarket("брёвна", Number(wh.брёвна || 0), pendingRef);
    }

    // --- FOOD (all accounts sell food, keep max 32, sell the rest) ---
    if (pendingRef.value < 10) {
      const foodQty = Number(wh.еда || 0);
      const foodToSell = Math.max(0, foodQty - 32);
      if (foodToSell > 0) {
        await this.handleResourceMarket("еда", foodToSell, pendingRef);
      } else {
        this.logger.info(`Market: food ${foodQty} (keeping 32), nothing to sell.`);
      }
    }
  }

  /* --------------------------------------------------------------------- */
  /* Process — main farming loop                                          */
  /* --------------------------------------------------------------------- */

  async process() {
    // 1. Login (state + flag)
    await this.login();
    await this.logUserInfo();

    // 2. Chest
    await this.executeTask("Chest", () => this.openChestIfNeeded());

    // 3. Tasks
    await this.executeTask("Tasks", () => this.handleTasks());

    // 4. Village Gifts
    await this.executeTask("Village Gifts", () => this.handleVillageGifts());

    // 5. Collect finished expeditions
    await this.executeTask("Collect", () => this.collectExpeditions());

    // 6. MINAZUKI — repair + buy materials if needed
    await this.executeTask("MINAZUKI", () => this.minazuki());

    // 7. Market — sell resources
    await this.executeTask("Market", () => this.handleMarket());

    // 8. Start new expeditions
    await this.executeTask("Start Expedition", () => this.startExpeditions());

    // 9. ARISE — buy food and start if needed (must be last)
    await this.executeTask("ARISE", () => this.arise());

    // 10. Final flag
    await this.flag().catch(() => {});
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
        "Season",
        `${s.сезон?.эмодзи || ""} ${s.сезон?.имя || "?"} day ${s.сезон?.деньСезона || "?"}/${s.сезон?.дней || "?"}`,
      );
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
        id: "collect",
        icon: "download",
        title: "Collect Expeditions",
        action: this.collectExpeditions.bind(this),
        dispatch: false,
      },
      {
        id: "minazuki",
        icon: "wrench",
        title: "MINAZUKI — Repair & Buy",
        action: this.minazuki.bind(this),
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
      {
        id: "arise",
        icon: "shop",
        title: "ARISE — Buy Food & Start",
        action: this.arise.bind(this),
        dispatch: false,
      },
    ];

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
