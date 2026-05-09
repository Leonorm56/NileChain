<p align="center">
  <a href="https://TODO_PEARLFARMER_WEBSITE" target="_blank">
    <img src="public/icon.png" width="192" alt="PearlFarmer Logo">
  </a>
</p>

<h1 align="center">PearlFarmer</h1>

<p align="center">
  <strong>Uganda's Premier Crypto Farming Tool.</strong>
</p>

<p align="center">
  Automate Telegram Mini-Apps with a clean, modern, premium UI (Extension + PWA builds).
</p>

---

## Overview

**PearlFarmer** is a Telegram Mini-Apps automation tool with multiple deployment modes:

- Chrome Extension (standalone)
- PWA (Progressive Web App)
- Optional bridge extension for PWA → Chrome API access
- Optional multi-account build (TODO brand name)

---

## Quick Start (Extension)

### Prerequisites

- Node.js v18+
- pnpm
- Chrome/Chromium
- Git

### Install

```bash
git clone https://github.com/TODO_ORG/TODO_REPO.git
cd TODO_REPO
pnpm install
cd apps/purrfect-farmer
```

### Build the Chrome extension

```bash
pnpm build-extension
```

**Output:**
- Unpacked: `dist-extension/` (load via `chrome://extensions`)
- Packaged: `dist-bundle/*.crx` and `dist-bundle/*.zip`

---

## Other Build Modes

### PWA (Progressive Web App)

```bash
pnpm build-pwa
```

Output: `dist/` (host with any static server).

### Bridge Extension (for PWA)

```bash
pnpm build-bridge
```

Output: `dist-bridge/` and packaged files under `dist-bundle/`.

### Build all variants

```bash
pnpm build
```

---

## Branding

- Primary navy: `#0A1628`
- Secondary navy: `#1B3A6B`
- Accent: `#2E5FFF`
- Light mode: white background, navy text
- Dark mode: deep navy background, white text, bright navy accents

---

## Development

```bash
pnpm dev
```

Access: `http://localhost:5173`

---

## Configuration

Create `.env.local` for local overrides; the extension manifest name/description is generated from `VITE_APP_NAME` and `VITE_APP_DESCRIPTION` during build.

---

## Community & Support

- Telegram: `https://t.me/TODO_PEARLFARMER_COMMUNITY`
- Issues: `https://github.com/TODO_ORG/TODO_REPO/issues`
- Discussions: `https://github.com/TODO_ORG/TODO_REPO/discussions`

---

Built on open-source Purrfect Farmer by Sadiq Salau (MIT License).
