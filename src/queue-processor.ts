#!/usr/bin/env node
/**
 * Queue Processor - Handles messages from all channels (WhatsApp, Telegram, etc.)
 * Processes one message at a time to avoid race conditions
 */

import { execSync } from 'child_process';
import fs from 'fs';
import path from 'path';

const SCRIPT_DIR = path.resolve(__dirname, '..');
const QUEUE_INCOMING = path.join(SCRIPT_DIR, '.tinyclaw/queue/incoming');
const QUEUE_OUTGOING = path.join(SCRIPT_DIR, '.tinyclaw/queue/outgoing');
const QUEUE_PROCESSING = path.join(SCRIPT_DIR, '.tinyclaw/queue/processing');
const LOG_FILE = path.join(SCRIPT_DIR, '.tinyclaw/logs/queue.log');
const RESET_FLAG = path.join(SCRIPT_DIR, '.tinyclaw/reset_flag');
const SETTINGS_FILE = path.join(SCRIPT_DIR, '.tinyclaw/settings.json');
const DISCUSS_DIR = path.join(SCRIPT_DIR, '.tinyclaw/discuss');
const AGENT_CWD_DIR = path.join(SCRIPT_DIR, '.tinyclaw/agent_cwd');

// Get chats root directory from settings or use default
function getChatsRootDir(): string {
    try {
        const settingsData = fs.readFileSync(SETTINGS_FILE, 'utf8');
        const settings: Settings = JSON.parse(settingsData);
        const chatsDir = settings?.chats_root_dir;

        if (chatsDir) {
            // Expand ~ to home directory
            const expandedPath = chatsDir.startsWith('~/')
                ? path.join(require('os').homedir(), chatsDir.slice(2))
                : chatsDir;
            return path.resolve(expandedPath);
        }
    } catch (error) {
        // Settings file doesn't exist yet or can't be read
    }

    // Default to ~/chats_with_claude
    return path.join(require('os').homedir(), 'chats_with_claude');
}

// Root directory for all Claude conversations (per-user sessions)
const CHATS_ROOT_DIR = getChatsRootDir();

// Ensure chats root directory exists
if (!fs.existsSync(CHATS_ROOT_DIR)) {
    fs.mkdirSync(CHATS_ROOT_DIR, { recursive: true });
    console.log(`Created chats directory: ${CHATS_ROOT_DIR}`);
}

// Model name mapping
const MODEL_IDS: Record<string, string> = {
    'sonnet': 'claude-sonnet-4-5',
    'opus': 'claude-opus-4-6',
};

interface Settings {
    channels?: {
        enabled?: string[];
        discord?: { bot_token?: string };
        telegram?: { bot_token?: string };
        whatsapp?: {};
    };
    models?: {
        anthropic?: {
            model?: string;
        };
    };
    monitoring?: {
        heartbeat_interval?: number;
    };
    chats_root_dir?: string;
}

function getModelFlag(): string {
    try {
        const settingsData = fs.readFileSync(SETTINGS_FILE, 'utf8');
        const settings: Settings = JSON.parse(settingsData);
        const model = settings?.models?.anthropic?.model;
        if (model) {
            const modelId = MODEL_IDS[model];
            if (modelId) {
                return `--model ${modelId} `;
            }
        }
    } catch { }
    return '';
}

// Ensure directories exist
const RESET_FLAGS_DIR = path.join(SCRIPT_DIR, '.tinyclaw/reset_flags');
[QUEUE_INCOMING, QUEUE_OUTGOING, QUEUE_PROCESSING, path.dirname(LOG_FILE), RESET_FLAGS_DIR, DISCUSS_DIR, AGENT_CWD_DIR].forEach(dir => {
    if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
    }
});

interface MessageData {
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
    message: string;
    originalMessage: string;
    timestamp: number;
    messageId: string;
    qaIndex?: number;
}

interface QAEntry {
    question: string;
    answer: string;
    timestamp: number;
}

/**
 * Append a Q&A pair to the discuss history file for a user.
 * Returns the 0-based index of the appended entry.
 */
