# TinyClaw 🦞

Minimal multi-channel AI assistant with Discord, WhatsApp, and Telegram integration. Each user gets their own private conversation with Claude.

## 🎯 What is TinyClaw?

TinyClaw is a lightweight wrapper around [Claude Code](https://claude.com/claude-code) that:

- ✅ Connects Discord, WhatsApp, and Telegram
- ✅ **Per-user session isolation** - each user has a private conversation
- ✅ **Access control** - pairing system to approve users
- ✅ Processes messages sequentially (no race conditions)
- ✅ Maintains conversation context per user
- ✅ Runs 24/7 in tmux
- ✅ Extensible multi-channel architecture

**Key innovation:** File-based queue system + per-user Claude sessions enables seamless multi-channel support with complete privacy.

## 📐 Architecture

```
┌─────────────────┐
│  Discord        │──┐
│  Client         │  │
└─────────────────┘  │
                     │
┌─────────────────┐  │
│  WhatsApp       │──┤
│  Client         │  │
└─────────────────┘  ├──→ Queue (incoming/)
                     │        ↓
┌─────────────────┐  │   ┌──────────────┐
│  Telegram       │──┤   │   Queue      │
│  Client         │  │   │  Processor   │
└─────────────────┘  │   └──────────────┘
                     │        ↓
                     │   Per-User Session:
                     │   ~/chats_with_claude/
                     │   ├── telegram_123456789/
                     │   ├── whatsapp_1234567890/
                     │   └── discord_987654321/
                     │        ↓
                     │   claude -c -p
                     │        ↓
                     │   Queue (outgoing/)
                     │        ↓
                     └──> Channels send
                          responses
```

## 🚀 Quick Start

### Prerequisites

- macOS or Linux
- [Claude Code](https://claude.com/claude-code) installed
- Node.js v14+
- tmux
- Bash 4.0+ (macOS users: `brew install bash` - system bash 3.2 won't work)

### Installation

```bash
cd /path/to/tinyclaw

# Install dependencies
npm install

# Start TinyClaw (first run triggers setup wizard)
./tinyclaw.sh start
```

### First Run - Setup Wizard

On first start, you'll see an interactive setup wizard:

```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  TinyClaw - Setup Wizard
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Which messaging channels do you want to enable?

  Enable Discord? [y/N]: y
    ✓ Discord enabled
  Enable WhatsApp? [y/N]: y
    ✓ WhatsApp enabled
  Enable Telegram? [y/N]: y
    ✓ Telegram enabled

Enter your Discord bot token:
(Get one at: https://discord.com/developers/applications)

Token: YOUR_DISCORD_BOT_TOKEN_HERE

✓ Discord token saved

Enter your Telegram bot token:
(Create a bot via @BotFather on Telegram to get a token)

Token: YOUR_TELEGRAM_BOT_TOKEN_HERE

✓ Telegram token saved

Which Claude model?

  1) Sonnet  (fast, recommended)
  2) Opus    (smartest)

Choose [1-2]: 1

✓ Model: sonnet

Where should user conversations be stored?
(Each user gets a private Claude session in this directory)

Directory [default: ~/chats_with_claude]: ~/chats_with_claude

✓ Chats directory: ~/chats_with_claude

Heartbeat interval (seconds)?
(How often Claude checks in proactively)

Interval [default: 3600]: 3600

✓ Heartbeat interval: 3600s

✓ Configuration saved to .tinyclaw/settings.json
```

### Discord Setup

1. Go to [Discord Developer Portal](https://discord.com/developers/applications)
2. Create a new application
3. Go to "Bot" section and create a bot
4. Copy the bot token
5. Enable "Message Content Intent" in Bot settings
6. Invite the bot to your server using OAuth2 URL Generator

### Telegram Setup

1. Open Telegram and search for @BotFather
2. Send `/newbot` and follow the prompts
3. Choose a name and username for your bot
4. Copy the bot token provided by BotFather
5. Start a chat with your bot

### WhatsApp Setup

After starting, a QR code will appear if WhatsApp is enabled:

```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
        WhatsApp QR Code
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

[QR CODE HERE]

📱 Scan with WhatsApp:
   Settings → Linked Devices → Link a Device
```

Scan it with your phone. **Done!** 🎉

## 🔐 Access Control (Pairing System)

TinyClaw includes a pairing system to control who can interact with your Claude instance. When someone first messages your bot, they must send `/start` to get a pairing code.

### How It Works

1. **First Contact**: User sends `/start` command
2. **Pairing Code Sent**: They receive an 8-character code
3. **Other Messages Ignored**: Any other message from unauthorized users is silently ignored
4. **Approval**: You approve using the CLI
5. **Access Granted**: Future messages are processed

**Note**: Unauthorized users must send `/start` to get a pairing code. All other messages are ignored.

### What Users See

When an unauthorized user sends `/start`:

```
🔒 TinyClaw: Access Required

Your telegram ID: 123456789
Pairing code: ABC12345

Ask the bot owner to approve access:
  npm run pairing -- approve ABC12345

This code expires in 1 hour.
```

### Pairing Commands

```bash
# List pending pairing requests
npm run pairing -- list

# Approve a user
npm run pairing -- approve ABC12345

# View all approved users
npm run pairing -- allowlist
```

### Pairing Code Details

- **Format**: 8 characters, uppercase letters and numbers
- **No Ambiguous Characters**: Excludes 0, O, 1, and I to prevent confusion
- **Expiration**: Codes expire after 1 hour
- **Limit**: Maximum 3 pending requests per channel at a time

## 💬 Per-User Sessions

Each user gets their own private Claude conversation that persists across messages. Sessions are isolated - users cannot see each other's conversations.

### Session Isolation

Each user (identified by channel + user ID) gets their own Claude session:

```
WhatsApp User: +1234567890
  → ~/chats_with_claude/whatsapp_1234567890_c_us/

Telegram User: 123456789
  → ~/chats_with_claude/telegram_123456789/

Discord User: 987654321
  → ~/chats_with_claude/discord_987654321/
```

(Default location: `~/chats_with_claude/`, configurable during setup)

**Example:**
```
Telegram User A: "My name is Alice"
Claude: "Nice to meet you, Alice!"

WhatsApp User B: "What's my name?"
Claude: "I don't have information about your name yet."

Telegram User A (later): "What's my name?"
Claude: "Your name is Alice."
```

### Session Storage

All sessions are stored in a configurable directory (default: `~/chats_with_claude/`):

You can choose the directory:
1. **During setup** - Setup wizard asks for the location
2. **Command-line argument** - Pass `--chats-dir` when starting:
   ```bash
   ./tinyclaw.sh --chats-dir ~/my_chats start
   ```
3. **Default** - If not specified, uses `~/chats_with_claude/`

This is separate from the TinyClaw codebase, making it easy to:
- Back up all conversations
- Archive old sessions
- Share conversation logs
- Keep conversations organized
- Store on external drive or cloud sync folder

### Session Management Commands

```bash
# List all active user sessions
npm run sessions -- list

# View a user's session details
npm run sessions -- view telegram 123456789

# Reset a user's conversation
npm run sessions -- reset telegram 123456789
```

**List Sessions Output:**
```
📁 Active Sessions (3):

  TELEGRAM (2):
    • 123456789
      Last active: 2h ago
      Size: 245KB

    • 987654321
      Last active: 1d ago
      Size: 1.2MB

  WHATSAPP (1):
    • 1234567890_c_us
      Last active: 30m ago
      Size: 512KB
```

### Backup Sessions

```bash
# Backup all sessions (replace path with your chats directory)
tar -czf chats_backup_$(date +%Y%m%d).tar.gz ~/chats_with_claude/

# Restore sessions
tar -xzf chats_backup_20260211.tar.gz -C ~/

# Backup single user
tar -czf user_backup.tar.gz ~/chats_with_claude/telegram_123456789/
```

**Note**: Your actual chats directory is shown when you run `npm run sessions -- list`

## 📋 Commands

```bash
# Start TinyClaw
./tinyclaw.sh start

# Start with custom chats directory
./tinyclaw.sh --chats-dir ~/my_conversations start
./tinyclaw.sh --chats-dir ~/Dropbox/claude_chats start
./tinyclaw.sh --chats-dir ~/Documents/chats restart

# Run setup wizard (change channels/model/heartbeat)
./tinyclaw.sh setup

# Check status
./tinyclaw.sh status

# Send manual message
./tinyclaw.sh send "What's the weather?"

# Reset conversation (per-user)
./tinyclaw.sh reset

# Reset channel authentication
./tinyclaw.sh channels reset whatsapp  # Clear WhatsApp session
./tinyclaw.sh channels reset discord   # Shows Discord reset instructions
./tinyclaw.sh channels reset telegram  # Shows Telegram reset instructions

# Switch Claude model
./tinyclaw.sh model           # Show current model
./tinyclaw.sh model sonnet    # Switch to Sonnet (fast)
./tinyclaw.sh model opus      # Switch to Opus (smartest)

# View logs
./tinyclaw.sh logs whatsapp   # WhatsApp activity
./tinyclaw.sh logs discord    # Discord activity
./tinyclaw.sh logs telegram   # Telegram activity
./tinyclaw.sh logs queue      # Queue processing
./tinyclaw.sh logs heartbeat  # Heartbeat checks

# Session management
npm run sessions -- list                    # List all user sessions
npm run sessions -- view telegram 123456789 # View session details
npm run sessions -- reset telegram 123456789 # Reset user conversation

# Pairing management
npm run pairing -- list          # List pending pairing requests
npm run pairing -- approve CODE  # Approve a user
npm run pairing -- allowlist     # View approved users

# Attach to tmux
./tinyclaw.sh attach

# Restart
./tinyclaw.sh restart

# Stop
./tinyclaw.sh stop
```

## 🔄 Reset Conversation

### Via CLI (All Users)

```bash
./tinyclaw.sh reset
```

### Via Chat (Per User)

Send: `!reset` or `/reset`

Next message starts fresh (no conversation history). Only resets your own conversation.

### Reset Specific User

```bash
npm run sessions -- reset telegram 123456789
```

## 💬 Message Flow

```
Message arrives (Discord/WhatsApp/Telegram)
       ↓
Client checks if user is approved (pairing)
       ↓
Client writes to:
  .tinyclaw/queue/incoming/{channel}_<id>.json
       ↓
queue-processor.ts picks it up
       ↓
Gets user session directory:
  ~/chats_with_claude/{channel}_{senderId}/
       ↓
Runs: cd {session_dir} && claude -c -p "message"
       ↓
Writes to:
  .tinyclaw/queue/outgoing/{channel}_<id>.json
       ↓
Client reads and sends response
       ↓
User receives reply
```

## 📁 Directory Structure

```
tinyclaw/
├── .claude/              # Claude Code config
│   ├── settings.json     # Hooks config
│   └── hooks/            # Hook scripts
├── .tinyclaw/            # TinyClaw data
│   ├── settings.json     # Configuration (channel, model, tokens)
│   ├── queue/
│   │   ├── incoming/     # New messages
│   │   ├── processing/   # Being processed
│   │   └── outgoing/     # Responses
│   ├── pairing/          # Access control
│   │   ├── telegram-pending.json
│   │   ├── whatsapp-pending.json
│   │   ├── discord-pending.json
│   │   └── allowlist.json
│   ├── reset_flags/      # Per-user reset flags
│   ├── logs/
│   │   ├── discord.log
│   │   ├── whatsapp.log
│   │   ├── telegram.log
│   │   ├── queue.log
│   │   └── heartbeat.log
│   ├── channels/         # Runtime channel data
│   ├── whatsapp-session/
│   └── heartbeat.md
├── src/
│   ├── discord-client.ts    # Discord I/O
│   ├── whatsapp-client.ts   # WhatsApp I/O
│   ├── telegram-client.ts   # Telegram I/O
│   ├── queue-processor.ts   # Message processing
│   ├── pairing.ts           # Access control logic
│   ├── pairing-cli.ts       # Pairing management CLI
│   └── sessions-cli.ts      # Session management CLI
├── dist/                 # TypeScript build output
├── setup-wizard.sh       # Interactive setup
├── tinyclaw.sh           # Main script
└── heartbeat-cron.sh     # Health checks

~/chats_with_claude/  # User sessions (configurable, separate)
├── telegram_123456789/
│   ├── session-abc.jsonl
│   └── memory/
├── whatsapp_1234567890_c_us/
│   ├── session-def.jsonl
│   └── memory/
└── discord_987654321/
    ├── session-ghi.jsonl
    └── memory/
```

## ⚙️ Configuration

### Settings File

All configuration is stored in `.tinyclaw/settings.json`:

```json
{
  "channels": {
    "enabled": ["discord", "whatsapp", "telegram"],
    "discord": {
      "bot_token": "YOUR_DISCORD_TOKEN_HERE"
    },
    "telegram": {
      "bot_token": "YOUR_TELEGRAM_TOKEN_HERE"
    },
    "whatsapp": {}
  },
  "models": {
    "anthropic": {
      "model": "sonnet"
    }
  },
  "monitoring": {
    "heartbeat_interval": 3600
  },
  "chats_root_dir": "~/chats_with_claude"
}
```

To reconfigure, run:

```bash
./tinyclaw.sh setup
```

The heartbeat interval is in seconds (default: 3600s = 60 minutes).
This controls how often Claude proactively checks in.

### Heartbeat Prompt

Edit `.tinyclaw/heartbeat.md`:

```markdown
Check for:

1. Pending tasks
2. Errors
3. Unread messages

Take action if needed.
```

## 📊 Monitoring

### View Logs

```bash
# WhatsApp activity
tail -f .tinyclaw/logs/whatsapp.log

# Discord activity
tail -f .tinyclaw/logs/discord.log

# Telegram activity
tail -f .tinyclaw/logs/telegram.log

# Queue processing
tail -f .tinyclaw/logs/queue.log

# Heartbeat checks
tail -f .tinyclaw/logs/heartbeat.log

# All logs
./tinyclaw.sh logs daemon
```

### Watch Queue

```bash
# Incoming messages
watch -n 1 'ls -lh .tinyclaw/queue/incoming/'

# Outgoing responses
watch -n 1 'ls -lh .tinyclaw/queue/outgoing/'
```

### Monitor Sessions

```bash
# List active sessions (shows your chats directory)
npm run sessions -- list

# Watch session directory
watch -n 1 'du -sh ~/chats_with_claude/*'
```

## 🎨 Features

### ✅ No Race Conditions

Messages processed **sequentially**, one at a time:

```
Message 1 → Process → Done
Message 2 → Wait → Process → Done
Message 3 → Wait → Process → Done
```

### ✅ Multi-Channel Support

Discord, WhatsApp, and Telegram work seamlessly together. Each user gets their own private conversation that persists across channels!

**Adding more channels is easy:**

```typescript
// new-channel-client.ts
// Write to queue with senderId
fs.writeFileSync(
  ".tinyclaw/queue/incoming/channel_<id>.json",
  JSON.stringify({
    channel: "channel-name",
    message,
    sender,
    senderId,  // Required for session isolation
    timestamp,
  }),
);

// Read responses from outgoing queue
// Same format as other channels
```

Queue processor handles all channels automatically!

### ✅ Per-User Privacy

- Each user has a private conversation
- Users cannot see each other's messages
- Sessions are completely isolated
- Easy to manage per user

### ✅ Clean Responses

Uses `claude -c -p`:

- `-c` = continue conversation
- `-p` = print mode (clean output)
- No tmux capture needed

### ✅ Persistent Sessions

Sessions persist across restarts:

```bash
# First time: Scan QR code
./tinyclaw.sh start

# Subsequent starts: Auto-connects
./tinyclaw.sh restart
```

Each user's conversation history is maintained in their session directory.

## 🔐 Security

- **Pairing System**: Only approved users can interact with Claude
- **Per-User Isolation**: Users cannot see each other's conversations
- **Session Privacy**: Each user gets their own private Claude session
- WhatsApp session stored locally in `.tinyclaw/whatsapp-session/`
- Queue files are local (no network exposure)
- Each channel handles its own authentication
- Claude runs with your user permissions
- Pairing codes expire after 1 hour
- Maximum 3 pending requests per channel

## 🐛 Troubleshooting

### Bash version error on macOS

If you see:

```
Error: This script requires bash 4.0 or higher (you have 3.2.57)
```

macOS ships with bash 3.2 by default. Install a newer version:

```bash
# Install bash 5.x via Homebrew
brew install bash

# Add to your PATH (add this to ~/.zshrc or ~/.bash_profile)
export PATH="/opt/homebrew/bin:$PATH"

# Or run directly with the new bash
/opt/homebrew/bin/bash ./tinyclaw.sh start
```

### WhatsApp not connecting

```bash
# Check logs
./tinyclaw.sh logs whatsapp

# Reset WhatsApp authentication
./tinyclaw.sh channels reset whatsapp
./tinyclaw.sh restart
```

### Discord not connecting

```bash
# Check logs
./tinyclaw.sh logs discord

# Update Discord bot token
./tinyclaw.sh setup
```

### Telegram not connecting

```bash
# Check logs
./tinyclaw.sh logs telegram

# Update Telegram bot token
./tinyclaw.sh setup
```

### Messages not processing

```bash
# Check queue processor
./tinyclaw.sh status

# Check queue
ls -la .tinyclaw/queue/incoming/

# View queue logs
./tinyclaw.sh logs queue
```

### User not getting responses

```bash
# Check if user is approved
npm run pairing -- allowlist

# Check user's session
npm run sessions -- view telegram 123456789

# Check logs for that channel
./tinyclaw.sh logs telegram
```

### Session not persisting

```bash
# Check if session directory exists
ls -la ~/chats_with_claude/

# Check permissions
ls -la ~/

# View session files
npm run sessions -- view telegram 123456789
```

### QR code not showing

```bash
# Attach to tmux to see the QR code
tmux attach -t tinyclaw
```

## 🚀 Production Deployment

### Using systemd

```bash
sudo systemctl enable tinyclaw
sudo systemctl start tinyclaw
```

### Using PM2

```bash
pm2 start tinyclaw.sh --name tinyclaw
pm2 save
```

### Using supervisor

```ini
[program:tinyclaw]
command=/path/to/tinyclaw/tinyclaw.sh start
autostart=true
autorestart=true
```

## 🎯 Use Cases

### Personal AI Assistant

```
You: "Remind me to call mom"
Claude: "I'll remind you!"
[5 minutes later via heartbeat]
Claude: "Don't forget to call mom!"
```

### Code Helper

```
You: "Review my code"
Claude: [reads files, provides feedback]
You: "Fix the bug"
Claude: [fixes and commits]
```

### Multi-Device

- WhatsApp on phone
- Discord on desktop/mobile
- Telegram on any device
- CLI for scripts

Each user has their own private conversation with Claude!

### Multi-User Bot

- Friend A on Telegram: "Help me with Python"
- Friend B on WhatsApp: "Help me with React"
- Friend C on Discord: "Help me with Go"

All three get private, isolated conversations. No context mixing!

## 🙏 Credits

- Inspired by [OpenClaw](https://openclaw.ai/) by Peter Steinberger
- Built on [Claude Code](https://claude.com/claude-code)
- Uses [discord.js](https://discord.js.org/)
- Uses [whatsapp-web.js](https://github.com/pedroslopez/whatsapp-web.js)
- Uses [node-telegram-bot-api](https://github.com/yagop/node-telegram-bot-api)

## 📄 License

MIT

---

**TinyClaw - Small but mighty!** 🦞✨
