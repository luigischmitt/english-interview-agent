# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

The primary users are Brazilian developers and other technology professionals preparing for professional interviews in English, initially for technology and international roles. The typical user is technically capable and works with English day to day, but has B1/B2 English and can lose clarity and confidence under interview pressure.

## Product Purpose

English Interview Agent provides realistic English interview practice so a candidate's technical competence can be perceived with clarity, confidence, and precision. The current experience presents a fixed interview question sequence. Coherent follow-ups are a confirmed intended product direction, not a current capability. Its intended feedback model is specific, respectful, and practical, evaluating the content of the answer, English communication, and vocal delivery when that capability is implemented.

Success means helping the candidate sustain and communicate an answer under pressure. The product does not require perfect English or aim to eliminate a Brazilian accent.

## Positioning

The product focuses on English communication under interview pressure rather than treating an AI interview simulation as the complete value. It prioritizes difficulties recurring for Brazilian Portuguese speakers: pauses, hesitation, pacing, intelligibility, pronunciation, word stress and intonation, articles, prepositions, verb tenses, literal translations, false cognates, language habits, and the difference between technical answer quality and how that answer is communicated in English.

## Operating Context

Candidates use the product to prepare for professional interviews, initially in technology and international hiring contexts. The current session is conducted in English with a fixed question sequence; coherent follow-ups are an intended future interaction model. The interviewer question can be spoken through the Kokoro speech route and remains visible as text when playback is unavailable. The candidate answers by speaking; only a completed, non-empty voice transcript can be submitted. Interview sessions and submitted transcripts are persisted to the candidate's private account when available; skipped questions do not create answer turns, and degraded outcomes must remain truthful when account synchronization fails.

## Capabilities and Constraints

- The current web app supports authentication, account recovery, an authenticated root shell, interview setup, a voice-only interview room, local microphone capture, Kokoro question playback, final voice-transcript persistence, a Progress view backed by real interview data, and settings. The public/authenticated two-state root is an approved ENG-29 contract documented in `docs/eng-28-home-redesign.md`; it is not yet implemented.
- Interview setup includes target role, seniority, practice focus, session length, and question count.
- The room must preserve spoken interviewer questions, final-transcript-only voice answer submission, question/session progress, microphone permission and local capture behavior, persistence status, and retry/skip/end recovery when microphone or transcription fails. The candidate has no editable answer field.
- Progress owns its real loading, error, empty, completed-session metrics, duration, answer-count, and session-history states. Other surfaces should hand off to Progress instead of duplicating its data or making new progress calls.
- Feedback and deeper pronunciation/transcription analysis are not established capabilities in the current evidence. Do not represent unsupported AI analysis, pronunciation scores, or future integrations as available product behavior.
- Avatar work, new camera or microphone integrations, analytics, and unrelated backend changes are outside the approved Home redesign scope.
- Authentication and protected routes must remain secure. Public access to the root does not make interview, Progress, or other protected views public; safe return paths must be preserved.

## Brand Commitments

- Product name: English Interview Agent.
- The voice is clear, respectful, practical, and confidence-building under pressure.
- The product speaks about clarity, intelligibility, confidence, and precision; it does not frame a Brazilian accent as a defect or promise native-like English.
- User-facing English should favor short, familiar language appropriate for B1/B2 readers and interview practice.
- The product must not imply that small imperfections are serious failures. Feedback is prioritized by impact on understanding and professional credibility.

## Evidence on Hand

- `AGENTS.md` records the audience, product purpose, differentiator, feedback principles, interview realism, pressure progression, and separation of technical content from English communication and vocal delivery.
- `frontend/src/app/page.tsx` contains the current authenticated shell, interview setup, room, local microphone capture, Kokoro playback, persistence status, Progress view, and settings. The approved public/authenticated root direction is documented separately in `docs/eng-28-home-redesign.md` and is not evidence of an implemented public root.
- `frontend/src/components/auth/` and `frontend/src/lib/supabase/` contain the authentication and session-guard flow.
- `frontend/src/lib/interview/` contains fixed interview questions, speech playback, interview types, persistence-related behavior, and voice-related behavior.
- `backend/src/speech/` contains the Kokoro speech provider and fallback provider paths.
- `docs/eng-28-home-redesign.md` is the approved ENG-28 surface direction and implementation contract for the Home; it is not a substitute for this product record.
- No verified testimonials, customer logos, benchmarks, outcome metrics, pronunciation scores, or evidence of connected AI analysis are present. Future work must not fabricate them.

## Product Principles

1. Make technical competence understandable in English under pressure.
2. Treat clarity and intelligibility as communication outcomes, not accent elimination.
3. Separate technical answer quality from English communication and vocal delivery.
4. Keep practice realistic and pressure-aware while concentrating most feedback after a useful interview block.
5. Make feedback specific, respectful, actionable, and prioritized by impact.

## Accessibility & Inclusion

The product must support candidates with B1/B2 English without shame or unnecessary jargon. It must not stigmatize Brazilian Portuguese accents or treat minor imperfections as major failures. Interviewer questions stay visible as text when playback is unavailable; microphone or transcription failures offer retry and explicit skip/end actions without a written-answer fallback. Keyboard access, clear labels, focus/validation feedback, readable contrast, responsive layouts, and reduced-motion alternatives are required for the web experience.
