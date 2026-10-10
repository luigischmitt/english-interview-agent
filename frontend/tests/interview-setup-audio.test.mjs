import assert from "node:assert/strict";
import test from "node:test";
import { defaultInterviewRoomPreferences, getInterviewSetupSummary, getInterviewerAudioMode, withInterviewerAudioMode } from "../src/lib/interview/setup-audio.mjs";

const baseConfig = {
  role: "Staff Platform Engineer",
  seniority: "senior",
  focus: "communication",
  duration: "15",
  playInterviewerAudio: true,
  showQuestionCaptions: true,
  autoCaptureVoice: true,
  candidateCameraEnabled: false,
};

test("spoken interviewer audio is the default and the explicit text mode is reversible", () => {
  assert.equal(defaultInterviewRoomPreferences.playInterviewerAudio, true);
  assert.equal(getInterviewerAudioMode(baseConfig), "audio");
  const textConfig = withInterviewerAudioMode(baseConfig, "text");
  assert.equal(textConfig.playInterviewerAudio, false);
  assert.equal(getInterviewerAudioMode(textConfig), "text");
  assert.deepEqual(withInterviewerAudioMode(textConfig, "audio"), baseConfig);
  assert.equal(textConfig.autoCaptureVoice, true);
});

test("session summary reports interviewer audio, captions, microphone, camera, duration, and long role text", () => {
  const summary = getInterviewSetupSummary(baseConfig, { senior: "Sênior" }, { communication: "Comunicação e clareza" });
  assert.deepEqual(summary, [
    { label: "Cargo", value: "Staff Platform Engineer" },
    { label: "Senioridade", value: "Sênior" },
    { label: "Foco", value: "Comunicação e clareza" },
    { label: "Duração", value: "Até 15 min" },
    { label: "Como o entrevistador fala", value: "Com áudio" },
    { label: "Voz", value: "Echo" },
    { label: "Legendas das perguntas", value: "Ligadas" },
    { label: "Microfone", value: "Inicia após cada pergunta" },
    { label: "Câmera", value: "Desligada" },
  ]);
  assert.equal(getInterviewSetupSummary({ ...baseConfig, voice: "bf_emma" }, {}, {}).find((row) => row.label === "Voz").value, "Emma");

  const textSummary = getInterviewSetupSummary({ ...baseConfig, role: " ", playInterviewerAudio: false, showQuestionCaptions: false, autoCaptureVoice: false, candidateCameraEnabled: true }, {}, {});
  assert.equal(textSummary[0].value, "Não selecionado");
  assert.equal(textSummary[4].value, "Somente texto");
  assert.equal(textSummary[5].value, "Sempre visíveis (somente texto)");
  assert.equal(textSummary[6].value, "Início manual");
  assert.equal(textSummary[7].value, "Prévia local ligada");
  assert.equal(summary.some(({ label }) => label.toLowerCase().includes("minha fala")), false);
});

test("the voice row is left out in text-only mode", () => {
  const summary = getInterviewSetupSummary({ ...baseConfig, voice: "bf_emma", playInterviewerAudio: false }, {}, {});
  assert.equal(summary.some((row) => row.label === "Voz"), false);
});

test("the resume setup summary hides the inferred role, seniority and focus", () => {
  const summary = getInterviewSetupSummary({ ...baseConfig, interviewSource: "resume" }, { senior: "Sênior" }, { communication: "Comunicação e clareza" });
  assert.equal(summary[0].value, "Prática pelo currículo");
  assert.deepEqual(summary.map((row) => row.label).filter((label) => ["Senioridade", "Foco"].includes(label)), []);
});
