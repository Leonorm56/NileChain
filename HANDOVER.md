# NILECHAIN — Complete AI Handover

> Read this end-to-end before touching anything. It explains the whole ecosystem, every folder, every config, current state, known pitfalls, and how to operate the farm. Written for the next AI that takes over this session.

---

## 1. What This Project Is

**NileChain** is a farming/botting ecosystem around Telegram mini-app games (HeadCoin, TradingWars, ATF, DreamcoinPro, SpaceJump, ADCLICKER). All code lives in a monorepo. The main deliverables:

1. **NileChain Farmer** — a Chrome extension (`apps/nilechain-farmer`) that users install to farm games in their browser AND to sync account "initData" to a cloud server.
2. **nileflylite** (`apps/nileflylite`) — **the most actively worked-on piece right now**. A lightweight Node.js cloud server that takes synced accounts from the extension and farms them 24/7 in a continuous PM2 loop, sending Telegram summaries.
3. **nilefly** / **purrfect-fly** (`apps/nilefly` and `apps/purrfect-fly`) — the older, heavyweight server versions (with DB, Sequelize, MTProto, many farmers). Generally considered legacy; the direction is toward the "lite" approach. `purrfect-fly` is basically a rebranded/template fork, largely unused.
4. **packages/shared** — shared farmer classes consumed by the extension and reusable logic.

The live deployment that matters is **nileflylite on an AWS Ubuntu server** (`ubuntu@ip-172-31-47-114`, at `~/NileChain`). 11 accounts are currently synced and being farmed.

---

## 2. Repository Layout (top level)

```
NILECHAIN/
├── apps/
│   ├── nilechain-farmer/     # Chrome extension (the client)
│   ├── nileflylite/          # ★ ACTIVE server farmer (main focus)
│   ├── nilefly/              # older heavyweight server (legacy)
│   └── purrfect-fly/         # rebrand fork of nilefly (mostly unused)
├── packages/
│   └── shared/               # shared farmer logic for extension
├── .github/workflows/
│   └── release.yml           # CI: builds + releases on tag push
├── package.json              # root manifest, version 1.0.65
├── pnpm-workspace.yaml       # monorepo packages
├── pnpm-lock.yaml
├── release.js                # manual release script (legacy/partial)
├── key.pem                   # RSA signing key (private) — do NOT leak
├── nilechain-farmer-v1.0.62.{crx,zip}  # old artifacts
├── whiskers/                 # native bridge assets (Exe/Zip ignored)
├── temp_build.ps1            # temp helper
└── HANDOVER.md               # this file
```

**Workspace:** uses `pnpm`. Root scripts: `pnpm build:farmer` (= `pnpm -F nilechain-farmer build`), `pnpm start:fly` (= purrfect-fly). The root and extension share version `1.0.65`.

---

## 3. Release Mechanism — READ THIS CAREFULLY

This is the single most confusing part (we made errors here). Two ways to release:

### 3a. Release via `release.js` (manual, NOT the preferred path anymore)
`release.js` bumps versions in the two `package.json` files, runs `pnpm build:farmer`, assembles artifacts under `apps/nilechain-farmer/dist-bundle/`, commits, pushes, and calls `gh release create`. It uses Windows `cmd` syntax (`del`, `ren`) — it is Windows-specific and obsolete.

### 3b. Release via CI (`.github/workflows/release.yml`) — RECOMMENDED
The GitHub Action triggers on **any pushed tag `v*.*.*`**. It:
1. Checks out + installs.
2. Builds with `EXTENSION_PRIVATE_KEY` (from GitHub secret) for CRX signing; `VITE_SEEKER_SERVER`, `VITE_PWA_URL` secrets, and `BASE_URL` (GitHub Pages URL).
3. Uploads PWA to GitHub Pages.
4. Attaches `dist-bundle/*.crx` and `*.zip` to the release.

**To release:** bump the version number in BOTH `package.json` (root) and `apps/nilechain-farmer/package.json`, commit, then tag + push. Example:
```bash
git tag v1.0.66 && git push origin v1.0.66
```

### Version history
- 1.0.62 → artifacts `nilechain-farmer-v1.0.62.{crx,zip}`
- 1.0.64 → Release commit `b13e7edd7`
- **1.0.65 (current)** → Release commit `5c0d2b6b8`, tag `v1.0.65`, GitHub release https://github.com/Leonorm56/NileChain/releases/tag/v1.0.65

