# NILECHAIN — Complete AI Handover

> Read this end-to-end before touching anything. It explains the whole ecosystem, every folder, every config, current state, known pitfalls, and how to operate the farm. Written for the next AI that takes over this session.

---

## 1. What This Project Is

**NileChain** is a farming/botting ecosystem around Telegram mini-app games (HeadCoin, TradingWars, DreamcoinPro, Makegram, ADCLICKER). All code lives in a monorepo. The main deliverables:

1. **NileChain Farmer** — a Chrome extension (`apps/nilechain-farmer`) that users install to farm games in their browser.
2. **packages/shared** — shared farmer classes consumed by the extension and reusable logic.

---

## 2. Repository Layout (top level)

```
NILECHAIN/
├── apps/
│   └── nilechain-farmer/     # Chrome extension (the client)
├── packages/
│   └── shared/               # shared farmer logic for extension
├── .github/workflows/
│   └── release.yml           # CI: builds + releases on tag push
├── package.json              # root manifest
├── pnpm-workspace.yaml       # monorepo packages
├── pnpm-lock.yaml
├── release.js                # manual release script (legacy/partial)
├── key.pem                   # RSA signing key (private) — do NOT leak
├── whiskers/                 # native bridge assets (Exe/Zip ignored)
└── HANDOVER.md               # this file
```

**Workspace:** uses `pnpm`. Root scripts: `pnpm build:farmer` (= `pnpm -F nilechain-farmer build`).

---

## 3. Release Mechanism — READ THIS CAREFULLY

Two ways to release:

### 3a. Release via `release.js` (manual, NOT the preferred path anymore)
`release.js` bumps versions in the two `package.json` files, runs `pnpm build:farmer`, assembles artifacts under `apps/nilechain-farmer/dist-bundle/`, commits, pushes, and calls `gh release create`. It uses Windows `cmd` syntax — it is Windows-specific and obsolete.

### 3b. Release via CI (`.github/workflows/release.yml`) — RECOMMENDED
The GitHub Action triggers on **any pushed tag `v*.*.*`**. It:
1. Checks out + installs.
2. Builds with `EXTENSION_PRIVATE_KEY` (from GitHub secret) for CRX signing.
3. Attaches `dist-bundle/*.crx` and `*.zip` to the release.

**To release:** bump the version number in `apps/nilechain-farmer/package.json`, commit, then tag + push. Example:
```bash
git tag v1.0.86 && git push origin v1.0.86
```

### ⚠️ Version bump locations
- `apps/nilechain-farmer/package.json` → `"version"`

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
  - `build-thenile` (VITE_THENILE=true)
  - `build-bridge` (VITE_BRIDGE=true)
- Build outputs land in `dist-extension/`, `dist-thenile/`, `dist-bridge/`, and final packages land in `dist-bundle/`.
- `src/` is huge (React + TanStack Query + Vite). Notable: `src/lib/createFarmer.js`, `src/partials/*`, `src/hooks/*`, `src/lib/bridge-client.js`, `src/lib/bridge-service-worker.js`, `src/lib/createTelegramClient.js`.
- `destructure dist.pem` — the CRX signing private key (`apps/nilechain-farmer/dist.pem`). **It is gitignored.**
- `.env` exists locally with dev vars (do not commit).

### ⚠️ `.gitignore` note
`apps/nilechain-farmer/.gitignore` ignores `dist-*` folders. That's **intentional and correct** — built artifacts should NOT be committed (CI builds them).

---

## 5. packages/shared (extension shared logic)

- `farmers/` maps each game's logic:
  - `MakegramFarmer.js` — Makegram Season 2 (mgrmga.org/s2-2026)
  - `HeadCoinFarmer.js`, `DreamcoinProFarmer.js`, `SpaceJumpFarmer.js`, etc.
  - `TradingWarsFarmer.js` contains the shared extension-side Trading model.
- `lib/` — base classes and helpers: `BaseFarmer.js`, `BaseDirectFarmer.js`, `BaseTelegramWebClient.js`, `BaseLogger.js`, `ConsoleLogger.js`, `BrowserLogger.js`, `BaseRunner.js`, `CronRunner.js`, `Encrypter.js`, `CaptchaSolver.js`.
- The extension imports these.

---

## 6. Current Git State & Important Commands

- Repo: `https://github.com/Leonorm56/NileChain` (origin).
- Branch: `main`.

### Common operations
```bash
# pull latest (local)
git fetch origin && git reset --hard origin/main    # CAREFUL — wipes local edits

# cut a release
# 1) bump version in apps/nilechain-farmer/package.json
# 2) git add . && git commit -m "Release v1.0.86"
# 3) git tag v1.0.86 && git push origin main --tags
```

### Known/verboten things
- Don't commit `dist-extension/`, `dist-thenile/`, `dist-bridge/`, `dist-bundle/` (gitignored, built by CI).

---

## 7. Known Issues / Gotchas

- **Telegram bot token** — verify current token with user before assuming it works.
- **MakegramFarmer** — Season 2, webview URL override via `webviewHost`/`webviewPath` params in `openTelegramBot`.

---

**— End of handover —**
