#!/usr/bin/env node
/**
 * HTTP server for the "Discuss" voice feature.
 *
 * Serves the Mini App HTML and proxies OpenAI Realtime API setup:
 * - POST /api/session — mint ephemeral token + return Q&A context
 * - POST /api/sdp — proxy SDP exchange with OpenAI
 */

import http from "http";
import fs from "fs";
import path from "path";

const SCRIPT_DIR = path.resolve(__dirname, "..");
const OPENAI_API_KEY = process.env.OPENAI_API_KEY ?? "";
const PORT = parseInt(process.env.CALL_SERVER_PORT ?? "3147", 10);
const CALL_SERVER_URL = process.env.CALL_SERVER_URL ?? "";
const DISCUSS_DIR = path.join(SCRIPT_DIR, ".tinyclaw/discuss");
const MAX_INSTRUCTIONS_CHARS = 20_000;
const HTML_PATH = path.join(SCRIPT_DIR, "public", "callai.html");
const LOG_FILE = path.join(SCRIPT_DIR, ".tinyclaw/logs/call-server.log");

let cachedHtml = "";

// Ensure directories exist
[DISCUSS_DIR, path.dirname(LOG_FILE)].forEach((dir) => {
    if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
    }
});

interface QAEntry {
    question: string;
    answer: string;
    timestamp: number;
}

function log(level: string, message: string): void {
    const ts = new Date().toISOString();
    const logMessage = `[${ts}] [${level}] [call-server] ${message}\n`;
    console.log(logMessage.trim());
    fs.appendFileSync(LOG_FILE, logMessage);
}

/**
 * Load Q&A history for a user from disk.
 */
function loadQAHistory(
    channel: string,
    senderId: string,
): QAEntry[] {
    const safeSenderId = senderId.replace(/[^a-zA-Z0-9_-]/g, "_");
    const historyFile = path.join(DISCUSS_DIR, `${channel}_${safeSenderId}.json`);

    try {
        const data = fs.readFileSync(historyFile, "utf8");
        return JSON.parse(data) as QAEntry[];
    } catch {
        return [];
    }
}

/**
 * Build system instructions from Q&A history.
 * Includes all pairs up to `upTo` index, with the latest one highlighted.
 * If total exceeds MAX_INSTRUCTIONS_CHARS, trims earlier exchanges (keeps latest).
 */
function buildInstructions(history: QAEntry[], upTo: number): string {
    const entries = history.slice(0, upTo + 1);
    if (entries.length === 0) {
        return "# Role\nYou are a voice assistant. The user wants to have a conversation. Be helpful and concise.";
    }

    const latest = entries[entries.length - 1];

    const preamble =
        "# Role\n" +
        "You are a voice assistant continuing a discussion about a prior conversation with the user.\n\n" +
        "# Response Style\n" +
        "- 3-5 sentences per turn. Longer only when the user explicitly asks for detail.\n" +
        "- Be direct. No filler, no preamble.\n" +
        "- Match the user's language. Default to English.\n\n";

    const latestSection =
        "# Latest exchange (the one the user wants to discuss)\n\n" +
        `User asked: ${latest.question}\n\n` +
        `Assistant answered: ${latest.answer}\n\n` +
        "The user is now calling to discuss this answer further. Use the exchange above as the primary context, " +
        "but you may reference earlier conversation history if relevant.\n";

    // Budget for earlier history = total limit minus fixed sections
    const budgetForEarlier = MAX_INSTRUCTIONS_CHARS - preamble.length - latestSection.length;

    // Build earlier exchanges from most recent to oldest, keeping what fits
    const earlier = entries.slice(0, -1);
    const keptExchanges: string[] = [];
    let usedChars = 0;

    for (let i = earlier.length - 1; i >= 0; i--) {
        const block =
            `**Exchange ${i + 1}:**\n` +
            `User: ${earlier[i].question}\n` +
            `Assistant: ${earlier[i].answer}\n\n`;

        if (usedChars + block.length > budgetForEarlier) {
            break;
        }
        keptExchanges.unshift(block);
        usedChars += block.length;
    }

    let instructions = preamble;

    if (keptExchanges.length > 0) {
        const trimmedCount = earlier.length - keptExchanges.length;
        instructions += "# Earlier conversation history";
        if (trimmedCount > 0) {
            instructions += ` (${trimmedCount} older exchange(s) omitted)`;
        }
        instructions += "\n\n" + keptExchanges.join("");
    }

    instructions += latestSection;

    return instructions;
}