Artifacts in `dist-bundle/` for 1.0.65:
```
nilechain-farmer-v1.0.65.crx / .zip          (main extension)
nilechain-farmer-whisker-v1.0.65.crx / .zip  (whisker build)
nilechain-farmer-bridge-v1.0.65.crx / .zip   (bridge build)
```

### ⚠️ Version bump locations (must stay in sync)
- `package.json` → `"version"`
- `apps/nilechain-farmer/package.json` → `"version"`
Line 8 of `release.js` reads the root version and the extension inherits it.

---

## 4. apps/nilechain-farmer (Chrome Extension)

The client users install. Key facts:

- `vite.config.js` — multiple build entry points:
  - `index` (PWA/web app, `index.html`)
  - `chrome-service-worker`
  - `content-script-main`
  - `content-script-isolated`
  - Plus `content-script-styles.css`.
- Build scripts (`package.json`): `build` runs `clean` then:
  - `build-pwa` (VITE_PWA=true)
  - `build-extension` (VITE_EXTENSION=true → builds index + service worker + content scripts + `bundle-extension.js`)
  - `build-whisker` (VITE_WHISKER=true)
  - `build-bridge` (VITE_BRIDGE=true)
- Build outputs land in `dist-extension/`, `dist-whisker/`, `dist-bridge/`, and final packages land in `dist-bundle/`.
- `src/` is huge (React + TanStack Query + Vite). Notable: `src/lib/createFarmer.js`, `src/partials/*`, `src/hooks/*`, `src/lib/bridge-client.js`, `src/lib/bridge-service-worker.js`, `src/lib/createTelegramClient.js`.
- `destructure dist.pem` — the CRX signing private key (`apps/nilechain-farmer/dist.pem`). **It is gitignored.** In the CI it comes from the `EXTENSION_PRIVATE_KEY` secret. Keep the local `dist.pem` safe; if CI needs it, it must be added as the repo secret.
- `.env` exists locally with dev vars (do not commit).
- The extension talks to the cloud server via Cloud Manager (`src/partials/CloudManager*`, host config in server).

### ⚠️ `.gitignore` note (we made a mistake here)
`apps/nilechain-farmer/.gitignore` ignores `dist-*` folders. That's **intentional and correct** — built artifacts should NOT be committed (CI builds them). Dist bundles are attached to releases, not committed. Do not `git add -f` them unless you know why.

---

## 5. apps/nile-flylite — ⭐ THE ACTIVE CLOUD FARMER

This is the code actually running the 11-account farm. Understand it deeply.

### 5.1 Files
```
apps/nileflylite/
├── server.js          # HTTP API server (port 3000), endpoint handling
├── run.js             # THE continuous farming loop (while(true) via `nilefly-runner`)
├── up.js              # one-shot bootstrap (install → server → one cycle)
├── import-backup.js   # import from old nilefly backup
├── setup.sh           # bash setup
├── ecosystem.config.cjs  # PM2 config (TWO apps)
├── config.json       # server + telegram settings  (★ NOT committed with secrets)
├── accounts.json      # account storage (★ NEVER commit — has session/initData)
├── farmers/
│   ├── headcoin.js         # HeadCoin farmer (HTTP initData)
│   └── tradingwars.js      # TradingWars farmer: mining + (trading REMOVED) 
├── lib/
│   ├── http.js             # post()/postJson() with 3 attempts + backoff
│   ├── logger.js           # console logger helpers
│   ├── storage.js          # read/write config.json, accounts.json
│   ├── telegram-bot.js     # Telegram Bot API (sendCycleSummary / sendFarmerSummary + delete prev)
│   ├── telegram-utils.js   # getInitDataUnsafe(javascript parsing)
│   └── gram-client.js      # MTProto phone login / session refresh
└── sessions/               # MTProto session files (gitignored)
```

### 5.2 PM2 – TWO processes (beware the names!)
`ecosystem.config.cjs` defines **two separate apps** — this confused us earlier:

| PM2 name | script | role |
|---|---|---|
| `nileflylite` | `server.js` | HTTP API server (serves extension requests on port 3000) |
| `nilefly-runner` | `run.js` | **the continuous farming loop** |

- Logs:
  - server: `err.log`, `out.log`
  - runner: **`run-err.log`**, **`run-out.log`**
- When debugging farming, look at the *runner* logs, and restart `nilefly-runner`.
- Restart both: `pm2 restart nilefly-runner && pm2 restart nileflylite`.