function appendQAHistory(channel: string, senderId: string, question: string, answer: string): number {
    const safeSenderId = senderId.replace(/[^a-zA-Z0-9_-]/g, '_');
    const historyFile = path.join(DISCUSS_DIR, `${channel}_${safeSenderId}.json`);

    let history: QAEntry[] = [];
    try {
        history = JSON.parse(fs.readFileSync(historyFile, 'utf8'));
    } catch {
        // File doesn't exist or is invalid — start fresh
    }

    history.push({ question, answer, timestamp: Date.now() });
    fs.writeFileSync(historyFile, JSON.stringify(history, null, 2));

    return history.length - 1;
}

/**
 * Clear discuss history for a user (on /reset).
 */
function clearQAHistory(channel: string, senderId: string): void {
    const safeSenderId = senderId.replace(/[^a-zA-Z0-9_-]/g, '_');
    const historyFile = path.join(DISCUSS_DIR, `${channel}_${safeSenderId}.json`);
    try {
        fs.unlinkSync(historyFile);
    } catch {
        // File doesn't exist — nothing to clear
    }
}

// Logger
function log(level: string, message: string): void {
    const timestamp = new Date().toISOString();
    const logMessage = `[${timestamp}] [${level}] ${message}\n`;
    console.log(logMessage.trim());
    fs.appendFileSync(LOG_FILE, logMessage);
}

/**
 * Get or create user session directory
 * Format: /Users/pb/notes/chats_with_claude/{channel}_{senderId}/
 */
function getUserSessionDir(channel: string, senderId: string): string {
    // Sanitize senderId for filesystem (remove special characters)
    const safeSenderId = senderId.replace(/[^a-zA-Z0-9_-]/g, '_');
    const sessionDir = path.join(CHATS_ROOT_DIR, `${channel}_${safeSenderId}`);

    if (!fs.existsSync(sessionDir)) {
        fs.mkdirSync(sessionDir, { recursive: true });
        log('INFO', `📁 Created new session directory: ${sessionDir}`);
    }

    return sessionDir;
}

/**
 * Get the agent working directory for a user.
 * Returns the custom dir if set, otherwise the session dir.
 */
function getAgentCwd(channel: string, senderId: string, sessionDir: string): string {
    const safeSenderId = senderId.replace(/[^a-zA-Z0-9_-]/g, '_');
    const cwdFile = path.join(AGENT_CWD_DIR, `${channel}_${safeSenderId}`);
    try {
        const cwd = fs.readFileSync(cwdFile, 'utf8').trim();
        if (cwd && fs.existsSync(cwd)) {
            return cwd;
        }
    } catch {
        // No custom cwd set
    }
    return sessionDir;
}

/**
 * Get user-specific reset flag path
 */
function getUserResetFlag(channel: string, senderId: string): string {
    const safeSenderId = senderId.replace(/[^a-zA-Z0-9_-]/g, '_');
    return path.join(SCRIPT_DIR, `.tinyclaw/reset_flags/${channel}_${safeSenderId}`);
}

