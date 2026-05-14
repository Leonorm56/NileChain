import { Api } from "telegram";
import BaseDirectFarmer from "../lib/BaseDirectFarmer.js";

const CHANNEL_LINKS = [
  "https://t.me/AdclickersbotGroup",
  "https://t.me/adclickersbotchannel",
  "https://t.me/gxgsport_bot",
  "https://t.me/brand_awareness",
  "https://t.me/taskonlinebotChannel",
  "https://t.me/AdclickersbotPaymentChannel",
];

const SUPPORTED_TASKS = ["Join Chats"];

export default class ADCLICKERFarmer extends BaseDirectFarmer {
  static id = "adclicker";
  static title = "ADCLICKER";
  static emoji = "🤖";
  static telegramLink = "https://t.me/adclickersbot?start=6627962056";
  static interval = "*/15 * * * *";
  static host = "";
  static domains = [];
  static singleton = true;
  static rating = 3;

  async sendStart() {
    // Sync the message ID counter by fetching recent messages before sending
    // (avoids MSGID_DECREASE_RETRY after subscribing to channels)
    try {
      await this.client.getMessages(this.entity, { limit: 1 });
    } catch {}
    return this.sendMessage("/start", {}, { hasButtons: false, timeout: 10000 });
  }

  _isEarningsPage(msg) {
    if (!msg?.buttons) return false;
    const btns = msg.buttons.flat().map((b) => b.text);
    return SUPPORTED_TASKS.some((t) => btns.some((b) => b.includes(t)));
  }