### 5.3 The farming loop (`run.js`)
- `run()` contains `while(true) { await runCycle() }` — **no sleep** between full cycles (cycles are back-to-back). There is NO cron anymore (we removed cron for the runner). This is intentional: user chose "continuous while(true) loop via PM2".
- `runCycle()`:
  1. `readAccounts()` → array.
  2. For each account, farms both farmers in parallel: HeadCoin + TradingWars (`Promise.all(FARMERS.map(...))`), 2s sleep between accounts.
  3. Groups results, then calls `bot.sendFarmerSummary(farmerId, farmerTitle, results, meta)` per farmer group.
  4. Writes back to `accounts.json`.
- Each result pushed into `allResults` includes both `accountId` (numeric TG id) and `accountTitle` (username) — used by Telegram formatting.

### 5.4 Telegram messages (`lib/telegram-bot.js`)
- `createBot(token, chatId, threadId)`.
- If `!token || !chatId` → returns a **no-op mock** that now includes BOTH `sendCycleSummary` and `sendFarmerSummary` (we fixed a bug where it only had `sendCycleSummary` → caused `bot.sendFarmerSummary is not a function`).
- Real bot sends ONE message per farmer type per cycle (separate TradingWars and HeadCoin messages), and `deletePrevious()` deletes the earlier message before sending the new one (editing-in-place pattern), using `last_message_<farmerId>.json`.
- Formatting details we implement:
  - TradingWars line: `<accountTitle || accountId> — <TWARS rounded to 2dp> TWARS`.
  - HeadCoin line: `<accountTitle || accountId> — <profit>/h` (+ `⬆upgrades`).
  - Errors section now also shows `accountTitle || accountId` (usernames when available).
- **Known API nuance:** Telegram returns HTTP 200 even on failure (with `{"ok":false,"description":"..."}` in body). `sendMessage` now checks `parsed.ok` and logs `parsed.description` when false (we fixed silent failures).

### 5.5 HeadCoin farmer (`farmers/headcoin.js`)
- API base `https://headgun.org/headcoin`. Auth via `initData` from extension sync (HTTP, no MTProto needed).
- `parseState` splits the state string by `|;1f~` (decodes `decodeURIComponent` first).
- Daily bonus claim, card upgrades. `MAX_PPH = 10000` (note: the SHARED `HeadCoinFarmer.js` uses `maxCardCost 150000`; the lite one caps PPH at 10k — intentional per user request). **Discrepancy to be aware of.**
- 2s delay between accounts.

### 5.6 TradingWars engine (`farmers/tradingwars.js`) — the main recent work
- API: `API_BASE = "https://tradingwars.site"` (see line 7 of the file). Auth: `x-auth` header = initData, `x-av: 4`, Telegram Android UA.
- `refreshInitData` via MTProto if no cached initData.
- **Mining strategy (important decision made):**
  - Venues: `venue_home` (21 slots), `venue_garage` (24), `venue_hotel` (27), `venue_datacenter` (36).
  - `gpu_1050ti` slots are FIXED per venue (not random) and are cheap (50 coins); `asic_s9` cost 9,300 coins and fill the remaining slots (they are expensive).
  - Slot counts for 1050ti: Home=12, Garage=12, Hotel=12, Data Center=6.
  - **Two-phase strategy**:
    - Phase 1: fill all `gpu_1050ti` slots → unlock next venue (Garage 1000, Hotel 10000, DC 100000) → repeat until all 4 venues unlocked and all 1050ti filled.
    - Phase 2: only after ALL venues unlocked AND all 1050ti slots filled → buy `asic_s9` for remaining slots.
  - Affordability: skip a slot (log `need X more`) if balance < cost — does NOT call the API (avoid `errorCode: 14` = insufficient funds).
  - In-memory `miningBalance -= cost` each purchase to avoid over-spending within a cycle.
- **TRADING (staking + openPosition) was REMOVED** by user request (`remove TWARS trading`). The `tradesCount` counter and staking/trading block were deleted. `apiGet`/`decodeKlines` remain defined but unused (dead code — safe to remove).
- `allFull` check: `const allFull = VENUE_ORDER.every(vk => ... venueGpus.length >= TOTAL_SLOTS[vk])` — defines all-full before upgrade attempt (we fixed a `allFull is not defined` ReferenceError).

