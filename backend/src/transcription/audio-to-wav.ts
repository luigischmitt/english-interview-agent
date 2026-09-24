import { spawn } from "node:child_process";
import type { AudioFormat } from "./types.js";

export type AudioConverter = (audio: Buffer, format: AudioFormat, timeoutMs?: number) => Promise<Buffer>;

/** Convert containerized browser audio entirely in memory; no user audio reaches disk. */
export function createAudioToWav(options: {
  spawnProcess?: typeof spawn;
  timeoutMs?: number;
  maxOutputBytes?: number;
} = {}): AudioConverter {
  const spawnProcess = options.spawnProcess ?? spawn;
  const timeoutMs = options.timeoutMs ?? 5_000;
  const maxOutputBytes = options.maxOutputBytes ?? 12 * 1024 * 1024;
  return (audio, format, budgetMs = timeoutMs) => new Promise((resolve, reject) => {
    if (format !== "webm" && format !== "mp4" && format !== "wav") return reject(new Error("Unsupported audio format"));
    const args = format === "wav"
      ? ["-nostdin", "-hide_banner", "-loglevel", "error", "-i", "pipe:0", "-ac", "1", "-ar", "16000", "-sample_fmt", "s16", "-f", "wav", "pipe:1"]
      : ["-nostdin", "-hide_banner", "-loglevel", "error", "-i", "pipe:0", "-vn", "-ac", "1", "-ar", "16000", "-sample_fmt", "s16", "-f", "wav", "pipe:1"];
    let child: ReturnType<typeof spawn>;
    try { child = spawnProcess("ffmpeg", args, { stdio: ["pipe", "pipe", "ignore"] }); }
    catch { reject(new Error("Audio conversion unavailable")); return; }
    if (!child.stdin || !child.stdout) { child.kill("SIGKILL"); reject(new Error("Audio conversion unavailable")); return; }
    const chunks: Buffer[] = [];
    let bytes = 0;
    let settled = false;
    const finish = (error?: Error, output?: Buffer) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (error) reject(error);
      else resolve(output!);
    };
    const timer = setTimeout(() => { child.kill("SIGKILL"); finish(new Error("Audio conversion timed out")); }, Math.max(1, Math.min(timeoutMs, budgetMs)));
    child.stdout.on("data", (part: Buffer) => {
      bytes += part.length;
      if (bytes > maxOutputBytes) { child.kill("SIGKILL"); finish(new Error("Converted audio too large")); return; }
      chunks.push(part);
    });
    child.on("error", () => finish(new Error("Audio conversion unavailable")));
    child.on("close", (code) => {
      if (code !== 0 || bytes < 44) finish(new Error("Audio conversion failed"));
      else finish(undefined, Buffer.concat(chunks, bytes));
    });
    child.stdin.on("error", () => finish(new Error("Audio conversion failed")));
    child.stdin.end(audio);
  });
}
