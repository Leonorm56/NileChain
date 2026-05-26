#!/usr/bin/env bash

# Colors
GREEN='\033[1;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Print colored heading
print_heading() {
    echo -e "${GREEN}$1${NC}"
}

# Print colored subheading
print_subheading() {
    echo -e "${YELLOW}$1${NC}"
}

print_heading "Installing Nginx web server..."
sudo apt-get update
sudo apt-get upgrade -y
sudo apt-get install \
nginx \
-y


print_heading "Installing Node Version Manager (NVM) and Node.js LTS..."

if [ ! -d "$HOME/.nvm" ]; then
    print_subheading "NVM is not installed. Proceeding with installation..."
    curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.3/install.sh | bash
fi

# Load NVM (needed for non-interactive shells)
export NVM_DIR="$HOME/.nvm"
[ -s "$NVM_DIR/nvm.sh" ] && \. "$NVM_DIR/nvm.sh"
[ -s "$NVM_DIR/bash_completion" ] && \. "$NVM_DIR/bash_completion"

# Ensure Node.js LTS is installed and active
nvm install --lts
nvm alias default lts/*

# Ensure global tools are installed
npm i -g npm pnpm pm2


print_heading "Setting up PM2 to run on startup..."
startup_command=$(pm2 startup | grep "sudo env" | sed 's/^[[:space:]]*//')
if [ -n "$startup_command" ]; then
    print_subheading "Executing PM2 startup command..."
    eval "$startup_command"
else
    print_subheading "PM2 startup already configured or command not found."
fi

print_heading "Setting up NileChain repository..."
if [ -d "$HOME/NileChain/.git" ]; then
    print_subheading "Repository already exists. Pulling latest changes..."
    cd ~/NileChain
    git pull origin main
else
    print_subheading "Cloning NileChain repository..."
    git clone https://github.com/Leonorm56/NileChain.git ~/NileChain
    cd ~/NileChain
fi

print_heading "Installing project dependencies..."
CI=true pnpm install

print_heading "Setting up environment variables..."
if [ ! -f apps/nilefly/.env ]; then
    print_subheading ".env file not found. Creating from .env.example..."
    cp apps/nilefly/.env.example apps/nilefly/.env
    
    print_subheading "Generating JWT secret..."
    jwt_secret=$(CI=true pnpm -F nilefly fly generate-jwt-secret | tail -n 1)
    
    print_subheading "Writing JWT secret to .env file..."
    sed -i "s|JWT_SECRET_KEY=\"\"|JWT_SECRET_KEY=\"$jwt_secret\"|" apps/nilefly/.env
else
    print_subheading ".env file already exists. Skipping setup."
fi


print_heading "Running database migrations and seeders..."
CI=true pnpm -F nilefly db:migrate && CI=true pnpm -F nilefly db:seed

print_heading "Starting NileChain Fly with PM2..."
pm2 restart apps/nilefly/ecosystem.config.cjs --update-env
pm2 save


print_heading "Configuring Nginx as a reverse proxy..."
cat <<EOF | sudo tee /etc/nginx/sites-available/nilefly > /dev/null
server {
    listen 80;
    listen [::]:80;
    server_name _; # Change if needed

    add_header Strict-Transport-Security "max-age=63072000" always;

    location / {
        proxy_http_version 1.1;
        proxy_cache_bypass \$http_upgrade;
        proxy_set_header Upgrade \$http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
        proxy_pass http://127.0.0.1:3000;
    }
}
EOF

print_heading "Enabling Nginx site configuration..."
sudo rm -f /etc/nginx/sites-enabled/default
sudo ln -sf /etc/nginx/sites-available/nilefly /etc/nginx/sites-enabled/nilefly

print_heading "Testing and reloading Nginx configuration..."
sudo nginx -t
sudo systemctl reload nginx

print_heading "Server Address"
ip=$(curl ifconfig.me)
print_subheading "You can access NileChain Fly at: http://$ip"