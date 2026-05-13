import { Api } from "telegram";
import BaseDirectFarmer from "../lib/BaseDirectFarmer.js";

const CHANNEL_LINKS = [
  "https://t.me/AdclickersbotGroup",
  "https://t.me/adclickersbotchannel",
  "https://t.me/brand_awareness",
  "https://t.me/taskonlinebotChannel",
  "https://t.me/AdclickersbotPaymentChannel",
];

const SUPPORTED_TASKS = ["Join Chats", "Message Bots", "View Posts"];

export default class ADCLICKERFarmer extends BaseDirectFarmer {
  static id = "adclicker";
  static title = "ADCLICKER";
  static emoji = "🤖";
  static telegramLink = "https://t.me/Adclickersbot";
  static interval = "*/15 * * * *";
  static host = "";
  static domains = [];
  static singleton = true;
  static rating = 3;

  async process() {
    await this.executeTask("Start Bot", () => this.sendStart());
    await this.logUserInfo();
    await this.executeTask("Subscribe to Channels", () => this.subscribeToChannels());
    await this.executeTask("Verify", () => this.verifyAccount());
    await this.executeTask("Tasks", () => this.runAllTasks());
  }

  async logUserInfo() {
    this.logger.newline();
    try {
      const me = await this.client.getMe();
      this.logger.keyValue("User", `${me.username || me.firstName || "(no-name)"} (${me.id})`);
    } catch {
      this.logCurrentUser();
    }
    let balance = "—";
    try {
      const msgs = await this.client.getMessages(this.entity, { limit: 5 });
      for (const msg of msgs) {
        const m = (msg.message || "").match(/Main Balance\s*:\s*([\d.]+)\s*USD/);
        if (m) { balance = `${m[1]} USD`; break; }
      }
    } catch {}
    this.logger.keyValue("Balance", balance);
  }

  async subscribeToChannels() {
    for (const link of CHANNEL_LINKS) {
      if (this.signal.aborted) break;
      const name = link.replace("https://t.me/", "");
      try {
        const entity = await this.client.getEntity(name);
        await this.client.invoke(
          new Api.channels.GetParticipant({ channel: entity, participant: "me" }),
        );
      } catch {
        await this.joinTelegramLink(link);
      }
    }
  }

  async _jitterDelay(base, { signal } = {}) {
    const delay = this._cloudMode ? base + base * Math.random() : base;
    await this.utils.delayForSeconds(delay, { signal });
  }

  get _maxPerTask() {
    return this._cloudMode ? 2 : 3;
  }

  _className(obj) {
    if (!obj || typeof obj !== "object") return typeof obj;
    const ctor = obj.constructor;
    return ctor?.name || Object.prototype.toString.call(obj).slice(8, -1);
  }

  _fetchVerificationUrl(url, label = "verification") {
    return fetch(url, { method: "GET", redirect: "follow" }).catch(() => null);
  }

  async _sendInteraction(host, headersFn, { webId, sessionId, tgInitData, baseUrl, actions }) {
    try {
      await fetch(`${host}/api/interaction`, {
        method: "POST", headers: headersFn(), credentials: "include",
        body: JSON.stringify({
          webId, sessionId, isTelegramWebApp: true, telegramInitData: tgInitData,
          userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
          deviceType: "Desktop", browser: "Chrome", operatingSystem: "Windows",
          screenResolution: "1920x1080", url: baseUrl,
          startTime: new Date().toISOString(), endTime: new Date().toISOString(),
          timeSpent: 0, actions, isAdBlocker: false,
        }),
      });
    } catch {}
  }

