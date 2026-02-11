#!/usr/bin/env node
/**
 * CLI tool for managing TinyClaw user sessions
 * Usage:
 *   npm run sessions -- list
 *   npm run sessions -- reset <channel> <senderId>
 *   npm run sessions -- view <channel> <senderId>
 */

import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';

const CHATS_ROOT_DIR = '/Users/pb/notes/chats_with_claude';
const SCRIPT_DIR = path.resolve(__dirname, '..');
const RESET_FLAGS_DIR = path.join(SCRIPT_DIR, '.tinyclaw/reset_flags');

interface SessionInfo {
    channel: string;
    senderId: string;
    path: string;
    lastModified: Date;
    size: string;
}

function formatSize(bytes: number): string {
    if (bytes < 1024) return `${bytes}B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
}

function formatDate(date: Date): string {
    const now = new Date();
    const diff = now.getTime() - date.getTime();
    const hours = Math.floor(diff / (1000 * 60 * 60));
    const days = Math.floor(hours / 24);

    if (days > 0) {
        return `${days}d ago`;
    } else if (hours > 0) {
        return `${hours}h ago`;
    } else {
        const minutes = Math.floor(diff / (1000 * 60));
        return `${minutes}m ago`;
    }
}

function parseSessionDir(dirName: string): { channel: string; senderId: string } | null {
    const match = dirName.match(/^(whatsapp|telegram|discord)_(.+)$/);
    if (!match) return null;
    return { channel: match[1], senderId: match[2] };
}

function getDirectorySize(dirPath: string): number {
    let size = 0;
    try {
        const files = fs.readdirSync(dirPath);
        for (const file of files) {
            const filePath = path.join(dirPath, file);
            const stats = fs.statSync(filePath);
            if (stats.isDirectory()) {
                size += getDirectorySize(filePath);
            } else {
                size += stats.size;
            }
        }
    } catch (error) {
        // Ignore errors
    }
    return size;
}

function listSessions(): SessionInfo[] {
    if (!fs.existsSync(CHATS_ROOT_DIR)) {
        return [];
    }

    const sessions: SessionInfo[] = [];
    const dirs = fs.readdirSync(CHATS_ROOT_DIR);

    for (const dir of dirs) {
        const parsed = parseSessionDir(dir);
        if (!parsed) continue;

        const dirPath = path.join(CHATS_ROOT_DIR, dir);
        const stats = fs.statSync(dirPath);
        const size = getDirectorySize(dirPath);

        sessions.push({
            channel: parsed.channel,
            senderId: parsed.senderId,
            path: dirPath,
            lastModified: stats.mtime,
            size: formatSize(size)
        });
    }

    return sessions.sort((a, b) => b.lastModified.getTime() - a.lastModified.getTime());
}

function listCommand() {
    const sessions = listSessions();

    if (sessions.length === 0) {
        console.log('\nNo active sessions yet.');
        console.log('Sessions will be created when users send messages.\n');
        return;
    }

    console.log(`\n📁 Active Sessions (${sessions.length}):\n`);

    const grouped = sessions.reduce((acc, session) => {
        if (!acc[session.channel]) {
            acc[session.channel] = [];
        }
        acc[session.channel].push(session);
        return acc;
    }, {} as Record<string, SessionInfo[]>);

    for (const [channel, channelSessions] of Object.entries(grouped)) {
        console.log(`  ${channel.toUpperCase()} (${channelSessions.length}):`);
        for (const session of channelSessions) {
            console.log(`    • ${session.senderId}`);
            console.log(`      Last active: ${formatDate(session.lastModified)}`);
            console.log(`      Size: ${session.size}`);
        }
        console.log('');
    }

    console.log('To reset a session:');
    console.log('  npm run sessions -- reset <channel> <senderId>');
    console.log('\nTo view session location:');
    console.log('  npm run sessions -- view <channel> <senderId>');
    console.log('');
}

function resetCommand(channel: string, senderId: string) {
    if (!channel || !senderId) {
        console.error('Error: Please provide channel and senderId');
        console.error('Usage: npm run sessions -- reset <channel> <senderId>');
        console.error('Example: npm run sessions -- reset telegram 123456789');
        process.exit(1);
    }

    const safeSenderId = senderId.replace(/[^a-zA-Z0-9_-]/g, '_');
    const sessionDir = path.join(CHATS_ROOT_DIR, `${channel}_${safeSenderId}`);

    if (!fs.existsSync(sessionDir)) {
        console.error(`\nError: Session not found for ${channel} user ${senderId}\n`);
        process.exit(1);
    }

    // Create reset flag for this user
    if (!fs.existsSync(RESET_FLAGS_DIR)) {
        fs.mkdirSync(RESET_FLAGS_DIR, { recursive: true });
    }

    const resetFlag = path.join(RESET_FLAGS_DIR, `${channel}_${safeSenderId}`);
    fs.writeFileSync(resetFlag, 'reset');

    console.log('');
    console.log('✅ Reset scheduled for next message');
    console.log('');
    console.log(`  Channel: ${channel}`);
    console.log(`  User: ${senderId}`);
    console.log('');
    console.log('The next message from this user will start a fresh conversation.');
    console.log('');
}

function viewCommand(channel: string, senderId: string) {
    if (!channel || !senderId) {
        console.error('Error: Please provide channel and senderId');
        console.error('Usage: npm run sessions -- view <channel> <senderId>');
        process.exit(1);
    }

    const safeSenderId = senderId.replace(/[^a-zA-Z0-9_-]/g, '_');
    const sessionDir = path.join(CHATS_ROOT_DIR, `${channel}_${safeSenderId}`);

    if (!fs.existsSync(sessionDir)) {
        console.error(`\nError: Session not found for ${channel} user ${senderId}\n`);
        process.exit(1);
    }

    const stats = fs.statSync(sessionDir);
    const size = getDirectorySize(sessionDir);

    console.log('');
    console.log('📊 Session Details');
    console.log('');
    console.log(`  Channel: ${channel}`);
    console.log(`  User ID: ${senderId}`);
    console.log(`  Location: ${sessionDir}`);
    console.log(`  Last active: ${formatDate(stats.mtime)}`);
    console.log(`  Size: ${formatSize(size)}`);
    console.log('');

    // List files
    const files = fs.readdirSync(sessionDir);
    if (files.length > 0) {
        console.log('  Files:');
        for (const file of files) {
            const filePath = path.join(sessionDir, file);
            const fileStats = fs.statSync(filePath);
            if (fileStats.isFile()) {
                console.log(`    • ${file} (${formatSize(fileStats.size)})`);
            } else {
                console.log(`    • ${file}/ (directory)`);
            }
        }
    }
    console.log('');
}

function main() {
    const args = process.argv.slice(2);
    const command = args[0];

    switch (command) {
        case 'list':
            listCommand();
            break;
        case 'reset':
            resetCommand(args[1], args[2]);
            break;
        case 'view':
            viewCommand(args[1], args[2]);
            break;
        default:
            console.log('');
            console.log('TinyClaw Session Management');
            console.log('');
            console.log('Usage:');
            console.log('  npm run sessions -- list                    List all active sessions');
            console.log('  npm run sessions -- reset <channel> <id>    Reset a user\'s conversation');
            console.log('  npm run sessions -- view <channel> <id>     View session details');
            console.log('');
            console.log('Examples:');
            console.log('  npm run sessions -- list');
            console.log('  npm run sessions -- reset telegram 123456789');
            console.log('  npm run sessions -- view whatsapp 1234567890_c_us');
            console.log('');
            process.exit(1);
    }
}

main();
