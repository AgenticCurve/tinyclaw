#!/usr/bin/env bash
set -euo pipefail

# TinyClaw dependency installer for macOS

GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m'

installed=()
skipped=()
warnings=()

info()  { echo -e "${GREEN}[+]${NC} $1"; }
warn()  { echo -e "${YELLOW}[!]${NC} $1"; }
err()   { echo -e "${RED}[x]${NC} $1"; }

has() { command -v "$1" &>/dev/null; }

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

echo "=============================="
echo "  TinyClaw installer (macOS)"
echo "=============================="
echo ""

# --- Homebrew ---
if ! has brew; then
  err "Homebrew not found"
  info "Installing Homebrew..."
  /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
  installed+=("homebrew")
fi

# --- Node.js ---
if has node; then
  NODE_VER=$(node -v | sed 's/v//' | cut -d. -f1)
  if [ "$NODE_VER" -lt 18 ]; then
    err "Node.js v${NODE_VER} found but v18+ is required"
    info "Installing Node.js via Homebrew..."
    brew install node
    installed+=("node")
  else
    info "Node.js $(node -v) found"
    skipped+=("node")
  fi
else
  info "Installing Node.js via Homebrew..."
  brew install node
  installed+=("node")
fi

# --- Homebrew packages ---
BREW_PACKAGES=()

if has tmux; then
  info "tmux found"
  skipped+=("tmux")
else
  BREW_PACKAGES+=("tmux")
fi

if has jq; then
  info "jq found"
  skipped+=("jq")
else
  BREW_PACKAGES+=("jq")
fi

if has ffmpeg; then
  info "ffmpeg found (optional — needed for TTS)"
  skipped+=("ffmpeg")
else
  BREW_PACKAGES+=("ffmpeg")
fi

if has cloudflared; then
  info "cloudflared found (optional — needed for Discuss)"
  skipped+=("cloudflared")
else
  BREW_PACKAGES+=("cloudflare/cloudflare/cloudflared")
fi

if [ ${#BREW_PACKAGES[@]} -gt 0 ]; then
  info "Installing brew packages: ${BREW_PACKAGES[*]}"
  brew install "${BREW_PACKAGES[@]}"
  installed+=("${BREW_PACKAGES[@]}")
fi

# --- Claude CLI ---
if has claude; then
  info "Claude CLI found"
  skipped+=("claude")
else
  info "Installing Claude CLI..."
  if has npm; then
    npm install -g @anthropic-ai/claude-code
    installed+=("claude")
  else
    err "npm not found — cannot install Claude CLI"
    warnings+=("Install Claude CLI manually: npm install -g @anthropic-ai/claude-code")
  fi
fi

# --- npm install (project dependencies) ---
if [ -f "$PROJECT_DIR/package.json" ]; then
  info "Installing Node.js project dependencies..."
  cd "$PROJECT_DIR" && npm install
  installed+=("node_modules")
fi

# --- Build TypeScript ---
if [ -f "$PROJECT_DIR/tsconfig.json" ]; then
  info "Building TypeScript..."
  cd "$PROJECT_DIR" && npm run build
  installed+=("dist")
fi

# --- .env file ---
if [ ! -f "$PROJECT_DIR/.env" ] && [ -f "$PROJECT_DIR/.env.example" ]; then
  cp "$PROJECT_DIR/.env.example" "$PROJECT_DIR/.env"
  info "Created .env from .env.example"
  warnings+=("Edit .env with your API keys, or run: make setup")
elif [ ! -f "$PROJECT_DIR/.env" ]; then
  warnings+=("No .env file found — run: make setup")
fi

# --- Summary ---
echo ""
echo "=============================="
echo "  Setup complete"
echo "=============================="

if [ ${#installed[@]} -gt 0 ]; then
  info "Installed: ${installed[*]}"
fi
if [ ${#skipped[@]} -gt 0 ]; then
  info "Already present: ${skipped[*]}"
fi
if [ ${#warnings[@]} -gt 0 ]; then
  echo ""
  warn "Action needed:"
  for w in "${warnings[@]}"; do
    echo "    - $w"
  done
fi

echo ""
info "Quick start:"
echo "    1. make setup     (configure channels & API keys)"
echo "    2. make tunnel    (start cloudflare tunnel — optional)"
echo "    3. make start     (start the bot)"
echo ""
