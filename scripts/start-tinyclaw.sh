#!/bin/bash
# Start TinyClaw with Cloudflare tunnel
# Runs on boot after network is ready
#
# Install: cp scripts/start-tinyclaw.sh ~/.config/autostart-scripts/

PROJECT_DIR="/home/aiadmin/programs/tinyclaw"
LOG="$PROJECT_DIR/.tinyclaw/logs/startup.log"

mkdir -p "$(dirname "$LOG")"

log() {
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] $1" | tee -a "$LOG"
}

log "Starting TinyClaw setup..."

# Wait for network
for i in {1..30}; do
    if ping -c 1 -W 1 8.8.8.8 >/dev/null 2>&1; then
        log "Network is ready"
        break
    fi
    log "Waiting for network... ($i/30)"
    sleep 2
done

cd "$PROJECT_DIR" || { log "ERROR: Project dir not found"; exit 1; }

# Source environment
set -a
source .env 2>/dev/null
set +a

# Export PATH for node, npm, cloudflared
export PATH="/usr/local/bin:/usr/bin:$HOME/.local/bin:$HOME/.nvm/versions/node/$(ls $HOME/.nvm/versions/node/ 2>/dev/null | tail -1)/bin:$PATH"

# --- Start Cloudflare tunnel ---
log "Starting Cloudflare tunnel..."
make tunnel-stop 2>/dev/null || true
sleep 1

make tunnel >> "$LOG" 2>&1
if [ $? -ne 0 ]; then
    log "ERROR: Failed to start tunnel"
    exit 1
fi

sleep 2

# --- Start TinyClaw agent ---
log "Starting TinyClaw agent..."
make agent >> "$LOG" 2>&1

sleep 3
if tmux has-session -t tinyclaw 2>/dev/null; then
    log "TinyClaw started successfully"
else
    log "ERROR: TinyClaw failed to start"
    exit 1
fi

log "TinyClaw startup completed"
