"use client";

import { InterviewReport } from "@/app/components/interview-report";
import type { InterviewReportResult } from "@/lib/interview/report";
import type { AzureMetricSummary } from "@/lib/interview/report-metrics.mjs";
import type { InterviewConfig } from "@/lib/interview/types";

export function ReportPreview() {
  const turns = [
    { sequenceNumber: 1, question: "Tell me about a system you improved and how you measured the result.", answer: "At my last company, I improved the checkout service. We had too many timeouts, so I first checked our traces and found one slow query. I added an index and worked with the team to roll it out safely. The timeout rate dropped from four percent to less than one percent, and we kept monitoring it after release." },
    { sequenceNumber: 3, question: "How do you handle a disagreement about a technical decision?", answer: "I try to understand what problem each person is solving. In one project, we disagreed about using a queue. I shared the traffic data, and we tested both options with a small prototype. We chose the simpler design and documented when we might revisit it." },
    { sequenceNumber: 5, question: "What would you do if a release caused an unexpected production issue?", answer: "First, I would check the impact and communicate with the team. If customers are affected, I would roll back or disable the change. After that, I would help investigate the cause and add a check so we can catch the same issue earlier." },
  ];
  const result: InterviewReportResult = {
    model: "preview", analysisVersion: "preview", technicalContent: {
      summary: "Você explicou decisões técnicas com contexto e resultados. O próximo passo é deixar o impacto ainda mais fácil de acompanhar, conectando cada ação a uma evidência.",
      strengths: [{ sequenceNumber: 1, evidence: "The timeout rate dropped...", explanation: "Trouxe um resultado concreto para mostrar o efeito da mudança." }],
      gaps: [{ sequenceNumber: 3, evidence: "we chose the simpler design", explanation: "O critério de decisão poderia ficar mais explícito." }],
    },
    turns: [
      { sequenceNumber: 1, technicalStrengths: [{ sequenceNumber: 1, evidence: "The timeout rate dropped...", explanation: "Trouxe um resultado concreto para mostrar o efeito da mudança." }], technicalGaps: [], englishPatterns: [{ type: "GRAMMAR", sequenceNumber: 1, evidence: "I explained to my manager about the issue", suggestion: "Use “explained the issue to my manager”.", rephrasedExample: "I explained the issue to my manager.", why: "Em português, “explicar algo a alguém” costuma colocar a pessoa depois do verbo; em inglês, a estrutura mais natural é explicar algo para alguém." }] },
      { sequenceNumber: 3, technicalStrengths: [], technicalGaps: [{ sequenceNumber: 3, evidence: "we chose the simpler design", explanation: "Diga qual critério tornou essa opção melhor para o time." }], englishPatterns: [{ type: "WORD_CHOICE", sequenceNumber: 3, evidence: "we made a test", suggestion: "Prefira “we ran a test”.", rephrasedExample: "We ran a small test with a prototype.", why: "“Fazer um teste” é uma tradução direta comum; em inglês, “run a test” é a combinação mais usada." }] },
      { sequenceNumber: 5, technicalStrengths: [], technicalGaps: [], englishPatterns: [] },
    ],
    englishCommunication: { clarity: "MOSTLY_CLEAR", evidenceStatus: "SUFFICIENT", patterns: [] },
    priorities: [
      { area: "TECHNICAL_CONTENT", sequenceNumber: 3, evidence: "we chose the simpler design", focus: "Explique o critério por trás da decisão.", exercise: "Conte a mesma história e inclua uma frase sobre o critério escolhido." },
      { area: "ENGLISH_COMMUNICATION", sequenceNumber: 1, evidence: "explained to my manager about", focus: "Pratique a estrutura de “explain”.", exercise: "Crie três frases com “explain something to someone”." },
      { area: "TECHNICAL_CONTENT", sequenceNumber: 5, evidence: "check the impact", focus: "Inclua como você manteria as pessoas informadas.", exercise: "Resuma um plano de resposta em três passos." },
    ],
  };
  const azureSummary: AzureMetricSummary = {
    accuracy: { mean: 82, sampleCount: 3, totalDurationMs: 57_000 }, fluency: { mean: 76, sampleCount: 3, totalDurationMs: 57_000 }, prosody: { mean: 79, sampleCount: 3, totalDurationMs: 57_000 },
    answers: [
      { sequenceNumber: 1, scores: { accuracy: 78, fluency: 72, prosody: 80 }, durationMs: 22_000, delivery: { wordsPerMinute: 128, pauseCount: 5, longestPauseMs: 1_300, fillerCount: 3, fillers: ["um", "uh", "like"] }, sentences: [{ sentenceIndex: 0, text: "I worked on the tree cache and improved the throughput.", startMs: 0, endMs: 4_000, score: 68, problemWords: [{ word: "three", score: 48, errorType: "phoneme", worstPhoneme: "θ" }, { word: "throughput", score: 57, errorType: "phoneme", worstPhoneme: "θ" }] }, { sentenceIndex: 1, text: "We reduced the response time by twenty percent.", startMs: 4_000, endMs: 7_000, score: 85 }], clips: [{ sentenceIndex: 0, startMs: 0, endMs: 4_000, path: "preview/clip.webm" }] },
      { sequenceNumber: 3, scores: { accuracy: 85, fluency: 80, prosody: 78 }, durationMs: 18_000, delivery: { wordsPerMinute: 140, pauseCount: 2, longestPauseMs: 800, fillerCount: 2 }, sentences: [{ sentenceIndex: 0, text: "We tested both options with a small prototype.", startMs: 0, endMs: 3_000, score: 82 }] },
      { sequenceNumber: 5, scores: { accuracy: 83, fluency: 77, prosody: 79 }, durationMs: 17_000, delivery: { wordsPerMinute: 122, pauseCount: 3, longestPauseMs: 1_100, fillerCount: 1 }, sentences: [{ sentenceIndex: 0, text: "I would check the impact and communicate with the team.", startMs: 0, endMs: 3_000, score: 79 }] },
    ],
  };
  const config: InterviewConfig = { role: "Senior Software Engineer", seniority: "senior", focus: "balanced", duration: "20", questionCount: "3", playInterviewerAudio: true, showInterviewerCharacter: false, showQuestionCaptions: true, candidateCameraEnabled: false, autoCaptureVoice: false, interviewSource: "manual" };
  return <main className="min-h-screen bg-cream px-4 py-8 sm:px-8"><InterviewReport config={config} elapsed="18:42" totalClock="20:00" answerCount={3} persistenceLabel="Relatório de demonstração" persistenceMessage={null} feedbackSyncMessage={null} reportState={{ status: "ready", result }} reportCaption="Analisando" turns={turns} azureSummary={azureSummary} coverage={{ available: 3, pending: 0, total: 3 }} onLeave={() => {}} progressRecords={[]} historical={false} /></main>;
}
