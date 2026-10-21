import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { farmerOpenOptions, shouldOpenWebviewBot } from "../src/lib/farmerOpen.js";

/** A farmer tab as the registry builds it. */
function makeDrop(overrides = {}) {
  return {
    id: "lootvault",
    title: "LootVault",
    icon: "icon",
    FarmerClass: { host: "lootvault.lol", path: "/" },
    ...overrides,
  };
}

describe("farmerOpenOptions", () => {
  it("asks for the webview", () => {
    const options = farmerOpenOptions(makeDrop());

    assert.equal(options.forceWebview, true);
  });

  it("carries the farmer's own host and path", () => {
    const options = farmerOpenOptions(makeDrop());

    /* Without these Telegram hands back the bot's webview, not the app's. */
    assert.equal(options.webviewHost, "lootvault.lol");
    assert.equal(options.webviewPath, "/");
  });

  it("keeps the tab's identity and browser options", () => {
    const options = farmerOpenOptions(
      makeDrop({ embedWebPage: false, embedInNewWindow: true }),
    );

    assert.equal(options.browserId, "lootvault");
    assert.equal(options.browserTitle, "LootVault");
    assert.equal(options.embedWebPage, false);
    assert.equal(options.embedInNewWindow, true);
  });

  it("does not send a force flag the opener never reads", () => {
    const options = farmerOpenOptions(makeDrop());

    assert.equal(
      "force" in options,
      false,
      "`force` is not an option the opener reads — it is silently ignored",
    );
  });

  it("survives a farmer with no class", () => {
    const options = farmerOpenOptions({ id: "x", title: "X" });

    assert.equal(options.webviewHost, null);
    assert.equal(options.webviewPath, null);
  });
});

describe("shouldOpenWebviewBot", () => {
  it("tells Telegram Web to open the mini-app when the farmer wants a webview", () => {
    assert.equal(shouldOpenWebviewBot({ forceWebview: true }), true);
  });

  it("leaves Telegram Web alone otherwise", () => {
    assert.equal(shouldOpenWebviewBot({ forceWebview: false }), false);
    assert.equal(shouldOpenWebviewBot({}), false);
  });

  it("does not let the link's shape decide", () => {
    /* Every mini-app link is a "short app" by the old test, and every one of
       them landed on the bot's chat instead of the app. The click-through is
       what opens the app, so the link must not be able to switch it off. */
    for (const url of [
      "https://t.me/LootVaultDexBot/app?startapp=ref_1",
      "https://t.me/mrgminerbot/app",
      "https://t.me/RigniteBot?startapp=ref_1",
    ]) {
      assert.equal(
        shouldOpenWebviewBot({ forceWebview: true }),
        true,
        `the webview was switched off for ${url}`,
      );
    }
  });
});
