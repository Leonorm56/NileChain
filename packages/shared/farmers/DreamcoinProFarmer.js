import BaseFarmer from "../lib/BaseFarmer.js";
import { getDeviceForSession, getTelegramVersion, generateAndroidUserAgent } from "../utils/core.js";

export default class DreamcoinProFarmer extends BaseFarmer {
  static id = "dreamcoin-pro";
  static title = "Dreamcoin Pro";
  static emoji = "👛";
  static host = "app.dreamcoin.pro";
  static domains = ["app.dreamcoin.pro", "api.dreamcoin.pro"];
  static telegramLink = "https://t.me/dreamcoin_bot?start=r_1147265290";
  static path = "/";
  static singleton = true;
  static cacheAuth = false;
  static published = true;
  static interval = "*/5 * * * *";
  static rating = 3;
  static startupDelay = 60;

  configureApi() {
    const device = getDeviceForSession(this.getUserId());
    const tgVersion = getTelegramVersion(this.getUserId());
    const userAgent = generateAndroidUserAgent(device, tgVersion);
    
    this.logger.log(`Device: ${device.name} (Android ${device.android}, Telegram ${tgVersion})`);
    
    const interceptor = this.api.interceptors.request.use((config) => {
      config.url = this._updateUrl(config.url);
      config.headers["User-Agent"] = userAgent;
      return config;
    });
    return () => this.api.interceptors.request.eject(interceptor);
  }

  _updateUrl(url) {
    const initData = this.telegramWebApp?.initData;
    if (!initData) return url;
    const separator = url.includes("?") ? "&" : "?";
    return `${url}${separator}initData=${encodeURIComponent(initData)}`;
  }

  getReferralLink() {
    return `https://t.me/dreamcoin_bot?start=r_${this.getUserId()}`;
  }

  // ---- API methods ----

  login(signal) {
    const startParam = this.getStartParam();
    const url = startParam
      ? `https://api.dreamcoin.pro/api/users/login/${startParam}`
      : "https://api.dreamcoin.pro/api/users/login/";
    return this.api
      .post(url, { user_agent: this.userAgent }, { signal })
      .then((r) => r.data);
  }

  getBalance(signal) {
    return this.api
      .get("https://api.dreamcoin.pro/api/users/balance/", { signal })
      .then((r) => r.data);
  }

  getCharacters(signal) {
    return this.api
      .get("https://api.dreamcoin.pro/api/characters", { signal })
      .then((r) => r.data);
  }

  getStoreCharacters(signal) {
    return this.api
      .get("https://api.dreamcoin.pro/api/characters/store", { signal })
      .then((r) => r.data)
      .catch(() => null);
  }

  getAllCharacters(signal) {
    return this.api
      .get("https://api.dreamcoin.pro/api/characters/all", { signal })
      .then((r) => r.data)
      .catch(() => null);
  }

  discoverCharacters(signal) {
    // POST /api/characters/store returns the full store catalog when authenticated
    return this.api
      .post("https://api.dreamcoin.pro/api/characters/store", null, { signal })
      .then((r) => r.data)
      .catch(() => null);
  }

  getMining(signal) {
    return this.api
      .get("https://api.dreamcoin.pro/api/mining", { signal })
      .then((r) => r.data);
  }

  getDailyBonus(signal) {
    return this.api
      .get("https://api.dreamcoin.pro/api/tasks-groups/7", { signal })
      .then((r) => r.data);
  }

  getTaskGroups(signal) {
    return this.api
      .get("https://api.dreamcoin.pro/api/tasks-groups", { signal })
      .then((r) => r.data);
  }

  getTaskGroupInfo(id, signal) {
    return this.api
      .get(`https://api.dreamcoin.pro/api/tasks-groups/${id}`, { signal })
      .then((r) => r.data);
  }

