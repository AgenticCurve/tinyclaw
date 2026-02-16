/**
 * Text-to-speech via Resemble AI.
 *
 * Calls Resemble AI's synthesis endpoint (base64 MP3 response),
 * then converts to OGG/Opus via ffmpeg for Telegram voice messages.
 */

import { spawn } from "child_process";

const RESEMBLE_API_KEY = process.env.RESEMBLE_API_KEY ?? "";
const RESEMBLE_VOICE_UUID = process.env.RESEMBLE_VOICE_UUID || "0c755526";
const SYNTHESIZE_URL = "https://f.cluster.resemble.ai/synthesize";
const VOICES_URL = "https://app.resemble.ai/api/v2/voices";
const MAX_TTS_CHARS = 2_000;
const MAX_RETRIES = 3;

let cachedVoiceUUID: string | null = null;

function log(level: string, message: string): void {
  const ts = new Date().toISOString();
  console.log(`[${ts}] [${level}] [tts] ${message}`);
}

/**
 * Strip markdown formatting for natural speech.
 */
function stripMarkdown(text: string): string {
  return (
    text
      .replace(/```[\s\S]*?```/g, "")
      .replace(/`([^`]+)`/g, "$1")
      .replace(/^#{1,6}\s+/gm, "")
      .replace(/\*\*(.+?)\*\*/g, "$1")
      .replace(/__(.+?)__/g, "$1")
      .replace(/\*(.+?)\*/g, "$1")
      .replace(/_(.+?)_/g, "$1")
      .replace(/~~(.+?)~~/g, "$1")
      .replace(/\[(.+?)\]\(.+?\)/g, "$1")
      .replace(/^[\s]*[-*+]\s+/gm, "")
      .replace(/^[\s]*\d+\.\s+/gm, "")
      .replace(/\n{3,}/g, "\n\n")
      .trim()
  );
}

/**
 * Escape XML/SSML special characters so Resemble doesn't choke.
 */
function escapeForSsml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

/**
 * Convert MP3 buffer to OGG/Opus via ffmpeg.
 */
function mp3ToOgg(mp3Buffer: Buffer): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const child = spawn(
      "ffmpeg",
      ["-i", "pipe:0", "-c:a", "libopus", "-b:a", "48k", "-f", "ogg", "pipe:1"],
      { stdio: ["pipe", "pipe", "pipe"] },
    );

    const chunks: Buffer[] = [];
    let stderr = "";

    child.stdout.on("data", (data: Buffer) => {
      chunks.push(data);
    });
    child.stderr.on("data", (data: Buffer) => {
      stderr += data.toString();
    });

    child.on("close", (code) => {
      if (code !== 0) {
        reject(new Error(`ffmpeg failed (code ${code}): ${stderr.slice(0, 300)}`));
        return;
      }
      resolve(Buffer.concat(chunks));
    });

    child.on("error", (err) => {
      reject(new Error(`Failed to run ffmpeg: ${err.message}. Is ffmpeg installed?`));
    });

    child.stdin.on("error", (err) => {
      if ((err as NodeJS.ErrnoException).code !== "EPIPE") {
        reject(new Error(`ffmpeg stdin error: ${err.message}`));
      }
    });
    child.stdin.write(mp3Buffer);
    child.stdin.end();
  });
}

// --- Resemble AI types ---

interface SynthesizeResponse {
  success: boolean;
  audio_content?: string;
  duration?: number;
  message?: string;
  error_name?: string;
}

interface VoiceItem {
  uuid: string;
  name: string;
  status: string;
  voice_status?: string;
}

interface VoicesResponse {
  success: boolean;
  items: VoiceItem[];
}

async function fetchFirstVoiceUUID(): Promise<string> {
  const res = await fetch(`${VOICES_URL}?page=1&page_size=100`, {
    signal: AbortSignal.timeout(15_000),
    headers: {
      Authorization: `Bearer ${RESEMBLE_API_KEY}`,
    },
  });

  if (!res.ok) {
    throw new Error(`Resemble voices API error ${res.status}`);
  }

  const data = (await res.json()) as VoicesResponse;
  const voice = data.items?.find(
    (v) => v.voice_status === "Ready" || v.status === "finished",
  );

  if (!voice) {
    throw new Error("No ready voices found in Resemble AI account");
  }

  log("INFO", `Auto-selected voice: "${voice.name}" (${voice.uuid})`);
  return voice.uuid;
}

async function getVoiceUUID(): Promise<string> {
  if (RESEMBLE_VOICE_UUID) return RESEMBLE_VOICE_UUID;
  if (cachedVoiceUUID) return cachedVoiceUUID;

  cachedVoiceUUID = await fetchFirstVoiceUUID();
  return cachedVoiceUUID;
}

async function synthesize(text: string, voiceUUID: string): Promise<Buffer> {
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    const res = await fetch(SYNTHESIZE_URL, {
      method: "POST",
      signal: AbortSignal.timeout(60_000),
      headers: {
        Authorization: RESEMBLE_API_KEY,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        voice_uuid: voiceUUID,
        data: text,
        output_format: "mp3",
        sample_rate: 44100,
        use_hd: false,
      }),
    });

    if (res.status === 429 && attempt < MAX_RETRIES) {
      const delay = Math.pow(2, attempt) * 1000;
      log("WARN", `Rate limited (429), retrying in ${delay}ms...`);
      await new Promise((r) => setTimeout(r, delay));
      continue;
    }

    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new Error(`Resemble API error ${res.status}: ${body.slice(0, 200)}`);
    }

    const data = (await res.json()) as SynthesizeResponse;

    if (!data.success) {
      throw new Error(
        `Resemble synthesis failed: ${data.message ?? data.error_name ?? "unknown error"}`,
      );
    }

    if (!data.audio_content) {
      throw new Error("Resemble returned no audio content");
    }

    const cleanBase64 = data.audio_content.replace(/\n/g, "");
    return Buffer.from(cleanBase64, "base64");
  }

  throw new Error("Resemble API: max retries exceeded");
}

/**
 * Convert text to a Telegram-compatible OGG/Opus voice buffer.
 */
export async function textToVoice(text: string): Promise<Buffer> {
  if (!RESEMBLE_API_KEY) {
    throw new Error("RESEMBLE_API_KEY not configured");
  }

  const cleaned = escapeForSsml(stripMarkdown(text)).slice(0, MAX_TTS_CHARS);
  if (!cleaned) {
    throw new Error("No text to convert to speech");
  }

  log("INFO", `Generating speech: ${cleaned.length} chars`);

  const voiceUUID = await getVoiceUUID();
  const mp3Buffer = await synthesize(cleaned, voiceUUID);
  log("INFO", `MP3 received: ${mp3Buffer.length} bytes`);

  const oggBuffer = await mp3ToOgg(mp3Buffer);
  log("INFO", `OGG converted: ${oggBuffer.length} bytes`);

  return oggBuffer;
}
