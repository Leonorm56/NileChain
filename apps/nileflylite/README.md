# NileFlyLite

<p align="center">
  <strong>Lightweight Cloud Farmer — HeadCoin + TradingWars</strong>
</p>

<p align="center">
  One-dep, one-file-per-feature, no database, no JWT, no cron.
  Continuous `while(true)` loop via PM2.
</p>

---

## Overview

**NileFlyLite** is a stripped-down server farmer for **HeadCoin** and **TradingWars**. It runs on your server, syncs accounts from the [NileChain Farmer](https://github.com/Leonorm56/NileChain) extension via its API, farms passively in a continuous loop, and sends per-farmer Telegram summaries each cycle.

---

## Key Features

- **HeadCoin farming** — daily bonus, card upgrades up to 55K PPH cap
- **TradingWars farming** — mining management (two-phase), staking + trading
- **Two-phase mining strategy** — fills all `gpu_1050ti` slots first (50 coins each) across all venues, unlocks next venue when current venue's 1050ti slots are full, then switches to `asic_s9` (9,300 coins each)
- **Per-farmer Telegram summaries** — separate messages for HeadCoin and TradingWars, deletes previous message before sending new one
- **Continuous loop** — runs back-to-back cycles via PM2, no cron needed
- **initData-based farming** — no MTProto login required for farming
- **PM2 managed** — auto-restart on crash, survives reboot

---

## Quick Installation

### Prerequisites

- Ubuntu 20.04+ / Debian 11+
- Node.js 18+
- PM2 (`npm install -g pm2`)
- [NileChain Farmer](https://github.com/Leonorm56/NileChain) Chrome extension

### Step 1: Clone & Install

```bash
git clone https://github.com/Leonorm56/NileChain.git ~/NileChain
cd ~/NileChain/apps/nileflylite
npm install
```

### Step 2: Configure

```bash
nano config.json
```

```json
{
  "server": {
    "port": 3000,
    "apiKey": ""
  },
  "telegram": {
    "botToken": "YOUR_BOT_TOKEN",
    "chatId": "YOUR_CHAT_ID",
    "threadId": ""
  }
}
```

| Field | Description |
|---|---|
| `server.port` | HTTP server port (default 3000) |
| `server.apiKey` | Leave empty |
| `telegram.botToken` | Bot token from [@BotFather](https://t.me/BotFather) |
| `telegram.chatId` | Chat ID from [@userinfobot](https://t.me/userinfobot) |
| `telegram.threadId` | Topic thread ID (optional) |

### Step 3: Start Server

```bash
pm2 start ecosystem.config.cjs
pm2 save
pm2 startup
```

This starts two processes:
- `nileflylite` — HTTP API server (port 3000)
- `nilefly-runner` — continuous farming loop

### Step 4: Add Accounts

1. Open NileChain Farmer extension → **Cloud Manager**
2. Enter server URL: `http://your-server-ip`
3. Open each farmer tab (HeadCoin, TradingWars) to sync accounts

---

## Project Structure

```
apps/nileflylite/
├── server.js                  # HTTP API server
├── run.js                     # Farming loop orchestrator (continuous)
├── ecosystem.config.cjs       # PM2 configuration
├── config.json                # Server + Telegram settings
├── accounts.json              # Account storage
├── farmers/
│   ├── headcoin.js            # HeadCoin farming logic
│   └── tradingwars.js         # TradingWars farming + mining + trading
└── lib/
    ├── http.js                # fetch wrapper with retries
    ├── logger.js              # Colored console logger
    ├── storage.js             # JSON file read/write
    ├── telegram-bot.js        # Telegram Bot API (per-farmer summaries)
    ├── telegram-utils.js      # initData parsing
    └── gram-client.js         # Optional MTProto login
```

---

## Management Commands

```bash
# View status
pm2 status

# View farming output
tail -f ~/NileChain/apps/nileflylite/run-out.log

# View error logs
tail -f ~/NileChain/apps/nileflylite/run-err.log

# Restart both processes
pm2 restart nilefly-runner && pm2 restart nileflylite

# Pull latest code + restart
cd ~/NileChain && git fetch origin && git checkout origin/main -- apps/nileflylite/run.js apps/nileflylite/lib/telegram-bot.js apps/nileflylite/farmers/tradingwars.js && pm2 restart nilefly-runner
```

---

## Farming Behavior

### TradingWars Mining Strategy

Each venue has a fixed number of `gpu_1050ti` slots (cheap) followed by `asic_s9` slots (expensive):

| Venue | 1050ti slots | Total slots | Unlock cost |
|---|---|---|---|
| Home | 12 | 21 | — |
| Garage | 12 | 24 | 1,000 |
| Hotel | 12 | 27 | 10,000 |
| Data Center | 6 | 36 | 100,000 |

**Phase 1**: Fill all `gpu_1050ti` slots (50 coins each) in current venue → unlock next venue → repeat until all 4 venues unlocked and all 1050ti slots filled.

**Phase 2**: Fill `asic_s9` slots (9,300 coins each) in all venues.

If balance is insufficient for a machine, the slot is skipped (no API call). Once all slots are full, equipment upgrades run automatically.

### HeadCoin Features

- Auto-claims daily bonus
- Auto-upgrades cards up to 55K PPH cap
- 2s delay between accounts

---

## History of Fixes

| # | Issue | Fix |
|---|---|---|
| 1 | **Extension logged out every refresh** | `/api/subscription` returns `session: "active"` |
| 2 | **Server crashed silently** | Added `unhandledRejection` + `uncaughtException` handlers |
| 3 | **API key required but extension has no field** | Removed auth checking |
| 4 | **Server bound to IPv6 only** | Changed binding to `0.0.0.0` |
| 5 | **Cron used wrong Node path** | Switched to continuous PM2 loop, removed cron |
| 6 | **No task completion** | Removed task loop entirely |
| 7 | **Multiple Telegram messages per cycle** | Replaced with single summary + delete previous |
| 8 | **`sendFarmerSummary` missing when no bot token** | Added no-op mock with both `sendCycleSummary` and `sendFarmerSummary` |
| 9 | **Telegram API errors silently swallowed** | Check `parsed.ok` in response body, log `description` on failure |
| 10 | **`allFull` not defined in TradingWars miner** | Added `allFull` variable before upgrade check |
| 11 | **TWARS tokens showed with excessive decimals** | Rounded to 2 decimal places |
| 12 | **TWARS trading caused errors** | Removed trading entirely from TradingWars farmer |
| 13 | **`config.json` deleted on `git pull`** | Restored to git tracking, removed from `.gitignore` |
| 14 | **Telegram messages showed user ID only** | Shows username if available, falls back to user ID |

---

## Troubleshooting

### No Telegram messages

- Check `config.json` has valid `botToken` and `chatId`
- Restart both PM2 processes

### "bot.sendFarmerSummary is not a function"

- Update code: `git fetch origin && git checkout origin/main -- apps/nileflylite/run.js apps/nileflylite/lib/telegram-bot.js`

### Mining management failed: allFull is not defined

- Update code: `git fetch origin && git checkout origin/main -- apps/nileflylite/farmers/tradingwars.js`

### Farming loop not running

```bash
pm2 status | grep nilefly-runner
```

If stopped, start it: `pm2 start nilefly-runner`

---

## License

MIT