  buyCharacter(id, signal) {
    return this.api.post(
      `https://api.dreamcoin.pro/api/characters/${id}`,
      null,
      { signal },
    );
  }

  setCharacter(id, signal) {
    return this.api.patch(
      `https://api.dreamcoin.pro/api/characters/${id}`,
      null,
      { signal },
    );
  }

  startMining(signal) {
    return this.api.post("https://api.dreamcoin.pro/api/mining", null, {
      signal,
    });
  }

  deleteMining(id, signal) {
    return this.api.delete(`https://api.dreamcoin.pro/api/mining/${id}`, {
      signal,
    });
  }

  claimTask(id, payload, signal) {
    return this.api.post(
      `https://api.dreamcoin.pro/api/tasks/${id}/claim`,
      payload || null,
      { signal },
    );
  }

  spin(signal) {
    return this.api
      .post("https://api.dreamcoin.pro/api/spin", null, { signal })
      .then((r) => r.data);
  }

  getRefSystem(signal) {
    return this.api
      .get(`https://api.dreamcoin.pro/api/ref_system/${this.getUserId()}`, {
        signal,
      })
      .then((r) => r.data.data);
  }

  getUsdtRefSystem(signal) {
    return this.api
      .get(`https://api.dreamcoin.pro/api/usdt_ref/${this.getUserId()}`, {
        signal,
      })
      .then((r) => r.data.data);
  }

  claimRefSystem(signal) {
    return this.api
      .post("https://api.dreamcoin.pro/api/ref_claim/", null, { signal })
      .then((r) => r.data);
  }

  claimUsdtRefSystem(signal) {
    return this.api
      .post("https://api.dreamcoin.pro/api/claim_usdt_ref/", null, { signal })
      .then((r) => r.data);
  }

  getCpcBanner(signal) {
    return this.api
      .get("https://api.dreamcoin.pro/api/cpc/banner", { signal })
      .then((r) => r.data);
  }

  getWidget(payload, signal) {
    return this.api
      .post("https://api.dreamcoin.pro/api/barza/original_widget", payload, {
        signal,
      })
      .then((r) => r.data);
  }

  getCampaignLink(campaignId, payload, signal) {
    return this.api
      .post(
        `https://api.dreamcoin.pro/api/barza/original_widget/${campaignId}/link`,
        payload,
        { signal },
      )
      .then((r) => r.data);
  }

  boostWithProvider(id, provider, action, signal) {
    return this.api.post(
      `https://api.dreamcoin.pro/api/mining/${id}/boost`,
      { action, provider },
      { signal },
    );
  }

  visitPage(page, signal) {
    return this.api
      .post(
        "https://api.dreamcoin.pro/api/users/action",
        {
          events: [
            {
              timestamp: Math.floor(Date.now() / 1000),
              type: "page_view",
              value: page,
              userId: this.getUserId(),
            },
          ],
          app_version: "1.2.202",
        },
        { signal },
      )
      .then((r) => r.data);
  }

  // ---- Process ----

  async process() {
    // Fetch all initial data in parallel
    const [dailyBonus, login, balance, characters, mining] = await Promise.all([
      this.getDailyBonus().catch(() => null),
      this.login().catch(() => null),
      this.getBalance().catch(() => null),
      this.getCharacters().catch(() => null),
      this.getMining().catch(() => null),
    ]);

    if (!login) {
      this.logger.warn("Login failed, skipping cycle");
      return;
    }

    this._logUserInfo(balance, characters, mining);

    await this.executeTask("Mining", () => this._completeMining(mining));
    await this.executeTask("Check In", () => this._checkIn(dailyBonus));
    await this.executeTask("Fortune Wheel", () => this._spinRaffle(balance));
    await this.executeTask("Referral Bonus", () => this._claimReferralBonus());
    await this.executeTask("Characters", () =>
      this._purchaseCharacters(balance, characters),
    );
  }

