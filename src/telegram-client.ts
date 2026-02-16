#!/usr/bin/env node
/**
 * Telegram Client for TinyClaw Simple
 * Writes DM messages to queue and reads responses
 * Does NOT call Claude directly - that's handled by queue-processor
 *
 * Setup: Create a bot via @BotFather on Telegram to get a bot token.
 */

import TelegramBot from 'node-telegram-bot-api';
import 'dotenv/config';
import fs from 'fs';
import path from 'path';
import { isUserAllowed, upsertPairingRequest, buildPairingMessage } from './pairing.js';
import { transcribeAudio } from './stt.js';
import { textToVoice } from './tts.js';

const SCRIPT_DIR = path.resolve(__dirname, '..');
const QUEUE_INCOMING = path.join(SCRIPT_DIR, '.tinyclaw/queue/incoming');
const QUEUE_OUTGOING = path.join(SCRIPT_DIR, '.tinyclaw/queue/outgoing');
const LOG_FILE = path.join(SCRIPT_DIR, '.tinyclaw/logs/telegram.log');
const AGENT_CWD_DIR = path.join(SCRIPT_DIR, '.tinyclaw/agent_cwd');

// Ensure directories exist
[QUEUE_INCOMING, QUEUE_OUTGOING, path.dirname(LOG_FILE), AGENT_CWD_DIR].forEach(dir => {
    if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
    }
});

// Validate bot token
const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
if (!TELEGRAM_BOT_TOKEN || TELEGRAM_BOT_TOKEN === 'your_token_here') {
    console.error('ERROR: TELEGRAM_BOT_TOKEN is not set in .env file');
    process.exit(1);
}

interface PendingMessage {
    chatId: number;
    messageId: number;
    timestamp: number;
    senderId: string;
}

interface QueueData {
    channel: string;
    sender: string;
    senderId: string;
    message: string;
    timestamp: number;
    messageId: string;
}

interface ResponseData {
    channel: string;
    sender: string;
    senderId?: string;
    message: string;
    originalMessage: string;
    timestamp: number;
    messageId: string;
    qaIndex?: number;
}

const CALL_SERVER_URL = process.env.CALL_SERVER_URL ?? "";
const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY ?? "";
const RESEMBLE_API_KEY = process.env.RESEMBLE_API_KEY ?? "";

// Track pending messages (waiting for response)
const pendingMessages = new Map<string, PendingMessage>();

// Logger
function log(level: string, message: string): void {
    const timestamp = new Date().toISOString();
    const logMessage = `[${timestamp}] [${level}] ${message}\n`;
    console.log(logMessage.trim());
    fs.appendFileSync(LOG_FILE, logMessage);
}

// Split long messages for Telegram's 4096 char limit
function splitMessage(text: string, maxLength = 4096): string[] {
    if (text.length <= maxLength) {
        return [text];
    }

    const chunks: string[] = [];
    let remaining = text;

    while (remaining.length > 0) {
        if (remaining.length <= maxLength) {
            chunks.push(remaining);
            break;
        }

        // Try to split at a newline boundary
        let splitIndex = remaining.lastIndexOf('\n', maxLength);

        // Fall back to space boundary
        if (splitIndex <= 0) {
            splitIndex = remaining.lastIndexOf(' ', maxLength);
        }

        // Hard-cut if no good boundary found
        if (splitIndex <= 0) {
            splitIndex = maxLength;
        }

        chunks.push(remaining.substring(0, splitIndex));
        remaining = remaining.substring(splitIndex).replace(/^\n/, '');
    }

    return chunks;
}

// Initialize Telegram bot (polling mode)
const bot = new TelegramBot(TELEGRAM_BOT_TOKEN, { polling: true });

// Bot ready
bot.getMe().then((me) => {
    log('INFO', `Telegram bot connected as @${me.username}`);
    log('INFO', 'Listening for messages...');
}).catch((err) => {
    log('ERROR', `Failed to connect: ${err.message}`);
    process.exit(1);
});

