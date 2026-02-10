#!/usr/bin/env bash
# TinyClaw Setup Wizard

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SETTINGS_FILE="$SCRIPT_DIR/.tinyclaw/settings.json"

GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
BLUE='\033[0;34m'
NC='\033[0m'

mkdir -p "$SCRIPT_DIR/.tinyclaw"

echo ""
echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo -e "${GREEN}  TinyClaw - Setup Wizard${NC}"
echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo ""

# --- Channel registry ---
# To add a new channel, add its ID here and fill in the config arrays below.
ALL_CHANNELS=(discord whatsapp telegram)

declare -A CHANNEL_DISPLAY=(
    [discord]="Discord"
    [whatsapp]="WhatsApp"
    [telegram]="Telegram"
)
declare -A CHANNEL_TOKEN_KEY=(
    [discord]="discord_bot_token"
    [telegram]="telegram_bot_token"
)
declare -A CHANNEL_TOKEN_PROMPT=(
    [discord]="Enter your Discord bot token:"
    [telegram]="Enter your Telegram bot token:"
)
declare -A CHANNEL_TOKEN_HELP=(
    [discord]="(Get one at: https://discord.com/developers/applications)"
    [telegram]="(Create a bot via @BotFather on Telegram to get a token)"
)

# Channel selection - simple checklist
echo "Which messaging channels do you want to enable?"
echo ""

ENABLED_CHANNELS=()
for ch in "${ALL_CHANNELS[@]}"; do
    read -rp "  Enable ${CHANNEL_DISPLAY[$ch]}? [y/N]: " choice
    if [[ "$choice" =~ ^[yY] ]]; then
        ENABLED_CHANNELS+=("$ch")
        echo -e "    ${GREEN}✓ ${CHANNEL_DISPLAY[$ch]} enabled${NC}"
    fi
done
echo ""

if [ ${#ENABLED_CHANNELS[@]} -eq 0 ]; then
    echo -e "${RED}No channels selected. At least one channel is required.${NC}"
    exit 1
fi

# Collect tokens for channels that need them
declare -A TOKENS
for ch in "${ENABLED_CHANNELS[@]}"; do
    token_key="${CHANNEL_TOKEN_KEY[$ch]:-}"
    if [ -n "$token_key" ]; then
        echo "${CHANNEL_TOKEN_PROMPT[$ch]}"
        echo -e "${YELLOW}${CHANNEL_TOKEN_HELP[$ch]}${NC}"
        echo ""
        read -rp "Token: " token_value

        if [ -z "$token_value" ]; then
            echo -e "${RED}${CHANNEL_DISPLAY[$ch]} bot token is required${NC}"
            exit 1
        fi
        TOKENS[$ch]="$token_value"
        echo -e "${GREEN}✓ ${CHANNEL_DISPLAY[$ch]} token saved${NC}"
        echo ""
    fi
done

# Model selection
echo "Which Claude model?"
echo ""
echo "  1) Sonnet  (fast, recommended)"
echo "  2) Opus    (smartest)"
echo ""
read -rp "Choose [1-2]: " MODEL_CHOICE

case "$MODEL_CHOICE" in
    1) MODEL="sonnet" ;;
    2) MODEL="opus" ;;
    *)
        echo -e "${RED}Invalid choice${NC}"
        exit 1
        ;;
esac
echo -e "${GREEN}✓ Model: $MODEL${NC}"
echo ""

# Heartbeat interval
echo "Heartbeat interval (seconds)?"
echo -e "${YELLOW}(How often Claude checks in proactively)${NC}"
echo ""
read -rp "Interval [default: 500]: " HEARTBEAT_INPUT
HEARTBEAT_INTERVAL=${HEARTBEAT_INPUT:-500}

if ! [[ "$HEARTBEAT_INTERVAL" =~ ^[0-9]+$ ]]; then
    echo -e "${RED}Invalid interval, using default 500${NC}"
    HEARTBEAT_INTERVAL=500
fi
echo -e "${GREEN}✓ Heartbeat interval: ${HEARTBEAT_INTERVAL}s${NC}"
echo ""

# Build channels comma-separated string
CHANNELS_CSV=$(IFS=,; echo "${ENABLED_CHANNELS[*]}")

# Build token entries for settings.json
TOKENS_JSON=""
for ch in "${ALL_CHANNELS[@]}"; do
    token_key="${CHANNEL_TOKEN_KEY[$ch]:-}"
    if [ -n "$token_key" ]; then
        token_value="${TOKENS[$ch]:-}"
        TOKENS_JSON="${TOKENS_JSON}  \"${token_key}\": \"${token_value}\",
"
    fi
done

# Write settings.json
cat > "$SETTINGS_FILE" <<EOF
{
  "channels": "${CHANNELS_CSV}",
  "model": "${MODEL}",
${TOKENS_JSON}  "heartbeat_interval": ${HEARTBEAT_INTERVAL}
}
EOF

echo -e "${GREEN}✓ Configuration saved to .tinyclaw/settings.json${NC}"
echo ""
echo "You can now start TinyClaw:"
echo -e "  ${GREEN}./tinyclaw.sh start${NC}"
echo ""
