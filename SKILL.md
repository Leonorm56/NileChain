# NileChain — working reference

How this codebase actually behaves. `AGENTS.md` says *how to work*; this says
*how the thing works*. Read it before touching a farmer, the webview, or the
cloud.

- [1. The map](#1-the-map)
- [2. Adding a farmer](#2-adding-a-farmer)
- [3. The webview architecture](#3-the-webview-architecture)
- [4. Traps that cost real time](#4-traps-that-cost-real-time)
- [5. Reading a mini-app from a HAR](#5-reading-a-mini-app-from-a-har)
- [6. LootVault, as a worked example](#6-lootvault-as-a-worked-example)

---

## 1. The map

```
NILECHAIN/
├── packages/shared/            the shared library — both runtimes consume it
│   ├── farmers/<Name>Farmer.js one class per mini-app game
│   ├── lib/BaseFarmer.js       the base class every farmer extends
│   ├── lib/BaseDirectFarmer.js for games that are literally Telegram bots
│   ├── lib/BaseTelegramWebClient.js  MTProto: getWebview, join, startBot
│   ├── lib/CaptchaSolver.js    Turnstile / reCAPTCHA / boterdrop / ezsolver
│   └── assets/images/farmers/<id>.png  the icon (filename == the farmer's id)
├── apps/nilechain-farmer/      the Chrome extension users install
│   ├── src/core/farmers.js     the extension's registry — manual
│   ├── src/hooks/useCore.js    openTelegramBot — decides how a farmer opens
│   ├── src/hooks/useZoomies.js the auto-farming path
│   ├── src/hooks/useTelegramWebApp.js  where a farmer's init data comes from
│   ├── src/extension/content-script-main.js      MAIN world: reads the URL hash
│   ├── src/extension/content-script-isolated.js  connects mini-app:<host> port
│   └── src/lib/farmerOpen.js   the shared options for opening a farmer
├── apps/nilecloud/             the server-side fleet
│   ├── farmers/discover.js     finds the farmer classes (skips test files)
│   ├── farmers/Runner.js       wraps a farmer with DB accounts, auth, cron
│   └── db/models/farmer.js     the per-account row
└── apps/nileearn/              a separate PM2 service
```

**Two runtimes, one class.** The extension registers farmers by hand
(`src/core/farmers.js`); the cloud discovers them by scanning
`packages/shared/farmers/`. Both drive the same class through
`start()` → `process()`.

---

## 2. Adding a farmer

**1. The class** — `packages/shared/farmers/<Name>Farmer.js`

```js
import BaseFarmer from "../lib/BaseFarmer.js";

export default class MyGameFarmer extends BaseFarmer {
  static id = "mygame";              // unique kebab-case. ALSO the icon filename
  static title = "My Game";
  static emoji = "🎮";
  static host = "app.mygame.xyz";    // the page's real host — see §3
  static domains = ["app.mygame.xyz", "api.mygame.xyz", "t.me"];
  static telegramLink = "https://t.me/MyGameBot/app";
  static path = "/";
  static singleton = true;
  static rating = 5;
  static cacheAuth = false;          // true only if the auth is a cacheable token
  static apiDelay = 300;
  static interval = "*/10 * * * *";
}
```

**2. The methods** — the contract

| method | required | notes |
|---|---|---|
| `process()` | **yes** | the run. Throw on auth failure. |
| `login()` | usually | authenticate + load state |
| `logUserInfo()` | usually | print the account summary |
| `getReferralLink()` | **yes** | must always answer — the cloud calls it per account and hard-logs any throw. **See §4.2.** |
| `fetchAuth()` / `getAuthHeaders()` | usually | how the auth travels |
| `createTools()` | optional | extra buttons in the terminal |

Free on `this`: `this.api` (axios, delay + retry interceptors already wired),
`this.logger`, `this.utils`, `this.signal` (check it inside loops),
`this.getInitData()` / `getUserId()` / `getStartParam()`,
`this.executeTask(name, fn)` (logs + 5s padding, **rethrows**),
`this.tryToJoinTelegramLink(link)`, `this.solveTurnstile({siteKey, pageUrl})`,
`this.storage` (extension only).

**3. The icon** — `packages/shared/assets/images/farmers/<id>.png`. The
filename must equal the `id`; the extension renders it at 80×80.

**4. Register (extension)** — `apps/nilechain-farmer/src/core/farmers.js`:
add the import **and** the array entry. The array order is the display order.

**5. Register (cloud)** — nothing. `apps/nilecloud/farmers/discover.js` finds
the file. But a `.test.js` sitting in `packages/shared/farmers/` would be
imported as a farmer class and crash the cloud — see §4.3.

**6. Update the registry test** — `test/farmer-registry.test.mjs` pins the
exact farmer set. **It fails until you add the new id and class name to its
two expected lists.** That failure is the checklist.

---

## 3. The webview architecture

This is the part that is hard to see and expensive to get wrong.

### 3.1 How a farmer gets its init data

A farmer can only talk to the app once it holds the Telegram init data. The
extension gets it like this:

```
the mini-app page is open at  https://<host>/#tgWebAppData=<initData>
        │
        ├─ content-script-main.js   (MAIN world, all_frames)
        │    reads the launch params out of the URL hash
        │    via retrieveRawLaunchParams()  →  {initData, initDataUnsafe,
        │                                          platform, version}
        │    posts them to the isolated script
        │
        ├─ content-script-isolated.js
        │    connects the port named  mini-app:${location.host}
        │    and posts  set-telegram-web-app:${location.host}
        │
        └─ useTelegramWebApp.js
             looks the port up by  mini-app:${host}   ← the farmer's `host`
             → telegramWebApp → the farmer instance
```

**So the farmer's `host` static must be the host the page actually runs on.**
Get it wrong and the port name never matches and the farmer silently gets no
init data.

### 3.2 The two ways the mini-app opens

**In the extension's in-app browser** — `farmerMode === "session"` (needs a
local Telegram session). `getWebview()` asks Telegram for the app's webview
URL and the extension opens it:

```
https://lootvault.lol/#tgWebAppData=<initData>&tgWebAppVersion=9.6
    &tgWebAppPlatform=android&tgWebAppThemeParams={...}
```

**Inside Telegram Web K/A** — `farmerMode === "web"` (the default). The
extension opens the bot in Telegram Web and posts `open-webview-bot` to the
Telegram Web port. A MutationObserver in the page then clicks **START** and
then the mini-app button:

| web version | the button it looks for |
|---|---|
| K | `.is-web-view`, `.reply-markup-button.anchor-url.is-link` |
| A | `button:has(.icon.icon-webapp)`, `.Button:has(.inline-button-text)` |

If the page finds no such button, the observer gives up after 20s — harmless.

### 3.3 `getWebview()` branches on the link's short name

`BaseTelegramWebClient.getWebview()`:

```
link has a short name   (t.me/bot/app)  → RequestAppWebView
                                               + InputBotAppShortName(botId, "app")
                                           → the APP's URL with tgWebAppData  ✅

link has no short name  (t.me/bot)      → RequestMainWebView
                                           → the BOT'S CHAT  ❌
```

**This is why the referral link must keep the `/app`.** Drop it and Telegram
hands back the bot's chat instead of the app — the mini-app never loads, and
the farmer never gets init data. See §4.2.

### 3.4 Opening a farmer — one helper, two callers

`src/lib/farmerOpen.js` → `farmerOpenOptions(drop, { force })` and
`shouldOpenWebviewBot({ forceWebview })`.

Both `TabContent.jsx` (the **Open Bot** button) and `useZoomies.js` (the
auto-farming path) must use it. They drifted once, and the drift was
invisible: see §4.1 and §4.4.

### 3.5 The stored referral link

`launchLink = referralLink || primaryFarmerLink || defaultLink`
(`TabContent.jsx:69`) — the **stored** link wins. It lives in Chrome storage;
the query client (`lib/createQueryClient.js`) is in-memory only.

**After you change a farmer's link shape, the user must reload the
extension** — otherwise the old link is still in storage and still used.

---

## 4. Traps that cost real time

### 4.1 A `force` key that nothing reads

`openTelegramBot` takes **`forceWebview`**. The farming path passed `force`,
which is not an option — silently dropped, so the farmer never asked for a
webview. A wrong option name is the same as no option at all.

### 4.2 A referral link that drops the mini-app

```
t.me/LootVaultDexBot?start=ref_X        → the BOT'S CHAT
t.me/LootVaultDexBot/app?startapp=ref_X  → the APP
```

Every farmer that owns a direct mini-app short name keeps it in
`getReferralLink()`. The referral travels as `?startapp=` — that is what
Telegram hands the mini-app as `start_param`, and what the app parses.

### 4.3 A test file inside `packages/shared/farmers/`

The cloud's discovery imports **every** `.js` file in that folder as a farmer
class. A test file has no default export → `FarmerClass.published` throws on
`undefined` → **the cloud does not start.** `discover.js` filters
`.test.js` / `.spec.js`; keep it that way.

### 4.4 A regex that over-matches

```js
const isShortApp = /^(http|https):\/\/t\.me\/[^\/\?]+(?:\/.*|\?.*)/.test(url);
```

This matches **every** `t.me/bot/...` and `t.me/bot?...` link — i.e. every
modern mini-app link. It was used to switch off the webview click-through,
which silently excluded all nine farmers except the one with a bare bot
link. The link's shape must not decide this; only the farmer's own request
for a webview does.

### 4.5 `node --test` and Windows paths

`import("C:/Users/...")` throws `ERR_UNSUPPORTED_ESM_URL_SCHEME` — a Windows
path looks like a URL with the scheme `c:`. Use `pathToFileURL()`.

### 4.6 A HAR is not a transcript of the server

`content.encoding: "base64"` means the **HAR** stored the body base64 — the
server sent plain bytes. Decode before believing the server sent base64.

And a capture that ends early proves nothing: an 18-second capture of
Telegram Web loading its emoji assets never reaches the point where the
mini-app would have loaded.

---

## 5. Reading a mini-app from a HAR

The mini-app's own bundle names its own endpoints. Pull it out and grep it.

```bash
node -e "
const fs=require('fs');
const har=JSON.parse(fs.readFileSync('app.har','utf8'));
const e=har.log.entries.filter(x=>x.request.url.includes('/assets/index-')).pop();
const js=e.response.content.encoding==='base64'
  ? Buffer.from(e.response.content.text,'base64').toString('utf8')
  : e.response.content.text;
fs.writeFileSync('app.js', js);
"
grep -o '/vx/[a-z0-9/_-]*' app.js | sort -u     # the endpoints, in order
grep -o 'Ze(\"[^\"]*\"' app.js                   # the names the app gives them
```

Then read the transport wrapper to learn the auth and the envelope:

```js
async function Ze(e, t) {
  const r = await (await fetch(`${fS}${e}`, {
    ...t,
    headers: {"Content-Type":"application/json", "X-TG-Init": hS(), ...t?.headers}
  })).json();
  return r;   // { ok: true, d: {...} }  or  { ok: false, e: "..." }
}
```

`hS()` is usually `window.Telegram.WebApp.initData` — the raw init data
string. Many mini-apps carry it in a single custom header and nothing else.

**The bot username** is usually in the app's own share links
(`https://t.me/<Bot>/app`) — the short name after the slash is what
`getWebview()` needs.

---

## 6. LootVault, as a worked example

`packages/shared/farmers/LootVaultFarmer.js` — a same-origin API with
obfuscated paths, a slider captcha and a registration step.

| what | how |
|---|---|
| host | `lootvault.lol` (the API is on the same origin, under `/vx/`) |
| bot | `@LootVaultDexBot`, direct mini-app short name `app` |
| auth | one header, `X-TG-Init: <raw initData>` — no bearer token |
| envelope | `{ok: true, d: {...}}`; failures carry `e` (`no_auth`, `too_fast`) |
| verification | `GET /vx/a0` → `{registered, isAdmin, maintenance}` |
| streak | `GET /vx/tk1` (status) → `POST /vx/tk2/streak` (claim) |
| tasks | `POST /vx/tk2/start` → settle → `POST /vx/tk2/claim` |
| wallet | `POST /vx/wc3` (is it free?) → `POST /vx/w6` (bind) → `POST /vx/w7` (unbind) |
| register | `POST /vx/a1` — needs a TON wallet **and** the captcha token |
| captcha | `POST /vx/cp1` → `{id, q, type:"slider"}` → `POST /vx/cp2` with `{id, duration, moves, slide:true}` |

**The slider captcha.** The app drags a slider and reports the gesture — how
long it took and how many pointer moves. The server only sees those two
numbers and refuses a synthetic one (`too_fast`). The gestures in the real
capture ran 801–1646 ms over 71–113 moves (~11–15 ms per move); replaying
that shape and actually spending the time is what works.

**Registration binds the wallet.** An account with no wallet cannot claim
anything, so the Register task asks for the address itself and remembers it —
rather than pointing the user at a separate tool.

**`isRegistered()`** treats the `w` flag as registered, because `a0` can
report `registered: false` for an account that already has a wallet bound.
