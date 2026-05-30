# NileFlyLite

<p align="center">
  <strong>Lightweight HeadCoin Cloud Farmer</strong>
</p>

<p align="center">
  One-dep, one-file-per-feature, no database, no JWT, no cron library.
  Just Node.js + `telegram` (optional).
</p>

---

## Overview

**NileFlyLite** is a stripped-down, single-farmer version of NileChain Fly designed specifically for **HeadCoin**. It runs on your server, syncs accounts from the [NileChain Farmer](https://github.com/Leonorm56/NileChain) extension, farms passively, and sends a Telegram summary every cycle.

### Why Lite?

| NileChain Fly (full) | NileFlyLite |
|---|---|
| JWT auth | No auth (extension has no API key field) |
| SQLite + Prisma | Flat JSON files |
| MTProto session management | initData-based farming (no MTProto needed) |
| 20+ farmers | HeadCoin only |
| 100+ npm dependencies | 1 dependency (`telegram`) |
| Complex setup | 3 commands to deploy |

---

## Key Features

- **initData-based farming** — No MTProto login needed for farming; works directly from extension sync
- **1 npm dependency** — Only `telegram` for optional session login
- **Sequential farming** — 2s delay between accounts to avoid Telegram rate limits
- **Single Telegram summary** — One compact message per cycle, deletes the previous one
- **Card upgrades** — Auto-upgrades all 4 categories up to 55K PPH cap
- **Daily bonus** — Auto-claims every cycle
- **PM2 managed** — Auto-restart on crash, survives reboot
- **OS cron scheduling** — No in-process cron; `*/20 * * * *` via system cron
- **`flock` lock** — Skips overlapping cycles automatically

---

## Quick Installation

### One-Line Install (Ubuntu/Debian)

```bash
curl -o- https://raw.githubusercontent.com/Leonorm56/NileChain/main/apps/nileflylite/install.sh | bash
```

### What the script does:
1. Installs Node.js via NVM (if missing)
2. Installs PM2 globally
3. Clones the repo
4. Installs dependencies (`npm install`)
5. Guides you through `config.json` setup
6. Starts the server via PM2
7. Runs the initial farming cycle
8. Adds crontab for `*/20 * * * *`

---

## Requirements

### System

- **OS:** Ubuntu 20.04+ / Debian 11+
- **RAM:** 512MB minimum
- **Node.js:** 18+ (NVM recommended)
- **PM2:** Global install recommended

### Telegram

1. **Bot Token** — Create a bot via [@BotFather](https://t.me/BotFather)
2. **Group Chat ID** — Create a group, add your bot as admin, get the chat ID
3. **Topic Thread ID** (optional) — Enable Topics in group, use thread ID for organized messages

### Extension

[NileChain Farmer](https://github.com/Leonorm56/NileChain) extension — used to sync accounts via **Cloud Manager**.

---

## Manual Installation

### Step 1: Install Node.js & PM2

```bash
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.2/install.sh | bash
\. "$HOME/.nvm/nvm.sh"
nvm install --lts
npm install -g pm2
```

### Step 2: Clone & Install

```bash
git clone https://github.com/Leonorm56/NileChain.git ~/NileChain
cd ~/NileChain/apps/nileflylite
npm install
```

### Step 3: Configure

```bash
cp config.json config.json.bak  # backup template
nano config.json
```

```json
{
  "server": {
    "port": 3000,
    "apiKey": ""
  },
  "telegram": {
    "botToken": "8201448771:AAEcCshFnuuVIWf6P2J7gHwcssEWTMew-Js",
    "chatId": "-1003548704230",
    "threadId": "4"
  }
}
```

| Field | Description |
|---|---|
| `server.port` | HTTP server port (default 3000) |
| `server.apiKey` | **Leave empty** — extension has no API key field |
| `telegram.botToken` | Your bot token from @BotFather |
| `telegram.chatId` | Your group's chat ID (negative for supergroups) |
| `telegram.threadId` | Topic thread ID (omit for main group) |

### Step 4: Nginx Reverse Proxy (Required)

The server listens on port 3000 internally. Nginx exposes it on port 80 so the extension can connect without a port number:

```bash
sudo apt install -y nginx
sudo tee /etc/nginx/sites-available/nilefly > /dev/null << 'EOF'
server {
    listen 80;
    server_name _;
    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
    }
}
EOF
sudo ln -sf /etc/nginx/sites-available/nilefly /etc/nginx/sites-enabled/
sudo rm -f /etc/nginx/sites-enabled/default
sudo nginx -t && sudo systemctl restart nginx
```

### Step 5: Start Server

```bash
pm2 start ecosystem.config.cjs
pm2 save
pm2 startup   # follow the generated command
```

### Step 6: Schedule Farming

```bash
crontab -e
```

Add:

```bash
*/20 * * * * /usr/bin/flock -n /tmp/nilefly.lock -c "cd /home/ubuntu/NileChain/apps/nileflylite && /home/ubuntu/.nvm/versions/node/v24.16.0/bin/node run.js >> farm.log 2>&1"
```

> Replace `/home/ubuntu` with your actual home directory.
> Find your node path: `which node`

### Step 7: Add Accounts

1. Open NileChain Farmer extension
2. Go to **Cloud Manager**
3. Enter server URL: `http://your-server-ip:3000`
4. Open each farmer tab → Synced accounts will appear in `accounts.json`
5. Run the first farming cycle manually:

```bash
cd ~/NileChain/apps/nileflylite && node run.js
```

---

## Importing from NileChain Fly

If you have an existing NileChain Fly server, export and import:

```bash
# On old server
curl -o backup.json http://localhost:3000/api/manager/export-backup

# Copy to new server, then
cd ~/NileChain/apps/nileflylite
node import-backup.js backup.json
```

---

## Configuration Reference

### `accounts.json`

```json
{
  "accounts": [
    {
      "id": "6627962056",
      "title": "My Account",
      "initData": "user=%7B%22id%22%3A...",
      "session": "",
      "headcoin": {
        "enabled": true,
        "lastRun": null,
        "coins": 0,
        "profit": 0,
        "dailyBonusClaimed": false
      }
    }
  ]
}
```

| Field | Description |
|---|---|
| `id` | Telegram user ID (numeric string) |
| `title` | Display name |
| `initData` | WebApp initData — required for HTTP farming |
| `session` | Optional MTProto session string |
| `headcoin.enabled` | Set `false` to skip this account |

### `config.json`

See [Step 3](#step-3-configure) above. Connect the extension to `http://your-server-ip` (port 80, no port number needed).

---

## How It Works

```
┌─────────────────────┐
│  NileChain Farmer   │
│  (Extension)        │──── Sync initData to server
└──────────┬──────────┘
           │ HTTP (no auth)
┌──────────▼──────────┐
│  NileFlyLite        │
│  Node.js Server     │──── Receives accounts, serves API
│  (PM2)              │
│                     │
│  ┌───────────────┐  │
│  │ API Endpoints │  │
│  │ /api/server   │  │
│  │ /api/sync     │  │
│  │ /api/farmers  │  │
│  │ /api/telegram │  │
│  └───────────────┘  │
└──────────┬──────────┘
           │
┌──────────▼──────────┐
│  Cron: */20 * * * * │──► node run.js → farm.log
│  (flock lock)       │
└─────────────────────┘
           │
           ▼
┌─────────────────────┐
│  HeadCoin API       │
│  daily bonus        │
│  card upgrades      │
│  (initData auth)    │
└─────────────────────┘
           │
           ▼
┌─────────────────────┐
│  Telegram Bot       │── One summary message per cycle
│  (deletes previous) │
└─────────────────────┘
```

### API Endpoints

| Path | Method | Purpose |
|---|---|---|
| `/api/server` | GET | Server health check |
| `/api/status` | GET | Server status + account count |
| `/api/subscription` | GET | Returns `session: "active"` so extension never logs out |
| `/api/sync` | POST | Receive accounts from extension |
| `/api/farmers` | GET | List registered farmers |
| `/api/farmers/activate` | POST | Enable a farmer for an account |
| `/api/farmers/deactivate` | POST | Disable a farmer |
| `/api/telegram/login` | POST | Initiate MTProto login |
| `/api/telegram/code` | POST | Submit login code |
| `/api/telegram/password` | POST | Submit 2FA password |
| `/api/telegram/logout` | POST | Log out MTProto session |

---

## Project Structure

```
apps/nileflylite/
├── server.js              # HTTP server (all API endpoints)
├── run.js                 # Farming orchestrator
├── up.js                  # One-command start (install → server → farm)
├── setup.sh               # Bash setup script
├── import-backup.js       # Import from old nilefly backup
├── ecosystem.config.cjs   # PM2 configuration
├── config.json            # Server + Telegram settings
├── accounts.json          # Account storage
├── last_message.json      # Tracks last Telegram message ID for deletion
├── farm.log               # Farming cycle logs
├── farmers/
│   └── headcoin.js        # HeadCoin farming logic
└── lib/
    ├── http.js            # fetch wrapper with 3 retries
    ├── logger.js          # Colored console logger
    ├── storage.js         # JSON file read/write
    ├── telegram-bot.js    # Bot API messaging (summary + delete)
    ├── telegram-utils.js  # initData parsing utilities
    └── gram-client.js     # Optional MTProto login
```

---

## Management Commands

```bash
# Server status
pm2 status

# View farming logs
tail -f farm.log

# View server logs
pm2 logs nileflylite

# Restart server
pm2 restart nileflylite

# Run farming cycle manually
node run.js

# View cron schedule
crontab -l

# Edit cron schedule
crontab -e
```

---

## History of Fixes & Corrections

This project evolved through active development. Here are the key fixes:

| # | Issue | Fix |
|---|-------|-----|
| 1 | **Extension logged out every refresh** | Changed `/api/subscription` to return `session: "active"` instead of `null` |
| 2 | **Server crashed silently** | Added `unhandledRejection` + `uncaughtException` handlers |
| 3 | **API key required by server, but extension has no API key field** | Removed all auth/API key checking from server |
| 4 | **Server bound to `::` (IPv6 only), unreachable from outside AWS** | Changed binding to `0.0.0.0` |
| 5 | **Cron used wrong Node.js path (`/usr/bin/node` doesn't exist with nvm)** | Updated crontab to use full nvm Node path |
| 6 | **Cron had no overlap protection** | Wrapped cron with `flock -n` to skip if previous cycle still running |
| 7 | **No task completion** | Added `gettasks.php` → `clicktasksponsor.php` → `checktasksponsor.php` loop (later removed — tasks never completed) |
| 8 | **Card upgrades skipped due to API rate-limiting on re-fetch** | Changed to reuse initial state instead of re-fetching on every category |
| 9 | **Upgrade variable scoping error** | Moved `upgrades`, `currentCoins`, `currentProfit` to function scope |
| 10 | **Post-upgrade state fetch caused rate limits** | Added 2s delay before re-fetching after successful upgrade |
| 11 | **Upgrade loop broke on unexpected API response** | Changed `break` to `continue` on non-"2" responses; categories 3/1/4 now processed |
| 12 | **55K PPH cap caused capped accounts to skip all upgrades** | (User requested to keep cap — intentional behavior) |
| 13 | **Telegram messages not deleted** | Fixed `sendMessage` to parse `postJson` response and save `message_id`; `postJson` no longer retries 4xx errors |
| 14 | **150x 5s delay = 12.5 min overhead** | Reduced delay from 5s to 2s |
| 15 | **Tasks always pending ("Play Gift Kombat")** | Removed task completion loop entirely |
| 16 | **Multiple messages per cycle** | Replaced per-account messages with single summary + delete previous |

---

## Troubleshooting

### No farming after 20 minutes

Check if cron is running and node path is correct:

```bash
crontab -l
which node
```

### "No accounts found"

Sync accounts from the extension, or check `accounts.json` format.

### Server won't start

```bash
pm2 logs nileflylite
```

Common issues:
- Port 3000 already in use: `sudo lsof -i :3000`
- Missing `config.json`

### Telegram messages not sending

Verify bot token and chat ID:

```bash
curl -s "https://api.telegram.org/bot<YOUR_TOKEN>/getMe"
curl -s "https://api.telegram.org/bot<YOUR_TOKEN>/getUpdates"
```

### Farming cycle overlaps

The `flock -n` lock should prevent this. Check:

```bash
ls -la /tmp/nilefly.lock
```

### Card upgrades not happening

Check farm.log for "locked" messages — means insufficient coins. Coins accumulate over cycles.

---

## License

MIT
