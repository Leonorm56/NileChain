# Anchored Summary — NILECHAIN Directory Exploration

## Objective
Explore the NILECHAIN project directory at `C:\Users\GH\Desktop\NILECHAIN` thoroughly and provide a comprehensive report on file structure, file types, and technical architecture.

## Important Details
- **Project**: NILECHAIN — a farming/botting ecosystem around Telegram mini-app games
- **Workspace version**: 1.0.76 (root `package.json`)
- **Package manager**: pnpm (workspace monorepo)
- **Git remotes**:
  - `origin`: `https://github.com/Leonorm56/NileChain.git`
  - `upstream`: `https://github.com/purrfect-farmer/purrfect-farmer`
- **Live deployment**: nileflylite on AWS Ubuntu server (`ubuntu@ip-172-31-47-114`, `~/NileChain`); nilecloud instances at `$HOME/nilecloud-one`, `$HOME/nilecloud-two`, `$HOME/nilecloud-three`
- **Git tags**: v1.0.0 through v1.0.32+ (packed-refs contains many tags); `refs/heads/main` at `4623865b9a9967814e684d6237935185c17a86df`
- **`.gitignore`**: excludes `node_modules/`, `apps/nileflylite/sessions/`, `whiskers/*.exe`, `whiskers/*.zip`, `whiskers/the-nile`, `dist.pem`
- **`HANDOVER.md`**: primary design doc (20K+ chars) — covers ecosystem, folder layout, deployment, pitfalls, operational instructions
- **CI/CD**: `.github/workflows/release.yml` — builds extension, uploads to GitHub Pages, releases CRX/ZIP on `v*.*.*` tag push
- **Pre-built artifacts**: `nilechain-farmer-v1.0.62.crx` and `.zip` exist at root
- **CRX signing**: `key.pem` exists at root

## Work State

### Completed
- Full recursive directory listing of the entire project tree (all subdirectories)
- Read `HANDOVER.md` in full (comprehensive design doc)
- Read all root-level configs: `package.json`, `pnpm-workspace.yaml`, `.gitignore`, `.npmrc`, `.claude/settings.local.json`, `.freebuff/project-id`, `release.js`, `temp_build.ps1`
- Read `.github/workflows/release.yml` (CI/CD pipeline)
- Read `.git/config` (dual remotes), `packed-refs` (tags + branches), `.sequelizerc` files
- **nilechain-farmer** (Chrome extension): read `package.json`, `vite.config.js`, `index.html`, `toolbar.html`, `jsconfig.json`, `.env`, `.gitignore`, `scripts/bundle-extension.js`, `plugins/generate-chrome-manifest.js`, `src/main.jsx`, `src/core/` (6 files: defaultAccounts.js, defaultSettings.js, defaultSharedSettings.js, defaultZoomiesState.js, farmers.js, tabs.js), `src/constants/index.js`, `src/lib/` (createFarmer.js, createTelegramClient.js, TelegramWebClient.js, bridge-service-worker.js, chrome-service-worker.js); listed all `src/` subdirectories (adapters, app, assets, cloud, components, constants, contexts, core, encryption, extension, fonts.css, hooks, index.css, layouts, lib, main.jsx, partials, services, toolbar, utils, workers)
- **nileflylite** (ACTIVE cloud farmer): read `package.json`, `server.js`, `run.js`, `up.js`, `setup.sh`, `config.json`, `ecosystem.config.cjs`, `README.md`, `import-backup.js`, `.env.example`; read `lib/` (storage.js, logger.js, http.js, telegram-bot.js, telegram-utils.js, gram-client.js); read `farmers/` (headcoin.js, tradingwars.js); read `accounts.json` (template with empty accounts array)
- **nilecloud** (legacy heavyweight server): read `package.json`, `app.js`, `fly` (CLI), `cron.js`, `startup.js`, `ecosystem.config.cjs`, `.env.example`, `.sequelizerc`; read `config/` (env.js, app.js, database.js); read `lib/` (bot.js, GramClient.js, cache.js, fingerprint.js, proxy.js, utils.js, logger.js, path.js, FloxyClient.js); read all 6 `actions/` (clean-database.js, expire-subscriptions.js, update-accounts.js, update-proxies.js); read `commands/` (16 CLI command files); read `farmers/` (index.js, Runner.js); read all routes; read all plugins; listed sandbox/, backups/, sessions/, test/, resources/; read `install.sh`, `update.sh`, `update-all.sh`
- **packages/shared** (`@nile/shared`): read `package.json`; read `lib/` (15 files: BaseFarmer.js, BaseRunner.js, BaseDirectFarmer.js, BaseTelegramWebClient.js, BaseLogger.js, ConsoleLogger.js, BrowserLogger.js, CaptchaSolver.js, Encrypter.js, MonetagClient.js, AdsGramClient.js, CronRunner.js, NileWallet.js, NileWalletConnect.js, SkipRun.js); read `auto/wallet.js`; read `utils/` (bundle.js, core.js, delay.js, index.js, telegram.js); read all 8 farmer classes (DreamcoinProFarmer.js, MakegramFarmer.js, RigniteFarmer.js, SlpyFarmer.js, SoulfarmFarmer.js, SurfEarnFarmer.js, TonoreumFarmer.js, UsdtflowFarmer.js); read `resources/` (user_agents.json, user_agents.txt, userAgents.js); read `generate-user-agents.js`, `test-addr.mjs`; inspected `node_modules` (symlinked deps: @faker-js, @noble, @scure, @ton, axios, chalk, croner, ethers, telegram, uuid, etc.)
- **whiskers/the-nile** (Electron desktop app): read `package.json`, `electron-builder.yml`, `electron.vite.config.mjs`; read `src/main/` (App.js, index.js, Profile.js, server.js); read `src/preload/index.js`; read `src/renderer/` (index.html, App.jsx); listed `src/renderer/src/components/`, `hooks/`, `store/`, `providers/`, `assets/`, `lib/`
- Git configuration files (`.git/config`, packed-refs, `.git/logs/HEAD`)
- Root signing key (`key.pem`)
- Deployment scripts (install.sh, update.sh, update-all.sh)
- Database models (index.js, account.js, farmer.js, payment.js, subscription.js, user.js)