// Process a single message
async function processMessage(messageFile: string): Promise<void> {
    const processingFile = path.join(QUEUE_PROCESSING, path.basename(messageFile));

    try {
        // Move to processing to mark as in-progress
        fs.renameSync(messageFile, processingFile);

        // Read message
        const messageData: MessageData = JSON.parse(fs.readFileSync(processingFile, 'utf8'));
        const { channel, sender, senderId, message, timestamp, messageId } = messageData;

        if (!senderId) {
            throw new Error('senderId is required for message processing');
        }

        log('INFO', `Processing [${channel}] from ${sender} (${senderId}): ${message.substring(0, 50)}...`);

        // Get user-specific session directory
        const sessionDir = getUserSessionDir(channel, senderId);

        // Check if we should reset conversation for this user
        const userResetFlag = getUserResetFlag(channel, senderId);
        const shouldReset = fs.existsSync(userResetFlag) || fs.existsSync(RESET_FLAG);
        const continueFlag = shouldReset ? '' : '-c ';

        if (shouldReset) {
            log('INFO', `🔄 Resetting conversation for ${sender} (starting fresh without -c)`);
            // Remove user-specific reset flag
            if (fs.existsSync(userResetFlag)) {
                fs.unlinkSync(userResetFlag);
            }
            // Remove global reset flag
            if (fs.existsSync(RESET_FLAG)) {
                fs.unlinkSync(RESET_FLAG);
            }
            // Clear discuss history on reset
            clearQAHistory(channel, senderId);
        }

        // Call Claude from agent working directory (defaults to session dir)
        const workingDir = getAgentCwd(channel, senderId, sessionDir);
        let response: string;
        try {
            const modelFlag = getModelFlag();
            // Strip env vars that interfere with Claude CLI:
            // - CLAUDECODE: prevents nested-session detection
            // - ANTHROPIC_API_KEY: forces API credits instead of Max subscription
            const env = { ...process.env };
            delete env.CLAUDECODE;
            delete env.ANTHROPIC_API_KEY;

            response = execSync(
                `cd "${workingDir}" && claude --dangerously-skip-permissions ${modelFlag}${continueFlag}-p "${message.replace(/"/g, '\\"')}"`,
                {
                    encoding: "utf-8",
                    timeout: 0, // No timeout - wait for Claude to finish (agents can run long)
                    maxBuffer: 10 * 1024 * 1024, // 10MB buffer
                    env,
                },
            );
        } catch (error) {
            const err = error as { message?: string; stderr?: string | Buffer; stdout?: string | Buffer; status?: number };
            log('ERROR', `Claude error: ${err.message}`);
            if (err.stderr) {
                log('ERROR', `Claude stderr: ${err.stderr.toString().trim()}`);
            }
            if (err.stdout) {
                log('ERROR', `Claude stdout: ${err.stdout.toString().trim().substring(0, 500)}`);
            }
            log('ERROR', `Claude exit code: ${err.status}`);
            response = "Sorry, I encountered an error processing your request.";
        }

        // Clean response
        response = response.trim();

        // Save Q&A to discuss history (skip heartbeat messages)
        let qaIndex: number | undefined;
        if (channel !== 'heartbeat') {
            qaIndex = appendQAHistory(channel, senderId, message, response);
        }

        // Write response to outgoing queue
        const responseData: ResponseData = {
            channel,
            sender,
            message: response,
            originalMessage: message,
            timestamp: Date.now(),
            messageId,
            ...(qaIndex !== undefined && { qaIndex }),
        };

        // For heartbeat messages, write to a separate location (they handle their own responses)
        const responseFile = channel === 'heartbeat'
            ? path.join(QUEUE_OUTGOING, `${messageId}.json`)
            : path.join(QUEUE_OUTGOING, `${channel}_${messageId}_${Date.now()}.json`);

        fs.writeFileSync(responseFile, JSON.stringify(responseData, null, 2));

        log('INFO', `✓ Response ready [${channel}] ${sender} (${response.length} chars)`);

        // Clean up processing file
        fs.unlinkSync(processingFile);

    } catch (error) {
        log('ERROR', `Processing error: ${(error as Error).message}`);

        // Move back to incoming for retry
        if (fs.existsSync(processingFile)) {
            try {
                fs.renameSync(processingFile, messageFile);
            } catch (e) {
                log('ERROR', `Failed to move file back: ${(e as Error).message}`);
            }
        }
    }
}

interface QueueFile {
    name: string;
    path: string;
    time: number;
}

// Main processing loop
async function processQueue(): Promise<void> {
    try {
        // Get all files from incoming queue, sorted by timestamp
        const files: QueueFile[] = fs.readdirSync(QUEUE_INCOMING)
            .filter(f => f.endsWith('.json'))
            .map(f => ({
                name: f,
                path: path.join(QUEUE_INCOMING, f),
                time: fs.statSync(path.join(QUEUE_INCOMING, f)).mtimeMs
            }))
            .sort((a, b) => a.time - b.time);

        if (files.length > 0) {
            log('DEBUG', `Found ${files.length} message(s) in queue`);

            // Process one at a time
            for (const file of files) {
                await processMessage(file.path);
            }
        }
    } catch (error) {
        log('ERROR', `Queue processing error: ${(error as Error).message}`);
    }
}

// Main loop
log('INFO', 'Queue processor started');
log('INFO', `Watching: ${QUEUE_INCOMING}`);

// Process queue every 1 second
setInterval(processQueue, 1000);

// Graceful shutdown
process.on('SIGINT', () => {
    log('INFO', 'Shutting down queue processor...');
    process.exit(0);
});

process.on('SIGTERM', () => {
    log('INFO', 'Shutting down queue processor...');
    process.exit(0);
});