### 5.7 Config & secrets (CRITICAL — do not repeat our mistake)
- `config.json` and `accounts.json` contain **sensitive data**. They are listed in `apps/nileflylite/.gitignore` **and are NOT in the git repo**.
- **History of the mistake:** a commit (`740963c84`) did `git rm config.json` and added it to `.gitignore`, which **deleted the file from production on `git pull`** toggling the user's bot token / chatId. We then:
  1. Force-pushed to revert a commit that accidentally committed the *real* Telegram bot token (user had to **revoke that token** because it leaked to a public GitHub).
  2. Re-added `config.json` to the repo as a **template with empty values** (commit `fa3d844c8`), keeping it tracked so `git pull` recreates it.
- **Therefore:** the version of `config.json` in git MUST remain a template with EMPTY token/chatId. NEVER commit real tokens. The real values live only on the server.
- On the server the user manually wrote: an actual bot token, `chatId: "-1003548704230"`, `threadId: "4"`. (After the leak they planned to create a NEW bot/token — **check with the user before assuming current token works**.)

---

## 6. The Live Server State (AS OF LAST SESSION)

- **Host:** `ubuntu@ip-172-31-47-114` (AWS). Repo at `~/NileChain`.
- **11 accounts** farmed on cloud (HeadCoin + TradingWars).
- **PM2:** `nileflylite` (server, port 3000) + `nilefly-runner` (loop) both **online**.
- The runner loops continuously; mining log shows "needs asic_s9 (9,300 coins) — need N more" repeatedly because balance < 9,300. This is EXPECTED (not a bug) — it will keep trying each cycle until enough coins accumulate.
- A recent deploy command that works WITHOUT the config getting clobbered (the server has divergent git history after our force-push). We've been using a **`git fetch origin && git checkout origin/main -- <files>` + `pm2 restart <app>` pattern** rather than plain `git pull` (plain pull fails with "divergent branches" on that server).

### Deploy just updated files (safe pattern — use this!)
```bash
cd ~/NileChain
git fetch origin
git checkout origin/main -- apps/nileflylite/lib/telegram-bot.js apps/nileflylite/farmers/tradingwars.js apps/nileflylite/run.js apps/nileflylite/README.md
pm2 restart nilefly-runner
```
Restart the server too if server.ll changed: `pm2 restart nileflylite`.

> ⚠️ **Do NOT run bare `git pull` on that server** — it aborts with "Please specify how to reconcile divergent branches" from the earlier force-push. Prefer the `git fetch + git checkout <file>` pattern.

---

## 7. packages/shared (extension shared logic)

- `farmers/` maps each game's logic:
  - `ATDFarmer.js`, `DreamcoinProFarmer.js`, `HeadCoinFarmer.js`, `SpaceJumpFarmer.js`, `ATTFarmer.js`, `WhiskersFarmer.js`, `mouthFarmer.js`… etc. See listing.
  - `TradingWarsFarmer.js` contains the shared extension-side Trading model — **note it also has the two-phase mining logic** (`_upgradeEquipment`, etc.). The nile/flylite server reimplements this rather than reusing the class, because nilefly-lite is dependency-light HTTP-only.
- `lib/` — base classes and helpers: `BaseFarmer.js`, `BaseDirectFarmer.js`, `BaseTelegramWebClient.js`, `BaseLogger.js`, `ConsoleLogger.js`, `BrowserLogger.js`, `BaseRunner.js`, `CronRunner.js`, `Encrypter.js`, `CaptchaSolver.js`, `atf-auto*.js`.
- The extension imports these; the server does NOT (lite is independent).

---

## 8. apps/nilefly & apps/purrfect-fly (legacy)

Heavyweight farmers: **Node + Express + Router + MySQL/Sequelize + JWT + MTProto**.
- Have `db/`, `routes/`, `controllers/`, `actions/`, `commands/`, `farmers/`, `plugins/`, `tests/`, `startup.js`, `cron.js`.
- `purrfect-fly` looks like a **rebranded/template copy** of `nilefly` that's largely unused (root's `start:fly` points to it).
- These are NOT deployed in our recent work; the "lite" direction supersedes them. Unless the user asks, keep hands off.

---

## 9. Current Git State & Important Commands

- Repo: `https://github.com/Leonorm56/NileChain` (origin). There is also an `upstream` remote → `purrfect-farmer/purrfect-farmer` (used by `release.js` in flutter; not for our live pushes — use origin).
- Current version: **1.0.65**.
- Branch: `main`.
- Release command that works: tag `vX.Y.Z` and push to origin (GitHub Actions builds+releases).