// Message received - Write to queue
bot.on('message', async (msg) => {
    try {
        // Skip group/channel messages - only handle private chats
        if (msg.chat.type !== 'private') {
            return;
        }

        const sender = msg.from
            ? (msg.from.first_name + (msg.from.last_name ? ` ${msg.from.last_name}` : ''))
            : 'Unknown';
        const senderId = msg.from ? msg.from.id.toString() : msg.chat.id.toString();

        // Extract text from message — either direct text or transcribed voice
        let text: string | undefined;

        if (msg.voice && OPENROUTER_API_KEY) {
            // Voice message — transcribe to text
            if (msg.voice.file_size && msg.voice.file_size > 10_000_000) {
                await bot.sendMessage(msg.chat.id, 'Voice message too large. Please keep it under a minute.', {
                    reply_to_message_id: msg.message_id,
                });
                return;
            }
            log('INFO', `Voice message from ${sender} (${msg.voice.duration}s)`);
            await bot.sendChatAction(msg.chat.id, 'typing');
            try {
                const fileLink = await bot.getFileLink(msg.voice.file_id);
                const audioRes = await fetch(fileLink);
                if (!audioRes.ok) {
                    throw new Error(`File download failed: ${audioRes.status}`);
                }
                const audioBuffer = Buffer.from(await audioRes.arrayBuffer());
                text = await transcribeAudio(
                    audioBuffer,
                    msg.voice.mime_type ?? 'audio/ogg',
                    OPENROUTER_API_KEY,
                );
                log('INFO', `Transcribed voice from ${sender}: "${text.slice(0, 80)}"`);
            } catch (err) {
                const message = err instanceof Error ? err.message : String(err);
                log('ERROR', `Voice transcription failed: ${message}`);
                await bot.sendMessage(msg.chat.id, 'Sorry, I couldn\'t transcribe that voice message. Please try sending text instead.', {
                    reply_to_message_id: msg.message_id,
                });
                return;
            }
        } else if (msg.text && msg.text.trim().length > 0) {
            text = msg.text.trim();
        }

        if (!text) return;

        log('INFO', `Message from ${sender}: ${text.substring(0, 50)}...`);

        // Check if user is allowed
        if (!isUserAllowed('telegram', senderId)) {
            // Only respond to /start command
            if (text.match(/^[!/]start$/i)) {
                log('INFO', `🔒 /start from unauthorized user: ${sender} (${senderId})`);

                // Create or update pairing request (keeps same code if exists)
                const { code } = upsertPairingRequest('telegram', sender, senderId);

                // Always send pairing message on /start
                const pairingMsg = buildPairingMessage('telegram', senderId, code);
                await bot.sendMessage(msg.chat.id, pairingMsg, {
                    reply_to_message_id: msg.message_id,
                });
                log('INFO', `📤 Sent pairing code ${code} to ${sender}`);
            } else {
                // Silently ignore all other messages from unauthorized users
                log('INFO', `🚫 Ignored message from unauthorized user: ${sender} (${senderId})`);
            }

            return;
        }

        // Check for reset command
        if (text.match(/^[!/]reset$/i)) {
            log('INFO', 'Reset command received');

            // Create reset flag
            const resetFlagPath = path.join(SCRIPT_DIR, '.tinyclaw/reset_flag');
            fs.writeFileSync(resetFlagPath, 'reset');

            // Reply immediately
            await bot.sendMessage(msg.chat.id, 'Conversation reset! Next message will start a fresh conversation.', {
                reply_to_message_id: msg.message_id,
            });
            return;
        }

        // Check for /agent_cd command
        const cdMatch = text.match(/^[!/]agent_cd\s+(.+)$/i);
        if (cdMatch) {
            const targetPath = cdMatch[1].trim();
            // Expand ~ to home directory
            const expandedPath = targetPath.startsWith('~/')
                ? path.join(require('os').homedir(), targetPath.slice(2))
                : targetPath === '~'
                    ? require('os').homedir()
                    : path.resolve(targetPath);

            if (!fs.existsSync(expandedPath)) {
                await bot.sendMessage(msg.chat.id, `Directory not found: ${expandedPath}`, {
                    reply_to_message_id: msg.message_id,
                });
                return;
            }

            const stat = fs.statSync(expandedPath);
            if (!stat.isDirectory()) {
                await bot.sendMessage(msg.chat.id, `Not a directory: ${expandedPath}`, {
                    reply_to_message_id: msg.message_id,
                });
                return;
            }

            const safeSenderId = senderId.replace(/[^a-zA-Z0-9_-]/g, '_');
            const cwdFile = path.join(AGENT_CWD_DIR, `telegram_${safeSenderId}`);
            fs.writeFileSync(cwdFile, expandedPath);

            log('INFO', `Agent CWD set to ${expandedPath} for ${sender} (${senderId})`);
            await bot.sendMessage(msg.chat.id, `Agent working directory set to:\n${expandedPath}`, {
                reply_to_message_id: msg.message_id,
            });
            return;
        }

        // Check for /agent_pwd command
        if (text.match(/^[!/]agent_pwd$/i)) {
            const safeSenderId = senderId.replace(/[^a-zA-Z0-9_-]/g, '_');
            const cwdFile = path.join(AGENT_CWD_DIR, `telegram_${safeSenderId}`);
            let currentCwd: string;
            try {
                currentCwd = fs.readFileSync(cwdFile, 'utf8').trim();
                if (!currentCwd || !fs.existsSync(currentCwd)) {
                    currentCwd = '(default session directory)';
                }
            } catch {
                currentCwd = '(default session directory)';
            }

            await bot.sendMessage(msg.chat.id, `Agent working directory:\n${currentCwd}`, {
                reply_to_message_id: msg.message_id,
            });
            return;
        }

        // Show typing indicator
        await bot.sendChatAction(msg.chat.id, 'typing');

        // Generate unique message ID
        const queueMessageId = `${Date.now()}_${Math.random().toString(36).substring(7)}`;

        // Write to incoming queue
        const queueData: QueueData = {
            channel: 'telegram',
            sender: sender,
            senderId: senderId,
            message: text,
            timestamp: Date.now(),
            messageId: queueMessageId,
        };

        const queueFile = path.join(QUEUE_INCOMING, `telegram_${queueMessageId}.json`);
        fs.writeFileSync(queueFile, JSON.stringify(queueData, null, 2));

        log('INFO', `Queued message ${queueMessageId}`);

        // Store pending message for response
        pendingMessages.set(queueMessageId, {
            chatId: msg.chat.id,
            messageId: msg.message_id,
            timestamp: Date.now(),
            senderId: senderId,
        });

        // Clean up old pending messages (older than 5 minutes)
        const fiveMinutesAgo = Date.now() - (5 * 60 * 1000);
        for (const [id, data] of pendingMessages.entries()) {
            if (data.timestamp < fiveMinutesAgo) {
                pendingMessages.delete(id);
            }
        }

    } catch (error) {
        log('ERROR', `Message handling error: ${(error as Error).message}`);
    }
});

