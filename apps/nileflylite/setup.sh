#!/usr/bin/env bash
set -e

echo ""
echo "  ╔═══════════════════════════════╗"
echo "  ║   NileFlyLite — Server Setup  ║"
echo "  ╚═══════════════════════════════╝"
echo ""

cd "$(dirname "$0")"

# 1. Install dependencies
echo "→ Installing dependencies..."
npm install --loglevel=error
echo "  ✓ Done"
echo ""

# 2. Check config
if [ ! -f config.json ]; then
  echo "  ⚠ No config.json found. Creating template..."
  cat > config.json << 'EOF'
{
  "server": { "port": 3000, "apiKey": "" },
  "telegram": { "botToken": "", "chatId": "", "threadId": "" }
}
EOF
  echo "  ✎ Edit config.json with your bot token and settings"
  echo ""
fi

# 3. Start via PM2
if command -v pm2 &> /dev/null; then
  echo "→ Starting server with PM2..."

  # Stop existing if any
  pm2 delete nileflylite 2>/dev/null || true

  pm2 start server.js --name nileflylite -- --port 3000
  pm2 save

  echo ""
  echo "  ✓ PM2: nileflylite started"
  echo "  → pm2 logs nileflylite     (view logs)"
  echo "  → pm2 stop nileflylite     (stop)"
  echo "  → pm2 restart nileflylite  (restart)"
else
  echo "→ Starting server (no PM2 found)..."
  echo "  Install PM2: npm install -g pm2"
  echo "  Starting with nohup instead..."
  nohup node server.js > server.log 2>&1 &
  echo "  ✓ Server PID: $!"
  echo "  → tail -f server.log       (view logs)"
fi

echo ""

# 4. Run initial farming cycle
echo "→ Running initial farming cycle..."
node run.js
echo ""

  echo "  ╔═══════════════════════════════╗"
  echo "  ║  Setup complete!              ║"
  echo "  ║                               ║"
  echo "  ║  Add to crontab:              ║"
  echo "  ║  crontab -e                   ║"
  echo "  ║  */20 * * * * /usr/bin/flock -n /tmp/nilefly.lock -c \"cd $(pwd) && $(which node) run.js >> farm.log 2>&1\"  ║"
  echo "  ╚═══════════════════════════════╝"
echo ""
