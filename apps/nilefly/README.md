# NileChain Fly

<p align="center">
  <strong>Cloud-Based Farming Platform</strong>
</p>

<p align="center">
  Run all NileChain farming bots autonomously on your server, 24/7
</p>

---

## Overview

**NileChain Fly** is a cloud-based farming platform that runs all NileChain farmers directly on your server. Unlike the browser extension which runs locally, NileChain Fly operates autonomously in the cloud, managing multiple Telegram accounts, executing farming tasks 24/7, and providing centralized control through the Cloud Manager tool in NileChain Farmer.

### Key Features

- **Cloud-Based Farming** - Runs all farmers directly on your server, no browser needed
- **Autonomous Operation** - 24/7 automated farming without manual intervention
- **Cloud Manager Integration** - Control everything through NileChain Farmer's Cloud Manager
- **Multi-Account Management** - Handle unlimited Telegram accounts
- **Real-Time Monitoring** - Live updates and notifications via Telegram topics
- **Database Backend** - Persistent storage for accounts, proxies, and sessions
- **Secure API** - JWT-based authentication for Cloud Manager
- **Scheduled Tasks** - Automated farming cycles and maintenance
- **Proxy Support** - Built-in proxy rotation and management

---

## Requirements

### System Requirements

- **OS:** Ubuntu 20.04+ / Debian 11+ (or compatible Linux distribution)
- **RAM:** Minimum 1GB (2GB+ recommended)
- **Storage:** At least 2GB free space
- **Network:** Public IP or accessible via domain

### Telegram Requirements

Before installation, you need:

