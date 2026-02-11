/**
 * Pairing system for TinyClaw
 * Ensures only approved users can interact with Claude
 */

import fs from 'fs';
import path from 'path';
import crypto from 'crypto';

const SCRIPT_DIR = path.resolve(__dirname, '..');
const PAIRING_DIR = path.join(SCRIPT_DIR, '.tinyclaw/pairing');
const PAIRING_CODE_LENGTH = 8;
const PAIRING_CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const PAIRING_PENDING_TTL_MS = 60 * 60 * 1000; // 1 hour
const PAIRING_PENDING_MAX = 3;

// Ensure pairing directory exists
if (!fs.existsSync(PAIRING_DIR)) {
    fs.mkdirSync(PAIRING_DIR, { recursive: true });
}

export interface PairingRequest {
    id: string;
    code: string;
    channel: 'whatsapp' | 'telegram' | 'discord';
    sender: string;
    senderId: string;
    createdAt: string;
    lastSeenAt: string;
}

interface PairingStore {
    version: 1;
    requests: PairingRequest[];
}

interface AllowlistStore {
    version: 1;
    allowlist: Array<{
        channel: 'whatsapp' | 'telegram' | 'discord';
        senderId: string;
        sender: string;
        approvedAt: string;
    }>;
}

function getPairingStorePath(channel: string): string {
    return path.join(PAIRING_DIR, `${channel}-pending.json`);
}

function getAllowlistPath(): string {
    return path.join(PAIRING_DIR, 'allowlist.json');
}

function readJsonFile<T>(filePath: string, defaultValue: T): T {
    try {
        if (!fs.existsSync(filePath)) {
            return defaultValue;
        }
        const content = fs.readFileSync(filePath, 'utf8');
        return JSON.parse(content) as T;
    } catch (error) {
        console.error(`Error reading ${filePath}:`, error);
        return defaultValue;
    }
}

function writeJsonFile(filePath: string, data: unknown): void {
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf8');
}

function generateCode(): string {
    let code = '';
    for (let i = 0; i < PAIRING_CODE_LENGTH; i++) {
        const idx = crypto.randomInt(0, PAIRING_CODE_ALPHABET.length);
        code += PAIRING_CODE_ALPHABET[idx];
    }
    return code;
}

function isExpired(request: PairingRequest): boolean {
    const createdAt = new Date(request.createdAt).getTime();
    const now = Date.now();
    return now - createdAt > PAIRING_PENDING_TTL_MS;
}

function pruneExpired(requests: PairingRequest[]): PairingRequest[] {
    return requests.filter(req => !isExpired(req));
}

/**
 * Check if a user is in the allowlist
 */
export function isUserAllowed(channel: 'whatsapp' | 'telegram' | 'discord', senderId: string): boolean {
    const allowlist = readJsonFile<AllowlistStore>(getAllowlistPath(), {
        version: 1,
        allowlist: []
    });

    return allowlist.allowlist.some(
        entry => entry.channel === channel && entry.senderId === senderId
    );
}

/**
 * Create or update a pairing request
 * Returns the pairing code and whether it was newly created
 */
