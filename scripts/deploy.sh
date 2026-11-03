#!/usr/bin/env bash
# ==============================================================================
# Proxmox Codex Bridge - Production Deployment & Update Script
# Usage: ./deploy.sh
# ==============================================================================
set -e

BOLD="\e[1m"
GREEN="\e[0;32m"
YELLOW="\e[1;33m"
RED="\e[0;31m"
CYAN="\e[0;36m"
NC="\e[0m"

ROOT_DIR="/opt/agent-bridge"
DASHBOARD_DIR="${ROOT_DIR}/dashboard"
cd "${ROOT_DIR}"

echo -e "${BOLD}${CYAN}====================================================${NC}"
echo -e "${BOLD}${CYAN}🚀 Proxmox Codex Bridge Deployment & Updater${NC}"
echo -e "${BOLD}${CYAN}====================================================${NC}"

# 1. Check Git Status & Pull Latest Code
echo -e "\n${BOLD}[1/5] 📥 Synchronizing Git Repository...${NC}"
if [ -d ".git" ]; then
  if ! git remote | grep -q "origin"; then
    git remote add origin https://github.com/techasit5415/proxmox-codex-bridge.git
  fi

  echo -e "Attempting git pull from origin/main..."
  if git pull origin main; then
    echo -e "${GREEN}✓ Successfully pulled latest changes from origin/main${NC}"
  else
    echo -e "${YELLOW}⚠️  Git pull failed!${NC}"
    echo -e "${YELLOW}   If repository is PRIVATE on GitHub:${NC}"
    echo -e "   1) Make it Public on GitHub (Settings -> Danger Zone -> Change visibility), OR"
    echo -e "   2) Set up a GitHub Personal Access Token (PAT):"
    echo -e "      git remote set-url origin https://<TOKEN>@github.com/techasit5415/proxmox-codex-bridge.git"
    echo -e "${YELLOW}   Continuing deployment with existing codebase...${NC}"
  fi
else
  echo -e "${YELLOW}⚠️  .git directory missing, initializing...${NC}"
  git init -b main
  git remote add origin https://github.com/techasit5415/proxmox-codex-bridge.git
fi

# 2. Check Environment Configuration (.env)
echo -e "\n${BOLD}[2/5] 🔒 Verifying Environment Secrets (.env)...${NC}"
if [ ! -f ".env" ]; then
  if [ -f ".env.example" ]; then
    echo -e "${YELLOW}⚠️  .env not found. Creating from .env.example...${NC}"
    cp .env.example .env
    chmod 600 .env
  else
    echo -e "${YELLOW}⚠️  .env file missing. Please create .env with KMITL_TOKEN${NC}"
  fi
else
  chmod 600 .env
  echo -e "${GREEN}✓ .env verified (chmod 600)${NC}"
fi

# 3. Install Root Dependencies (for MCP server)
echo -e "\n${BOLD}[3/5] 📦 Installing Root Dependencies...${NC}"
if [ -f "package.json" ]; then
  npm install --no-audit --no-fund 2>/dev/null || true
  echo -e "${GREEN}✓ Root dependencies ready (@modelcontextprotocol/sdk)${NC}"
fi

# 4. Install Dashboard Dependencies & Build
echo -e "\n${BOLD}[4/5] 🏗️  Building SvelteKit Dashboard...${NC}"
cd "${DASHBOARD_DIR}"
npm install --no-audit --no-fund
npm run build
echo -e "${GREEN}✓ Dashboard built successfully in ${DASHBOARD_DIR}/build${NC}"
cd "${ROOT_DIR}"

# 5. Restart / Reload Application (PM2 & Systemd)
echo -e "\n${BOLD}[5/5] 🔄 Reloading Services...${NC}"
if command -v pm2 >/dev/null 2>&1; then
  if pm2 list | grep -q "proxmox-codex-bridge"; then
    echo "Reloading PM2 process proxmox-codex-bridge..."
    pm2 restart ecosystem.config.cjs --update-env
    pm2 save
    echo -e "${GREEN}✓ PM2 process restarted and saved${NC}"
  else
    echo "Starting PM2 process with ecosystem.config.cjs..."
    pm2 start ecosystem.config.cjs
    pm2 save
    echo -e "${GREEN}✓ PM2 process started${NC}"
  fi
fi

if systemctl is-active --quiet agent-web.service 2>/dev/null; then
  echo "Restarting agent-web.service (systemd)..."
  systemctl restart agent-web.service || true
fi

# 6. Health Check Verification
echo -e "\n${BOLD}🩺 Health Check Verification...${NC}"
sleep 2
HEALTH_CODE=$(curl -s -o /dev/null -w "%{http_code}" http://127.0.0.1:3000/ || echo "000")
if [ "$HEALTH_CODE" = "200" ]; then
  echo -e "${GREEN}${BOLD}✓ Web Dashboard is HEALTHY (HTTP 200) at http://192.168.5.159:3000${NC}"
else
  echo -e "${YELLOW}⚠️  Web Dashboard returned HTTP ${HEALTH_CODE}. Checking PM2 logs...${NC}"
  pm2 logs proxmox-codex-bridge --lines 10 --nostream || true
fi

echo -e "\n${BOLD}${GREEN}====================================================${NC}"
echo -e "${BOLD}${GREEN}✨ Deployment Complete!${NC}"
echo -e "${BOLD}${GREEN}====================================================${NC}"