  _logUserInfo(balance, characters, mining) {
    this.logger.newline();
    this.logCurrentUser();
    if (balance) {
      this.logger.keyValue("Balance", `DC ${balance.dc}, USDT $${balance.usdt}`);
    }
    if (characters) {
      const own = characters.owned_characters || [];
      const active = own.find((c) => c.is_active)?.character;
      const totalEarns = own.reduce((s, c) => s + (c.character?.earns_usdt || 0), 0);
      this.logger.keyValue(
        "Characters",
        `${own.length} owned ($${totalEarns}/4HOURS)`,
      );
      if (active) this.logger.keyValue("Active", `${active.name} ($${active.earns_usdt || 0}/4HOURS)`);
    }
    if (mining) {
      this.logger.keyValue("Mining", mining.mining?.status || "idle");
    }
    this.logger.newline();
  }

  // ---- Check In ----

  async _checkIn(dailyBonus) {
    if (!dailyBonus) return;
    const tasks = dailyBonus.tasks || [];
    if (tasks.length === 0) return;

    await this.visitPage("/");
    let claimedMain = false;

    for (const task of tasks) {
      if (this.signal.aborted) break;
      const status = task.status;
      const partner = task.partner;
      const details = task.details || {};
      const isMain = details?.current_day != null;
      const name = isMain ? `Day ${details.current_day}` : `Sponsor ${partner?.name || task.id}`;

      if (status === "DONE") continue;

      if (status === "NOT_STARTED" || status === "STARTED") {
        if (partner?.link && this.validateTelegramTask(partner.link)) {
          await this.joinTelegramLink(partner.link);
          await this.utils.delayForSeconds(2, { signal: this.signal });
        }
        if (isMain && details.promote_link && this.validateTelegramTask(details.promote_link)) {
          await this.joinTelegramLink(details.promote_link);
          await this.utils.delayForSeconds(2, { signal: this.signal });
        }
        try {
          const payload = partner?.id
            ? { details: { validation_type: "subscription", partner_id: partner.id } }
            : (isMain && details.partner_id
              ? { details: { validation_type: "subscription", partner_id: details.partner_id } }
              : null);
          await this.claimTask(task.id, payload);
          if (isMain) {
            this.logger.success(`Checked in ${name}`);
            claimedMain = true;
          } else {
            this.logger.success(`Completed sponsor: ${partner?.name || task.id}`);
          }
        } catch (e) {
          const code = e.response?.status;
          if (code === 404) {
            this.logger.info(`Skipped ${name} (stale)`);
          } else if (code === 400) {
            this.logger.info(`Skipped ${name} (unclaimable)`);
          } else {
            this.logger.warn(`${name}: ${e.response?.data?.message || e.message}`);
          }
        }
      }
      await this.utils.delayForSeconds(1, { signal: this.signal });
    }

    if (!claimedMain) {
      // Check if all sponsor tasks are done but main is still locked
      const allDone = tasks.every((t) => t.status === "DONE" || t.details?.current_day != null);
      const notStarted = tasks.find((t) => t.status === "NOT_STARTED" && !t.partner);
      if (allDone && notStarted) {
        try {
          const payload = notStarted.details?.partner_id
            ? { details: { validation_type: "subscription", partner_id: notStarted.details.partner_id } }
            : null;
          await this.claimTask(notStarted.id, payload);
          this.logger.success(`Checked in Day ${notStarted.details?.current_day || notStarted.id}`);
        } catch (e) {
          this.logger.warn(`Main task: ${e.response?.data?.message || e.message}`);
        }
      }
    }
  }

  // ---- Fortune Wheel ----

  async _spinRaffle(balance) {
    const tickets = balance?.tickets || 0;
    if (tickets <= 0) return;
    await this.visitPage("/fortune-wheel");
    for (let i = 0; i < tickets; i++) {
      if (this.signal.aborted) break;
      try {
        const result = await this.spin();
        if (result?.reward) {
          this.logger.info(`Spin #${i + 1}: ${result.reward}`);
        }
      } catch {
        this.logger.warn(`Spin #${i + 1} failed`);
      }
      await this.utils.delayForSeconds(1, { signal: this.signal });
    }
  }