### Active
- (none — exploration phase complete)

### Blocked
- (none)

## Next Move
- Report complete — summary saved to `.kilo/anchored-summary-2026-08-23.md`

## Relevant Files
- `/app/HANDOVER.md` — definitive project overview, architecture, deployment notes, known pitfalls
- `C:\Users\GH\Desktop\NILECHAIN\package.json` — monorepo root, version 1.0.76
- `C:\Users\GH\Desktop\NILECHAIN\pnpm-workspace.yaml` — workspace config for `apps/*` and `packages/*`
- `C:\Users\GH\Desktop\NILECHAIN\apps\nilechain-farmer/` — Chrome extension (PWAI + Manifest V3, Vite + React + Tailwind); browser-based farming client with mini-app automation; imports farmer classes from `@nile/shared`
- `C:\Users\GH\Desktop\NILECHAIN\apps\nileflylite/` — **ACTIVE** lightweight cloud farmer (Node.js HTTP server + PM2); targets HeadCoin and TradingWars; uses Telegram initData (no MTProto login)
- `C:\Users\GH\Desktop\NILECHAIN\apps\nilecloud/` — legacy heavyweight server (Fastify + Sequelize + grammy Telegram bot + MTProto via GramClient); 17 CLI commands, SQLite DB with 6 models, cron-based farming; multi-instance deployment via `update-all.sh`
- `C:\Users\GH\Desktop\NILECHAIN\apps\nilefly/` — near-identical clone of nilecloud
- `C:\Users\GH\Desktop\NILECHAIN\apps\apps/` — nested directory with `nilechain-farmer/` (duplicate) and `purrfect-fly/` (rebranded nilefly fork)
- `C:\Users\GH\Desktop\NILECHAIN\packages\shared/` — shared library `@nile/shared`: 8 farmer classes, 15 core lib files (BaseFarmer, BaseDirectFarmer, BaseRunner, BaseTelegramWebClient, loggers, Encrypter, CaptchaSolver, CronRunner, NileWallet/NileWalletConnect), utils bundle, user agent resources
- `C:\Users\GH\Desktop\NILECHAIN\whiskers\the-nile/` — Electron desktop app (upstream Leonorm56/THE-NILE v0.0.5): Chromium-based multi-profile browser with proxy/fingerprint spoofing
- `C:\Users\GH\Desktop\NILECHAIN\.github/workflows/release.yml` — CI/CD on tag push
- `C:\Users\GH\Desktop\NILECHAIN\release.js` — build/release script
- `C:\Users\GH\Desktop\NILECHAIN\apps\nilecloud\install.sh` / `update.sh` / `update-all.sh` — deployment scripts
- `C:\Users\GH\Desktop\NILECHAIN\apps\nilecloud\db\models/` — Sequelize models (Account, Farmer, Payment, Subscription, User)
- `C:\Users\GH\Desktop\NILECHAIN\.git\config` — dual remote config
