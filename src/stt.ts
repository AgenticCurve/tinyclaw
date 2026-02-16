/**
 * Speech-to-text via OpenRouter (Gemini Flash).
 *
 * Sends base64-encoded audio to Gemini and returns the transcribed text.
 */

const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions";
const MODEL = "google/gemini-3-flash-preview";

function log(level: string, message: string): void {
  const ts = new Date().toISOString();
  console.log(`[${ts}] [${level}] [stt] ${message}`);
}

/**
 * Transcribe an audio buffer to text using OpenRouter + Gemini Flash.
 *
 * @param audioBuffer - The audio file contents (OGG/Opus from Telegram)
 * @param mimeType - MIME type of the audio (e.g. "audio/ogg")
 * @param apiKey - OpenRouter API key
 */
export async function transcribeAudio(
  audioBuffer: Buffer,
  mimeType: string,
  apiKey: string,
): Promise<string> {
  const base64 = audioBuffer.toString("base64");
  const dataUrl = `data:${mimeType};base64,${base64}`;

  log("INFO", `Transcribing audio: ${audioBuffer.length} bytes (${mimeType})`);

  const res = await fetch(OPENROUTER_URL, {
    method: "POST",
    signal: AbortSignal.timeout(30_000),
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: MODEL,
      messages: [
        {
          role: "user",
          content: [
            {
              type: "text",
              text: "Transcribe this voice message exactly as spoken. Return ONLY the transcribed text, nothing else. No quotes, no labels, no formatting.",
            },
            {
              // OpenRouter routes non-image media (audio) to Gemini via the image_url type
              type: "image_url",
              image_url: { url: dataUrl },
            },
          ],
        },
      ],
    }),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(
      `OpenRouter STT error ${res.status}: ${body.slice(0, 200)}`,
    );
  }

  const data = (await res.json()) as {
    choices?: Array<{ message: { content: string | null } }>;
  };

  const text = data.choices?.[0]?.message?.content?.trim();
  if (!text) {
    throw new Error("OpenRouter returned empty transcription");
  }

  log("INFO", `Transcribed: "${text.slice(0, 100)}${text.length > 100 ? "..." : ""}"`);
  return text;
}