// Watch for responses in outgoing queue
function checkOutgoingQueue(): void {
    try {
        const files = fs.readdirSync(QUEUE_OUTGOING)
            .filter(f => f.startsWith('telegram_') && f.endsWith('.json'));

        for (const file of files) {
            const filePath = path.join(QUEUE_OUTGOING, file);

            try {
                const responseData: ResponseData = JSON.parse(fs.readFileSync(filePath, 'utf8'));
                const { messageId, message: responseText, sender } = responseData;

                // Find pending message
                const pending = pendingMessages.get(messageId);
                if (pending) {
                    // Split message if needed (Telegram 4096 char limit)
                    const chunks = splitMessage(responseText);

                    // Build inline buttons row
                    const qaIndex = responseData.qaIndex;
                    const buttons: TelegramBot.InlineKeyboardButton[] = [];

                    if (CALL_SERVER_URL && qaIndex !== undefined) {
                        buttons.push({
                            text: "\uD83C\uDF99\uFE0F Discuss",
                            web_app: {
                                url: `${CALL_SERVER_URL}/call?senderId=${encodeURIComponent(pending.senderId)}&channel=telegram&upTo=${qaIndex}`,
                            },
                        });
                    }

                    if (RESEMBLE_API_KEY) {
                        buttons.push({
                            text: "\uD83D\uDD0A Read Aloud",
                            callback_data: "tts",
                        });
                    }

                    const replyMarkup = buttons.length > 0 ? {
                        reply_markup: {
                            inline_keyboard: [buttons],
                        },
                    } : {};

                    // First chunk as reply, rest as follow-up messages
                    // Discuss button goes on the last chunk
                    if (chunks.length === 1) {
                        bot.sendMessage(pending.chatId, chunks[0], {
                            reply_to_message_id: pending.messageId,
                            ...replyMarkup,
                        });
                    } else {
                        bot.sendMessage(pending.chatId, chunks[0], {
                            reply_to_message_id: pending.messageId,
                        });
                        for (let i = 1; i < chunks.length - 1; i++) {
                            bot.sendMessage(pending.chatId, chunks[i]);
                        }
                        bot.sendMessage(pending.chatId, chunks[chunks.length - 1], replyMarkup);
                    }

                    log('INFO', `Sent response to ${sender} (${responseText.length} chars, ${chunks.length} message(s))`);

                    // Clean up
                    pendingMessages.delete(messageId);
                    fs.unlinkSync(filePath);
                } else {
                    // Message too old or already processed
                    log('WARN', `No pending message for ${messageId}, cleaning up`);
                    fs.unlinkSync(filePath);
                }
            } catch (error) {
                log('ERROR', `Error processing response file ${file}: ${(error as Error).message}`);
                // Don't delete file on error, might retry
            }
        }
    } catch (error) {
        log('ERROR', `Outgoing queue error: ${(error as Error).message}`);
    }
}