  // ---- Referral Bonus ----

  async _claimReferralBonus() {
    await this.visitPage("/fortune-wheel");
    const [refSystem, usdtSystem] = await Promise.all([
      this.getRefSystem().catch(() => null),
      this.getUsdtRefSystem().catch(() => null),
    ]);
    if (refSystem?.amount_all > 0) {
      await this.claimRefSystem();
      this.logger.info(`Claimed DC ref bonus: ${refSystem.amount_all}`);
    }
    if (usdtSystem?.amount_all > 0) {
      await this.claimUsdtRefSystem();
      this.logger.info(`Claimed USDT ref bonus: ${usdtSystem.amount_all}`);
    }
  }

  // ---- Characters ----

  async _purchaseCharacters(balance, characters) {
    if (!characters || !balance) return;
    const allAvailable = characters.available_characters || [];
    const owned = characters.owned_characters || [];
    const ownedIds = new Set(owned.map((o) => o.character?.id).filter(Boolean));

    // Buy free characters first (e.g. Mr. Beast)
    const free = allAvailable.filter((c) => c.price <= 0 && !ownedIds.has(c.id));
    if (free.length > 0) {
      const item = free[0];
      const bought = await this.buyCharacter(item.id).then(() => true).catch(() => false);
      if (bought) {
        await this.setCharacter(item.id).catch(() => {});
        this.logger.success(`Bought & equipped ${item.name} (DC 0, $${item.earns_usdt || 0}/4HOURS)`);
        return;
      }
    }

    // Buy strategy: prefer big card (500), small card (150) only if saving for big
    const SMALL = 150;
    const BIG = 500;
    const RESERVE = 400;
    const { dc } = balance;

    const paid = allAvailable.filter(
      (c) => c.price_currency === "DC" && c.price > 0 && !ownedIds.has(c.id),
    );
    if (paid.length === 0) {
      await this._setActiveCharacter(characters);
      return;
    }

    let target = null;
    if (dc >= BIG) {
      target = paid.find((c) => c.price === BIG) || paid.sort((a, b) => b.price - a.price)[0];
    } else if (dc >= SMALL && dc < RESERVE) {
      target = paid.find((c) => c.price === SMALL) || paid.sort((a, b) => b.price - a.price)[0];
    }

    if (!target) {
      await this._setActiveCharacter(characters);
      return;
    }

    try {
      await this.buyCharacter(target.id);
      await this.setCharacter(target.id);
      this.logger.success(`Bought & equipped ${target.name} (DC ${target.price}, $${target.earns_usdt || 0}/4HOURS)`);
    } catch {
      this.logger.warn(`Failed to buy ${target.name}`);
    }

    await this._setActiveCharacter(characters);
  }

  async _setActiveCharacter(characters) {
    const owned = characters.owned_characters || [];
    for (const oc of owned) {
      if (oc.character) {
        this.logger.info(`Owned: ${oc.character.name} — $${oc.character.earns_usdt || 0}/4HOURS${oc.is_active ? " [ACTIVE]" : ""}`);
      }
    }
    const best = owned
      .filter((c) => c.character)
      .sort((a, b) => (b.character.earns_usdt || 0) - (a.character.earns_usdt || 0))[0];
    if (best && !best.is_active) {
      try {
        await this.setCharacter(best.character.id);
        this.logger.success(`Equipped ${best.character.name}`);
      } catch {
        this.logger.warn("Failed to set active character");
      }
    }
  }

  // ---- Mining ----