// ---------------------------------------------------------------------------
// HTTP helpers
// ---------------------------------------------------------------------------

const MAX_BODY_SIZE = 1_000_000;

function parseJsonBody(
    req: http.IncomingMessage,
): Promise<Record<string, unknown>> {
    return new Promise((resolve, reject) => {
        let body = "";
        req.on("data", (chunk: Buffer) => {
            body += chunk.toString();
            if (body.length > MAX_BODY_SIZE) {
                req.destroy();
                reject(new Error("Request body too large"));
            }
        });
        req.on("end", () => {
            try {
                resolve(JSON.parse(body));
            } catch {
                reject(new Error("Invalid JSON"));
            }
        });
        req.on("error", reject);
    });
}

function sendJson(
    res: http.ServerResponse,
    status: number,
    data: unknown,
): void {
    res.writeHead(status, {
        "Content-Type": "application/json",
        "Access-Control-Allow-Origin": CALL_SERVER_URL || "*",
        "Access-Control-Allow-Headers": "Content-Type",
    });
    res.end(JSON.stringify(data));
}

// ---------------------------------------------------------------------------
// Route: POST /api/session
// ---------------------------------------------------------------------------

async function handleSession(
    req: http.IncomingMessage,
    res: http.ServerResponse,
): Promise<void> {
    const body = await parseJsonBody(req);
    const senderId = body.senderId as string;
    const channel = body.channel as string;
    const upTo = typeof body.upTo === "number" ? body.upTo : -1;

    if (!senderId || !channel) {
        sendJson(res, 400, { error: "senderId and channel are required" });
        return;
    }

    // Load Q&A history
    const history = loadQAHistory(channel, senderId);
    if (history.length === 0) {
        sendJson(res, 404, { error: "No conversation history found" });
        return;
    }

    const effectiveUpTo = upTo >= 0 ? Math.min(upTo, history.length - 1) : history.length - 1;

    // Mint ephemeral token from OpenAI
    const tokenRes = await fetch(
        "https://api.openai.com/v1/realtime/client_secrets",
        {
            method: "POST",
            signal: AbortSignal.timeout(15_000),
            headers: {
                Authorization: `Bearer ${OPENAI_API_KEY}`,
                "Content-Type": "application/json",
            },
            body: JSON.stringify({
                session: {
                    type: "realtime",
                    model: "gpt-4o-mini-realtime-preview",
                    output_modalities: ["audio"],
                    audio: {
                        input: {
                            format: { type: "audio/pcm", rate: 24000 },
                            transcription: { model: "gpt-4o-mini-transcribe" },
                            turn_detection: {
                                type: "semantic_vad",
                                eagerness: "medium",
                                create_response: true,
                                interrupt_response: true,
                            },
                            noise_reduction: { type: "near_field" },
                        },
                        output: {
                            format: { type: "audio/pcm", rate: 24000 },
                            voice: "ash",
                        },
                    },
                },
            }),
        },
    );

    if (!tokenRes.ok) {
        const errText = await tokenRes.text().catch(() => "");
        log(
            "ERROR",
            `Token mint failed: ${tokenRes.status} ${errText.slice(0, 200)}`,
        );
        sendJson(res, 502, { error: "Failed to mint ephemeral token" });
        return;
    }

    const tokenData = (await tokenRes.json()) as {
        client_secret?: { value: string };
        value?: string;
    };
    const token = tokenData.client_secret?.value ?? tokenData.value;
    if (!token) {
        log("ERROR", "No token in OpenAI response");
        sendJson(res, 502, { error: "Invalid token response from OpenAI" });
        return;
    }

    // Build instructions from Q&A history
    const instructions = buildInstructions(history, effectiveUpTo);

    const clientIp =
        req.headers["x-forwarded-for"] ?? req.socket.remoteAddress ?? "unknown";

    sendJson(res, 200, {
        token,
        instructions,
        totalExchanges: effectiveUpTo + 1,
    });
    log(
        "INFO",
        `Session created for ${channel}_${senderId} (upTo=${effectiveUpTo}, exchanges=${effectiveUpTo + 1}, ip=${clientIp})`,
    );
}

