import assert from "node:assert/strict";
import test from "node:test";
import { finalVoiceTranscription, transcriptionFailureMessage } from "../src/lib/interview/transcription-state.mjs";

test("the batch complete event is the only source of a submittable transcript", () => {
  assert.deepEqual(finalVoiceTranscription({
    status: "complete",
    provider: "whisper-large-v3-turbo",
    transcript: "  I led the migration.  ",
  }), {
    status: "available",
    value: { provider: "whisper-large-v3-turbo", transcript: "I led the migration." },
  });
});

test("empty or unsuccessful completion events remain recoverable failures", () => {
  assert.deepEqual(finalVoiceTranscription({ status: "complete", transcript: "  " }), {
    status: "failed",
    message: "A transcrição não foi concluída. Tente gravar novamente, pule a pergunta ou encerre a prática.",
  });
  assert.deepEqual(finalVoiceTranscription({ status: "failed", code: "NO_SPEECH_RECOGNIZED" }), {
    status: "failed",
    message: "Não conseguimos reconhecer sua fala. Tente gravar novamente, pule a pergunta ou encerre a prática.",
  });
  assert.match(transcriptionFailureMessage("NO_SPEECH_DETECTED"), /Confira o microfone/);
  assert.match(transcriptionFailureMessage("SPEECH_TOO_SHORT"), /curta demais/);
  assert.match(transcriptionFailureMessage("STREAM_CAPACITY_REACHED"), /A sala está processando/);
  assert.match(transcriptionFailureMessage("TRANSCRIPTION_CAPACITY_REACHED"), /Aguarde um instante/);
  assert.match(transcriptionFailureMessage("UNSUPPORTED_PCM_PROTOCOL"), /formato de áudio.*não é compatível/);
  assert.match(transcriptionFailureMessage("TRANSCRIPTION_NOT_CONFIGURED"), /não está disponível/);
});

test("structured rate limits receive concise retry guidance without provider details", () => {
  assert.match(transcriptionFailureMessage("UPSTREAM_RATE_LIMITED"), /ocupado.*tente novamente/);
  assert.doesNotMatch(transcriptionFailureMessage("UPSTREAM_RATE_LIMITED"), /429|OpenRouter/i);
  assert.match(transcriptionFailureMessage("UNKNOWN_CODE"), /Tente gravar novamente/);
});

test("stream setup and capacity errors offer retry, skip, and end without naming providers", () => {
  for (const code of [
    "STREAM_CAPACITY_REACHED",
    "TRANSCRIPTION_CAPACITY_REACHED",
    "UNSUPPORTED_PCM_PROTOCOL",
    "TRANSCRIPTION_NOT_CONFIGURED",
    "NO_SPEECH_DETECTED",
    "SPEECH_TOO_SHORT",
  ]) {
    const message = transcriptionFailureMessage(code);
    assert.match(message, /tente (?:novamente|gravar novamente|em outro navegador)/i, code);
    assert.match(message, /pule a pergunta/, code);
    assert.match(message, /encerre a prática/, code);
    assert.doesNotMatch(message, /OpenRouter|Whisper|Azure|\b429\b/i, code);
  }
});