  async process() {
    await this.logUserInfo();
    await this.executeTask("Subscribe to Channels", () => this.subscribeToChannels());
    await this.executeTask("Verify", () => this.verifyAccount());
    await this.executeTask("Tasks", () => this.runAllTasks());
    await this.executeTask("Faucet", () => this.handleFaucetClaim(), false);
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
      if (this.lastMessage?.message) {
        const m = this.lastMessage.message.match(/Main Balance\s*:\s*([\d.]+)\s*USD/);
        if (m) { balance = `${m[1]} USD`; this.logger.keyValue("Balance", balance); return; }
      }
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

  async _sendInteraction(host, headersFn, { webId, sessionId, tgInitData, pageUrl, actions, startTime, timeSpent }) {
    try {
      const now = new Date().toISOString();
      const resp = await fetch(`${host}/api/interaction`, {
        method: "POST", headers: headersFn(), credentials: "include",
        body: JSON.stringify({
          webId, sessionId, isTelegramWebApp: true, telegramInitData: tgInitData,
          userAgent: "Mozilla/5.0 (Linux; Android 15; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/136.0.7103.60 Mobile Safari/537.36 Telegram-Android/11.6.1",
          deviceType: "Mobile", browser: "Chrome", operatingSystem: "Android",
          screenResolution: "1280x720", url: pageUrl,
          startTime: startTime || now, endTime: now,
          timeSpent: timeSpent || 0, actions, isAdBlocker: false,
        }),
      });
    } catch {}
  }

  async _verifyViaDirectApi(webviewUrl) {
    let tgInitData;
    try {
      const extracted = this.utils.extractTgWebAppData(webviewUrl);
      tgInitData = extracted.initData;
    } catch { return false; }
    if (!tgInitData) return false;

    const parsed = new URL(webviewUrl);
    const host = parsed.origin;
    const baseUrl = `${parsed.origin}${parsed.pathname}${parsed.search}`;
    const pageUrl = webviewUrl;

    let pageResp;
    try { pageResp = await fetch(baseUrl, { method: "GET", redirect: "follow", credentials: "include" }); }
    catch { return false; }
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

    const startTime = new Date().toISOString();
    const allActions = [];

    const headers = (extra = {}) => ({
      "Content-Type": "application/json",
      "CSRF-Token": csrfToken,
      ...extra,
    });

    // Step 1: Send dom_loaded interaction
    allActions.push({
      type: "dom_loaded", data: "Document fully loaded",
      additionalData: { timestamp: new Date().toISOString(), url: pageUrl },
    });
    await this._sendInteraction(host, headers, { webId, sessionId, tgInitData, pageUrl, actions: allActions, startTime });
    await this._jitterDelay(2, { signal: this.signal });

    // Step 2: Send click on Verify button
    allActions.push({
      type: "click", data: "User clicked an element",
      additionalData: { tagName: "button", id: "verify-button", className: "bg-green-500 text-white py-2 px-4 rounded-lg hover:bg-green-600 transition duration-200", coordinates: { x: 320, y: 480 }, isTrusted: true },
    });
    await this._sendInteraction(host, headers, { webId, sessionId, tgInitData, pageUrl, actions: allActions, startTime, timeSpent: 2 });
    await this._jitterDelay(2, { signal: this.signal });

    // Step 3: Generate captcha
    let captchaData;
    try {
      const genResp = await fetch(`${host}/api/captcha/generate`, {
        method: "POST", credentials: "include",
        headers: { ...headers(), referer: baseUrl },
        body: JSON.stringify({ webId, sessionId, tgData: tgInitData }),
      });
      captchaData = await genResp.json();
      if (!captchaData.success) { this.logger.warn("Captcha generate failed"); return false; }
    } catch { this.logger.warn("Captcha generate error"); return false; }

    const targetEmoji = captchaData.captcha?.targetEmoji;
    const captchaToken = captchaData.captcha?.captchaToken;
    if (!targetEmoji || !captchaToken) return false;

    this.logger.info(`Captcha: select "${targetEmoji}"`);

    // Step 4: Send captcha ready + emoji click
    allActions.push({ type: "captcha_ready", data: "Captcha loaded, user selecting emoji" });
    allActions.push({
      type: "click", data: "User clicked an element",
      additionalData: { tagName: "button", className: "emoji-button text-2xl p-2 bg-gray-200 rounded-lg hover:bg-blue-100 transition duration-200 focus:outline-none", coordinates: { x: 250, y: 350 }, isTrusted: true },
    });
    await this._sendInteraction(host, headers, { webId, sessionId, tgInitData, pageUrl, actions: allActions, startTime, timeSpent: 8 });
    await this._jitterDelay(1, { signal: this.signal });

    // Step 5: Send click on Submit button after emoji selection
    allActions.push({
      type: "click", data: "User clicked an element",
      additionalData: { tagName: "button", id: "submit-button", className: "mt-4 bg-blue-500 text-white py-2 px-4 rounded-lg disabled:bg-gray-300 disabled:cursor-not-allowed hover:bg-blue-600 transition duration-200", coordinates: { x: 320, y: 550 }, isTrusted: true },
    });
    await this._sendInteraction(host, headers, { webId, sessionId, tgInitData, pageUrl, actions: allActions, startTime, timeSpent: 9 });
    await this._jitterDelay(1, { signal: this.signal });

    // Step 7: Validate captcha
    try {
      const validateResp = await fetch(`${host}/api/captcha/validate`, {
        method: "POST", credentials: "include",
        headers: { ...headers({ Action: action }), referer: baseUrl },
        body: JSON.stringify({ webId, sessionId, tgData: tgInitData, selectedEmoji: targetEmoji, captchaToken }),
      });
      const validateData = await validateResp.json();
      if (!validateData.success) {
        const msg = validateData.message || "validation failed";
        this.logger.warn(`Captcha validation failed: ${msg}`);
        return false;
      }
    } catch (e) { this.logger.warn(`Captcha validation error: ${e.message}`); return false; }

    this.logger.info(`Captcha solved (${action})`);

    // If faucet, call /popup-ads to claim reward
    if (action === "faucet") {
      try {
        const popupResp = await fetch(`${host}/popup-ads`, {
          method: "POST", credentials: "include",
          headers: { ...headers(), referer: baseUrl },
        });
        const popupData = await popupResp.json();
        if (popupData.success && popupData.link) {
          this.logger.info(`Faucet reward link: ${popupData.link}`);
          if (popupData.link.includes("t.me/")) {
            await this.joinTelegramLink(popupData.link);
          } else {
            await fetch(popupData.link, { method: "GET", redirect: "follow" }).catch(()=>{});
          }
        }
      } catch (e) { this.logger.warn(`Faucet reward error: ${e.message}`); }
    }

    this._directVerificationDone = true;
    return true;
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
    // Verification is handled during task execution if needed.
    // No need to pre-click a task button here.
    await this.navigateToEarnings();
  }

  async navigateToEarnings() {
    if (this._isEarningsPage(this.lastMessage)) return this.lastMessage;

    // Try to find an existing earnings page in recent messages (no clicks needed)
    try {
      const recent = await this.client.getMessages(this.entity, { limit: 10 });
      for (const msg of recent) {
        if (this._isEarningsPage(msg)) {
          this.lastMessage = msg;
          return msg;
        }
      }
    } catch {}

    // If current message has an Earnings button, click it
    const curBtnTexts = this.lastMessage?.buttons?.flat().map((b) => b.text) || [];
    const earnBtn = curBtnTexts.find((b) => b.includes("Earnings"));
    if (earnBtn) {
      try {
        await this.lastMessage.click({ text: (input) => input.includes("Earnings") });
        await this._jitterDelay(2, { signal: this.signal });
        const msgs = await this.client.getMessages(this.entity, { limit: 1 });
        if (msgs.length) {
          this.lastMessage = msgs[0];
          if (this._isEarningsPage(msgs[0])) return msgs[0];
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

      if (this._isEarningsPage(msgs[0])) return msgs[0];

      const btns = msgs[0].buttons?.flat().map((b) => b.text) || [];
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
    if (!message) return false;

    const earningsPage = message;
    await this.showBalance(message);

    if (message.message?.includes("No tasks are available")) {
      const notifBtn = message.buttons?.flat().find((b) => b.text?.includes("🔔"));
      if (notifBtn) {
        await message.click({ text: notifBtn.text });
        await this._jitterDelay(2, { signal: this.signal });
      }
      this.lastMessage = earningsPage;
      return false;
    }

    const maxPerTask = this._maxPerTask;
    let allEmpty = false;

    for (const taskType of SUPPORTED_TASKS) {
      if (allEmpty) break;
      let processed = 0;
      while (!this.signal.aborted && processed < maxPerTask) {
        const btn = message.buttons?.flat().find(
          (b) => b.text?.includes(taskType),
        );
        if (!btn) break;

        try {
          const taskMsg = await this.clickButton(message, btn.text, {
            hasButtons: true,
            timeout: 20000,
          });

          if (taskMsg.message?.includes("No tasks")) {
            allEmpty = true;
            break;
          }

          this.logger.info(`--- ${taskType} ---`);

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

    }

    this.lastMessage = earningsPage;
    return !allEmpty;
  }

  async executeTaskType(taskName, message) {
    const btns = message.buttons?.flat().map((b) => ({ text: b.text, url: !!b.url })) || [];
    const urlName = (u) => u.replace("https://t.me/", "").replace(/[?#].*$/, "");

    const urlButtons = message.buttons?.flat().filter((btn) => btn.url) || [];
    for (const btn of urlButtons) {
      const name = urlName(btn.url);
      if (taskName.includes("Join")) this.logger.info(`Joining chat ${name}`);
      else if (taskName.includes("View")) this.logger.info(`Viewing post ${name}`);
      await this.joinTelegramLink(btn.url);
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

  async handleFaucetClaim() {
    let message = await this.navigateToEarnings();
    if (!message) return;
    const earningsPage = message;

    try {
      // Look for a Faucet button
      const faucetBtn = message.buttons?.flat().find(
        (b) => b.text?.includes("Faucet") || b.text?.includes("💰"),
      );
      if (!faucetBtn) {
        // Try sending /faucet command
        this.logger.info("No faucet button, trying /faucet command...");
        try {
          const reply = await this.sendMessage("/faucet", {}, { hasButtons: false, timeout: 10000 });
          if (reply?.message?.includes("Verification Required") || reply?.message?.includes("faucet")) {
            message = reply;
          } else {
            const homeBtn = reply?.buttons?.flat().find((b) => b.text?.includes("Home") || b.text?.includes("Back"));
            if (homeBtn && !homeBtn.text?.includes("Faucet")) {
              await reply.click({ text: (input) => input.includes(homeBtn.text) });
              await this._jitterDelay(1, { signal: this.signal });
            }
            return;
          }
        } catch {
          return;
        }
      }

      // Click faucet button
      this.logger.info("Claiming faucet...");
      let taskMsg;
      try {
        taskMsg = await this.clickButton(message, faucetBtn.text, { hasButtons: true, timeout: 15000 });
      } catch {
        try {
          taskMsg = await this.clickButton(message, faucetBtn.text, { hasButtons: true, edited: true, timeout: 15000 });
        } catch {
          const msgs = await this.client.getMessages(this.entity, { limit: 1 });
          taskMsg = msgs[0] || null;
        }
      }

      if (!taskMsg) return;

      // Check for verification/captcha
      if (taskMsg.message?.includes("Verification Required")) {
        await this.handleVerification(taskMsg);
        return;
      }

      // Check for webview button to start faucet captcha
      const webviewBtn = taskMsg.buttons?.flat().find((b) => {
        const raw = b?.button || b;
        return raw.url && raw.className?.includes("WebView");
      }) || taskMsg.buttons?.flat().find((b) => b.text?.includes("Start") || b.text?.includes("Verify"));

      if (webviewBtn) {
        const raw = webviewBtn?.button || webviewBtn;
        if (raw.url) {
          const result = await this.client.invoke(
            new Api.messages.RequestWebView({
              platform: "android", bot: this.entity, peer: this.entity,
              url: raw.url, fromBotMenu: false,
            }),
          ).catch(() => null);
          if (result?.url) {
            const bypassed = await this._verifyViaDirectApi(result.url);
            if (bypassed) {
              this.logger.success("Faucet claimed");
            }
            return;
          }
        }
        if (raw.data) {
          const answer = await this.client.invoke(
            new Api.messages.GetBotCallbackAnswer({
              peer: this.entity, msgId: taskMsg.id, data: raw.data,
            }),
          ).catch(() => null);
          if (answer?.url) await this._verifyViaDirectApi(answer.url);
        }
      }

      // If faucet task succeeded, show new balance
      if (taskMsg.message?.includes("✅") || taskMsg.message?.includes("Success")) {
        await this.showBalance(taskMsg);
        this.logger.success("Faucet claimed");
      }
    } finally {
      this.lastMessage = earningsPage;
    }
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
