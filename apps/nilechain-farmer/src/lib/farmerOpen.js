/**
 * The options for opening a farmer's mini-app.
 *
 * The farmer's own host and path have to travel with the request: Telegram
 * hands back a webview for the bot, not for the app, and only the override
 * points it at the app the farmer actually farms.
 *
 * `forceWebview` is the flag the opener reads. Passing a bare `force` reads
 * as nothing at all, and the farmer then opens the bot's chat instead of the
 * app.
 *
 * @param {object} drop - the farmer tab being opened
 * @param {{force?: boolean}} [options]
 * @returns {object} the options for opening a farmer
 */
export function farmerOpenOptions(drop, { force = true } = {}) {
  return {
    forceWebview: force,
    browserId: drop?.id,
    browserTitle: drop?.title,
    browserIcon: drop?.icon,
    embedWebPage: drop?.embedWebPage,
    embedInNewWindow: drop?.embedInNewWindow,
    webviewHost: drop?.FarmerClass?.host || null,
    webviewPath: drop?.FarmerClass?.path || null,
  };
}

/**
 * Should the Telegram Web page be told to open the mini-app in a webview?
 *
 * The message makes the Telegram Web page click through to the app: it starts
 * the bot and then opens the mini-app — either from the app's own launch page
 * or from the mini-app button in the bot's chat. Both buttons are what the
 * page looks for.
 *
 * The shape of the link must not decide this. A direct mini-app link
 * (`t.me/bot/app`) lands on the bot's chat, not on the app, so it needs the
 * click-through at least as much as a plain bot link does — and a link that
 * already opens the app has nothing to click, which the page handles by
 * finding no button.
 *
 * @param {{forceWebview?: boolean}} options
 * @returns {boolean}
 */
export function shouldOpenWebviewBot({ forceWebview } = {}) {
  return forceWebview === true;
}