// ---------------------------------------------------------------------------
// Route: POST /api/sdp
// ---------------------------------------------------------------------------

async function handleSdp(
    req: http.IncomingMessage,
    res: http.ServerResponse,
): Promise<void> {
    const body = await parseJsonBody(req);
    const sdp = body.sdp as string;
    const token = body.token as string;
    if (!sdp || !token) {
        sendJson(res, 400, { error: "sdp and token required" });
        return;
    }

    const sdpRes = await fetch("https://api.openai.com/v1/realtime/calls", {
        method: "POST",
        signal: AbortSignal.timeout(15_000),
        headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/sdp",
        },
        body: sdp,
    });

    if (!sdpRes.ok) {
        const errText = await sdpRes.text().catch(() => "");
        log(
            "ERROR",
            `SDP exchange failed: ${sdpRes.status} ${errText.slice(0, 200)}`,
        );
        sendJson(res, 502, { error: "SDP exchange failed" });
        return;
    }

    const clientIp =
        req.headers["x-forwarded-for"] ?? req.socket.remoteAddress ?? "unknown";
    const answerSdp = await sdpRes.text();
    sendJson(res, 200, { sdp: answerSdp });
    log("INFO", `SDP exchange completed (ip=${clientIp})`);
}

// ---------------------------------------------------------------------------
// Server
// ---------------------------------------------------------------------------

function startCallServer(): void {
    if (!OPENAI_API_KEY) {
        log("INFO", "OPENAI_API_KEY not set — call server disabled");
        return;
    }

    try {
        cachedHtml = fs.readFileSync(HTML_PATH, "utf8");
    } catch (err) {
        log("ERROR", `Failed to load ${HTML_PATH}: ${(err as Error).message}`);
        return;
    }

    const server = http.createServer(async (req, res) => {
        const url = new URL(req.url ?? "/", `http://localhost:${PORT}`);

        // CORS preflight
        if (req.method === "OPTIONS") {
            res.writeHead(204, {
                "Access-Control-Allow-Origin": CALL_SERVER_URL || "*",
                "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
                "Access-Control-Allow-Headers": "Content-Type",
            });
            res.end();
            return;
        }

        try {
            // Serve Mini App HTML
            if (
                req.method === "GET" &&
                (url.pathname === "/" || url.pathname === "/call")
            ) {
                res.writeHead(200, {
                    "Content-Type": "text/html; charset=utf-8",
                    "Cache-Control": "no-cache",
                });
                res.end(cachedHtml);
                return;
            }

            // Health check
            if (req.method === "GET" && url.pathname === "/api/health") {
                sendJson(res, 200, { ok: true, port: PORT });
                return;
            }

            // API: create session
            if (req.method === "POST" && url.pathname === "/api/session") {
                await handleSession(req, res);
                return;
            }

            // API: SDP exchange
            if (req.method === "POST" && url.pathname === "/api/sdp") {
                await handleSdp(req, res);
                return;
            }

            sendJson(res, 404, { error: "Not found" });
        } catch (err) {
            log("ERROR", `Request error: ${(err as Error).message}`);
            sendJson(res, 500, { error: "Internal server error" });
        }
    });

    server.listen(PORT, () => {
        log("INFO", `Call server listening on port ${PORT}`);
    });
}

// Start the server
startCallServer();
