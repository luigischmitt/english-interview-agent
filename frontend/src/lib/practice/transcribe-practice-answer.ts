import { authorizedFetch } from "@/lib/auth/backend-auth";

const backendBaseUrl = process.env.NEXT_PUBLIC_BACKEND_URL ?? "http://localhost:3001";

function baseAudioType(mimeType: string) {
  const type = mimeType.split(";", 1)[0].toLowerCase();
  if (type === "audio/webm" || type === "audio/mp4" || type === "audio/wav") return type;
  return "audio/webm";
}

export async function transcribePracticeAnswer(blob: Blob, mimeType = blob.type): Promise<{ transcript: string; [key: string]: unknown }> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 25_000);
  try {
    const response = await authorizedFetch(`${backendBaseUrl}/api/v1/transcriptions`, {
      method: "POST",
      headers: { "Content-Type": baseAudioType(mimeType), "x-transcription-provider": "whisper-large-v3-turbo" },
      body: blob,
      signal: controller.signal,
    });
    if (response.status === 413) throw new Error("A gravação ficou longa demais. Tente novamente.");
    if (response.status === 503) throw new Error("A transcrição está indisponível agora. Tente novamente.");
    if (!response.ok) throw new Error("Não foi possível transcrever agora. Tente novamente.");
    return await response.json() as { transcript: string; [key: string]: unknown };
  } catch (error) {
    if (error instanceof Error && error.message.startsWith("A gravação")) throw error;
    if (error instanceof Error && error.message.startsWith("A transcrição")) throw error;
    if (error instanceof Error && error.name === "AbortError") throw new Error("A transcrição demorou demais. Tente novamente.");
    throw new Error("Falha de conexão. Confira sua internet e tente novamente.");
  } finally {
    clearTimeout(timeout);
  }
}
