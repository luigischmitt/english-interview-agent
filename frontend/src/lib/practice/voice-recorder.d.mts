export type VoiceRecorderState = "idle" | "requesting" | "recording" | "processing" | "error";
export type VoiceRecording = { blob: Blob; mimeType: string; durationMs: number };
export function chooseAudioMimeType(mediaRecorder?: { isTypeSupported?: (type: string) => boolean } | null): string;
export function createVoiceRecorder(options?: {
  mediaDevices?: { getUserMedia: (constraints: { audio: boolean }) => Promise<MediaStream> };
  MediaRecorderClass?: new (stream: MediaStream, options?: { mimeType?: string }) => MediaRecorder;
  now?: () => number;
  setTimeoutFn?: typeof setTimeout;
  clearTimeoutFn?: typeof clearTimeout;
  maxSeconds?: number;
  minDurationMs?: number;
  onStateChange?: (state: VoiceRecorderState) => void;
}): { start: () => Promise<null>; stop: () => Promise<VoiceRecording | null>; completed: () => Promise<VoiceRecording | null>; cancel: () => void; readonly state: VoiceRecorderState };