1. **Telegram Bot Token**
   - Create a bot via [@BotFather](https://t.me/BotFather)
   - Save the token provided

2. **Telegram Group with Topics**
   - Create a new Telegram group
   - Enable "Topics" in group settings
   - Add your bot as an admin with full permissions

3. **Required Topics** (create these in your group):
   - **Announcements** - General notifications
   - **Errors** - Error logs and failures
   - **Farming** - Farming activity logs
   - **Additional Topics (Optional)** - One topic per farmer for detailed logs

**Note:** The Telegram bot is used for notifications and logs only. All management is done through the Cloud Manager tool in NileChain Farmer extension/PWA.

---

## Manual Installation

### Step 1: Install System Packages

```bash
sudo apt-get update
sudo apt-get install \
  nginx \
  nano \
  micro \
  curl \
  wget \
  git \
  -y
```

### Step 2: Setup Node.js

Install NVM (Node Version Manager):

```bash
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.2/install.sh | bash
```

Load NVM:

```bash
\. "$HOME/.nvm/nvm.sh"
```

Install Node.js LTS:

```bash
nvm install --lts
```

Install global packages:

```bash
npm i -g npm
npm i -g pnpm
npm i -g pm2
```

### Step 3: Setup PM2 Auto-Startup

Configure PM2 to start on system boot:

```bash
pm2 startup
```

**Important:** PM2 will generate a command like:
```
sudo env PATH=$PATH:/home/username/.nvm/versions/node/vX.X.X/bin ...
```
Copy and run the generated command.

### Step 4: Clone Repository

```bash
git clone https://github.com/Leonorm56/NileChain.git ~/NileChain
cd ~/NileChain
```

### Step 5: Install Dependencies

```bash
pnpm install
```

### Step 6: Configure Environment

Create environment file:

```bash
cp apps/nilefly/.env.example apps/nilefly/.env
```

Generate JWT secret:

```bash
pnpm -F nilefly fly generate-jwt-secret
```

Copy the generated secret and edit `.env`:

```bash
micro apps/nilefly/.env
# or
nano apps/nilefly/.env
```

**Required environment variables:**

```env
# JWT
JWT_SECRET_KEY=<paste-generated-secret-here>

# Telegram
TELEGRAM_BOT_TOKEN=<your-bot-token>
TELEGRAM_CHAT_ID=-100<CHAT_ID>
TELEGRAM_ANNOUNCEMENT_THREAD_ID=<topic-id>
TELEGRAM_ERROR_THREAD_ID=<topic-id>
TELEGRAM_FARMING_THREAD_ID=<topic-id>

# Server
PORT=3000
NODE_ENV=production
```

**Keyboard shortcuts:**
- **micro:** `Ctrl+S` to save, `Ctrl+Q` to quit
- **nano:** `Ctrl+S` to save, `Ctrl+X` to exit

### Step 7: Initialize Database

Run migrations and seeders (SQLite database will be created automatically):

```bash
pnpm -F nilefly db:migrate && pnpm -F nilefly db:seed
```

**Note:** NileChain Fly uses SQLite for database storage. The database file will be created in `apps/nilefly/db/` on first run.

**Default Admin User:**
- **Username:** `admin`
- **Password:** `password`

**Important:** Change the default password immediately after first login through Cloud Manager.

### Step 8: Start Application

```bash
pm2 start apps/nilefly/ecosystem.config.cjs
pm2 save
```

Verify it's running:

```bash
pm2 status
pm2 logs nilefly
```

---

## Nginx Configuration

### Step 1: Create Nginx Server Block

```bash
sudo micro /etc/nginx/sites-available/nilefly
```

### Step 2: Add Configuration

```nginx
server {
    listen 80;
    listen [::]:80;
    server_name your-domain.com;

    # Security headers
    add_header Strict-Transport-Security "max-age=63072000" always;
    add_header X-Frame-Options "SAMEORIGIN" always;
    add_header X-Content-Type-Options "nosniff" always;

    # Proxy settings
    location / {
        proxy_http_version 1.1;
        proxy_cache_bypass $http_upgrade;

        # Headers
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;

        # Proxy pass
        proxy_pass http://127.0.0.1:3000;
    }

    # Optional: Static file caching
    location ~* \.(jpg|jpeg|png|gif|ico|css|js|svg|woff|woff2|ttf)$ {
        proxy_pass http://127.0.0.1:3000;
        expires 30d;
        add_header Cache-Control "public, immutable";
    }
}
```

### Step 3: Enable Site

```bash
# Disable default site (optional)
sudo rm /etc/nginx/sites-enabled/default

# Enable NileChain Fly
sudo ln -s /etc/nginx/sites-available/nilefly /etc/nginx/sites-enabled/
```

### Step 4: Test and Reload

```bash
# Test configuration
sudo nginx -t

# Reload Nginx
sudo systemctl reload nginx
```

### Optional: Enable HTTPS with Certbot

```bash
sudo apt-get install certbot python3-certbot-nginx -y
sudo certbot --nginx -d your-domain.com
```

---

## Updating

```bash
cd ~/NileChain

git pull && \
pnpm install && \
pnpm -F nilefly db:migrate && \
pnpm -F nilefly db:seed && \
pm2 reload apps/nilefly/ecosystem.config.cjs --update-env && \
pm2 save
```

---

## Management Commands

### PM2 Process Management

```bash
# View status
pm2 status

# View logs
pm2 logs nilefly

# Restart
pm2 restart nilefly

# Stop
pm2 stop nilefly

# Delete process
pm2 delete nilefly

# Monitor
pm2 monit
```

### Database Commands

```bash
# Run migrations
pnpm -F nilefly db:migrate

# Rollback last migration
pnpm -F nilefly db:migrate:undo

# Seed database
pnpm -F nilefly db:seed

# Reset database
pnpm -F nilefly db:migrate:refresh
```

### Fly CLI Commands

```bash
# Generate JWT secret
pnpm -F nilefly fly generate-jwt-secret

# List accounts
pnpm -F nilefly fly list-accounts

# Update accounts
pnpm -F nilefly fly update-accounts

# Test proxies
pnpm -F nilefly fly test-proxies

# Clean database
pnpm -F nilefly fly clean-db

# Export backup
pnpm -F nilefly fly export-backup

# Import backup
pnpm -F nilefly fly import-backup <file>
```

---

## Troubleshooting

### Port Already in Use

```bash
sudo lsof -i :3000
sudo kill -9 <PID>
```

### PM2 Not Starting on Boot

```bash
pm2 unstartup
pm2 startup
```

### Nginx 502 Bad Gateway

```bash
pm2 status
pm2 logs nilefly
pm2 restart nilefly
```

---

## Architecture

```
┌─────────────────────┐
│  NileChain Farmer   │
│  Cloud Manager      │◄────── Manage accounts, proxies, farmers
│  (Extension/PWA)    │
└──────────┬──────────┘
           │
           │ HTTPS/REST API (JWT Auth)
           │
┌──────────▼──────────┐
│  NileChain Fly      │
│  Node.js Server     │◄────── Runs all farmers in cloud
│  (PM2)              │
│                     │
│  ┌───────────────┐  │
│  │ Farmer Bots   │  │
│  │ - HeadCoin    │  │
│  │ - SpaceJump   │  │
│  │ - Dreamcoin   │  │
│  │ - ADCLICKER   │  │
│  │ - ATF         │  │
│  │ - 24/7 uptime │  │
│  └───────────────┘  │
└──────────┬──────────┘
           │
      ┌────┴─────┬──────────────┐
      │          │              │
┌─────▼────┐ ┌──▼────────┐ ┌──▼──────────┐
│ SQLite   │ │ Telegram  │ │ Telegram    │
│ Database │ │ Accounts  │ │ Bot (Logs)  │
│          │ │ (Sessions)│ │             │
└──────────┘ └───────────┘ └─────────────┘
```

---

## License

This project is licensed under the MIT License.