// Check outgoing queue every second
setInterval(checkOutgoingQueue, 1000);

// Refresh typing indicator every 4 seconds for pending messages
setInterval(() => {
    for (const [, data] of pendingMessages.entries()) {
        bot.sendChatAction(data.chatId, 'typing').catch(() => {
            // Ignore typing errors silently
        });
    }
}, 4000);

// Handle "Read Aloud" button callback
bot.on('callback_query', async (query) => {
    if (!query.data || !query.message) return;

    if (query.data === 'tts') {
        const chatId = query.message.chat.id;
        const text = query.message.text;

        if (!text) {
            await bot.answerCallbackQuery(query.id, { text: 'No text to read.' });
            return;
        }

        await bot.answerCallbackQuery(query.id, { text: 'Generating audio...' });
        await bot.sendChatAction(chatId, 'record_voice');

        try {
            const voiceBuffer = await textToVoice(text);
            await bot.sendVoice(chatId, voiceBuffer, {
                reply_to_message_id: query.message.message_id,
            });
            log('INFO', `[tts] Sent voice message to ${chatId} (${text.length} chars)`);
        } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            log('ERROR', `[tts] Failed: ${message}`);
            await bot.sendMessage(chatId, 'Sorry, failed to generate audio.', {
                reply_to_message_id: query.message.message_id,
            });
        }
    }
});

// Handle polling errors
bot.on('polling_error', (error) => {
    log('ERROR', `Polling error: ${error.message}`);
});

// Graceful shutdown
process.on('SIGINT', () => {
    log('INFO', 'Shutting down Telegram client...');
    bot.stopPolling();
    process.exit(0);
});

process.on('SIGTERM', () => {
    log('INFO', 'Shutting down Telegram client...');
    bot.stopPolling();
    process.exit(0);
});

// Start
log('INFO', 'Starting Telegram client...');
