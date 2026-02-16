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
ALL_CHANNELS=(telegram discord whatsapp)

declare -A CHANNEL_DISPLAY=(
    [telegram]="Telegram"
    [discord]="Discord"
    [whatsapp]="WhatsApp"
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
echo "Which messaging channels (Telegram, Discord, WhatsApp) do you want to enable?"
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

# Chats directory
echo "Where should user conversations be stored?"
echo -e "${YELLOW}(Each user gets a private Claude session in this directory)${NC}"
echo ""
read -rp "Directory [default: ~/chats_with_claude]: " CHATS_DIR_INPUT
CHATS_ROOT_DIR=${CHATS_DIR_INPUT:-~/chats_with_claude}

echo -e "${GREEN}✓ Chats directory: ${CHATS_ROOT_DIR}${NC}"
echo ""

# Heartbeat interval
echo "Heartbeat interval (seconds)?"
echo -e "${YELLOW}(How often Claude checks in proactively)${NC}"
echo ""
read -rp "Interval in seconds [default: 3600]: " HEARTBEAT_INPUT
HEARTBEAT_INTERVAL=${HEARTBEAT_INPUT:-3600}

if ! [[ "$HEARTBEAT_INTERVAL" =~ ^[0-9]+$ ]]; then
    echo -e "${RED}Invalid interval, using default 3600${NC}"
    HEARTBEAT_INTERVAL=3600
fi
echo -e "${GREEN}✓ Heartbeat interval: ${HEARTBEAT_INTERVAL}s${NC}"
echo ""

# Discuss (voice) feature - OpenAI config
echo "Enable voice Discuss feature? (requires OpenAI API key)"
echo -e "${YELLOW}(Adds a 'Discuss' button to Telegram replies for voice conversations)${NC}"
echo ""
read -rp "  Enable Discuss? [y/N]: " DISCUSS_CHOICE
OPENAI_API_KEY=""
CALL_SERVER_URL=""
CALL_SERVER_PORT="3147"

if [[ "$DISCUSS_CHOICE" =~ ^[yY] ]]; then
    echo ""
    echo "Enter your OpenAI API key:"
    echo -e "${YELLOW}(Get one at: https://platform.openai.com/api-keys)${NC}"
    echo ""
    read -rp "API Key: " OPENAI_API_KEY

    if [ -z "$OPENAI_API_KEY" ]; then
        echo -e "${RED}OpenAI API key is required for Discuss feature${NC}"
        echo -e "${YELLOW}Discuss feature will be disabled${NC}"
    else
        echo -e "${GREEN}✓ OpenAI API key saved${NC}"
        echo ""

        read -rp "Call server port [default: 3100]: " PORT_INPUT
        CALL_SERVER_PORT=${PORT_INPUT:-3100}

        read -rp "Call server URL [default: http://localhost:${CALL_SERVER_PORT}]: " URL_INPUT
        CALL_SERVER_URL=${URL_INPUT:-http://localhost:${CALL_SERVER_PORT}}

        echo -e "${GREEN}✓ Discuss feature enabled (${CALL_SERVER_URL})${NC}"
    fi
fi
echo ""

# Audio features
echo "Enable audio features?"
echo -e "${YELLOW}(Voice messages → text via OpenRouter, Read Aloud via Resemble AI)${NC}"
echo ""

OPENROUTER_API_KEY=""
RESEMBLE_API_KEY_VAL=""
RESEMBLE_VOICE_UUID=""

read -rp "  Enable voice message transcription? [y/N]: " STT_CHOICE
if [[ "$STT_CHOICE" =~ ^[yY] ]]; then
    echo ""
    echo "Enter your OpenRouter API key:"
    echo -e "${YELLOW}(Get one at: https://openrouter.ai/keys)${NC}"
    read -rp "API Key: " OPENROUTER_API_KEY
    if [ -n "$OPENROUTER_API_KEY" ]; then
        echo -e "${GREEN}✓ Voice transcription enabled${NC}"
    fi
fi
echo ""

read -rp "  Enable Read Aloud (TTS)? [y/N]: " TTS_CHOICE
if [[ "$TTS_CHOICE" =~ ^[yY] ]]; then
    echo ""
    echo "Enter your Resemble AI API key:"
    echo -e "${YELLOW}(Get one at: https://app.resemble.ai)${NC}"
    read -rp "API Key: " RESEMBLE_API_KEY_VAL
    if [ -n "$RESEMBLE_API_KEY_VAL" ]; then
        echo -e "${GREEN}✓ Read Aloud enabled${NC}"
        echo ""
        read -rp "Resemble Voice UUID [default: auto-detect]: " RESEMBLE_VOICE_UUID
    fi
fi
echo ""

# Build enabled channels array JSON
CHANNELS_JSON="["
for i in "${!ENABLED_CHANNELS[@]}"; do
    if [ $i -gt 0 ]; then
        CHANNELS_JSON="${CHANNELS_JSON}, "
    fi
    CHANNELS_JSON="${CHANNELS_JSON}\"${ENABLED_CHANNELS[$i]}\""
done
CHANNELS_JSON="${CHANNELS_JSON}]"

# Build channel configs with tokens
DISCORD_TOKEN="${TOKENS[discord]:-}"
TELEGRAM_TOKEN="${TOKENS[telegram]:-}"

# Write settings.json with layered structure
cat > "$SETTINGS_FILE" <<EOF
{
  "channels": {
    "enabled": ${CHANNELS_JSON},
    "discord": {
      "bot_token": "${DISCORD_TOKEN}"
    },
    "telegram": {
      "bot_token": "${TELEGRAM_TOKEN}"
    },
    "whatsapp": {}
  },
  "models": {
    "anthropic": {
      "model": "${MODEL}"
    }
  },
  "monitoring": {
    "heartbeat_interval": ${HEARTBEAT_INTERVAL}
  },
  "discuss": {
    "openai_api_key": "${OPENAI_API_KEY}",
    "call_server_url": "${CALL_SERVER_URL}",
    "call_server_port": ${CALL_SERVER_PORT}
  },
  "audio": {
    "openrouter_api_key": "${OPENROUTER_API_KEY}",
    "resemble_api_key": "${RESEMBLE_API_KEY_VAL}",
    "resemble_voice_uuid": "${RESEMBLE_VOICE_UUID}"
  },
  "chats_root_dir": "${CHATS_ROOT_DIR}"
}
EOF

echo -e "${GREEN}✓ Configuration saved to .tinyclaw/settings.json${NC}"
echo ""
echo "You can now start TinyClaw:"
echo -e "  ${GREEN}./tinyclaw.sh start${NC}"
echo ""
