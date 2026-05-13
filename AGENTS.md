# NileChain Project Instructions

## Release Process
- ALWAYS release both CRX and ZIP files.
- Run `node release.js` to release — never upload manually.
- `release.js` handles: version bump → build → rename zip/crx → commit → push → GitHub release.
- `telegramClient: "purrfect-gram"` in `defaultSharedSettings.js` must never change.

## ADCLICKER Farmer
- Finalized Message Bots handler: click ✉️ → press ✅ → wait for `🔎 Forward...` → send /start to target bot → forward fresh message.
- `navigateToEarnings()` between each individual task (not just between task types).

## Verification Bypass (Direct API)
- The "✅ Start Verification" button is a `KeyboardButtonWebView` pointing to `https://www.adclickersbot.com/verify?id=...`.
- `RequestWebView` returns an authenticated URL with `#tgWebAppData=...` containing HMAC-signed initData.
- `_verifyViaDirectApi()` bypasses the browser entirely by calling adclickersbot.com API endpoints directly:
  1. Extract `tgWebAppData` (initData) from the RequestWebView URL hash via `this.utils.extractTgWebAppData(url)`
  2. Fetch the verification page HTML to get session cookies + embedded tokens (`webId`, `csrfToken`, `sessionId`)
  3. `POST /api/interaction` to register the server-side session
  4. `POST /api/captcha/generate` with `{webId, sessionId, tgData}` → returns captcha with target emoji
  5. `POST /api/captcha/validate` with `{selectedEmoji: targetEmoji, captchaToken}` and header `Action: verify`
- If the response `success=true`, verification is complete. The flag `this._directVerificationDone` is set.
- `handleVerification()` checks `this._directVerificationDone` after `_invokeVerificationUrl()` to skip the 30s polling loop.
- No headless browser needed — the Mini App SPA is just a UI; the real work happens server-side via API calls.
- Anti-tamper checks (devtools, headless, visibility abuse) are all client-side and don't affect direct API calls.
- Key constraint: the `tgData` must be a genuine HMAC-signed initData from Telegram (obtained via `RequestWebView`).
