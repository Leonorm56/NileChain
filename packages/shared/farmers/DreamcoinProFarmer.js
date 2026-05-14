import BaseFarmer from "../lib/BaseFarmer.js";

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
  static interval = "*/5 * * * *";
  static rating = 3;
  static startupDelay = 60;

  configureApi() {
    const interceptor = this.api.interceptors.request.use((config) => {
      config.url = this._updateUrl(config.url);
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
      payload,
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

    await this.executeTask("Check In", () => this._checkIn(dailyBonus));
    await this.executeTask("Fortune Wheel", () => this._spinRaffle(balance));
    await this.executeTask("Referral Bonus", () => this._claimReferralBonus());
    await this.executeTask("Characters", () =>
      this._purchaseCharacters(balance, characters),
    );
    await this.executeTask("Mining", () => this._completeMining(mining));
    await this.executeTask("Tasks", () => this._completeTasks());
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
        `${own.length} owned ($${totalEarns}/day)`,
      );
      if (active) this.logger.keyValue("Active", `${active.name} ($${active.earns_usdt || 0}/day)`);
    }
    if (mining) {
      this.logger.keyValue("Mining", mining.mining?.status || "idle");
    }
    this.logger.newline();
  }

  // ---- Check In ----

  async _checkIn(dailyBonus) {
    if (!dailyBonus) return;
    const day = dailyBonus.tasks?.find(
      (t) =>
        t.status === "NOT_STARTED" &&
        t.details?.current_day &&
        this.validateTelegramTask(t.details.promote_link),
    );
    if (!day) return;
    await this.visitPage("/");
    await this.tryToJoinTelegramLink(day.details.promote_link);
    await this.claimTask(day.id, {
      details: { validation_type: "subscription", partner_id: day.details.partner_id },
    });
    this.logger.success(`Checked in day ${day.details.current_day}`);
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
    const available = (characters.available_characters || []).filter(
      (c) => c.price_currency === "DC" && c.price <= balance.dc,
    );
    if (available.length > 0) {
      for (const c of available) {
        this.logger.info(`Buyable: ${c.name} — DC ${c.price}, earns $${c.earns_usdt || 0}/day`);
      }
      const item = this.utils.randomItem(available);
      try {
        await this.buyCharacter(item.id);
        await this.setCharacter(item.id);
        this.logger.success(`Bought & equipped ${item.name} (DC ${item.price})`);
        return;
      } catch {
        this.logger.warn(`Failed to buy ${item.name}`);
      }
    }
    await this._setActiveCharacter(characters);
  }

  async _setActiveCharacter(characters) {
    const owned = characters.owned_characters || [];
    for (const oc of owned) {
      if (oc.character) {
        this.logger.info(`Owned: ${oc.character.name} — earns $${oc.character.earns_usdt || 0}/day${oc.is_active ? " [ACTIVE]" : ""}`);
      }
    }
    const best = owned
      .filter((c) => c.character)
      .sort((a, b) => (b.character.earns_usdt || 0) - (a.character.earns_usdt || 0))[0];
    if (best && !best.is_active) {
      try {
        await this.setCharacter(best.character.id);
        this.logger.success(`Equipped ${best.character.name} ($${best.character.earns_usdt || 0}/day)`);
      } catch {
        this.logger.warn("Failed to set active character");
      }
    }
  }

  // ---- Mining ----

  async _completeMining(mining) {
    if (!mining?.mining) return;
    const { status, id } = mining.mining;

    // "end" = mining finished, rewards ready to claim — boost with "claim" to collect, delete, then restart
    // "claim" = same as end but needs explicit claim action — boost with "claim", delete, then restart
    if (status === "end" || status === "claim") {
      await this._boostMining(mining, "claim");
      await this.deleteMining(id).catch(() => {});
      this.logger.success("Mining claimed");
      await this.startMining().catch(() => {});
      this.logger.info("Mining restarted");
    } else {
      const lastBoost = mining.last_boost_time;
      const shouldBoost =
        !lastBoost ||
        this.utils.dateFns.isBefore(
          new Date(lastBoost + "Z"),
          this.utils.dateFns.subMinutes(new Date(), 3),
        );
      if (shouldBoost) {
        await this._boostMining(mining);
      }
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
      tg_user_first_name: this.getTelegramUser()?.["first_name"],
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

    await this.boostWithProvider(mining.mining.id, provider, action);
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
          const name = partner?.name || (details?.current_day ? `Day ${details.current_day}` : `Task ${task.id}`);

          this.logger.info(`[${status}] ${name}`);

          if (status === "NOT_STARTED") {
            const payload = partner?.id ? { details: { validation_type: "subscription", partner_id: partner.id } } : {};
            if (partner?.link) {
              if (this.validateTelegramTask(partner.link)) {
                await this.tryToJoinTelegramLink(partner.link);
                await this.utils.delayForSeconds(2, { signal: this.signal });
              }
            }
            await this.claimTask(task.id, payload);
            this.logger.success(`Completed: ${name}`);
          } else if (status === "STARTED") {
            const payload = partner?.id ? { details: { partner_id: partner.id } } : {};
            await this.claimTask(task.id, payload);
            this.logger.success(`Claimed: ${name}`);
          } else {
            this.logger.info(`Skipped ${status}: ${name}`);
          }
        } catch (e) {
          this.logger.warn(`${name}: ${e.response?.data?.message || e.message}`);
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
