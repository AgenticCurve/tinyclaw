.PHONY: start stop restart status setup wizard build install logs attach reset tunnel tunnel-stop agent help model model-sonnet model-opus

SETTINGS_FILE = .tinyclaw/settings.json
LOG_DIR = .tinyclaw/logs
PID_FILE = .tinyclaw/cloudflared.pid
PORT ?= 3147

# Build flags from env vars
START_FLAGS =
ifneq ($(URL),)
	START_FLAGS += --url $(URL)
endif
ifneq ($(CHATS_DIR),)
	START_FLAGS += --chats-dir $(CHATS_DIR)
endif

# Default target
help:
	@echo "TinyClaw - Claude Code + Messaging Channels"
	@echo ""
	@echo "Usage: make <target>"
	@echo ""
	@echo "Targets:"
	@echo "  setup          Install all dependencies (auto-detects macOS/Ubuntu)"
	@echo "  wizard         Run interactive config wizard (channels, API keys)"
	@echo "  start          Start TinyClaw (all configured channels)"
	@echo "  stop           Stop all processes"
	@echo "  restart        Restart TinyClaw"
	@echo "  status         Show current status"
	@echo "  build          Build TypeScript"
	@echo "  install        Install Node.js dependencies only"
	@echo "  logs           Tail all logs"
	@echo "  attach         Attach to tmux session"
	@echo "  reset          Reset conversation (next message starts fresh)"
	@echo "  model          Show current model"
	@echo "  model-sonnet   Switch to Sonnet"
	@echo "  model-opus     Switch to Opus"
	@echo "  tunnel         Start Cloudflare tunnel for Discuss"
	@echo "  tunnel-stop    Stop Cloudflare tunnel"
	@echo "  agent          Start TinyClaw (alias for start)"
	@echo ""
	@echo "Examples:"
	@echo "  make setup     # install deps (first time)"
	@echo "  make wizard    # configure channels & keys"
	@echo "  make tunnel    # start tunnel, auto-saves URL to settings"
	@echo "  make start     # picks up tunnel URL automatically"
	@echo "  make logs"

setup:
	@case "$$(uname -s)" in \
		Darwin) bash scripts/install-macos.sh ;; \
		Linux)  bash scripts/install-ubuntu.sh ;; \
		*)      echo "Unsupported OS: $$(uname -s). Use macOS or Linux." && exit 1 ;; \
	esac

wizard:
	./setup-wizard.sh

start:
	./tinyclaw.sh $(START_FLAGS) start

agent:
	./tinyclaw.sh stop 2>/dev/null || true
	@sleep 1
	./tinyclaw.sh $(START_FLAGS) start

stop:
	./tinyclaw.sh stop

restart:
	./tinyclaw.sh $(START_FLAGS) restart

status:
	./tinyclaw.sh status

build:
	npm run build

install:
	npm install

logs:
	./tinyclaw.sh logs all

attach:
	tmux attach -t tinyclaw

reset:
	./tinyclaw.sh reset

model:
	./tinyclaw.sh model

model-sonnet:
	./tinyclaw.sh model sonnet

model-opus:
	./tinyclaw.sh model opus

tunnel: tunnel-stop
	@command -v cloudflared >/dev/null 2>&1 || { \
		echo "Error: cloudflared not installed. Run: make setup"; \
		exit 1; \
	}
	@mkdir -p $(LOG_DIR)
	@echo "Starting Cloudflare tunnel on port $(PORT)..."
	@nohup cloudflared tunnel --url http://localhost:$(PORT) > $(LOG_DIR)/tunnel.log 2>&1 & echo $$! > $(PID_FILE)
	@TUNNEL_URL=""; \
	for i in $$(seq 1 30); do \
		if [ -f "$(LOG_DIR)/tunnel.log" ]; then \
			TUNNEL_URL=$$(grep -aoE 'https://[a-zA-Z0-9]+-[a-zA-Z0-9-]+\.trycloudflare\.com' $(LOG_DIR)/tunnel.log | head -1); \
			if [ -n "$$TUNNEL_URL" ]; then break; fi; \
		fi; \
		sleep 1; \
	done; \
	if [ -z "$$TUNNEL_URL" ]; then \
		echo "Timed out waiting for tunnel URL (30s)"; \
		echo "Check $(LOG_DIR)/tunnel.log"; \
		kill $$(cat $(PID_FILE)) 2>/dev/null || true; \
		rm -f $(PID_FILE); \
		exit 1; \
	fi; \
	if [ -f "$(SETTINGS_FILE)" ] && command -v jq >/dev/null 2>&1; then \
		jq ".discuss.call_server_url = \"$$TUNNEL_URL\"" $(SETTINGS_FILE) > $(SETTINGS_FILE).tmp && mv $(SETTINGS_FILE).tmp $(SETTINGS_FILE); \
	fi; \
	if [ -f .env ]; then \
		grep -v '^CALL_SERVER_URL=' .env > .env.tmp && mv .env.tmp .env; \
	fi; \
	echo "CALL_SERVER_URL=$$TUNNEL_URL" >> .env; \
	echo ""; \
	echo "=============================="; \
	echo "  Cloudflare Tunnel Active"; \
	echo "=============================="; \
	echo "URL:  $$TUNNEL_URL"; \
	echo "PID:  $$(cat $(PID_FILE))"; \
	echo "Log:  $(LOG_DIR)/tunnel.log"; \
	echo "Saved to settings.json + .env"; \
	echo ""; \
	echo "Now run:  make start"

tunnel-stop:
	@if [ -f $(PID_FILE) ]; then \
		PID=$$(cat $(PID_FILE)); \
		if kill -0 $$PID 2>/dev/null; then \
			kill $$PID && echo "Tunnel stopped (PID $$PID)"; \
		else \
			echo "Tunnel not running (stale PID $$PID)"; \
		fi; \
		rm -f $(PID_FILE); \
	fi
