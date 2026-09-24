export type VoiceTranscription = {
  transcript: string;
  assessment: {
    accuracyScore: number | null;
    fluencyScore: number | null;
    prosodyScore: number | null;
    pronunciationScore: number | null;
    words: Array<{ word: string; accuracyScore: number | null; errorType: string | null }>;
  };
};

const sampleRate = 16_000;

function createWav(samples: Float32Array): Blob {
  const buffer = new ArrayBuffer(44 + samples.length * 2);
  const view = new DataView(buffer);
  const writeString = (offset: number, value: string) => {
    for (let index = 0; index < value.length; index += 1) view.setUint8(offset + index, value.charCodeAt(index));
  };

  writeString(0, "RIFF");
  view.setUint32(4, 36 + samples.length * 2, true);
  writeString(8, "WAVE");
  writeString(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  writeString(36, "data");
  view.setUint32(40, samples.length * 2, true);

  samples.forEach((sample, index) => view.setInt16(44 + index * 2, Math.max(-1, Math.min(1, sample)) * 0x7fff, true));
  return new Blob([buffer], { type: "audio/wav" });
}

async function convertToAzureWav(recording: Blob): Promise<Blob> {
  const context = new AudioContext();
  try {
    const decoded = await context.decodeAudioData(await recording.arrayBuffer());
    const frameCount = Math.ceil(decoded.duration * sampleRate);
    const offlineContext = new OfflineAudioContext(1, frameCount, sampleRate);
    const source = offlineContext.createBufferSource();
    source.buffer = decoded;
    source.connect(offlineContext.destination);
    source.start();
    const rendered = await offlineContext.startRendering();
    return createWav(rendered.getChannelData(0));
  } finally {
    await context.close();
  }
}

export async function requestVoiceTranscription(recording: Blob, endpoint: string): Promise<VoiceTranscription> {
  const audio = await convertToAzureWav(recording);
  const response = await fetch(endpoint, {
    method: "POST",
    headers: { "content-type": "audio/wav" },
    body: audio,
  });

  if (!response.ok) {
    const data = (await response.json().catch(() => null)) as { error?: { message?: string } } | null;
    throw new Error(data?.error?.message ?? "A transcrição não está disponível agora.");
  }

  return await response.json() as VoiceTranscription;
}