  async _completeMining(mining) {
    if (!mining?.mining) return;
    const { status, id } = mining.mining;

    if (status === "end" || status === "claim") {
      await this._boostMining(mining, "claim").catch(() => {});
      await this.deleteMining(id).catch(() => {});
      this.logger.success("Mining claimed");
      await this.startMining().catch(() => {});
      this.logger.info("Mining restarted");
    } else {
      await this._boostMining(mining).catch(() => {});
    }
  }

  async _boostMining(mining, action) {
    try {
      await this.getCpcBanner();
    } catch {
      /* banner optional */
    }

    const payload = {
      tg_user_id: this.getUserId(),
      tg_user_locale: "ru",
      tg_user_first_name: this.getUserFirstName(),
      tg_user_is_premium: false,
      tg_user_platform: "android",
    };

    let provider = "tads";
    try {
      const widget = await this.getWidget(payload);
      if (widget?.ad_campaign_id) {
        provider = "barza";
        const linkData = await this.getCampaignLink(widget.ad_campaign_id, payload).catch(() => null);
        if (linkData?.link) {
          try { await fetch(linkData.link, { method: "GET", redirect: "follow" }); } catch { /* ignore */ }
        }
      }
    } catch {
      /* widget optional */
    }

    try {
      await this.boostWithProvider(mining.mining.id, provider, action);
      this.logger.log(`Boosted mining (${provider})`);
    } catch {
      this.logger.info("Boost not available");
    }
  }

  // ---- Tasks ----

  async _completeTasks() {
    await this.visitPage("/earn");
    let taskGroups;
    try {
      taskGroups = await this.getTaskGroups();
    } catch {
      this.logger.warn("Failed to fetch task groups");
      return;
    }

    const groups = [...(taskGroups.individual || []), ...(taskGroups.combined || [])];

    for (const group of groups) {
      if (this.signal.aborted) break;
      this.logger.info(`Tasks group: ${group.slug}`);
      await this.visitPage(`/tasks/${group.slug}`);
      let groupInfo;
      try {
        groupInfo = await this.getTaskGroupInfo(group.task_group_id);
      } catch {
        continue;
      }
      const tasks = groupInfo.tasks || [];
      for (const task of tasks) {
        if (this.signal.aborted) break;
        try {
          const status = task.status;
          const partner = task.partner;
          const details = task.details || {};
          const name = partner?.name || (details?.current_day != null ? `Day ${details.current_day}` : `Task ${task.id}`);

          this.logger.info(`[${status}] ${name}`);

          if (status === "DONE" || status === "CLAIMED") {
            continue;
          } else if (status === "NOT_STARTED") {
            const payload = partner?.id ? { details: { validation_type: "subscription", partner_id: partner.id } } : null;
            if (payload && partner?.link) {
              if (this.validateTelegramTask(partner.link)) {
                await this.joinTelegramLink(partner.link);
                await this.utils.delayForSeconds(2, { signal: this.signal });
              }
            }
            await this.claimTask(task.id, payload);
            this.logger.success(`Completed: ${name}`);
          } else if (status === "STARTED") {
            const payload = partner?.id ? { details: { partner_id: partner.id } } : null;
            await this.claimTask(task.id, payload);
            this.logger.success(`Claimed: ${name}`);
          } else {
            this.logger.info(`Skipped ${status}: ${name}`);
          }
        } catch (e) {
          const code = e.response?.status;
          if (code === 404) {
            this.logger.info(`Skipped (stale)`);
          } else if (code === 400) {
            this.logger.info(`Skipped (unclaimable)`);
          } else {
            this.logger.warn(`${name}: ${e.response?.data?.message || e.message}`);
          }
        }
        await this.utils.delayForSeconds(1, { signal: this.signal });
      }
    }
  }



  // ---- Tools ----

  createTools() {
    return [
      {
        name: "Tasks",
        list: [
          {
            id: "process",
            icon: "refresh",
            title: "Run Cycle",
            action: this.process.bind(this),
            dispatch: false,
          },
        ],
      },
    ];
  }
}