### Common operations
```bash
# pull latest simply (local, not the server)
git fetch origin && git reset --hard origin/main    # CAREFUL — wipes local edits
# inspect secrets got removed
git log --oneline -10

# cut a release (on this working dir)
# 1) bump version in root + apps/nilechain-farmer/package.json
# 2) git add . && git commit -m "Release v1.0.66"
# 3) git tag v1.0.66 && git push origin main --tags
# GH Actions will build & attach artifacts + deploy PWA; nothing to do manually.
```

### Known/verboten things
- Never commit real credentials (Telegram bot token). It must stay empty/template in git.
- Never commit `accounts.json` (contains initData/session secrets).
- Don't commit `dist-extension/`, `dist-whisker/`, `dist-bridge/`, `dist-bundle/` (gitignored, built by CI). They often have no .gitkeep.

---

## 8. Connect the extension→server (how accounts arrive)

1. User opens NileChain Farmer extension → **Cloud Manager**.
2. Enters server URL (`http://<server-ip>:3000` or domain).
3. Extension hits `GET /api/server` (returns `{name:"nilcyflylite"}`) to confirm it's a valid cloud server.
4. Extension calls `POST /api/sync` with `{ auth: initData, farmer: "head-coin"|"trading-wars", title }`.
5. Server stores/updates account in `accounts.json` and responds `{ ok:true, userId }`.
6. The runner loop picks it up and starts farming.

See `server.servic` routes: `/api/server`, `/api/status`, `/api/subscription` (always returns `session:"active"` — this avoids forced logout; critical), `/api/farmers`, `/api/farmers/activate`, `/api/farmers/detfa`, `/api/telegram/login|code|password|logout`, `/api/sync`.

---

## 9. Known Issues / Gotchas / Next Steps

- **Trading is removed** from TradingWars per request — don't re-add. `apiGet` / `decodeKlines` are now dead code.
- **`MAX_PPH` discrepancy** — lite uses 10000, shared farmer uses 150000. Confirm which is intended if asked.
- **Telegram bot token was compromised** — the user revoked the old one. A new bot token must be set in server `config.json` (as documented) for summaries to send. Confirm current value with user.
- **Server git history is divergent** — use `git fetch && git checkout origin/main -- <file>` pattern, never bare `git pull`.
- **`last_message_<farmerId>.json`** files exist in `apps/nlilyLite/` — the delete-previous-message mechanism. `<G180>` they are ephemeral.
- **Node version** on server: NVM LTS (path like `/home/ubuntu/.nvm/versions/node/v24.16.0/bin/node`). The OLD install/README reads cron + `node run.js` but we moved to PM2 continuous.
- **Next cycle:** all 1050ti slots already full; the bot is waiting for balance to reach 9,300 to buy `asic_s9`. No action needed unless balances stall.
- **PMW self-service:** `pm2 save`, `pm2 startup` set when user set up server; not touched recently.

---

## 10. Quick Answers for Frequent Questions

- *How many accounts?* → 11 (server `accounts.json`). Local `accounts.json` is an empty TEMPLATE; real count is on the server.
- *Why is Telegram empty?* → `config.json` in git is a template; real credentials only on server, and the token is currently pending user action (was compromised).
- *Why `bot.sendFarmerSummary is not a function`?* → old code; fixed in `lib/telegram-bot`. During when a fix lands: pull server files + `pm2 restart nilefly-runner`.
- *Why a file missing on server after pull?* → the `git rm config.json` mistake. Fixed on git side; never do again.

---

## 11. Deployment Cheatsheet (server, safe)

```bash
ssh / user@your-server   # already logged in as ubuntu in past sessions
cd ~/NileChain

# Pull specific updated files (avoids divergent-history problem)
git fetch origin
git checkout origin/main -- apps/nileflylite/lib/telegram-bot.js apps/nileflylite/farmers/tradingwars.js apps/nileflylite/run.js apps/nileflylite/README.md

pm2 restart nilefly-runner      # picks up farmer code
pm2 restart nileflylite         # only if server.js helper changed

# tail logs
tail -f apps/nileflylite/run-out.log
tail -f apps/nileflylite/run-err.log

# set up Telegram (on server, editing the real config — never commit):
nano apps/nileflylite/config.json
pm2 restart nilefly-runner && pm2 restart nileflylite

# plain git pull if safe/you don't care about local drift:
git pull --rebase
```

**— End of handover —**