export function upsertPairingRequest(
    channel: 'whatsapp' | 'telegram' | 'discord',
    sender: string,
    senderId: string
): { code: string; created: boolean } {
    const storePath = getPairingStorePath(channel);
    const store = readJsonFile<PairingStore>(storePath, {
        version: 1,
        requests: []
    });

    const now = new Date().toISOString();

    // Prune expired requests
    let requests = pruneExpired(store.requests);

    // Check if request already exists
    const existingIdx = requests.findIndex(req => req.senderId === senderId);

    if (existingIdx >= 0) {
        // Update existing request
        const existing = requests[existingIdx];
        requests[existingIdx] = {
            ...existing,
            lastSeenAt: now,
            sender // Update sender name in case it changed
        };
        writeJsonFile(storePath, { version: 1, requests });
        return { code: existing.code, created: false };
    }

    // Check if we've hit the max pending requests
    if (requests.length >= PAIRING_PENDING_MAX) {
        // Remove oldest request (by lastSeenAt)
        requests.sort((a, b) =>
            new Date(a.lastSeenAt).getTime() - new Date(b.lastSeenAt).getTime()
        );
        requests.shift();
    }

    // Generate unique code
    const existingCodes = new Set(requests.map(req => req.code));
    let code: string;
    let attempts = 0;
    do {
        code = generateCode();
        attempts++;
        if (attempts > 100) {
            throw new Error('Failed to generate unique pairing code');
        }
    } while (existingCodes.has(code));

    // Create new request
    const newRequest: PairingRequest = {
        id: `${channel}_${senderId}`,
        code,
        channel,
        sender,
        senderId,
        createdAt: now,
        lastSeenAt: now
    };

    requests.push(newRequest);
    writeJsonFile(storePath, { version: 1, requests });

    return { code, created: true };
}

/**
 * List all pending pairing requests for a channel
 */
export function listPairingRequests(channel?: 'whatsapp' | 'telegram' | 'discord'): PairingRequest[] {
    const channels = channel ? [channel] : ['whatsapp', 'telegram', 'discord'];
    const allRequests: PairingRequest[] = [];

    for (const ch of channels) {
        const storePath = getPairingStorePath(ch);
        const store = readJsonFile<PairingStore>(storePath, {
            version: 1,
            requests: []
        });

        const validRequests = pruneExpired(store.requests);
        allRequests.push(...validRequests);

        // Write back pruned list
        if (validRequests.length !== store.requests.length) {
            writeJsonFile(storePath, { version: 1, requests: validRequests });
        }
    }

    return allRequests.sort((a, b) =>
        new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
    );
}

/**
 * Approve a pairing code
 */
export function approvePairingCode(code: string): { success: boolean; request?: PairingRequest } {
    const upperCode = code.toUpperCase();

    // Search all channels
    for (const channel of ['whatsapp', 'telegram', 'discord'] as const) {
        const storePath = getPairingStorePath(channel);
        const store = readJsonFile<PairingStore>(storePath, {
            version: 1,
            requests: []
        });

        const requests = pruneExpired(store.requests);
        const idx = requests.findIndex(req => req.code === upperCode);

        if (idx >= 0) {
            const request = requests[idx];

            // Remove from pending
            requests.splice(idx, 1);
            writeJsonFile(storePath, { version: 1, requests });

            // Add to allowlist
            const allowlistPath = getAllowlistPath();
            const allowlist = readJsonFile<AllowlistStore>(allowlistPath, {
                version: 1,
                allowlist: []
            });

            // Check if already in allowlist
            const alreadyExists = allowlist.allowlist.some(
                entry => entry.channel === request.channel && entry.senderId === request.senderId
            );

            if (!alreadyExists) {
                allowlist.allowlist.push({
                    channel: request.channel,
                    senderId: request.senderId,
                    sender: request.sender,
                    approvedAt: new Date().toISOString()
                });
                writeJsonFile(allowlistPath, allowlist);
            }

            return { success: true, request };
        }
    }

    return { success: false };
}

/**
 * List all approved users
 */
export function listApprovedUsers(): AllowlistStore['allowlist'] {
    const allowlist = readJsonFile<AllowlistStore>(getAllowlistPath(), {
        version: 1,
        allowlist: []
    });
    return allowlist.allowlist;
}

/**
 * Build pairing message for a user
 */
export function buildPairingMessage(
    channel: 'whatsapp' | 'telegram' | 'discord',
    senderId: string,
    code: string
): string {
    return [
        '🔒 TinyClaw: Access Required',
        '',
        `Your ${channel} ID: ${senderId}`,
        `Pairing code: ${code}`,
        '',
        'Ask the bot owner to approve access:',
        `  npm run pairing -- approve ${code}`,
        '',
        'This code expires in 1 hour.'
    ].join('\n');
}
