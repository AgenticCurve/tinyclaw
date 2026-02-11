#!/usr/bin/env node
/**
 * CLI tool for managing TinyClaw pairing requests
 * Usage:
 *   npm run pairing -- list
 *   npm run pairing -- approve <CODE>
 *   npm run pairing -- allowlist
 */

import {
    listPairingRequests,
    approvePairingCode,
    listApprovedUsers
} from './pairing.js';

function formatDate(isoString: string): string {
    const date = new Date(isoString);
    const now = new Date();
    const diff = now.getTime() - date.getTime();
    const minutes = Math.floor(diff / 60000);
    const hours = Math.floor(minutes / 60);

    if (hours > 0) {
        return `${hours}h ago`;
    } else if (minutes > 0) {
        return `${minutes}m ago`;
    } else {
        return 'just now';
    }
}

function listCommand() {
    const requests = listPairingRequests();

    if (requests.length === 0) {
        console.log('No pending pairing requests.');
        return;
    }

    console.log(`\n📋 Pending Pairing Requests (${requests.length}):\n`);

    for (const req of requests) {
        console.log(`  Code: ${req.code}`);
        console.log(`  Channel: ${req.channel}`);
        console.log(`  Sender: ${req.sender}`);
        console.log(`  Sender ID: ${req.senderId}`);
        console.log(`  Created: ${formatDate(req.createdAt)}`);
        console.log(`  Last seen: ${formatDate(req.lastSeenAt)}`);
        console.log('');
    }

    console.log('To approve a request, run:');
    console.log('  npm run pairing -- approve <CODE>');
    console.log('');
}

function approveCommand(code: string) {
    if (!code) {
        console.error('Error: Please provide a pairing code');
        console.error('Usage: npm run pairing -- approve <CODE>');
        process.exit(1);
    }

    const result = approvePairingCode(code);

    if (result.success && result.request) {
        console.log('');
        console.log('✅ Pairing request approved!');
        console.log('');
        console.log(`  Channel: ${result.request.channel}`);
        console.log(`  Sender: ${result.request.sender}`);
        console.log(`  Sender ID: ${result.request.senderId}`);
        console.log('');
        console.log(`${result.request.sender} can now send messages.`);
        console.log('');
    } else {
        console.error('');
        console.error('❌ Pairing code not found or expired');
        console.error('');
        console.error('Run this to see pending requests:');
        console.error('  npm run pairing -- list');
        console.error('');
        process.exit(1);
    }
}

function allowlistCommand() {
    const users = listApprovedUsers();

    if (users.length === 0) {
        console.log('No approved users yet.');
        return;
    }

    console.log(`\n✅ Approved Users (${users.length}):\n`);

    const grouped = users.reduce((acc, user) => {
        if (!acc[user.channel]) {
            acc[user.channel] = [];
        }
        acc[user.channel].push(user);
        return acc;
    }, {} as Record<string, typeof users>);

    for (const [channel, channelUsers] of Object.entries(grouped)) {
        console.log(`  ${channel.toUpperCase()}:`);
        for (const user of channelUsers) {
            console.log(`    • ${user.sender} (${user.senderId})`);
            console.log(`      Approved: ${formatDate(user.approvedAt)}`);
        }
        console.log('');
    }
}

function main() {
    const args = process.argv.slice(2);
    const command = args[0];

    switch (command) {
        case 'list':
            listCommand();
            break;
        case 'approve':
            approveCommand(args[1]);
            break;
        case 'allowlist':
            allowlistCommand();
            break;
        default:
            console.log('');
            console.log('TinyClaw Pairing Management');
            console.log('');
            console.log('Usage:');
            console.log('  npm run pairing -- list          List pending pairing requests');
            console.log('  npm run pairing -- approve <CODE> Approve a pairing request');
            console.log('  npm run pairing -- allowlist     Show all approved users');
            console.log('');
            process.exit(1);
    }
}

main();
