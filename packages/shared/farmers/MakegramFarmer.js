import BaseFarmer from "../lib/BaseFarmer.js";

/**
 * Makegram Season 2 — mgrmga.org/s2-2026
 *
 * Optimized farmer for https://api.mgrmga.org/s2/*
 * Auth: X-Init-Data header + Origin https://mgrmga.org
 *
 * Optimized flow:
 *   login → chest → collect → market (parallel) → BANKAI (repair+buy+start) → flag
 *
 * BANKAI = repair tools + buy repair materials + buy food + start expeditions
 * All in one merged step with batched market fetches.
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

  /** Fetch a math captcha */
  async fetchCaptcha() {
    const res = await this.post("s2/captcha", {});
    if (!res?.ok || !res.id || !res.вопрос) {
      this.logger.warn("Captcha fetch failed:", JSON.stringify(res));
      return null;
    }
    return res;
  }

  /** Solve math captcha like "3 + 7" → "10" */
  solveMath(question) {
    try {
      const clean = question.replace(/[^0-9+\-*/]/g, " ");
      const parts = clean.split(/\s+/).filter(Boolean);
      if (parts.length === 3) {
        const [a, op, b] = parts;
        const numA = Number(a), numB = Number(b);
        if (isNaN(numA) || isNaN(numB)) return null;
        let result;
        if (op === "+") result = numA + numB;
        else if (op === "-") result = numA - numB;
        else if (op === "*") result = numA * numB;
        else if (op === "/") result = Math.floor(numA / numB);
        else return null;
        return String(result);
      }
    } catch (_) {}
    return null;
  }

  /** Human-like delay before solving captcha (2-5s) */
  async humanCaptchaDelay() {
    const delay = this.randInt(2, 5);
    await this.utils.delayForSeconds(delay, { signal: this.signal });
  }

  async sellMarket(item, qty, price) {
    const captcha = await this.fetchCaptcha();
    const payload = { товар: item, кол: qty, цена: price };
    if (captcha) {
      await this.humanCaptchaDelay();
      const answer = this.solveMath(captcha.вопрос);
      if (answer) {
        payload.капчаId = captcha.id;
        payload.капчаОтвет = answer;
      } else {
        this.logger.warn(`Captcha solve failed for: ${captcha.вопрос}`);
      }
    }
    return this.post("s2/market/sell", payload);
  }

  async buyMarket(lot) {
    const captcha = await this.fetchCaptcha();
    const payload = { лот: lot };
    if (captcha) {
      await this.humanCaptchaDelay();
      const answer = this.solveMath(captcha.вопрос);
      if (answer) {
        payload.капчаId = captcha.id;
        payload.капчаОтвет = answer;
      } else {
        this.logger.warn(`Captcha solve failed for: ${captcha.вопрос}`);
      }
    }
    return this.post("s2/market/buy", payload);
  }

  /* --------------------------------------------------------------------- */
  /* Village browsing — human-like behavior                                */
  /* --------------------------------------------------------------------- */

  /** Browse village top list */
  async browseVillageTop() {
    return this.get("village/top").catch(() => null);
  }

  /** Browse village list */
  async browseVillageList() {
    return this.get("village/list", { поиск: "" }).catch(() => null);
  }

  /** Check village gifts */
  async browseVillageGifts() {
    return this.get("village/gifts").catch(() => null);
  }

  /** Do random village browsing (cloud only) */
  async humanBrowse() {
    if (process.env.NODE_ENV !== "production") return;
    const actions = [
      () => this.browseVillageTop(),
      () => this.browseVillageList(),
      () => this.browseVillageGifts(),
    ];
    // Pick 1-2 random actions
    const count = this.randInt(1, 2);
    const shuffled = actions.sort(() => Math.random() - 0.5).slice(0, count);
    for (const action of shuffled) {
      await this.utils.delayForSeconds(this.randInt(1, 3), { signal: this.signal });
      await action();
    }
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

  async openChest(reason = "новичок") {
    return this.post("s2/chest", { повод: reason });
  }

  /* --------------------------------------------------------------------- */
  /* Login — fetch state                                                  */
  /* --------------------------------------------------------------------- */

  async login() {
    this.s2_state = await this.getState().catch((e) => {
      const status = e.response?.status || "no-status";
      const respData = e.response?.data;
      // Check for ban
      if (respData?.бан) {
        this.logger.error(`ACCOUNT BAN: ${respData.причина || 'unknown'}`);
        const err = new Error(`Account banned: ${respData.причина || 'bot farm'}`);
        err.isBanned = true;
        throw err;
      }
      this.logger.warn(`S2 state failed [${status}]`);
      if (status === 401 || status === 403)
        this.logger.warn("X-Init-Data expired — will refresh next run");
      return null;
    });
    if (!this.s2_state?.ok)
      throw new Error("S2 state failed — check X-Init-Data / proxy");

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
        this.logger.warn("Chest open failed:", e.response?.data?.error || e.message);
        return null;
      });
      if (res?.already) break;
      if (res?.ok) this.logger.success(`Opened chest ${i + 1}/2!`);
      else if (!res) break;
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
        this.logger.warn(`Collect ${exp.id} failed:`, e.response?.data?.error || e.message);
        return null;
      });
      if (res?.ok) {
        this.logger.success(`Collected ${exp.id}: ${res.ресурс} +${res.добыто}`);
        if (res.стояние?.ok) this.s2_state = res.стояние;
      }
    }
  }

  /* --------------------------------------------------------------------- */
  /* Market — adaptive pricing with cancel & replace                      */
  /* --------------------------------------------------------------------- */

  randInt(min, max) {
    return Math.floor(Math.random() * (max - min + 1)) + min;
  }

  /** Count pending lots for a specific resource */
  pendingForResource(item) {
    const lots = this.s2_state?.мойЛот || [];
    return lots.filter((l) => l.товар === item).length;
  }

  /** Cancel a market lot */
  async cancelLot(lotId) {
    const res = await this.post("s2/market/cancel", { лот: lotId }).catch((e) => {
      this.logger.warn(`Cancel lot ${lotId} failed:`, e.message);
      return null;
    });
    if (res?.ok) {
      const returned = res.вернулось ? Object.entries(res.вернулось).map(([k,v]) => `${k}+${v}`).join(', ') : '?';
      this.logger.info(`Cancelled lot ${lotId} (returned: ${returned})`);
      if (res.стояние?.ok) this.s2_state = res.стояние;
    }
    return res;
  }

  /** Sell one lot */
  async sellOne(item, qty, price, pendingRef, maxQty) {
    if (pendingRef.value >= 10) {
      this.logger.info("Market: 10 pending lots (max), stop selling.");
      return false;
    }
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
      pendingRef.value = Array.isArray(this.s2_state?.мойЛот)
        ? this.s2_state.мойЛот.length
        : pendingRef.value;
      return true;
    }
    return false;
  }

  /** Fetch market, cancel stale orders, place new ones */
  async handleResourceMarket(item, warehouseQty, pendingRef) {
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

    const cheapest = Number(lots[0].цена);
    const mostExpensive = Number(lots[lots.length - 1].цена);
    this.logger.info(`Market ${item}: cheapest=${cheapest} mostExpensive=${mostExpensive} (${lots.length} lots)`);

    // Cancel stale orders
    const myLots = (this.s2_state?.мойЛот || []).filter((l) => l.товар === item);
    for (const lot of myLots) {
      if (this.signal?.aborted) break;
      const lotPrice = Number(lot.цена);
      if (lotPrice < cheapest || lotPrice > mostExpensive) {
        this.logger.info(`Cancelling ${item} lot ${lot.id} at ${lotPrice} (outside ${cheapest}–${mostExpensive})`);
        await this.cancelLot(lot.id);
      }
    }

    const currentPending = this.pendingForResource(item);
    if (currentPending >= 3) {
      this.logger.info(`Market: ${item} already has ${currentPending}/3 pending, skip.`);
      return;
    }
    if (warehouseQty <= 0) {
      this.logger.info(`Market: no ${item} to sell.`);
      return;
    }

    // Place up to 3 orders — fixed qty per item, always lowest price
    const slotsLeft = 3 - currentPending;
    const qtyMap = { еда: 20, руда: 50, брёвна: 50 };
    const qty = qtyMap[item] || 10;
    const tiers = [
      { qty, price: cheapest, label: `${qty}× @${cheapest} (lowest)` },
    ];

    let placed = 0;
    for (const tier of tiers) {
      if (this.signal?.aborted) break;
      if (pendingRef.value >= 10) break;
      if (placed >= slotsLeft) break;
      const ok = await this.sellOne(item, tier.qty, tier.price, pendingRef, warehouseQty);
      if (ok) {
        placed++;
        warehouseQty = Math.max(0, warehouseQty - tier.qty);
      }
    }
    this.logger.info(`Market: ${item} — ${placed} placed (${currentPending + placed}/3 pending).`);
  }

  /** Parallel fetch all market data at once */
  async fetchAllMarkets(items) {
    const results = await Promise.allSettled(
      items.map((item) => this.getMarket(item))
    );
    const map = {};
    for (let i = 0; i < items.length; i++) {
      const r = results[i];
      map[items[i]] = r.status === "fulfilled" && r.value?.ok ? r.value : null;
    }
    return map;
  }

  /** Get cheapest non-self lots from market data */
  getCheapestLots(marketData, maxLots = 10) {
    if (!marketData?.ok || !Array.isArray(marketData.лоты)) return [];
    return marketData.лоты
      .filter((l) => !l.свой)
      .sort((a, b) => a.цена - b.цена)
      .slice(0, maxLots);
  }

  async handleMarket() {
    const s2 = this.s2_state;
    if (!s2?.ok) {
      this.logger.warn("Market: no state, skip.");
      return;
    }

    const wh = s2.склад || {};
    const pending = Array.isArray(s2.мойЛот) ? s2.мойЛот.length : 0;
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

    // --- FOOD (sell if > 32) ---
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
  /* BANKAI — Combined repair + buy + food + start                        */
  /*                                                                       */
  /* Merges MINAZUKI + ARISE into one fast step.                          */
  /* Fetches market data ONCE, buys from snapshot, repairs, starts.        */
  /* --------------------------------------------------------------------- */

  foodCostForTool(tool) {
    if (tool.тип === "топор" || tool.тип?.toLowerCase()?.includes("axe")) return 9;
    return 8;
  }

  parseRepairCost(errorResponse) {
    if (!errorResponse) return null;
    const cost = errorResponse.цена || errorResponse.price;
    if (cost && typeof cost === "object") return cost;
    return null;
  }

  async bankai() {
    const s2 = this.s2_state;
    if (!s2?.ok || !Array.isArray(s2.инструменты)) {
      this.logger.info("BANKAI: no state or tools, skip.");
      return;
    }

    const MAX_HEAL_SPEND = 100000;
    const MAX_FOOD_SPEND = 100000;
    let totalHealSpent = 0;
    let totalFoodSpent = 0;
    let repaired = 0;
    const wh = s2.склад || {};

    // --- Quick check: anything to do? ---
    const tools = s2.инструменты;
    // Any tool missing HP? (allow repair even at low HP)
    const needsRepair = tools.some((t) => (t.hp_макс || 40) - t.hp > 0);
    // Idle tools with enough HP to start (hp > 2)
    const idle = tools.filter(
      (t) => (!t.занят_до || t.занят_до === 0 || t.занят_до < Date.now()) && t.hp > 2,
    );
    const foodHave = Number(wh.еда || 0);
    const minFoodNeeded = idle.length > 0 ? Math.min(...idle.map((t) => this.foodCostForTool(t))) : Infinity;
    const needsFood = idle.length > 0 && foodHave < minFoodNeeded;
    const needsStart = idle.length > 0;

    if (!needsRepair && !needsFood && !needsStart) {
      this.logger.info(`BANKAI: tools OK (repair:${needsRepair} food:${foodHave} idle:${idle.length} needFood:${needsFood}), skip.`);
      return;
    }

    this.logger.info(`BANKAI: repair:${needsRepair} food:${foodHave}/${minFoodNeeded} idle:${idle.length}`);

    // --- Step 1: Pre-fetch all market data in parallel ---
    const marketItems = new Set(["еда"]);
    if (needsRepair) {
      // Fetch common repair materials
      for (const mat of ["руда", "брёвна", "слитки", "доски", "пайки"]) {
        marketItems.add(mat);
      }
    }
    const marketData = await this.fetchAllMarkets([...marketItems]);
    this.logger.info(`BANKAI: fetched ${Object.keys(marketData).length} markets in parallel`);

    // --- Step 2: Repair tools (buy materials from pre-fetched market) ---
    if (needsRepair) {
      for (const tool of tools) {
        if (this.signal?.aborted) break;
        if (totalHealSpent >= MAX_HEAL_SPEND) {
          this.logger.info(`BANKAI: heal limit ${MAX_HEAL_SPEND} reached.`);
          break;
        }

        const hpMax = tool.hp_макс || 40;
        const need = hpMax - tool.hp;
        if (need <= 0) continue;

        // Try repair
        let res = await this.repairTool(tool.id, need).catch((e) => {
          const errData = e.response?.data || {};
          return { ok: false, error: e.message, _raw: errData };
        });

        if (res?.ok) {
          this.logger.success(`BANKAI: ${tool.тип} ${tool.id} repaired! (+${need} hp)`);
          if (res.стояние?.ok) this.s2_state = res.стояние;
          repaired++;
          continue;
        }

        // Need materials?
        const costData = this.parseRepairCost(res?._raw || res);
        if (!costData) {
          this.logger.info(`BANKAI: ${tool.тип} ${tool.id} — ${res?.error || "skip"}`);
          continue;
        }

        this.logger.info(`BANKAI: ${tool.тип} ${tool.id} needs: ${JSON.stringify(costData)}`);

        // Buy each missing material from pre-fetched market
        const s2Now = this.s2_state || s2;
        const whNow = s2Now.склад || {};

        for (const [mat, qty] of Object.entries(costData)) {
          if (this.signal?.aborted) break;
          if (totalHealSpent >= MAX_HEAL_SPEND) break;

          const have = Number(whNow[mat] || 0);
          if (have >= qty) continue;

          const deficit = qty - have;
          const lots = this.getCheapestLots(marketData[mat], 10);

          let matBought = 0;
          for (const lot of lots) {
            if (matBought >= deficit) break;
            if (totalHealSpent >= MAX_HEAL_SPEND) break;
            if (totalHealSpent + lot.цена * lot.кол > MAX_HEAL_SPEND) continue;

            const buyRes = await this.buyMarket(lot.id).catch((e) => {
              this.logger.warn(`BANKAI buy ${mat} lot ${lot.id} failed:`, e.message);
              return null;
            });
            if (buyRes?.ok) {
              matBought += lot.кол;
              totalHealSpent += lot.цена * lot.кол;
              if (buyRes.стояние?.ok) this.s2_state = buyRes.стояние;
            }
          }
          if (matBought < deficit) {
            this.logger.warn(`BANKAI: only bought ${matBought}/${deficit} ${mat}`);
          }
        }

        // Retry repair
        res = await this.repairTool(tool.id, need).catch((e) => {
          return { ok: false, error: e.response?.data?.error || e.message };
        });
        if (res?.ok) {
          this.logger.success(`BANKAI: ${tool.тип} ${tool.id} repaired after buying materials!`);
          if (res.стояние?.ok) this.s2_state = res.стояние;
          repaired++;
        } else {
          this.logger.warn(`BANKAI: ${tool.тип} ${tool.id} repair failed: ${res?.error || "unknown"}`);
        }
      }
    }

    // --- Step 3: Buy food if needed ---
    if (idle.length === 0) {
      this.logger.info("BANKAI: all tools busy, skip food buy.");
    } else if (needsFood) {
      const currentFood = Number(this.s2_state?.склад?.еда || foodHave);
      const needed = Math.max(16 - currentFood, minFoodNeeded - currentFood);

      this.logger.info(`BANKAI: buying food, have ${currentFood}, need ${needed} more`);

      const lots = this.getCheapestLots(marketData["еда"], 10);
      let foodBought = 0;

      for (const lot of lots) {
        if (foodBought >= needed) break;
        if (totalFoodSpent >= MAX_FOOD_SPEND) break;
        if (totalFoodSpent + lot.цена * lot.кол > MAX_FOOD_SPEND) continue;

        const buyRes = await this.buyMarket(lot.id).catch((e) => {
          this.logger.warn(`BANKAI food lot ${lot.id} failed:`, e.message);
          return null;
        });
        if (buyRes?.ok) {
          foodBought += lot.кол;
          totalFoodSpent += lot.цена * lot.кол;
          if (buyRes.стояние?.ok) this.s2_state = buyRes.стояние;
        }
      }
      this.logger.info(`BANKAI: bought ${foodBought} food, spent ${totalFoodSpent} coins`);
    }

    // --- Step 4: Start all idle tools ---
    const currentIdle = (this.s2_state?.инструменты || tools).filter(
      (t) => (!t.занят_до || t.занят_до === 0 || t.занят_до < Date.now()) && t.hp > 2,
    );

    for (const tool of currentIdle) {
      if (this.signal?.aborted) break;
      const curFood = Number(this.s2_state?.склад?.еда ?? 0);
      const toolFood = this.foodCostForTool(tool);
      if (curFood < toolFood) {
        this.logger.info(`BANKAI: not enough food (${curFood}) for ${tool.тип} ${tool.id} (need ${toolFood})`);
        continue;
      }
      const res = await this.startExpedition(tool.id, 4, "ближняя").catch((e) => {
        if (e.response?.status === 400) return null;
        this.logger.warn(`BANKAI start ${tool.id} failed:`, e.message);
        return null;
      });
      if (res?.ok !== false && res !== null) {
        this.logger.success(`BANKAI: started ${tool.тип} ${tool.id} 4h`);
        if (res.стояние?.ok) this.s2_state = res.стояние;
      }
    }

    this.logger.info(
      `BANKAI done: repaired=${repaired} healSpent=${totalHealSpent} foodSpent=${totalFoodSpent}`,
    );
  }

  /* --------------------------------------------------------------------- */
  /* Process — main farming loop                                          */
  /* --------------------------------------------------------------------- */

  task(title) {
    this.logger.output(this.logger.c.magenta.bold(`\n═══ ${title} ═══`));
  }

  async process() {
    const isCloud = process.env.NODE_ENV === "production";

    // 0. Stagger — random delay so 140 accounts don't all hit at once (cloud only)
    if (isCloud) {
      const stagger = this.randInt(2, 15);
      this.logger.info(`Stagger: waiting ${stagger}s before starting...`);
      await this.utils.delayForSeconds(stagger, { signal: this.signal });
    }

    // 1. Login
    await this.login();
    await this.logUserInfo();

    // 2. Chest (skips if already opened)
    this.task("CHEST");
    await this.openChestIfNeeded();

    // 3. Collect finished expeditions
    this.task("COLLECT");
    await this.collectExpeditions();

    // 4. Village browse — human-like (cloud only, ~60% chance)
    if (isCloud && Math.random() < 0.6) {
      this.task("VILLAGE");
      await this.humanBrowse();
    }

    // 5. Market & BANKAI — randomize order per account
    const skipMarket = isCloud && Math.random() < 0.2;
    const doMarket = !skipMarket;
    const doBankai = true;

    if (isCloud && Math.random() < 0.5) {
      // BANKAI first, then MARKET
      if (doBankai) { this.task("BANKAI"); await this.bankai(); }
      if (doMarket) { this.task("MARKET"); await this.handleMarket(); }
    } else {
      // MARKET first, then BANKAI
      if (doMarket) { this.task("MARKET"); await this.handleMarket(); }
      if (doBankai) { this.task("BANKAI"); await this.bankai(); }
    }
    if (skipMarket) this.logger.info("MARKET: skipped this cycle (cloud random)");

    // 6. Final flag
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
      this.logger.keyValue("Balance", `${s.баланс} (withdrawable: ${s.кВыводу})`);
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
        `${s.сезон?.эмодзи || ""} ${s.сезон?.имя || "?"} day ${s.сезон?.деньСезона || "?"}/${s.сезон?.дней || "?"} (${s.сезон?.доКонцаДней || "?"} left)`,
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
        id: "collect",
        icon: "download",
        title: "Collect Expeditions",
        action: this.collectExpeditions.bind(this),
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
        id: "bankai",
        icon: "wrench",
        title: "BANKAI — Repair + Buy + Start",
        action: this.bankai.bind(this),
        dispatch: false,
      },
    ];

    const tools = this.s2_state?.инструменты || [];
    const perTool = tools
      .filter(
        (t) => !t.занят_до || t.занят_до === 0 || t.занят_до < Date.now(),
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