  async _verifyViaDirectApi(webviewUrl) {
    let tgInitData;
    try {
      const extracted = this.utils.extractTgWebAppData(webviewUrl);
      tgInitData = extracted.initData;
    } catch {
      return false;
    }
    if (!tgInitData) return false;

    const parsed = new URL(webviewUrl);
    const baseUrl = `${parsed.origin}${parsed.pathname}${parsed.search}`;
    const host = parsed.origin;

    let pageResp;
    try {
      pageResp = await fetch(baseUrl, { method: "GET", redirect: "follow", credentials: "include" });
    } catch {
      return false;
    }

    const html = await pageResp.text();
    const webIdMatch = html.match(/webId:\s*"([^"]+)"/);
    const sessionMatch = html.match(/sessionId:\s*"([^"]+)"/);
    const csrfMatch = html.match(/"CSRF-Token":\s*"([^"]+)"/);
    const actionMatch = html.match(/const action = "([^"]+)"/);
    if (!webIdMatch || !csrfMatch || !sessionMatch) return false;

    const webId = webIdMatch[1];
    const csrfToken = csrfMatch[1];
    const sessionId = sessionMatch[1];
    const action = actionMatch ? actionMatch[1] : "verify";

    const headers = (extra = {}) => ({
      "Content-Type": "application/json",
      "CSRF-Token": csrfToken,
      ...extra,
    });

    // Send dom_loaded interaction (page sends this on load)
    await this._sendInteraction(host, headers, { webId, sessionId, tgInitData, baseUrl, actions: [{
      type: "dom_loaded", data: "Document fully loaded",
      element: null, timestamp: new Date().toISOString(), url: baseUrl,
    }] }).catch(()=>{});

    return false;
  }

  async _invokeVerificationUrl(startBtn, message) {
    const rawBtn = startBtn?.button || startBtn;

    if (rawBtn.data) {
      try {
        const answer = await this.client.invoke(
          new Api.messages.GetBotCallbackAnswer({
            peer: this.entity,
            msgId: message.id,
            data: rawBtn.data,
          }),
        );
        if (answer.url) {
          this._fetchVerificationUrl(answer.url, "callback-url");
        }
        return answer;
      } catch {
        return null;
      }
    }

    if (rawBtn.url) {
      try {
        const result = await this.client.invoke(
          new Api.messages.RequestWebView({
            platform: "android",
            bot: this.entity,
            peer: this.entity,
            url: rawBtn.url,
            fromBotMenu: false,
          }),
        );
        if (result.url) {
          const bypassed = await this._verifyViaDirectApi(result.url);
          if (bypassed) {
            this._directVerificationDone = true;
            return result;
          }
          this._fetchVerificationUrl(result.url, "webview-url");
        }
        return result;
      } catch {
        this._fetchVerificationUrl(rawBtn.url, "direct-url");
        return null;
      }
    }

    return null;
  }

  async handleVerification(message) {
    if (!message?.message?.includes("Verification Required")) return false;
    this._directVerificationDone = false;
    this.logger.info("Verification required, solving captcha...");

    const btns = message.buttons?.flat() || [];
    const startBtn = btns.find((b) => b.text?.includes("Start Verification"));
    if (!startBtn) return false;

    await this._invokeVerificationUrl(startBtn, message);

    if (this._directVerificationDone) {
      this.logger.info("Captcha solved");
      return true;
    }

    for (let i = 0; i < 15; i++) {
      if (this.signal.aborted) return false;
      await this._jitterDelay(2, { signal: this.signal });
      const msgs = await this.client.getMessages(this.entity, { limit: 5 });
      for (const msg of msgs) {
        const b = msg.buttons?.flat() || [];
        const labels = b.map((x) => x.text || x.url || "");

        if (b.some((x) => {
          const raw = x?.button || x;
          return raw.url && raw.className?.includes("WebView");
        })) {
          const webviewBtn = b.find((x) => {
            const raw = x?.button || x;
            return raw.url && raw.className?.includes("WebView");
          });
          await this._invokeVerificationUrl(webviewBtn, message);
          if (this._directVerificationDone) return true;
        }

        if (labels.some((l) => SUPPORTED_TASKS.some((t) => l.includes(t))) ||
            msg.message?.includes("verified") || msg.message?.includes("✅")) {
          this.lastMessage = msg;
          return true;
        }
      }
    }

    this.logger.warn("Verification did not complete");
    return false;
  }

  async verifyAccount() {
    const earnings = await this.navigateToEarnings();
    if (!earnings) return;

    const btnTexts = earnings.buttons?.flat().map((b) => b.text) || [];
    const testTask = btnTexts.find((b) => SUPPORTED_TASKS.some((t) => b.includes(t)));
    if (testTask) {
      try {
        const taskMsg = await this.clickButton(earnings, testTask, {
          hasButtons: true,
          timeout: 15000,
        });

        if (taskMsg.message?.includes("Verification Required")) {
          this.logger.info("Account needs verification");
          const verified = await this.handleVerification(taskMsg);
          if (verified) {
            await this.navigateToEarnings();
          } else {
            this.logger.warn("Verification failed");
          }
          return;
        }

        const homeBtn = taskMsg.buttons?.flat().find(
          (b) => b.text?.includes("Home") || b.text?.includes("Back"),
        );
        if (homeBtn && !SUPPORTED_TASKS.some((t) => homeBtn.text.includes(t))) {
          await taskMsg.click({ text: (input) => input.includes(homeBtn.text) });
          await this._jitterDelay(1, { signal: this.signal });
        }
      } catch (e) {
        this.logger.warn(`Verification check failed: ${e.message}`);
      }
    }
  }

  async navigateToEarnings() {
    const isTaskList = (msg) => {
      if (!msg?.buttons) return false;
      const btns = msg.buttons.flat().map((b) => b.text);
      return SUPPORTED_TASKS.some((t) => btns.some((b) => b.includes(t)));
    };

    if (isTaskList(this.lastMessage)) return this.lastMessage;

    const curBtnTexts = this.lastMessage?.buttons?.flat().map((b) => b.text) || [];
    const earnBtn = curBtnTexts.find((b) => b.includes("Earnings"));
    if (earnBtn) {
      try {
        await this.lastMessage.click({ text: (input) => input.includes("Earnings") });
        await this._jitterDelay(2, { signal: this.signal });
        const msgs = await this.client.getMessages(this.entity, { limit: 1 });
        if (msgs.length) {
          this.lastMessage = msgs[0];
          if (isTaskList(msgs[0])) return msgs[0];
        }
      } catch {}
    }

    for (let attempt = 0; attempt < 3; attempt++) {
      const menu = await this.sendStart();
      if (!menu) continue;

      const menuBtnTexts = menu.buttons?.flat().map((b) => b.text) || [];
      const eBtn = menuBtnTexts.find((b) => b.includes("Earnings"));
      if (!eBtn) continue;

      try {
        await menu.click({ text: (input) => input.includes("Earnings") });
      } catch {
        continue;
      }
      await this._jitterDelay(2, { signal: this.signal });

      const msgs = await this.client.getMessages(this.entity, { limit: 1 });
      if (!msgs.length) continue;

      this.lastMessage = msgs[0];
      const btns = msgs[0].buttons?.flat().map((b) => b.text) || [];

      if (isTaskList(msgs[0])) return msgs[0];

      const homeBtn = btns.find((b) => b.includes("Home") || b.includes("Back"));
      if (!homeBtn) continue;

      await msgs[0].click({ text: (input) => input.includes(homeBtn) });
      await this._jitterDelay(2, { signal: this.signal });
    }

    return this.lastMessage;
  }

  async showBalance(message) {
    if (!message?.message) return;
    const match = message.message.match(/Main Balance\s*:\s*([\d.]+)\s*USD/);
    if (match) {
      const bal = `${match[1]} USD`;
      this.logger.keyValue("BALANCE", bal);
      try { chrome?.action?.setBadgeText?.({ text: bal }); } catch {}
      try { this.storage?.set?.("adclicker-balance", bal); } catch {}
    }
  }

  async runAllTasks() {
    let message = await this.navigateToEarnings();
    if (!message) return;

    await this.showBalance(message);

    if (message.message?.includes("No tasks are available")) {
      const notifBtn = message.buttons?.flat().find((b) => b.text?.includes("🔔"));
      if (notifBtn) {
        await message.click({ text: notifBtn.text });
        await this._jitterDelay(2, { signal: this.signal });
      }
      return;
    }

    const maxPerTask = this._maxPerTask;

    for (const taskType of SUPPORTED_TASKS) {
      let processed = 0;
      while (!this.signal.aborted && processed < maxPerTask) {
        const btn = message.buttons?.flat().find(
          (b) => b.text?.includes(taskType),
        );
        if (!btn) break;

        this.logger.info(`--- ${taskType} ---`);

        try {
          const isMessageBots = taskType.includes("Message Bots");
          const taskMsg = await this.clickButton(message, btn.text, {
            hasButtons: true,
            timeout: 20000,
          });

          if (taskMsg.message?.includes("No tasks")) {
            this.logger.info(`No more ${taskType}`);
            break;
          }

          if (taskMsg.message?.includes("Verification Required")) {
            this.logger.info("Verification required during task");
            const verified = await this.handleVerification(taskMsg);
            if (verified) {
              message = await this.navigateToEarnings();
              if (!message) break;
              continue;
            }
            break;
          }

          let reward = taskMsg;
          if (!taskMsg.message?.includes("✅ Success")) {
            reward = await this.executeTaskType(taskType, taskMsg);
          }

          if (!reward) {
            this.logger.info(`No reward from ${taskType}`);
            break;
          }

          await this.showBalance(reward);
          this.logger.success(`Done ${taskType}`);
          processed++;

          message = await this.navigateToEarnings();
          if (!message) break;
        } catch (error) {
          this.logger.warn(`Failed ${taskType}: ${error.message}`);
          message = await this.navigateToEarnings();
          break;
        }

        await this._jitterDelay(3, { signal: this.signal });
      }

      message = await this.navigateToEarnings();
    }
  }

  async executeTaskType(taskName, message) {
    if (taskName.includes("Message Bots")) {
      return this.handleMessageBots(message);
    }

    const btns = message.buttons?.flat().map((b) => ({ text: b.text, url: !!b.url })) || [];
    const urlName = (u) => u.replace("https://t.me/", "").replace(/[?#].*$/, "");

    const urlButtons = message.buttons?.flat().filter((btn) => btn.url) || [];
    for (const btn of urlButtons) {
      const name = urlName(btn.url);
      if (taskName.includes("Join")) this.logger.info(`Joining chat ${name}`);
      else if (taskName.includes("View")) this.logger.info(`Viewing post ${name}`);
      await this.joinWithCheck(btn.url);
      await this._jitterDelay(3, { signal: this.signal });
    }

    const actionBtn = message.buttons?.flat().find(
      (b) => !b.url && !b.text?.includes("✅") && !b.text?.includes("🔴") && !b.text?.includes("⏩") && !b.text?.includes("✉️"),
    );
    if (actionBtn) {
      await message.click({ text: (input) => input.includes(actionBtn.text) });
      await this._jitterDelay(2, { signal: this.signal });
    }

    const confirmBtn = btns.find((b) => b.text.includes("✅"));
    if (!confirmBtn) return null;

    await message.click({ text: (input) => input.includes("✅") });
    await this._jitterDelay(2, { signal: this.signal });

    try {
      const msgs = await this.client.getMessages(this.entity, { limit: 1 });
      if (msgs.length > 0) {
        this.lastMessage = msgs[0];
        return msgs[0];
      }
    } catch {}

    return this.lastMessage;
  }

  async handleMessageBots(taskMsg) {
    const msgBtn = taskMsg?.buttons?.flat().find(
      (b) => b.text?.includes("✉️") || b.text?.includes("Message Bot"),
    );
    if (!msgBtn) { this.logger.warn("No Message Bot button"); return null; }

    let targetBot;
    if (msgBtn.url) {
      const match = msgBtn.url.match(/t\.me\/([a-zA-Z0-9_]+)/);
      if (match) targetBot = match[1];
    }
    if (!targetBot) {
      const match = taskMsg?.message?.match(/@([a-zA-Z0-9_]+bot)/i);
      if (match) targetBot = match[1];
    }
    if (!targetBot) { this.logger.warn("Could not determine target bot"); return null; }

    this.logger.info(`Messaging bot @${targetBot}`);
    await taskMsg.click({ text: (input) => input.includes("✉️") });

    await this._jitterDelay(2, { signal: this.signal });
    await taskMsg.click({ text: (input) => input.includes("✅") });

    for (let i = 0; i < 15; i++) {
      if (this.signal.aborted) return null;
      const msgs = await this.client.getMessages(this.entity, { limit: 5 });
      if (msgs.some((m) => m.message?.includes("🔎 Forward any message from"))) {
        let targetEntity;
        try { targetEntity = await this.client.getEntity(targetBot); }
        catch { this.logger.warn(`Could not find bot @${targetBot}`); return null; }

        await this.client.sendMessage(targetEntity, { message: "/start" });
        await this._jitterDelay(3, { signal: this.signal });

        const botMsgs = await this.client.getMessages(targetEntity, { limit: 1 });
        if (!botMsgs.length) { this.logger.warn(`No messages from @${targetBot}`); return null; }

        const fwdMsg = await this.waitForReply(
          () => this.client.forwardMessages(this.entity, {
            messages: [botMsgs[0].id],
            fromPeer: targetEntity,
          }),
          { timeout: 30000, hasButtons: true },
        );

        try {
          const msgs = await this.client.getMessages(this.entity, { limit: 1 });
          if (msgs.length > 0) { this.lastMessage = msgs[0]; return msgs[0]; }
        } catch {}

        return fwdMsg || this.lastMessage;
      }
      await this._jitterDelay(2, { signal: this.signal });
    }

    this.logger.warn("Forward prompt not received");
    return null;
  }

  createTools() {
    return [
      {
        name: "Tasks",
        list: [
          {
            id: "claim-all-tasks",
            icon: "tasks",
            title: "Claim All Tasks",
            action: this.runAllTasks.bind(this),
            dispatch: false,
          },
        ],
      },
    ];
  }
}
